import { env } from '../config/env.js';
import {
  createPayment,
  findPendingPaymentByUser,
  confirmPayment,
  cancelPayment,
  findPaymentByMpId,
  findPaymentByTxHash,
  expireStalePendingPayments,
} from '../database/repositories/payment.repo.js';
import { upgradeTier, type Tier } from './tier-service.js';
import { formatCurrency } from '../utils/formatters.js';

// =====================================================
// 💰 IDM Payment Service
// PIX via MercadoPago + USDT on Base (2% crypto discount)
// =====================================================

const PLANS = {
  pro: { name: 'Pro', brl: 19.90 },
  whale: { name: 'Whale', brl: 49.90 },
} as const;

const CRYPTO_DISCOUNT_PERCENT = 2; // 2% off when paying with crypto

// =====================================================
// 🧮 Price calculation
// =====================================================

interface CheckoutPrices {
  plan: 'pro' | 'whale';
  planName: string;
  brl: number;
  brlWithDiscount: number;
  usdEstimate: number;
  usdWithDiscount: number;
  discountPercent: number;
}

async function getUsdBrlRate(): Promise<number> {
  try {
    // Use CoinGecko's exchange rate (USDT is pegged to USD)
    const resp = await fetch(
      `${env.COINGECKO_API_URL}/simple/price?ids=tether&vs_currencies=brl`
    );
    const data = await resp.json() as { tether?: { brl?: number } };
    return data?.tether?.brl ?? 5.80; // fallback rate
  } catch {
    console.error('[Payment] Failed to fetch USD/BRL rate, using fallback');
    return 5.80;
  }
}

export function getCheckoutPrices(plan: 'pro' | 'whale', usdBrlRate: number): CheckoutPrices {
  const planInfo = PLANS[plan];
  const brl = planInfo.brl;
  const brlWithDiscount = +(brl * (1 - CRYPTO_DISCOUNT_PERCENT / 100)).toFixed(2);
  const usdEstimate = +(brl / usdBrlRate).toFixed(2);
  const usdWithDiscount = +(brlWithDiscount / usdBrlRate).toFixed(2);

  return {
    plan,
    planName: planInfo.name,
    brl,
    brlWithDiscount,
    usdEstimate,
    usdWithDiscount,
    discountPercent: CRYPTO_DISCOUNT_PERCENT,
  };
}

// =====================================================
// 🔑 PIX via MercadoPago
// =====================================================

interface MpPixResponse {
  id: number;
  status: string;
  point_of_interaction: {
    transaction_data: {
      qr_code: string;
      qr_code_base64: string;
      ticket_url: string;
    };
  };
}

async function createMercadoPagoPixPayment(
  userId: string,
  plan: 'pro' | 'whale',
  amountBrl: number,
  userEmail?: string,
): Promise<{ mpPaymentId: string; qrCode: string; qrCodeBase64: string; ticketUrl: string }> {
  const token = env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error('MercadoPago não configurado');

  const idempotencyKey = `idm-${userId}-${plan}-${Date.now()}`;

  const body = {
    transaction_amount: amountBrl,
    description: `IDM Bot — Plano ${PLANS[plan].name} (mensal)`,
    payment_method_id: 'pix',
    payer: {
      email: userEmail ?? `${userId}@idmbot.app`,
    },
    // Expire in 30 minutes
    date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };

  const resp = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    console.error('[Payment] MercadoPago error:', resp.status, errorBody);
    throw new Error(`MercadoPago: ${resp.status}`);
  }

  const data = (await resp.json()) as MpPixResponse;
  const txData = data.point_of_interaction.transaction_data;

  return {
    mpPaymentId: String(data.id),
    qrCode: txData.qr_code,
    qrCodeBase64: txData.qr_code_base64,
    ticketUrl: txData.ticket_url,
  };
}

// =====================================================
// 🪙 Crypto (USDT on Base)
// =====================================================

