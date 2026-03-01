import type { ParsedMessage } from '../types/index.js';
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
import { sendMessageWithTyping } from './whatsapp.js';
import * as response from './response-builder.js';
import { checkRateLimit, recordRequest } from '../utils/rate-limiter.js';

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

export async function processMessage(message: ParsedMessage): Promise<void> {
  const { phoneNumber, text, pushName } = message;

  // 🔒 Safe logging
  const maskedPhone = env.NODE_ENV === 'production'
    ? `${phoneNumber.slice(0, 4)}***${phoneNumber.slice(-2)}`
    : phoneNumber;
  console.log(`[Router] Processing message from ${maskedPhone}: "${text.slice(0, 80)}"`);

  try {
    // 🔒 Whitelist check (beta mode)
    if (ADMIN_WHITELIST && !ADMIN_WHITELIST.has(phoneNumber)) {
      console.log(`[Router] Blocked: ${maskedPhone} not in whitelist`);
      await sendMessageWithTyping(
        phoneNumber,
        '🔒 O IDM Carteira está em fase beta. Em breve você poderá usar! Fique de olho na comunidade.'
      );
      return;
    }

    // Check rate limit
    const rateLimitResult = checkRateLimit(phoneNumber);
    if (!rateLimitResult.allowed) {
      console.log(`[Router] Rate limited: ${phoneNumber}`);
      await sendMessageWithTyping(phoneNumber, response.buildRateLimited());
      return;
    }

    // Record this request for rate limiting
    recordRequest(phoneNumber);

    // Get or create user
    const user = await findOrCreateUser(phoneNumber, pushName);
    console.log(`[Router] User: ${user.id} (${maskedPhone})`);

    // Check if this is a new user (for onboarding)
    const isNewUser = !user.name && pushName;

    // Parse intent
    const intent = await parseIntent(text);
    console.log(`[Router] Intent: ${intent.type} (confidence: ${intent.confidence})`);

    // Handle unknown intent
    if (intent.type === 'unknown') {
      // If new user, show onboarding instead
      if (isNewUser) {
        await sendMessageWithTyping(phoneNumber, response.buildOnboarding(pushName));
      } else {
        await sendMessageWithTyping(phoneNumber, response.buildUnknownIntent());
      }
      return;
    }

    // Route to appropriate handler
    const responseText = await handleIntent(user.id, intent);
    await sendMessageWithTyping(phoneNumber, responseText);
  } catch (error) {
    console.error(`[Router] Error processing message:`, error);

    const errorMessage =
      error instanceof Error ? error.message : 'Erro interno. Tente novamente.';
    await sendMessageWithTyping(phoneNumber, response.buildError(errorMessage));
  }
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
      // Future feature - just acknowledge for now
      return response.buildError(
        'Alertas de preço em breve! Por enquanto, use "preço do btc" para ver cotações.'
      );
    }

    case 'help': {
      return response.buildHelp();
    }

    default:
      return response.buildUnknownIntent();
  }
}
