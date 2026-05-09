import { encode } from "gpt-tokenizer";
import { extractAllText } from "../utils/token-counter.js";
import { MS_PER_SECOND } from "../core/constants.js";

const SECONDS_PER_MINUTE = 60;
const TTL_MINUTES = 30;
/** TTL for cache entries: 30 minutes in milliseconds */
const TTL_MS = TTL_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

interface CacheEntry {
  tokens: number[];
  updatedAt: number;
}

/**
 * Cache hit estimator based on token-level prefix matching.
 *
 * Maintains a Map of (sessionId, model) → last request token sequence.
 * On each estimateHit() call, the current request body is tokenized and
 * compared against the stored sequence from the previous request for the
 * same (sessionId, model) pair. The count of matching prefix tokens is
 * the estimated cache hit.
 *
 * TTL of 30 minutes per entry; expired entries are cleaned up on every
 * update() / estimateHit() / cleanup() call.
 */
export class CacheEstimator {
  private cache = new Map<string, CacheEntry>();

  /**
   * Tokenize the request body and store in the cache, overwriting any
   * previous entry for the same (sessionId, model) key. Expired entries
   * across the entire cache are cleaned up first.
   */
  update(sessionId: string, model: string, body: Record<string, unknown>): void {
    this.cleanup();
    const key = buildKey(sessionId, model);
    const tokens = tokenize(body);
    this.cache.set(key, { tokens, updatedAt: Date.now() });
  }

  /**
   * Check cache history for the given (sessionId, model), perform prefix
   * matching against the previous request's token sequence, and return
   * the overlap count. Returns null if no prior history exists (first
   * request for this session+model, or entry expired).
   *
   * Internally calls update() afterwards so the cache always reflects
   * the latest request body.
   */
  estimateHit(
    sessionId: string,
    model: string,
    body: Record<string, unknown>,
  ): number | null {
    const key = buildKey(sessionId, model);
    const newTokens = tokenize(body);

    // Remove expired entries before looking up history, so expired
    // entries are treated as "no history".
    this.cleanup();

    const existing = this.cache.get(key);

    // Always refresh the cache with the current request's tokens
    // (equivalent to calling update() after lookup).
    this.cache.set(key, { tokens: newTokens, updatedAt: Date.now() });

    if (!existing) return null;

    return prefixMatch(existing.tokens, newTokens);
  }

  /**
   * Iterate the entire cache and delete entries whose updatedAt
   * is older than TTL_MS (30 minutes).
   */
  cleanup(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [key, entry] of this.cache) {
      if (entry.updatedAt < cutoff) {
        this.cache.delete(key);
      }
    }
  }
}

/** Single shared instance for the application. */
export const cacheEstimator = new CacheEstimator();

// ---- internal helpers ----

function buildKey(sessionId: string, model: string): string {
  return `${sessionId}::${model}`;
}

/** Extract text from request body then encode full token sequence (no sampling). */
function tokenize(body: Record<string, unknown>): number[] {
  const text = extractAllText(body);
  return encode(text);
}

/** Count leading matching tokens between two arrays. */
function prefixMatch(a: number[], b: number[]): number {
  const minLen = Math.min(a.length, b.length);
  let overlap = 0;
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) break;
    overlap++;
  }
  return overlap;
}
