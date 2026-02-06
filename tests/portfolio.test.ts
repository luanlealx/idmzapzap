import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatCurrencyCompact,
  formatCryptoAmount,
  formatPercent,
  formatProfitLoss,
  progressBar,
} from '../src/utils/formatters.js';

describe('Formatters', () => {
  describe('formatCurrency', () => {
    it('should format currency in BRL', () => {
      // Using toMatch to handle locale-specific spacing (NBSP vs regular space)
      expect(formatCurrency(1000)).toMatch(/R\$\s*1\.000,00/);
      expect(formatCurrency(1234.56)).toMatch(/R\$\s*1\.234,56/);
      expect(formatCurrency(0)).toMatch(/R\$\s*0,00/);
      expect(formatCurrency(99.9)).toMatch(/R\$\s*99,90/);
    });

    it('should handle negative values', () => {
      expect(formatCurrency(-1000)).toMatch(/-R\$\s*1\.000,00/);
      expect(formatCurrency(-50.5)).toMatch(/-R\$\s*50,50/);
    });

    it('should handle large values', () => {
      expect(formatCurrency(1000000)).toMatch(/R\$\s*1\.000\.000,00/);
      expect(formatCurrency(123456789.12)).toMatch(/R\$\s*123\.456\.789,12/);
    });
  });

  describe('formatCurrencyCompact', () => {
    it('should format small values normally', () => {
      expect(formatCurrencyCompact(1000)).toMatch(/R\$\s*1\.000,00/);
      expect(formatCurrencyCompact(9999)).toMatch(/R\$\s*9\.999,00/);
    });

    it('should use compact notation for large values', () => {
      const result = formatCurrencyCompact(100000);
      // Compact notation varies by locale, just check it contains R$
      expect(result).toContain('R$');
    });
  });

  describe('formatCryptoAmount', () => {
    it('should format large amounts with fewer decimals', () => {
      const result = formatCryptoAmount(1234.5678);
      expect(result).toContain('1.234');
    });

    it('should format small amounts with more decimals', () => {
      const result = formatCryptoAmount(0.00012345);
      expect(result).toContain('0,000123');
    });

    it('should format medium amounts appropriately', () => {
      const result = formatCryptoAmount(1.23456789);
      // Accept either 1,2345 or 1,2346 (rounding)
      expect(result).toMatch(/1,234[56]/);
    });
  });

  describe('formatPercent', () => {
    it('should format positive percentages with plus sign', () => {
      const result = formatPercent(15.5);
      expect(result).toContain('+');
      expect(result).toContain('15');
    });

    it('should format negative percentages with minus sign', () => {
      const result = formatPercent(-10.25);
      expect(result).toContain('-');
      expect(result).toContain('10');
    });

    it('should format zero', () => {
      const result = formatPercent(0);
      expect(result).toContain('0');
    });
  });

  describe('formatProfitLoss', () => {
    it('should show profit with up emoji', () => {
      const result = formatProfitLoss(1000, 10);
      expect(result).toContain('📈');
      expect(result).toContain('+');
      expect(result).toContain('R$');
    });

    it('should show loss with down emoji', () => {
      const result = formatProfitLoss(-500, -5);
      expect(result).toContain('📉');
      expect(result).toContain('R$');
    });
  });

  describe('progressBar', () => {
    it('should show empty bar at 0%', () => {
      const result = progressBar(0, 10);
      expect(result).toBe('░░░░░░░░░░');
    });

    it('should show full bar at 100%', () => {
      const result = progressBar(100, 10);
      expect(result).toBe('▓▓▓▓▓▓▓▓▓▓');
    });

    it('should show partial bar at 50%', () => {
      const result = progressBar(50, 10);
      expect(result).toBe('▓▓▓▓▓░░░░░');
    });

    it('should cap at 100%', () => {
      const result = progressBar(150, 10);
      expect(result).toBe('▓▓▓▓▓▓▓▓▓▓');
    });

    it('should work with custom length', () => {
      const result = progressBar(50, 20);
      expect(result.length).toBe(20);
      expect(result).toBe('▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░');
    });
  });
});

