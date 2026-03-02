import { env } from '../config/env.js';
import type { PriceCache } from '../types/index.js';
import { resolveCryptoId } from '../utils/crypto-mapper.js';

// Cache configuration
const SPOT_PRICE_TTL = 60 * 1000; // 60 seconds
const HISTORICAL_PRICE_TTL = 5 * 60 * 1000; // 5 minutes

// In-memory cache
const priceCache = new Map<string, PriceCache>();
const historicalCache = new Map<string, { data: unknown; timestamp: number }>();

// Rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds between requests (30 calls/min)

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();
  return fetch(url);
}

export interface SpotPrice {
  cryptoId: string;
  price: number;
  priceChange24h: number;
  priceChangePercent24h: number;
}

export async function getSpotPrice(cryptoIdOrAlias: string): Promise<SpotPrice | null> {
  const cryptoId = resolveCryptoId(cryptoIdOrAlias) ?? cryptoIdOrAlias;
  const cacheKey = `spot:${cryptoId}`;
  const cached = priceCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < SPOT_PRICE_TTL) {
    console.log(`[PriceService] Cache hit for ${cryptoId}`);
    return {
      cryptoId,
      price: cached.price,
      priceChange24h: (cached.price * cached.priceChangePercent24h) / 100,
      priceChangePercent24h: cached.priceChangePercent24h,
    };
  }

  try {
    const url = `${env.COINGECKO_API_URL}/simple/price?ids=${cryptoId}&vs_currencies=brl&include_24hr_change=true`;
    console.log(`[PriceService] Fetching price for ${cryptoId}`);

    const response = await rateLimitedFetch(url);

    if (!response.ok) {
      console.error(`[PriceService] CoinGecko API error: ${response.status}`);
      return getCachedOrNull(cacheKey, cryptoId);
    }

    const data = (await response.json()) as Record<
      string,
      { brl: number; brl_24h_change?: number }
    >;
    const priceData = data[cryptoId];

    if (!priceData) {
      console.error(`[PriceService] No price data for ${cryptoId}`);
      return null;
    }

    const price = priceData.brl;
    const priceChangePercent24h = priceData.brl_24h_change ?? 0;

    // Update cache
    priceCache.set(cacheKey, { price, priceChangePercent24h, timestamp: Date.now() });

    return {
      cryptoId,
      price,
      priceChange24h: (price * priceChangePercent24h) / 100,
      priceChangePercent24h,
    };
  } catch (error) {
    console.error(`[PriceService] Error fetching price for ${cryptoId}:`, error);
    return getCachedOrNull(cacheKey, cryptoId);
  }
}

/**
 * Busca preços de múltiplas cryptos numa única chamada CoinGecko.
 * Muito mais eficiente que chamar getSpotPrice() pra cada uma.
 * Retorna Map<cryptoId, preçoBRL>.
 */
export async function getSpotPriceBatch(cryptoIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const idsToFetch: string[] = [];

  // Resolve aliases e checa cache
  for (const rawId of cryptoIds) {
    const cryptoId = resolveCryptoId(rawId) ?? rawId;
    const cacheKey = `spot:${cryptoId}`;
    const cached = priceCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < SPOT_PRICE_TTL) {
      result.set(cryptoId, cached.price);
    } else if (!idsToFetch.includes(cryptoId)) {
      idsToFetch.push(cryptoId);
    }
  }

  // Se tudo tava em cache, retorna direto
  if (idsToFetch.length === 0) return result;

  try {
    // Uma única chamada CoinGecko com todos os IDs
    const idsParam = idsToFetch.join(',');
    const url = `${env.COINGECKO_API_URL}/simple/price?ids=${idsParam}&vs_currencies=brl&include_24hr_change=true`;
    console.log(`[PriceService] Batch fetching prices for: ${idsParam}`);

    const response = await rateLimitedFetch(url);
    if (!response.ok) {
      console.error(`[PriceService] CoinGecko batch error: ${response.status}`);
      // Retorna o que tiver em cache
      return result;
    }

    const data = (await response.json()) as Record<
      string,
      { brl: number; brl_24h_change?: number }
    >;

    for (const cryptoId of idsToFetch) {
      const priceData = data[cryptoId];
      if (priceData) {
        const price = priceData.brl;
        const priceChangePercent24h = priceData.brl_24h_change ?? 0;
        // Atualiza cache individual
        priceCache.set(`spot:${cryptoId}`, { price, priceChangePercent24h, timestamp: Date.now() });
        result.set(cryptoId, price);
      }
    }
  } catch (error) {
    console.error('[PriceService] Batch price error:', error);
  }

  return result;
}

