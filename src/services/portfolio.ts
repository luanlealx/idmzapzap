import type {
  HoldingWithCurrentValue,
  PortfolioSummary,
  DcaGoal,
} from '../types/index.js';
import * as transactionRepo from '../database/repositories/transaction.repo.js';
import * as portfolioRepo from '../database/repositories/portfolio.repo.js';
import { getSpotPrice, getMultipleSpotPrices } from './price-service.js';

export interface BuyResult {
  cryptoId: string;
  amountFiat: number;
  amountCrypto: number;
  priceAtTransaction: number;
  newTotalCrypto: number;
  newAveragePrice: number;
}

export async function registerBuy(
  userId: string,
  cryptoId: string,
  amountFiat: number,
  amountCrypto?: number,
  priceAtTransaction?: number
): Promise<BuyResult> {
  // Get current price if not provided
  let price = priceAtTransaction;
  if (!price) {
    const spotPrice = await getSpotPrice(cryptoId);
    if (!spotPrice) {
      throw new Error(`Não foi possível obter o preço de ${cryptoId}`);
    }
    price = spotPrice.price;
  }

  // Calculate amount of crypto if not provided
  const cryptoAmount = amountCrypto ?? amountFiat / price;

  // Create transaction
  await transactionRepo.createTransaction({
    userId,
    cryptoId,
    type: 'buy',
    amountFiat,
    amountCrypto: cryptoAmount,
    priceAtTransaction: price,
  });

  // Get updated holding
  const holding = await portfolioRepo.getHoldingByUserAndCrypto(userId, cryptoId);

  return {
    cryptoId,
    amountFiat,
    amountCrypto: cryptoAmount,
    priceAtTransaction: price,
    newTotalCrypto: holding?.total_crypto ?? cryptoAmount,
    newAveragePrice: holding?.average_price ?? price,
  };
}

export interface SellResult {
  cryptoId: string;
  amountFiat: number;
  amountCrypto: number;
  priceAtTransaction: number;
  profit: number;
  profitPercent: number;
  remainingCrypto: number;
}

export async function registerSell(
  userId: string,
  cryptoId: string,
  amountCrypto: number,
  amountFiat?: number,
  priceAtTransaction?: number
): Promise<SellResult> {
  // Get current holding
  const currentHolding = await portfolioRepo.getHoldingByUserAndCrypto(userId, cryptoId);

  if (!currentHolding || currentHolding.total_crypto < amountCrypto) {
    throw new Error(
      `Você não possui ${amountCrypto} de ${cryptoId}. Saldo atual: ${currentHolding?.total_crypto ?? 0}`
    );
  }

  // Get current price if not provided
  let price = priceAtTransaction;
  if (!price && amountFiat) {
    price = amountFiat / amountCrypto;
  }
  if (!price) {
    const spotPrice = await getSpotPrice(cryptoId);
    if (!spotPrice) {
      throw new Error(`Não foi possível obter o preço de ${cryptoId}`);
    }
    price = spotPrice.price;
  }

  const fiatAmount = amountFiat ?? amountCrypto * price;

  // Calculate profit
  const costBasis = amountCrypto * currentHolding.average_price;
  const profit = fiatAmount - costBasis;
  const profitPercent = costBasis > 0 ? (profit / costBasis) * 100 : 0;

  // Create transaction
  await transactionRepo.createTransaction({
    userId,
    cryptoId,
    type: 'sell',
    amountFiat: fiatAmount,
    amountCrypto: amountCrypto,
    priceAtTransaction: price,
  });

  // Get updated holding
  const newHolding = await portfolioRepo.getHoldingByUserAndCrypto(userId, cryptoId);

  return {
    cryptoId,
    amountFiat: fiatAmount,
    amountCrypto,
    priceAtTransaction: price,
    profit,
    profitPercent,
    remainingCrypto: newHolding?.total_crypto ?? 0,
  };
}

export async function getPortfolioSummary(userId: string): Promise<PortfolioSummary> {
  const holdings = await portfolioRepo.getHoldingsByUser(userId);

  if (holdings.length === 0) {
    return {
      holdings: [],
      total_invested: 0,
      total_current_value: 0,
      total_profit_loss: 0,
      total_profit_loss_percent: 0,
    };
  }

  // Get all prices at once
  const cryptoIds = holdings.map((h) => h.crypto_id);
  const prices = await getMultipleSpotPrices(cryptoIds);

  const holdingsWithValue: HoldingWithCurrentValue[] = holdings.map((holding) => {
    const priceData = prices.get(holding.crypto_id);
    const currentPrice = priceData?.price ?? 0;
    const currentValue = holding.total_crypto * currentPrice;
    const profitLoss = currentValue - holding.total_invested;
    const profitLossPercent =
      holding.total_invested > 0 ? (profitLoss / holding.total_invested) * 100 : 0;

    return {
      ...holding,
      current_price: currentPrice,
      current_value: currentValue,
      profit_loss: profitLoss,
      profit_loss_percent: profitLossPercent,
    };
  });

  const totalInvested = holdingsWithValue.reduce((sum, h) => sum + h.total_invested, 0);
  const totalCurrentValue = holdingsWithValue.reduce((sum, h) => sum + h.current_value, 0);
  const totalProfitLoss = totalCurrentValue - totalInvested;
  const totalProfitLossPercent =
    totalInvested > 0 ? (totalProfitLoss / totalInvested) * 100 : 0;

  // Sort by current value descending
  holdingsWithValue.sort((a, b) => b.current_value - a.current_value);

  return {
    holdings: holdingsWithValue,
    total_invested: totalInvested,
    total_current_value: totalCurrentValue,
    total_profit_loss: totalProfitLoss,
    total_profit_loss_percent: totalProfitLossPercent,
  };
}

