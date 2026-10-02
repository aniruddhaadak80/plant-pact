/**
 * Abuse control for anonymous writes.
 *
 * HONESTY NOTE, repeated in the README: a per-instance counter is the weakest
 * possible limiter. On Vercel each instance has its own memory, so a determined
 * caller can multiply their budget by spreading requests across cold starts.
 * This protects against casual abuse and runaway scripts; it is NOT a
 * substitute for a shared limiter. To harden, point the same interface at a
 * hosted rate limiter (Upstash Redis, Vercel KV) and everything else is
 * unchanged.
 *
 * Read paths are not limited: an unbounded read is a performance concern, not
 * an abuse vector, and this application exposes no expensive reads.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;

const globalStore = globalThis as typeof globalThis & {
  __plantPactRate?: Map<string, Bucket>;
};

function store(): Map<string, Bucket> {
  if (!globalStore.__plantPactRate) globalStore.__plantPactRate = new Map();
  return globalStore.__plantPactRate;
}

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRate(key: string, limit: number): RateVerdict {
  const now = Date.now();
  const map = store();
  const existing = map.get(key);

  if (!existing || existing.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 60 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 60 };
}

/** Cheap opportunistic cleanup so the map cannot grow without bound. */
export function pruneRateStore(): void {
  const now = Date.now();
  const map = store();
  for (const [key, bucket] of map) {
    if (bucket.resetAt <= now) map.delete(key);
  }
  if (map.size > 5000) map.clear();
}