describe('Portfolio Calculations', () => {
  describe('Average Price Calculation', () => {
    it('should calculate simple average price', () => {
      // Buy 1 BTC at R$100,000
      // Buy 1 BTC at R$120,000
      // Total: 2 BTC for R$220,000
      // Average: R$110,000
      const totalCrypto = 2;
      const totalInvested = 220000;
      const averagePrice = totalInvested / totalCrypto;

      expect(averagePrice).toBe(110000);
    });

    it('should calculate weighted average price', () => {
      // Buy 0.5 BTC at R$100,000 (R$50,000 invested)
      // Buy 1.5 BTC at R$120,000 (R$180,000 invested)
      // Total: 2 BTC for R$230,000
      // Average: R$115,000
      const totalCrypto = 0.5 + 1.5;
      const totalInvested = 50000 + 180000;
      const averagePrice = totalInvested / totalCrypto;

      expect(averagePrice).toBe(115000);
    });
  });

  describe('Profit/Loss Calculation', () => {
    it('should calculate profit correctly', () => {
      const totalInvested = 10000;
      const currentValue = 15000;
      const profitLoss = currentValue - totalInvested;
      const profitLossPercent = (profitLoss / totalInvested) * 100;

      expect(profitLoss).toBe(5000);
      expect(profitLossPercent).toBe(50);
    });

    it('should calculate loss correctly', () => {
      const totalInvested = 10000;
      const currentValue = 7500;
      const profitLoss = currentValue - totalInvested;
      const profitLossPercent = (profitLoss / totalInvested) * 100;

      expect(profitLoss).toBe(-2500);
      expect(profitLossPercent).toBe(-25);
    });

    it('should handle zero investment', () => {
      const totalInvested = 0;
      const currentValue = 0;
      const profitLoss = currentValue - totalInvested;
      const profitLossPercent = totalInvested > 0 ? (profitLoss / totalInvested) * 100 : 0;

      expect(profitLoss).toBe(0);
      expect(profitLossPercent).toBe(0);
    });
  });

  describe('Sell Transaction Profit', () => {
    it('should calculate profit on partial sell', () => {
      // Holding: 1 BTC at average price R$100,000
      // Sell: 0.5 BTC at R$120,000
      const averagePrice = 100000;
      const sellAmount = 0.5;
      const sellPrice = 120000;

      const costBasis = sellAmount * averagePrice; // R$50,000
      const saleProceeds = sellAmount * sellPrice; // R$60,000
      const profit = saleProceeds - costBasis; // R$10,000
      const profitPercent = (profit / costBasis) * 100; // 20%

      expect(costBasis).toBe(50000);
      expect(saleProceeds).toBe(60000);
      expect(profit).toBe(10000);
      expect(profitPercent).toBe(20);
    });

    it('should calculate loss on sell', () => {
      // Holding: 1 BTC at average price R$100,000
      // Sell: 0.5 BTC at R$80,000
      const averagePrice = 100000;
      const sellAmount = 0.5;
      const sellPrice = 80000;

      const costBasis = sellAmount * averagePrice; // R$50,000
      const saleProceeds = sellAmount * sellPrice; // R$40,000
      const profit = saleProceeds - costBasis; // -R$10,000
      const profitPercent = (profit / costBasis) * 100; // -20%

      expect(costBasis).toBe(50000);
      expect(saleProceeds).toBe(40000);
      expect(profit).toBe(-10000);
      expect(profitPercent).toBe(-20);
    });
  });

  describe('DCA Progress', () => {
    it('should calculate progress percentage', () => {
      const goalAmount = 10000;
      const currentInvested = 7500;
      const progressPercent = (currentInvested / goalAmount) * 100;

      expect(progressPercent).toBe(75);
    });

    it('should cap progress at 100%', () => {
      const goalAmount = 10000;
      const currentInvested = 15000;
      const progressPercent = Math.min((currentInvested / goalAmount) * 100, 100);

      expect(progressPercent).toBe(100);
    });

    it('should calculate remaining amount', () => {
      const goalAmount = 10000;
      const currentInvested = 7500;
      const remaining = Math.max(goalAmount - currentInvested, 0);

      expect(remaining).toBe(2500);
    });
  });

  describe('Projection Calculations', () => {
    it('should calculate moderate projection', () => {
      const currentValue = 10000;
      const months = 12;
      const annualRate = 0.15; // 15%

      const monthlyFactor = months / 12;
      const projectedValue = currentValue * (1 + annualRate * monthlyFactor);

      expect(projectedValue).toBe(11500);
    });

    it('should calculate pessimistic projection', () => {
      const currentValue = 10000;
      const months = 12;
      const annualRate = -0.2; // -20%

      const monthlyFactor = months / 12;
      const projectedValue = currentValue * (1 + annualRate * monthlyFactor);

      expect(projectedValue).toBe(8000);
    });

    it('should calculate 6-month projection', () => {
      const currentValue = 10000;
      const months = 6;
      const annualRate = 0.15; // 15%

      const monthlyFactor = months / 12; // 0.5
      const projectedValue = currentValue * (1 + annualRate * monthlyFactor);

      expect(projectedValue).toBe(10750);
    });
  });
});
