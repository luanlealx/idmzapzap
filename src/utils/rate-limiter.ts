// Sliding window rate limiter
const WINDOW_SIZE_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 10; // 10 messages per minute

interface WindowEntry {
  timestamps: number[];
}

const windows = new Map<string, WindowEntry>();

// Clean up old entries periodically
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  const now = Date.now();
  const cutoff = now - WINDOW_SIZE_MS * 2;

  for (const [key, entry] of windows) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) {
      windows.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // milliseconds until next slot available
}

export function checkRateLimit(identifier: string): RateLimitResult {
  const now = Date.now();
  const windowStart = now - WINDOW_SIZE_MS;

  let entry = windows.get(identifier);
  if (!entry) {
    entry = { timestamps: [] };
    windows.set(identifier, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  const remaining = MAX_REQUESTS - entry.timestamps.length;

  if (remaining <= 0) {
    // Find when the oldest timestamp will expire
    const oldestTimestamp = entry.timestamps[0];
    const resetIn = oldestTimestamp ? oldestTimestamp + WINDOW_SIZE_MS - now : 0;

    return {
      allowed: false,
      remaining: 0,
      resetIn: Math.max(resetIn, 0),
    };
  }

  return {
    allowed: true,
    remaining: remaining - 1, // Account for current request
    resetIn: 0,
  };
}

export function recordRequest(identifier: string): void {
  const now = Date.now();

  let entry = windows.get(identifier);
  if (!entry) {
    entry = { timestamps: [] };
    windows.set(identifier, entry);
  }

  entry.timestamps.push(now);
}

export function getRateLimitStatus(identifier: string): {
  used: number;
  limit: number;
  remaining: number;
} {
  const now = Date.now();
  const windowStart = now - WINDOW_SIZE_MS;

  const entry = windows.get(identifier);
  if (!entry) {
    return { used: 0, limit: MAX_REQUESTS, remaining: MAX_REQUESTS };
  }

  const validTimestamps = entry.timestamps.filter((t) => t > windowStart);
  const used = validTimestamps.length;

  return {
    used,
    limit: MAX_REQUESTS,
    remaining: Math.max(MAX_REQUESTS - used, 0),
  };
}

// For testing purposes
export function clearRateLimits(): void {
  windows.clear();
}