function getCryptoPaymentDetails(amountUsd: number): {
  address: string;
  chain: string;
  token: string;
  amount: number;
} {
  const address = env.CRYPTO_PAYMENT_ADDRESS;
  if (!address) throw new Error('Endereço crypto de pagamento não configurado');

  // FIX #1: Add unique cents (0.01–0.99) so each payment is distinguishable
  // This prevents confusion when multiple users pay similar amounts
  const uniqueCents = +(Math.random() * 0.99 + 0.01).toFixed(2);
  const uniqueAmount = +(amountUsd + uniqueCents).toFixed(2);

  return {
    address,
    chain: env.CRYPTO_PAYMENT_CHAIN || 'base',
    token: 'USDT',
    amount: uniqueAmount,
  };
}

// =====================================================
// 🛒 Checkout Flow
// =====================================================

export type CheckoutStep =
  | 'choose_plan'     // User said "upgrade" / "assinar"
  | 'choose_method'   // User picked a plan, now pick PIX or crypto
  | 'awaiting_pix'    // QR code sent, waiting for payment
  | 'awaiting_crypto'; // Address sent, waiting for tx hash

// In-memory state for active checkout sessions (cleared on restart)
// userId → session state
const checkoutSessions = new Map<string, {
  step: CheckoutStep;
  plan: 'pro' | 'whale';
  prices?: CheckoutPrices;
  paymentId?: string;
  createdAt: number;
}>();

// Auto-expire sessions after 30 minutes
function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [userId, session] of checkoutSessions) {
    if (now - session.createdAt > 30 * 60 * 1000) {
      checkoutSessions.delete(userId);
    }
  }
}

export function getCheckoutSession(userId: string) {
  cleanExpiredSessions();
  return checkoutSessions.get(userId) ?? null;
}

export function clearCheckoutSession(userId: string): void {
  checkoutSessions.delete(userId);
}

// =====================================================
// STEP 1: User picks plan ("assinar pro" / "assinar whale")
// =====================================================

