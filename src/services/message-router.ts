import type { ParsedMessage, PortfolioSummary } from '../types/index.js';
import { supabase } from '../database/client.js';
import { env } from '../config/env.js';
import { findOrCreateUser } from '../database/repositories/user.repo.js';
import { parseIntent } from './intent-parser.js';
import {
  registerBuy,
  registerSell,
  getPortfolioSummary,
  getAssetDetail,
  removeAsset,
  setDcaGoal,
  getDcaProgress,
  getProjection,
} from './portfolio.js';
import { getSpotPrice } from './price-service.js';
import { sendMessageWithTyping, sendImageWithTyping } from './whatsapp.js';
import * as response from './response-builder.js';
import { checkRateLimit, recordRequest } from '../utils/rate-limiter.js';
import { detectChain, getWalletBalance, type Chain } from './wallet-tracker.js';
import { addWallet, getUserWallets, removeWallet, countUserWallets } from '../database/repositories/wallet.repo.js';
import {
  generatePortfolioCard,
  generatePriceCard,
  generateWalletCard,
  generateMemeCard,
  shouldGenerateMeme,
} from './image-generator.js';
import {
  canAddWallet,
  canUseChain,
  canUseGroupAI,
  incrementGroupAIUsage,
  getUserTier,
  buildUpgradePlans,
  buildTierInfo,
  buildUpgradeMessage,
  buildGroupUpsellNudge,
  buildReferralInfo,
  updateStreak,
  getOnboardingStep,
  setOnboardingStep,
  getOrCreateReferralCode,
  processReferral,
} from './tier-service.js';
import {
  isCheckoutMessage,
  handleCheckoutMessage,
  startCheckout,
  checkPendingPixPayment,
  getCheckoutSession,
} from './payment.js';

// =====================================================
// 🔒 SECURITY: Admin whitelist
// =====================================================
// During beta, only whitelisted numbers can use the bot.
// Set ADMIN_WHITELIST env var with comma-separated phone numbers.
// Leave empty to allow all (production mode).
// Example: ADMIN_WHITELIST=5573999999999,5511888888888
const ADMIN_WHITELIST: Set<string> | null = (() => {
  const raw = process.env['ADMIN_WHITELIST']?.trim();
  if (!raw) return null; // No whitelist = open to all
  return new Set(raw.split(',').map(n => n.trim()));
})();

// 🔒 Transaction safety limits (BRL)
const MAX_TRANSACTION_FIAT = 1_000_000; // R$ 1M max per transaction
const MAX_DCA_GOAL = 10_000_000; // R$ 10M max DCA goal

// PIX poll throttle: avoid calling MP API on every single message
const pixPollTimestamps = new Map<string, number>();

// =====================================================
// 🔒 PRIVACY: Intents that should only be answered in DM
// =====================================================
const PRIVATE_INTENTS = new Set([
  'buy', 'sell', 'portfolio_summary', 'asset_detail',
  'remove_asset', 'set_dca_goal', 'dca_progress', 'projection',
  'watch_wallet', 'list_wallets', 'remove_wallet', 'wallet_balance',
  'set_alert', 'my_plan', 'upgrade', 'referral',
]);

// Intents safe to answer in groups (public info)
// price_check, help, unknown, set_alert → respond in group

