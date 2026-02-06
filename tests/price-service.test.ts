import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkRateLimit,
  recordRequest,
  clearRateLimits,
  getRateLimitStatus,
} from '../src/utils/rate-limiter.js';

describe('Rate Limiter', () => {
  beforeEach(() => {
    clearRateLimits();
  });

  afterEach(() => {
    clearRateLimits();
  });

  describe('checkRateLimit', () => {
    it('should allow first request', () => {
      const result = checkRateLimit('user1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // 10 - 1 for current
    });

    it('should track multiple requests', () => {
      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit('user2');
        expect(result.allowed).toBe(true);
        recordRequest('user2');
      }

      const status = getRateLimitStatus('user2');
      expect(status.used).toBe(5);
      expect(status.remaining).toBe(5);
    });

    it('should block after limit exceeded', () => {
      for (let i = 0; i < 10; i++) {
        recordRequest('user3');
      }

      const result = checkRateLimit('user3');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should isolate users', () => {
      for (let i = 0; i < 10; i++) {
        recordRequest('user4');
      }

      const user4Result = checkRateLimit('user4');
      const user5Result = checkRateLimit('user5');

      expect(user4Result.allowed).toBe(false);
      expect(user5Result.allowed).toBe(true);
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return full limit for new user', () => {
      const status = getRateLimitStatus('newuser');
      expect(status.used).toBe(0);
      expect(status.limit).toBe(10);
      expect(status.remaining).toBe(10);
    });

    it('should track usage correctly', () => {
      recordRequest('user6');
      recordRequest('user6');
      recordRequest('user6');

      const status = getRateLimitStatus('user6');
      expect(status.used).toBe(3);
      expect(status.remaining).toBe(7);
    });
  });
});

describe('Price Cache Logic', () => {
  describe('Cache TTL calculations', () => {
    it('should calculate if cache is fresh (spot price)', () => {
      const SPOT_PRICE_TTL = 60 * 1000; // 60 seconds
      const cacheTimestamp = Date.now() - 30 * 1000; // 30 seconds ago
      const isFresh = Date.now() - cacheTimestamp < SPOT_PRICE_TTL;

      expect(isFresh).toBe(true);
    });

    it('should calculate if cache is stale (spot price)', () => {
      const SPOT_PRICE_TTL = 60 * 1000; // 60 seconds
      const cacheTimestamp = Date.now() - 90 * 1000; // 90 seconds ago
      const isFresh = Date.now() - cacheTimestamp < SPOT_PRICE_TTL;

      expect(isFresh).toBe(false);
    });

    it('should calculate if cache is fresh (historical price)', () => {
      const HISTORICAL_PRICE_TTL = 5 * 60 * 1000; // 5 minutes
      const cacheTimestamp = Date.now() - 3 * 60 * 1000; // 3 minutes ago
      const isFresh = Date.now() - cacheTimestamp < HISTORICAL_PRICE_TTL;

      expect(isFresh).toBe(true);
    });

    it('should calculate if cache is stale (historical price)', () => {
      const HISTORICAL_PRICE_TTL = 5 * 60 * 1000; // 5 minutes
      const cacheTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      const isFresh = Date.now() - cacheTimestamp < HISTORICAL_PRICE_TTL;

      expect(isFresh).toBe(false);
    });
  });

  describe('Rate limit timing', () => {
    it('should calculate minimum request interval', () => {
      const MIN_REQUEST_INTERVAL = 2000; // 2 seconds
      const lastRequestTime = Date.now() - 1000; // 1 second ago
      const timeSinceLastRequest = Date.now() - lastRequestTime;
      const shouldWait = timeSinceLastRequest < MIN_REQUEST_INTERVAL;

      expect(shouldWait).toBe(true);
    });

    it('should allow request after interval passed', () => {
      const MIN_REQUEST_INTERVAL = 2000; // 2 seconds
      const lastRequestTime = Date.now() - 3000; // 3 seconds ago
      const timeSinceLastRequest = Date.now() - lastRequestTime;
      const shouldWait = timeSinceLastRequest < MIN_REQUEST_INTERVAL;

      expect(shouldWait).toBe(false);
    });
  });
});

describe('CoinGecko Response Parsing', () => {
  it('should parse spot price response', () => {
    const mockResponse = {
      bitcoin: {
        brl: 500000,
        brl_24h_change: 2.5,
      },
    };

    const cryptoId = 'bitcoin';
    const priceData = mockResponse[cryptoId];

    expect(priceData).toBeDefined();
    expect(priceData?.brl).toBe(500000);
    expect(priceData?.brl_24h_change).toBe(2.5);
  });

  it('should parse multiple prices response', () => {
    const mockResponse = {
      bitcoin: { brl: 500000, brl_24h_change: 2.5 },
      ethereum: { brl: 15000, brl_24h_change: -1.2 },
      solana: { brl: 800, brl_24h_change: 5.0 },
    };

    const prices = Object.entries(mockResponse).map(([id, data]) => ({
      cryptoId: id,
      price: data.brl,
      priceChangePercent24h: data.brl_24h_change,
    }));

    expect(prices).toHaveLength(3);
    expect(prices[0]).toEqual({
      cryptoId: 'bitcoin',
      price: 500000,
      priceChangePercent24h: 2.5,
    });
  });

  it('should parse historical price response', () => {
    const mockResponse = {
      prices: [
        [1704067200000, 450000],
        [1704153600000, 460000],
        [1704240000000, 455000],
      ] as [number, number][],
    };

    const prices = mockResponse.prices.map(([timestamp, price]) => ({
      timestamp,
      price,
    }));

    expect(prices).toHaveLength(3);
    expect(prices[0]).toEqual({ timestamp: 1704067200000, price: 450000 });
  });

  it('should handle missing crypto in response', () => {
    const mockResponse = {
      bitcoin: { brl: 500000 },
    };

    const cryptoId = 'ethereum';
    const priceData = mockResponse[cryptoId as keyof typeof mockResponse];

    expect(priceData).toBeUndefined();
  });
});

describe('Exponential Backoff', () => {
  const BASE_DELAY = 1000;
  const MAX_DELAY = 10000;

  function getRetryDelay(attempt: number): number {
    const delay = BASE_DELAY * Math.pow(2, attempt);
    return Math.min(delay, MAX_DELAY);
  }

  it('should calculate first retry delay', () => {
    expect(getRetryDelay(0)).toBe(1000);
  });

  it('should calculate second retry delay', () => {
    expect(getRetryDelay(1)).toBe(2000);
  });

  it('should calculate third retry delay', () => {
    expect(getRetryDelay(2)).toBe(4000);
  });

  it('should cap at max delay', () => {
    expect(getRetryDelay(5)).toBe(10000); // Would be 32000, capped at 10000
    expect(getRetryDelay(10)).toBe(10000);
  });
});