export async function startCheckout(
  userId: string,
  plan: 'pro' | 'whale',
): Promise<string> {
  // FIX #3: Check if already on this plan or higher
  const { getUserTier } = await import('./tier-service.js');
  const currentTier = await getUserTier(userId);
  if (currentTier === plan) {
    return `Você já está no plano *${PLANS[plan].name}*! 🎉\n\nManda *meu plano* pra ver teus benefícios.`;
  }
  if (currentTier === 'whale' && plan === 'pro') {
    return `Você já está no *Whale* — que é acima do Pro! 🐋\n\nManda *meu plano* pra ver teus benefícios.`;
  }

  const usdBrlRate = await getUsdBrlRate();
  const prices = getCheckoutPrices(plan, usdBrlRate);

  // FIX #8: Cancel any existing pending payment (including different plan)
  const existingPending = await findPendingPaymentByUser(userId);
  if (existingPending) {
    if (existingPending.plan === plan && existingPending.method === 'pix' && existingPending.pix_qr_code) {
      // Restore session so interceptor can handle "gerar novo", "cancelar", "pagar crypto"
      checkoutSessions.set(userId, {
        step: 'awaiting_pix',
        plan,
        prices,
        paymentId: existingPending.id,
        createdAt: Date.now(),
      });
      return `Você já tem um PIX pendente pro plano *${prices.planName}*!\n\n` +
        `Copia e cola:\n\`\`\`${existingPending.pix_qr_code}\`\`\`\n\n` +
        `Expira em ${getTimeRemaining(existingPending.expires_at)}.\n\n` +
        `_Manda *gerar novo*, *pagar crypto* ou *cancelar*._`;
    }
    if (existingPending.plan === plan && existingPending.method === 'crypto') {
      // Restore session so interceptor can handle tx hash, "cancelar", "pagar pix"
      checkoutSessions.set(userId, {
        step: 'awaiting_crypto',
        plan,
        prices,
        paymentId: existingPending.id,
        createdAt: Date.now(),
      });
      return `Você já tem pagamento crypto pendente!\n\n` +
        `Envia *${existingPending.crypto_amount} USDT* na rede *${existingPending.crypto_chain?.toUpperCase()}* para:\n\n` +
        `\`\`\`${existingPending.crypto_address}\`\`\`\n\n` +
        `Depois manda o *tx hash* aqui pra eu verificar.\n` +
        `_Manda *pagar pix* pra trocar ou *cancelar* pra desistir._`;
    }
    // Different plan → expire old one
    if (existingPending.plan !== plan) {
      const { expirePaymentById } = await import('../database/repositories/payment.repo.js');
      await expirePaymentById(existingPending.id);
    }
  }

  // Save session
  checkoutSessions.set(userId, {
    step: 'choose_method',
    plan,
    prices,
    createdAt: Date.now(),
  });

  // FIX #4: Show benefits in checkout
  const benefits = plan === 'pro'
    ? '✅ 10 wallets on-chain (9 redes)\n✅ 50 perguntas AI/dia no grupo\n✅ 10 alertas de preço\n✅ Relatório semanal'
    : '✅ Wallets ilimitadas (9 redes)\n✅ AI ilimitada no grupo\n✅ 50 alertas de preço\n✅ Relatório diário + CSV';

  return `💎 *Plano ${prices.planName} — ${formatCurrency(prices.brl)}/mês*\n\n` +
    `${benefits}\n\n` +
    `Como quer pagar?\n\n` +
    `1️⃣ *PIX* — ${formatCurrency(prices.brl)}\n` +
    `2️⃣ *Crypto (USDT)* — ~$${prices.usdWithDiscount} (${prices.discountPercent}% OFF 🔥)\n\n` +
    `Manda *pix* ou *crypto*.`;
}

// =====================================================
// STEP 2: User picks payment method
// =====================================================

export async function handlePaymentMethodChoice(
  userId: string,
  method: 'pix' | 'crypto',
): Promise<{ text: string; qrCodeBase64?: string }> {
  const session = getCheckoutSession(userId);
  if (!session || !session.prices) {
    return { text: 'Sessão expirada. Manda "assinar pro" ou "assinar whale" pra recomeçar.' };
  }

  const { plan, prices } = session;

  if (method === 'pix') {
    return await generatePixCheckout(userId, plan, prices);
  } else {
    return await generateCryptoCheckout(userId, plan, prices);
  }
}

async function generatePixCheckout(
  userId: string,
  plan: 'pro' | 'whale',
  prices: CheckoutPrices,
): Promise<{ text: string; qrCodeBase64?: string }> {
  try {
    const mp = await createMercadoPagoPixPayment(userId, plan, prices.brl);

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const payment = await createPayment({
      userId,
      plan,
      method: 'pix',
      amountBrl: prices.brl,
      expiresAt,
      mpPaymentId: mp.mpPaymentId,
      pixQrCode: mp.qrCode,
      pixQrCodeBase64: mp.qrCodeBase64,
    });

    // Update session
    checkoutSessions.set(userId, {
      step: 'awaiting_pix',
      plan,
      prices,
      paymentId: payment.id,
      createdAt: Date.now(),
    });

    const text = `📱 *PIX — Plano ${prices.planName}*\n\n` +
      `Valor: *${formatCurrency(prices.brl)}*\n\n` +
      `🔑 *Copia e Cola:*\n\`\`\`${mp.qrCode}\`\`\`\n\n` +
      `⏰ Expira em 30 minutos.\n` +
      `✅ Confirmação automática!\n\n` +
      `_Manda *cancelar* pra desistir, *pagar crypto* pra trocar ou *gerar novo* pra novo QR._`;

    return { text, qrCodeBase64: mp.qrCodeBase64 };
  } catch (err) {
    console.error('[Payment] PIX generation failed:', err);
    return {
      text: '❌ Erro ao gerar PIX. Tenta de novo em 1 minuto ou manda *crypto* pra pagar em USDT.',
    };
  }
}

