import { env } from '../config/env.js';
import {
  createPayment,
  findPendingPaymentByUser,
  confirmPayment,
  findPaymentByMpId,
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

  return {
    address,
    chain: env.CRYPTO_PAYMENT_CHAIN || 'base',
    token: 'USDT',
    amount: amountUsd,
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
  // Check if already on this plan
  const usdBrlRate = await getUsdBrlRate();
  const prices = getCheckoutPrices(plan, usdBrlRate);

  // Cancel any existing pending payment
  const existingPending = await findPendingPaymentByUser(userId);
  if (existingPending) {
    // Don't cancel — just inform they already have one pending
    if (existingPending.plan === plan) {
      if (existingPending.method === 'pix' && existingPending.pix_qr_code) {
        return `Voce ja tem um PIX pendente pro plano *${prices.planName}*!\n\n` +
          `Copia e cola:\n\`\`\`${existingPending.pix_qr_code}\`\`\`\n\n` +
          `Expira em ${getTimeRemaining(existingPending.expires_at)}.\n\n` +
          `Quer gerar novo? Manda *novo pix* ou *pagar crypto*.`;
      }
      if (existingPending.method === 'crypto') {
        return `Voce ja tem pagamento crypto pendente!\n\n` +
          `Envia *${existingPending.crypto_amount} USDT* na rede *${existingPending.crypto_chain?.toUpperCase()}* para:\n\n` +
          `\`\`\`${existingPending.crypto_address}\`\`\`\n\n` +
          `Depois manda o *tx hash* aqui pra confirmar.`;
      }
    }
  }

  // Save session
  checkoutSessions.set(userId, {
    step: 'choose_method',
    plan,
    prices,
    createdAt: Date.now(),
  });

  return `💎 *Plano ${prices.planName} — ${formatCurrency(prices.brl)}/mês*\n\n` +
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
    return { text: 'Sessao expirada. Manda "assinar pro" ou "assinar whale" pra recomecar.' };
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
      `✅ Assim que pagar, ativo automaticamente!`;

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
        `Valor: *$${prices.usdWithDiscount} USDT* (${prices.discountPercent}% OFF!) 🔥\n` +
        `Equivalente: ~${formatCurrency(prices.brlWithDiscount)}\n\n` +
        `Rede: *${chainName}*\n` +
        `Token: *${crypto.token}*\n` +
        `Endereço:\n\`\`\`${crypto.address}\`\`\`\n\n` +
        `⚠️ Envia *exatamente* $${prices.usdWithDiscount} USDT na rede *${chainName}*.\n\n` +
        `Depois manda o *tx hash* aqui pra eu confirmar.\n` +
        `⏰ Expira em 1 hora.`,
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
      await confirmPayment(payment.id);
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

// Crypto: user sends tx hash manually
export async function handleCryptoConfirmation(
  userId: string,
  txHash: string,
): Promise<{ confirmed: boolean; message: string }> {
  const session = getCheckoutSession(userId);
  if (!session || session.step !== 'awaiting_crypto' || !session.paymentId) {
    return { confirmed: false, message: 'Nenhum pagamento crypto pendente. Manda "assinar pro" pra comecar.' };
  }

  // Normalize tx hash
  const normalizedHash = txHash.trim().toLowerCase();
  if (!normalizedHash.startsWith('0x') || normalizedHash.length < 60) {
    return { confirmed: false, message: 'Hash invalido. Manda o tx hash completo (comeca com 0x...).' };
  }

  // For now: trust + verify later (manual review via admin panel)
  // In production: verify on-chain via block explorer API
  await confirmPayment(session.paymentId, normalizedHash);
  await upgradeTier(userId, session.plan as Tier, 30);
  clearCheckoutSession(userId);

  console.log(`[Payment] ✅ Crypto confirmed (manual)! User ${userId} → ${session.plan}, tx: ${normalizedHash}`);

  return {
    confirmed: true,
    message: `✅ *Pagamento confirmado!*\n\n` +
      `Plano *${PLANS[session.plan].name}* ativado por 30 dias.\n` +
      `TX: \`${normalizedHash.slice(0, 10)}...${normalizedHash.slice(-8)}\`\n\n` +
      `Aproveita! Manda *meu plano* pra ver tudo que desbloqueou.`,
  };
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
      await confirmPayment(pending.id);
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

  // Step: choose_method → user says "pix" or "crypto"
  if (session.step === 'choose_method') {
    return lower === 'pix' || lower === 'crypto' || lower === '1' || lower === '2';
  }

  // Step: awaiting_crypto → user sends tx hash (0x...)
  if (session.step === 'awaiting_crypto') {
    return lower.startsWith('0x') && lower.length >= 60;
  }

  // Cancel
  if (lower === 'cancelar' || lower === 'cancel') return true;

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
    clearCheckoutSession(userId);
    return { text: 'Checkout cancelado. Manda *upgrade* quando quiser.' };
  }

  if (!session) {
    return { text: 'Sessao expirada. Manda "assinar pro" ou "assinar whale" pra recomecar.' };
  }

  // Choose method
  if (session.step === 'choose_method') {
    if (lower === 'pix' || lower === '1') {
      return await handlePaymentMethodChoice(userId, 'pix');
    }
    if (lower === 'crypto' || lower === '2') {
      return await handlePaymentMethodChoice(userId, 'crypto');
    }
  }

  // Crypto tx hash
  if (session.step === 'awaiting_crypto' && lower.startsWith('0x')) {
    const result = await handleCryptoConfirmation(userId, text.trim());
    return { text: result.message };
  }

  return { text: 'Nao entendi. Manda *pix*, *crypto*, ou *cancelar*.' };
}