export async function processMessage(message: ParsedMessage): Promise<void> {
  const { phoneNumber, text, pushName, isGroup, groupJid } = message;

  // 🔒 Safe logging
  const maskedPhone = env.NODE_ENV === 'production'
    ? `${phoneNumber.slice(0, 4)}***${phoneNumber.slice(-2)}`
    : phoneNumber;
  const context = isGroup ? `[GROUP ${groupJid}]` : '[DM]';
  console.log(`[Router] ${context} Message from ${maskedPhone}: "${text.slice(0, 80)}"`);

  try {
    // 🔒 Rate limit check (10 msgs/min per user)
    const rateCheck = checkRateLimit(phoneNumber);
    if (!rateCheck.allowed) {
      console.log(`[Router] Rate limited: ${maskedPhone} (${Math.round(rateCheck.resetIn / 1000)}s)`);
      if (!isGroup) {
        await sendMessageWithTyping(phoneNumber, response.buildRateLimited());
      }
      return;
    }
    recordRequest(phoneNumber);

    // 🔒 Whitelist check (beta mode)
    if (ADMIN_WHITELIST && !ADMIN_WHITELIST.has(phoneNumber)) {
      console.log(`[Router] Blocked: ${maskedPhone} not in whitelist`);
      // In groups, ignore silently. In DM, explain.
      if (!isGroup) {
        await sendMessageWithTyping(
          phoneNumber,
          '🔒 O IDM Carteira está em fase beta. Em breve você poderá usar!'
        );
      }
      return;
    }

    // Get or create user
    const user = await findOrCreateUser(phoneNumber, pushName);
    console.log(`[Router] User: ${user.id} (${maskedPhone})`);

    // 🔥 Update streak (track daily engagement)
    const { streak, isNewDay } = await updateStreak(user.id);
    if (isNewDay && streak > 1 && !isGroup) {
      // Don't send streak message yet — append to response later
      console.log(`[Router] Streak: ${streak} days`);
    }

    // Check if this is a new user (for onboarding)
    const isNewUser = !user.name && pushName;

    // Parse intent
    const intent = await parseIntent(text);
    console.log(`[Router] Intent: ${intent.type} (confidence: ${intent.confidence})`);

    // =====================================================
    // 🏟️ GROUP GATE: only respond if @mentioned or safe public intent
    // In DM, everything passes through naturally
    // =====================================================
    if (isGroup) {
      const isMentioned = text.toLowerCase().includes('@idm') ||
        text.toLowerCase().includes('idm bot') ||
        text.toLowerCase().includes('idm,');

      // Safe public intents that work WITHOUT @mention in groups
      // Only price_check is safe — help could trigger on casual "ajuda"
      const SAFE_GROUP_INTENTS = new Set(['price_check']);

      if (!isMentioned && !SAFE_GROUP_INTENTS.has(intent.type)) {
        // Not mentioned + not a safe intent → ignore silently
        // "carteira" without @IDM in group = probably not for us
        console.log(`[Router] Group: ignoring "${text.slice(0, 40)}" (not mentioned)`);
        return;
      }

      // @mentioned with unknown intent → Group AI
      if (isMentioned && intent.type === 'unknown') {
        const aiCheck = await canUseGroupAI(user.id);

        if (!aiCheck.allowed) {
          if (aiCheck.upgrade) {
            await sendMessageWithTyping(groupJid!, buildGroupUpsellNudge(pushName ?? 'Gorila'));
            await sendMessageWithTyping(phoneNumber, `Curtiu? As ${aiCheck.remaining === 0 ? 'tuas perguntas da semana acabaram' : 'perguntas são limitadas no Free'}.\n\n${buildUpgradePlans()}`);
          } else {
            await sendMessageWithTyping(groupJid!, `@${pushName ?? 'Gorila'} ${aiCheck.reason ?? 'Limite atingido.'}`);
            await sendMessageWithTyping(phoneNumber, `${aiCheck.reason}\n\nPro libera 50/dia. Manda "upgrade" aqui.`);
          }
          return;
        }

        try {
          const { generateGroupAIResponse } = await import('./group-ai.js');
          const aiResponse = await generateGroupAIResponse(text);
          await incrementGroupAIUsage(user.id);

          const remaining = aiCheck.remaining;
          const footer = remaining !== undefined && remaining < 10
            ? `\n\n_${remaining} perguntas restantes_`
            : '';

          await sendMessageWithTyping(groupJid!, aiResponse + footer);
        } catch (aiError) {
          console.error('[Router] Group AI failed:', aiError);
          await sendMessageWithTyping(groupJid!, 'Eita, deu ruim aqui. Tenta de novo!');
        }
        return;
      }

      // @mentioned with unknown but not a question → ignore
      if (intent.type === 'unknown') return;

      // @mentioned with private intent → redirect to DM
      if (PRIVATE_INTENTS.has(intent.type)) {
        const displayName = pushName ?? 'Gorila';
        await sendMessageWithTyping(groupJid!, `@${displayName} te mandei no privado 👀`);
        const responseText = await handleIntent(user.id, intent);
        await sendResponseWithImages(phoneNumber, intent, user.id, responseText);
        return;
      }

      // Public intent (price_check, help) → respond in group
      const responseText = await handleIntent(user.id, intent);
      // Only show Pro/Whale signature when user @mentioned the bot (social status)
      // Passive price checks don't get signature to avoid looking like spam
      if (isMentioned) {
        const tier = await getUserTier(user.id);
        const signature = tier !== 'free' ? `\n\n— IDM Bot (${tier === 'pro' ? 'Pro' : 'Whale'})` : '\n\n— IDM Bot';
        await sendMessageWithTyping(groupJid!, responseText + signature);
      } else {
        await sendMessageWithTyping(groupJid!, responseText);
      }
      return;
    }

    // =====================================================
    // 💬 DM FLOW: natural language, no prefix needed
    // =====================================================

    // 🛒 CHECKOUT INTERCEPTOR: if user is in active checkout, route here first
    if (!isGroup && isCheckoutMessage(user.id, text)) {
      const result = await handleCheckoutMessage(user.id, text);
      if (result.qrCodeBase64) {
        // Send QR code image + text
        const imageBuffer = Buffer.from(result.qrCodeBase64, 'base64');
        await sendImageWithTyping(phoneNumber, imageBuffer, result.text);
      } else {
        await sendMessageWithTyping(phoneNumber, result.text);
      }
      return;
    }

    // 🛒 PIX POLL: if user has pending PIX, check if paid (throttled: max once per 30s)
    if (!isGroup) {
      const session = getCheckoutSession(user.id);
      if (session?.step === 'awaiting_pix') {
        const now = Date.now();
        const lastPoll = pixPollTimestamps.get(user.id) ?? 0;
        if (now - lastPoll > 30_000) { // 30s throttle
          pixPollTimestamps.set(user.id, now);
          const pixCheck = await checkPendingPixPayment(user.id);
          if (pixCheck.confirmed) {
            pixPollTimestamps.delete(user.id);
            const planName = pixCheck.plan === 'whale' ? 'Whale' : 'Pro';
            await sendMessageWithTyping(phoneNumber,
              `✅ *PIX confirmado!*\n\nPlano *${planName}* ativado por 30 dias.\n\nManda *meu plano* pra ver tudo que desbloqueou.`
            );
            return;
          }
        }
        // Hint: user sent a non-checkout msg while awaiting PIX
        if (intent.type !== 'upgrade' && intent.type !== 'my_plan') {
          // Don't block normal usage, just append a subtle reminder after response
        }
      }
    }

    // Handle unknown intent in DM
    if (intent.type === 'unknown') {
      if (isNewUser) {
        await sendMessageWithTyping(phoneNumber, response.buildOnboarding(pushName));
      } else {
        await sendMessageWithTyping(phoneNumber, response.buildUnknownIntent());
      }
      return;
    }

    // =====================================================
    // DM: progressive onboarding + images
    // =====================================================
    const responseText = await handleIntent(user.id, intent);
    const onboardingStep = await getOnboardingStep(user.id);

    // After first buy → send response + guide to "carteira"
    if (intent.type === 'buy' && onboardingStep < 1) {
      await setOnboardingStep(user.id, 1);
      await sendMessageWithTyping(phoneNumber, responseText);
      // Small delay then nudge
      await sendMessageWithTyping(phoneNumber, response.buildOnboardingStep2());
      return;
    }

    // After first portfolio view → send card + guide to wallet tracking
    if (intent.type === 'portfolio_summary' && onboardingStep < 2) {
      await setOnboardingStep(user.id, 2);
      const summary = await getPortfolioSummary(user.id);
      await sendResponseWithImages(phoneNumber, intent, user.id, responseText, summary);
      await sendMessageWithTyping(phoneNumber, response.buildOnboardingStep3());
      return;
    }

    // After first wallet add → onboarding complete
    if (intent.type === 'watch_wallet' && onboardingStep < 3) {
      await setOnboardingStep(user.id, 3);
    }

    // Send with images
    await sendResponseWithImages(phoneNumber, intent, user.id, responseText);
  } catch (error) {
    console.error(`[Router] Error processing message:`, error);

    const target = isGroup ? groupJid! : phoneNumber;
    // 🔒 Never expose internal error details to user
    const userMessage = error instanceof Error && error.message.length < 100 && !error.message.includes('SQL') && !error.message.includes('supabase')
      ? error.message
      : 'Algo deu errado. Tenta de novo em instantes.';
    await sendMessageWithTyping(target, response.buildError(userMessage));
  }
}