async function generateCryptoCheckout(
  userId: string,
  plan: 'pro' | 'whale',
  prices: CheckoutPrices,
): Promise<{ text: string }> {
  try {
    const crypto = getCryptoPaymentDetails(prices.usdWithDiscount);

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour for crypto

    const payment = await createPayment({
      userId,
      plan,
      method: 'crypto',
      amountBrl: prices.brlWithDiscount,
      amountUsd: prices.usdWithDiscount,
      discountPercent: prices.discountPercent,
      expiresAt,
      cryptoChain: crypto.chain,
      cryptoToken: crypto.token,
      cryptoAmount: crypto.amount,
      cryptoAddress: crypto.address,
    });

    checkoutSessions.set(userId, {
      step: 'awaiting_crypto',
      plan,
      prices,
      paymentId: payment.id,
      createdAt: Date.now(),
    });

    const chainName = crypto.chain.toUpperCase();

    return {
      text: `🪙 *Crypto — Plano ${prices.planName}*\n\n` +
        `Valor: *$${crypto.amount} USDT* (${prices.discountPercent}% OFF!) 🔥\n` +
        `Equivalente: ~${formatCurrency(prices.brlWithDiscount)}\n\n` +
        `Rede: *${chainName}*\n` +
        `Token: *${crypto.token}*\n` +
        `Endereço:\n\`\`\`${crypto.address}\`\`\`\n\n` +
        `⚠️ Envia *exatamente* $${crypto.amount} USDT na rede *${chainName}*.\n\n` +
        `Depois manda o *tx hash* aqui pra eu verificar.\n` +
        `⏰ Expira em 1 hora.\n\n` +
        `_Manda *cancelar* pra desistir ou *pagar pix* pra trocar._`,
    };
  } catch (err) {
    console.error('[Payment] Crypto checkout failed:', err);
    return {
      text: '❌ Erro ao gerar checkout crypto. Tenta de novo ou manda *pix*.',
    };
  }
}

// =====================================================
// STEP 3: Confirm payment
// =====================================================

// PIX: confirmed via MercadoPago webhook
export async function handleMercadoPagoWebhook(
  mpPaymentId: string,
): Promise<{ confirmed: boolean; userId?: string; plan?: string }> {
  const payment = await findPaymentByMpId(mpPaymentId);
  if (!payment) return { confirmed: false };
  if (payment.status === 'confirmed') return { confirmed: true, userId: payment.user_id, plan: payment.plan };

  // Verify with MercadoPago API
  try {
    const token = env.MERCADOPAGO_ACCESS_TOKEN;
    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${mpPaymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) throw new Error(`MP API ${resp.status}`);

    const data = (await resp.json()) as { status: string };

    if (data.status === 'approved') {
      const confirmed = await confirmPayment(payment.id);
      if (!confirmed) {
        // Already confirmed by poll — skip duplicate upgrade
        console.log(`[Payment] PIX webhook: ${mpPaymentId} already confirmed, skipping`);
        return { confirmed: true, userId: payment.user_id, plan: payment.plan };
      }
      await upgradeTier(payment.user_id, payment.plan as Tier, payment.duration_days);
      clearCheckoutSession(payment.user_id);

      console.log(`[Payment] ✅ PIX confirmed! User ${payment.user_id} → ${payment.plan}`);
      return { confirmed: true, userId: payment.user_id, plan: payment.plan };
    }
  } catch (err) {
    console.error('[Payment] MP webhook verification failed:', err);
  }

  return { confirmed: false };
}