function getCachedOrNull(cacheKey: string, cryptoId: string): SpotPrice | null {
  const cached = priceCache.get(cacheKey);
  if (cached) {
    console.log(`[PriceService] Using stale cache for ${cryptoId}`);
    return {
      cryptoId,
      price: cached.price,
      priceChange24h: (cached.price * cached.priceChangePercent24h) / 100,
      priceChangePercent24h: cached.priceChangePercent24h,
    };
  }
  return null;
}

export async function getMultipleSpotPrices(
  cryptoIds: string[]
): Promise<Map<string, SpotPrice>> {
  const results = new Map<string, SpotPrice>();
  const idsToFetch: string[] = [];

  // Check cache first
  for (const idOrAlias of cryptoIds) {
    const cryptoId = resolveCryptoId(idOrAlias) ?? idOrAlias;
    const cacheKey = `spot:${cryptoId}`;
    const cached = priceCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < SPOT_PRICE_TTL) {
      results.set(cryptoId, {
        cryptoId,
        price: cached.price,
        priceChange24h: (cached.price * cached.priceChangePercent24h) / 100,
        priceChangePercent24h: cached.priceChangePercent24h,
      });
    } else {
      idsToFetch.push(cryptoId);
    }
  }

  if (idsToFetch.length === 0) {
    return results;
  }

  try {
    const url = `${env.COINGECKO_API_URL}/simple/price?ids=${idsToFetch.join(',')}&vs_currencies=brl&include_24hr_change=true`;
    console.log(`[PriceService] Fetching prices for ${idsToFetch.join(', ')}`);

    const response = await rateLimitedFetch(url);

    if (!response.ok) {
      console.error(`[PriceService] CoinGecko API error: ${response.status}`);
      return results;
    }

    const data = (await response.json()) as Record<
      string,
      { brl: number; brl_24h_change?: number }
    >;

    for (const cryptoId of idsToFetch) {
      const priceData = data[cryptoId];
      if (priceData) {
        const price = priceData.brl;
        const priceChangePercent24h = priceData.brl_24h_change ?? 0;

        priceCache.set(`spot:${cryptoId}`, { price, priceChangePercent24h, timestamp: Date.now() });

        results.set(cryptoId, {
          cryptoId,
          price,
          priceChange24h: (price * priceChangePercent24h) / 100,
          priceChangePercent24h,
        });
      }
    }
  } catch (error) {
    console.error('[PriceService] Error fetching multiple prices:', error);
  }

  return results;
}

export interface HistoricalPrice {
  timestamp: number;
  price: number;
}

export async function getHistoricalPrices(
  cryptoIdOrAlias: string,
  days: number = 30
): Promise<HistoricalPrice[]> {
  const cryptoId = resolveCryptoId(cryptoIdOrAlias) ?? cryptoIdOrAlias;
  const cacheKey = `historical:${cryptoId}:${days}`;
  const cached = historicalCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < HISTORICAL_PRICE_TTL) {
    console.log(`[PriceService] Historical cache hit for ${cryptoId}`);
    return cached.data as HistoricalPrice[];
  }

  try {
    const url = `${env.COINGECKO_API_URL}/coins/${cryptoId}/market_chart?vs_currency=brl&days=${days}`;
    console.log(`[PriceService] Fetching historical prices for ${cryptoId}`);

    const response = await rateLimitedFetch(url);

    if (!response.ok) {
      console.error(`[PriceService] CoinGecko API error: ${response.status}`);
      return getCachedHistoricalOrEmpty(cacheKey);
    }

    const data = (await response.json()) as { prices: [number, number][] };
    const prices: HistoricalPrice[] = data.prices.map(([timestamp, price]) => ({
      timestamp,
      price,
    }));

    historicalCache.set(cacheKey, { data: prices, timestamp: Date.now() });

    return prices;
  } catch (error) {
    console.error(`[PriceService] Error fetching historical prices for ${cryptoId}:`, error);
    return getCachedHistoricalOrEmpty(cacheKey);
  }
}

function getCachedHistoricalOrEmpty(cacheKey: string): HistoricalPrice[] {
  const cached = historicalCache.get(cacheKey);
  if (cached) {
    return cached.data as HistoricalPrice[];
  }
  return [];
}

export function clearCache(): void {
  priceCache.clear();
  historicalCache.clear();
}