// =====================================================
// 🖼️ Send response with image cards (DM only)
// =====================================================
async function sendResponseWithImages(
  phoneNumber: string,
  intent: Awaited<ReturnType<typeof parseIntent>>,
  userId: string,
  responseText: string,
  cachedSummary?: PortfolioSummary
): Promise<void> {
  try {
    if (intent.type === 'portfolio_summary') {
      const summary = cachedSummary ?? await getPortfolioSummary(userId);
      if (summary.holdings.length > 0) {
        const cardImage = await generatePortfolioCard(summary);
        await sendImageWithTyping(phoneNumber, cardImage, responseText);

        // Send meme if P/L is significant
        if (shouldGenerateMeme(summary.total_profit_loss_percent)) {
          const memeImage = await generateMemeCard(
            summary.total_profit_loss_percent,
            summary.total_current_value,
            summary.total_profit_loss
          );
          await sendImageWithTyping(phoneNumber, memeImage);
        }
        return;
      }
    }

    if (intent.type === 'price_check' && intent.data?.crypto) {
      const spotPrice = await getSpotPrice(intent.data.crypto);
      if (spotPrice) {
        const priceImage = await generatePriceCard(spotPrice);
        await sendImageWithTyping(phoneNumber, priceImage, responseText);
        return;
      }
    }

    if (intent.type === 'watch_wallet' || intent.type === 'wallet_balance') {
      const addr = intent.data?.walletAddress;
      if (addr) {
        const chain = detectChain(addr);
        if (chain) {
          const walletSummary = await getWalletBalance(addr, chain);
          const walletImage = await generateWalletCard(walletSummary);
          await sendImageWithTyping(phoneNumber, walletImage, responseText);
          return;
        }
      }
    }
  } catch (imgError) {
    console.error('[Router] Image generation failed, sending text only:', imgError);
  }

  // Fallback: text only
  await sendMessageWithTyping(phoneNumber, responseText);
}