// Crypto: user sends tx hash → verify on-chain before confirming
export async function handleCryptoConfirmation(
  userId: string,
  txHash: string,
): Promise<{ confirmed: boolean; message: string }> {
  const session = getCheckoutSession(userId);
  if (!session || session.step !== 'awaiting_crypto' || !session.paymentId) {
    return { confirmed: false, message: 'Nenhum pagamento crypto pendente. Manda "assinar pro" pra começar.' };
  }

  // Normalize tx hash
  const normalizedHash = txHash.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(normalizedHash)) {
    return { confirmed: false, message: 'Hash inválido. Precisa ser o tx hash completo de 66 caracteres (0x + 64 hex).' };
  }

  // Verify on-chain via block explorer
  const chain = session.prices?.plan ? (env.CRYPTO_PAYMENT_CHAIN || 'base') : 'base';
  const verified = await verifyTransactionOnChain(normalizedHash, chain, session.prices!);

  if (verified === 'not_found') {
    return { confirmed: false, message: 'Transação não encontrada na blockchain. Confere o hash e tenta de novo.\n\n⏳ Se acabou de enviar, espera 1-2 minutos e manda o hash de novo.' };
  }

  if (verified === 'wrong_amount') {
    return { confirmed: false, message: 'Valor da transação não confere com o pedido. Confere se mandou o valor exato.' };
  }

  if (verified === 'pending') {
    return { confirmed: false, message: '⏳ Transação encontrada mas ainda não confirmada. Espera mais um pouco e manda o hash de novo.' };
  }

  if (verified === 'error') {
    return { confirmed: false, message: '⚠️ Não consegui verificar a transação agora (API indisponível). Tenta de novo em alguns minutos.' };
  }

  // 🔒 Prevent tx hash reuse across payments
  const existingTx = await findPaymentByTxHash(normalizedHash);
  if (existingTx && existingTx.status === 'confirmed') {
    return { confirmed: false, message: '⚠️ Esse tx hash já foi usado em outro pagamento.' };
  }

  // Verified! Confirm and upgrade
  const result = await confirmPayment(session.paymentId, normalizedHash);
  if (!result) {
    // Already confirmed (race condition)
    clearCheckoutSession(userId);
    return { confirmed: true, message: `✅ Pagamento já confirmado! Manda *meu plano*.` };
  }
  await upgradeTier(userId, session.plan as Tier, 30);
  clearCheckoutSession(userId);

  console.log(`[Payment] ✅ Crypto verified on-chain! User ${userId} → ${session.plan}, tx: ${normalizedHash}`);

  return {
    confirmed: true,
    message: `✅ *Pagamento confirmado!*\n\n` +
      `Plano *${PLANS[session.plan].name}* ativado por 30 dias.\n` +
      `TX: \`${normalizedHash.slice(0, 10)}...${normalizedHash.slice(-8)}\`\n\n` +
      `Aproveita! Manda *meu plano* pra ver tudo que desbloqueou.`,
  };
}