export async function getAssetDetail(
  userId: string,
  cryptoId: string
): Promise<HoldingWithCurrentValue | null> {
  const holding = await portfolioRepo.getHoldingByUserAndCrypto(userId, cryptoId);

  if (!holding) {
    return null;
  }

  const priceData = await getSpotPrice(cryptoId);
  const currentPrice = priceData?.price ?? 0;
  const currentValue = holding.total_crypto * currentPrice;
  const profitLoss = currentValue - holding.total_invested;
  const profitLossPercent =
    holding.total_invested > 0 ? (profitLoss / holding.total_invested) * 100 : 0;

  return {
    ...holding,
    current_price: currentPrice,
    current_value: currentValue,
    profit_loss: profitLoss,
    profit_loss_percent: profitLossPercent,
  };
}

export async function removeAsset(
  userId: string,
  cryptoId: string
): Promise<{ removed: boolean; amountRemoved: number; valueAtRemoval: number }> {
  const holding = await portfolioRepo.getHoldingByUserAndCrypto(userId, cryptoId);

  if (!holding || holding.total_crypto <= 0) {
    return { removed: false, amountRemoved: 0, valueAtRemoval: 0 };
  }

  const priceData = await getSpotPrice(cryptoId);
  const currentPrice = priceData?.price ?? holding.average_price;

  await portfolioRepo.createZeroingTransaction(userId, cryptoId, holding, currentPrice);

  return {
    removed: true,
    amountRemoved: holding.total_crypto,
    valueAtRemoval: holding.total_crypto * currentPrice,
  };
}

// DCA Goal functions
export async function setDcaGoal(
  userId: string,
  cryptoId: string,
  goalAmount: number
): Promise<DcaGoal> {
  return portfolioRepo.setDcaGoal(userId, cryptoId, goalAmount);
}

export interface DcaProgress {
  cryptoId: string;
  goalAmount: number;
  currentInvested: number;
  progressPercent: number;
  remaining: number;
}

export async function getDcaProgress(userId: string): Promise<DcaProgress[]> {
  const goals = await portfolioRepo.getDcaGoalsByUser(userId);
  const holdings = await portfolioRepo.getHoldingsByUser(userId);

  const holdingsMap = new Map(holdings.map((h) => [h.crypto_id, h]));

  return goals.map((goal) => {
    const holding = holdingsMap.get(goal.crypto_id);
    const currentInvested = holding?.total_invested ?? 0;
    const progressPercent =
      goal.goal_amount > 0 ? (currentInvested / goal.goal_amount) * 100 : 0;

    return {
      cryptoId: goal.crypto_id,
      goalAmount: goal.goal_amount,
      currentInvested,
      progressPercent: Math.min(progressPercent, 100),
      remaining: Math.max(goal.goal_amount - currentInvested, 0),
    };
  });
}

export interface Projection {
  months: number;
  scenarios: {
    pessimistic: { value: number; change: number };
    moderate: { value: number; change: number };
    optimistic: { value: number; change: number };
  };
}

export async function getProjection(userId: string, months: number): Promise<Projection> {
  const summary = await getPortfolioSummary(userId);
  const currentValue = summary.total_current_value;

  // Annual growth rates (approximate historical crypto market ranges)
  const pessimisticAnnual = -0.2; // -20% per year
  const moderateAnnual = 0.15; // +15% per year
  const optimisticAnnual = 0.5; // +50% per year

  // Convert to monthly rates
  const monthlyFactor = months / 12;

  const pessimisticValue = currentValue * (1 + pessimisticAnnual * monthlyFactor);
  const moderateValue = currentValue * (1 + moderateAnnual * monthlyFactor);
  const optimisticValue = currentValue * (1 + optimisticAnnual * monthlyFactor);

  return {
    months,
    scenarios: {
      pessimistic: {
        value: pessimisticValue,
        change: pessimisticValue - currentValue,
      },
      moderate: {
        value: moderateValue,
        change: moderateValue - currentValue,
      },
      optimistic: {
        value: optimisticValue,
        change: optimisticValue - currentValue,
      },
    },
  };
}