async function handleIntent(
  userId: string,
  intent: Awaited<ReturnType<typeof parseIntent>>
): Promise<string> {
  switch (intent.type) {
    case 'buy': {
      const { crypto, amountFiat, amountCrypto, price } = intent.data ?? {};

      if (!crypto) {
        return response.buildError('Qual cripto você comprou? Ex: "comprei 500 de btc"');
      }

      if (!amountFiat && !amountCrypto) {
        return response.buildError(
          'Quanto você investiu? Ex: "comprei 500 de btc"'
        );
      }

      // 🔒 Validate transaction amount
      if (amountFiat && (amountFiat <= 0 || amountFiat > MAX_TRANSACTION_FIAT)) {
        return response.buildError('Valor inválido. Informe um valor entre R$ 0,01 e R$ 1.000.000.');
      }
      if (amountCrypto && amountCrypto <= 0) {
        return response.buildError('Quantidade de cripto precisa ser maior que zero.');
      }

      const result = await registerBuy(
        userId,
        crypto,
        amountFiat ?? 0,
        amountCrypto,
        price
      );

      return response.buildBuyConfirmation(result);
    }

    case 'sell': {
      const { crypto, amountCrypto, amountFiat, price } = intent.data ?? {};

      if (!crypto) {
        return response.buildError('Qual cripto você vendeu? Ex: "vendi 0.5 eth"');
      }

      if (!amountCrypto) {
        return response.buildError(
          'Quanto você vendeu? Ex: "vendi 0.5 eth por 5000"'
        );
      }

      // 🔒 Validate sell amounts
      if (amountCrypto <= 0) {
        return response.buildError('Quantidade precisa ser maior que zero.');
      }
      if (amountFiat && (amountFiat <= 0 || amountFiat > MAX_TRANSACTION_FIAT)) {
        return response.buildError('Valor inválido. Informe um valor entre R$ 0,01 e R$ 1.000.000.');
      }

      const result = await registerSell(userId, crypto, amountCrypto, amountFiat, price);

      return response.buildSellConfirmation(result);
    }

    case 'portfolio_summary': {
      const summary = await getPortfolioSummary(userId);
      return response.buildPortfolioSummary(summary);
    }

    case 'asset_detail': {
      const { crypto } = intent.data ?? {};

      if (!crypto) {
        return response.buildError('Qual ativo você quer ver? Ex: "quanto tenho de btc"');
      }

      const detail = await getAssetDetail(userId, crypto);

      if (!detail) {
        return response.buildAssetNotFound(crypto);
      }

      return response.buildAssetDetail(detail);
    }

    case 'price_check': {
      const { crypto } = intent.data ?? {};

      if (!crypto) {
        return response.buildError('Qual cripto? Ex: "preço do btc"');
      }

      const priceData = await getSpotPrice(crypto);

      if (!priceData) {
        return response.buildCryptoNotSupported(crypto);
      }

      return response.buildPriceCheck(priceData);
    }

    case 'remove_asset': {
      const { crypto } = intent.data ?? {};

      if (!crypto) {
        return response.buildError('Qual ativo remover? Ex: "remover btc"');
      }

      const result = await removeAsset(userId, crypto);

      if (!result.removed) {
        return response.buildAssetNotFound(crypto);
      }

      return response.buildRemoveAssetConfirmation(
        crypto,
        result.amountRemoved,
        result.valueAtRemoval
      );
    }

    case 'set_dca_goal': {
      const { crypto, goalAmount } = intent.data ?? {};

      if (!crypto || !goalAmount) {
        return response.buildError(
          'Como definir meta: "meta 10000 em btc"'
        );
      }

      // 🔒 Validate DCA goal
      if (goalAmount <= 0 || goalAmount > MAX_DCA_GOAL) {
        return response.buildError('Meta precisa ser entre R$ 1 e R$ 10.000.000.');
      }

      await setDcaGoal(userId, crypto, goalAmount);

      return response.buildDcaGoalSet(crypto, goalAmount);
    }

    case 'dca_progress': {
      const progress = await getDcaProgress(userId);
      return response.buildDcaProgress(progress);
    }

    case 'projection': {
      const { months } = intent.data ?? {};
      const projectionMonths = months ?? 12;

      const summary = await getPortfolioSummary(userId);

      if (summary.holdings.length === 0) {
        return response.buildError(
          'Você precisa ter ativos na carteira para ver projeções.'
        );
      }

      const projection = await getProjection(userId, projectionMonths);

      return response.buildProjection(projection, summary.total_current_value);
    }

    case 'set_alert': {
      const { crypto, targetPrice, alertType, removeIndex } = intent.data ?? {};

      // Remove alert by index: "remover alerta 1"
      if (removeIndex !== undefined) {
        const { removeAlertByIndex } = await import('./alert-service.js');
        return await removeAlertByIndex(userId, removeIndex);
      }

      if (!crypto || !targetPrice || !alertType) {
        // Maybe they want to list alerts
        const { listAlerts } = await import('./alert-service.js');
        return await listAlerts(userId);
      }

      const { setAlert } = await import('./alert-service.js');
      const result = await setAlert(userId, crypto, targetPrice, alertType);
      return result.message;
    }

    // =====================================================
    // Wallet Tracking
    // =====================================================

    case 'watch_wallet': {
      const walletAddress = intent.data?.walletAddress;
      if (!walletAddress) {
        return response.buildInvalidAddress();
      }

      const chain = detectChain(walletAddress);
      if (!chain) {
        return response.buildInvalidAddress();
      }

      // 🏷️ Check chain access
      const chainCheck = await canUseChain(userId, chain);
      if (!chainCheck.allowed) {
        return chainCheck.reason! + buildUpgradeMessage('Mais redes');
      }

      // 🏷️ Check wallet limit
      const walletCount = await countUserWallets(userId);
      const walletCheck = await canAddWallet(userId, walletCount);
      if (!walletCheck.allowed) {
        return walletCheck.reason! + buildUpgradeMessage('Mais wallets');
      }

      // Salva no banco
      await addWallet({
        userId,
        address: walletAddress.toLowerCase(),
        chain,
        label: intent.data?.walletLabel,
      });

      // Busca saldo atual
      const walletSummary = await getWalletBalance(walletAddress, chain);

      return response.buildWalletAdded(walletSummary);
    }

    case 'list_wallets': {
      const wallets = await getUserWallets(userId);

      // Busca saldo de cada wallet
      const summaries = await Promise.all(
        wallets.map((w) => getWalletBalance(w.address, w.chain as Chain, w.label ?? undefined))
      );

      return response.buildWalletList(wallets, summaries);
    }

    case 'remove_wallet': {
      const removeAddr = intent.data?.walletAddress;
      if (!removeAddr) {
        return response.buildInvalidAddress();
      }

      const removed = await removeWallet(userId, removeAddr);
      if (!removed) {
        return response.buildWalletNotFound(removeAddr);
      }

      return response.buildWalletRemoved(removeAddr);
    }

    case 'wallet_balance': {
      const balanceAddr = intent.data?.walletAddress;
      if (!balanceAddr) {
        return response.buildInvalidAddress();
      }

      const balanceChain = detectChain(balanceAddr);
      if (!balanceChain) {
        return response.buildInvalidAddress();
      }

      const balanceSummary = await getWalletBalance(balanceAddr, balanceChain);
      return response.buildWalletBalance(balanceSummary);
    }

    case 'help': {
      return response.buildHelp();
    }

    case 'my_plan': {
      const tier = await getUserTier(userId);
      const { streak } = await updateStreak(userId);
      // Get phone to generate referral code
      const { data: userData } = await supabase.from('idm_users').select('phone_number').eq('id', userId).single();
      const code = userData ? await getOrCreateReferralCode(userId, userData.phone_number) : undefined;
      return buildTierInfo(tier, streak, code);
    }

    case 'upgrade': {
      const plan = intent.data?.plan;
      if (plan) {
        // User said "assinar pro" or "assinar whale" → start checkout
        return await startCheckout(userId, plan);
      }
      // Just "upgrade" → show plans
      return buildUpgradePlans();
    }

    case 'referral': {
      const incomingCode = intent.data?.referralCode;

      // User sent a referral code → process it
      if (incomingCode) {
        const result = await processReferral(userId, incomingCode);
        if (result.success) {
          return `Código aplicado! ${result.referrerName ? `Indicado por ${result.referrerName}.` : ''}\n\nBem-vindo ao IDM! Manda *comprei 500 de btc* pra começar.`;
        }
        return 'Código de referral inválido. Confere e tenta de novo!';
      }

      // User wants their own code
      const { data: userData } = await supabase.from('idm_users').select('phone_number, referral_count').eq('id', userId).single();
      if (!userData) return response.buildError('Erro ao buscar dados.');
      const code = await getOrCreateReferralCode(userId, userData.phone_number);
      return buildReferralInfo(code, userData.referral_count ?? 0);
    }

    case 'group_ai_question': {
      return response.buildUnknownIntent();
    }

    default:
      return response.buildUnknownIntent();
  }
}