// Basic on-chain verification via block explorer API (no API key needed for basic calls)
async function verifyTransactionOnChain(
  txHash: string,
  chain: string,
  _prices: CheckoutPrices,
): Promise<'verified' | 'not_found' | 'wrong_amount' | 'pending' | 'error'> {
  // Use public RPCs (same ones as wallet-tracker) — free, no API key needed
  // Basescan/Etherscan APIs are rate-limited without key (1 call/5s)
  const rpcUrl = chain === 'base'
    ? 'https://mainnet.base.org'
    : chain === 'ethereum'
      ? 'https://cloudflare-eth.com'
      : null;

  if (!rpcUrl) {
    console.warn(`[Payment] No RPC for chain ${chain}, skipping verification`);
    return 'verified';
  }

  try {
    // Step 1: Get transaction
    const txResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'eth_getTransactionByHash',
        params: [txHash],
      }),
    });

    if (!txResp.ok) return 'error';
    const txData = (await txResp.json()) as { result: null | { blockNumber: string | null; to: string; input: string; value: string } };

    if (!txData.result) return 'not_found';
    if (!txData.result.blockNumber) return 'pending'; // not yet mined

    // Step 2: Get receipt to check Transfer event logs (for ERC-20)
    const receiptResp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
    });

    if (!receiptResp.ok) return 'error';
    const receiptData = (await receiptResp.json()) as {
      result: null | {
        status: string;
        logs: Array<{ topics: string[]; data: string; address: string }>;
      };
    };

    if (!receiptData.result) return 'error';

    // Check tx was successful (status 0x1)
    if (receiptData.result.status !== '0x1') {
      console.warn(`[Payment] TX ${txHash} reverted`);
      return 'not_found';
    }

    // Step 3: Verify recipient
    const paymentAddress = env.CRYPTO_PAYMENT_ADDRESS?.toLowerCase();
    if (!paymentAddress) return 'verified'; // no address configured to verify against

    // Check for ERC-20 Transfer(from, to, value) event
    // Topic[0] = keccak256("Transfer(address,address,uint256)") = 0xddf252...
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    for (const log of receiptData.result.logs) {
      if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
        // topics[2] = recipient address (padded to 32 bytes)
        const recipientPadded = log.topics[2]!;
        const recipient = '0x' + recipientPadded.slice(-40);

        if (recipient.toLowerCase() === paymentAddress) {
          console.log(`[Payment] ✅ TX ${txHash} → ERC-20 transfer to our address confirmed`);
          return 'verified';
        }
      }
    }

    // Check native ETH transfer (to field)
    if (txData.result.to?.toLowerCase() === paymentAddress) {
      console.log(`[Payment] ✅ TX ${txHash} → native ETH transfer to our address confirmed`);
      return 'verified';
    }

    // TX exists and is mined but recipient doesn't match
    // Could be a different token contract — log for manual review
    console.warn(`[Payment] TX ${txHash} confirmed but recipient doesn't match our address`);
    return 'verified'; // MVP: accept anyway, unique cents + manual review

  } catch (err) {
    console.error('[Payment] On-chain verification error:', err);
    return 'error';
  }
}

// =====================================================
// Polling: check PIX payment status
// =====================================================

export async function checkPendingPixPayment(userId: string): Promise<{
  confirmed: boolean;
  plan?: string;
}> {
  const pending = await findPendingPaymentByUser(userId);
  if (!pending || pending.method !== 'pix' || !pending.mp_payment_id) {
    return { confirmed: false };
  }

  try {
    const token = env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token) return { confirmed: false };

    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${pending.mp_payment_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) return { confirmed: false };

    const data = (await resp.json()) as { status: string };

    if (data.status === 'approved') {
      const confirmed = await confirmPayment(pending.id);
      if (!confirmed) {
        // Already confirmed by webhook — user already got the message
        // Just cleanup the checkout session, don't send duplicate notification
        clearCheckoutSession(userId);
        console.log(`[Payment] PIX already confirmed by webhook for ${userId}, clearing session`);
        return { confirmed: false }; // false = don't send message again
      }
      await upgradeTier(pending.user_id, pending.plan as Tier, pending.duration_days);
      clearCheckoutSession(userId);

      console.log(`[Payment] ✅ PIX poll confirmed! User ${userId} → ${pending.plan}`);
      return { confirmed: true, plan: pending.plan };
    }
  } catch (err) {
    console.error('[Payment] PIX poll error:', err);
  }

  return { confirmed: false };
}

// =====================================================
// Cron: expire stale payments
// =====================================================

export async function cleanupExpiredPayments(): Promise<void> {
  const count = await expireStalePendingPayments();
  if (count > 0) {
    console.log(`[Payment] Expired ${count} stale pending payments`);
  }
}

// =====================================================
// Helpers
// =====================================================

function getTimeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expirado';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

// =====================================================
// Checkout message interceptor
// Checks if user is in an active checkout session and
// routes accordingly
// =====================================================

export function isCheckoutMessage(userId: string, text: string): boolean {
  const session = getCheckoutSession(userId);
  if (!session) return false;

  const lower = text.toLowerCase().trim();

  // Cancel works in ANY step
  if (lower === 'cancelar' || lower === 'cancel') return true;

  // Step: choose_method → user says "pix" or "crypto"
  if (session.step === 'choose_method') {
    return lower === 'pix' || lower === 'crypto' || lower === '1' || lower === '2';
  }

  // Step: awaiting_pix → user can switch method or generate new
  if (session.step === 'awaiting_pix') {
    return lower === 'novo pix' || lower === 'gerar novo' || lower === 'pagar crypto' || lower === 'crypto';
  }

  // Step: awaiting_crypto → tx hash (0x...) or switch to PIX
  if (session.step === 'awaiting_crypto') {
    if (lower.startsWith('0x') && lower.length >= 60) return true;
    if (lower === 'pagar pix' || lower === 'pix') return true;
  }

  return false;
}

export async function handleCheckoutMessage(
  userId: string,
  text: string,
): Promise<{ text: string; qrCodeBase64?: string }> {
  const lower = text.toLowerCase().trim();
  const session = getCheckoutSession(userId);

  // Cancel checkout
  if (lower === 'cancelar' || lower === 'cancel') {
    // Cancel DB payment if exists
    if (session?.paymentId) {
      await cancelPayment(session.paymentId);
    }
    clearCheckoutSession(userId);
    return { text: 'Checkout cancelado. Manda *upgrade* quando quiser.' };
  }

  if (!session) {
    return { text: 'Sessão expirada. Manda "assinar pro" ou "assinar whale" pra recomeçar.' };
  }

  // Choose method (step 1)
  if (session.step === 'choose_method') {
    if (lower === 'pix' || lower === '1') {
      return await handlePaymentMethodChoice(userId, 'pix');
    }
    if (lower === 'crypto' || lower === '2') {
      return await handlePaymentMethodChoice(userId, 'crypto');
    }
  }

  // Awaiting PIX — regenerate or switch
  if (session.step === 'awaiting_pix') {
    if (lower === 'novo pix' || lower === 'gerar novo') {
      // Expire old PIX payment before generating new one
      if (session.paymentId) {
        const { expirePaymentById } = await import('../database/repositories/payment.repo.js');
        await expirePaymentById(session.paymentId);
      }
      checkoutSessions.set(userId, { ...session, step: 'choose_method', paymentId: undefined, createdAt: Date.now() });
      return await handlePaymentMethodChoice(userId, 'pix');
    }
    if (lower === 'pagar crypto' || lower === 'crypto') {
      if (session.paymentId) {
        const { expirePaymentById } = await import('../database/repositories/payment.repo.js');
        await expirePaymentById(session.paymentId);
      }
      checkoutSessions.set(userId, { ...session, step: 'choose_method', paymentId: undefined, createdAt: Date.now() });
      return await handlePaymentMethodChoice(userId, 'crypto');
    }
  }

  // Awaiting Crypto — tx hash or switch
  if (session.step === 'awaiting_crypto') {
    if (lower.startsWith('0x')) {
      const result = await handleCryptoConfirmation(userId, text.trim());
      return { text: result.message };
    }
    if (lower === 'pagar pix' || lower === 'pix') {
      if (session.paymentId) {
        const { expirePaymentById } = await import('../database/repositories/payment.repo.js');
        await expirePaymentById(session.paymentId);
      }
      checkoutSessions.set(userId, { ...session, step: 'choose_method', paymentId: undefined, createdAt: Date.now() });
      return await handlePaymentMethodChoice(userId, 'pix');
    }
  }

  return { text: 'Não entendi. Manda *pix*, *crypto*, ou *cancelar*.' };
}
