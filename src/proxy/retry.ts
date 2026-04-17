import type { ProxyResult, StreamProxyResult } from "./proxy-core.js";
import type { FastifyReply } from "fastify";

// ---------- Types ----------

import type { RetryRuleMatcher } from "./retry-rules.js";

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  ruleMatcher?: RetryRuleMatcher;
}

export interface Attempt {
  attemptIndex: number;
  statusCode: number | null;
  error: string | null;
  latencyMs: number;
  responseBody: string | null;
}

export interface RetryResult<T> {
  result: T;
  attempts: Attempt[];
}

export type ProxyFn<T = ProxyResult | StreamProxyResult> = () => Promise<T>;

// ---------- Strategy Pattern ----------

export interface RetryStrategy {
  getDelay(attempt: number): number;
}

export class FixedIntervalStrategy implements RetryStrategy {
  constructor(private delayMs: number) {}
  getDelay(_attempt: number): number { return this.delayMs; }
}

export class ExponentialBackoffStrategy implements RetryStrategy {
  constructor(private baseMs: number, private capMs: number) {}
  getDelay(attempt: number): number {
    return Math.min(this.baseMs * 2 ** attempt, this.capMs);
  }
}

export function createStrategy(rule: { retry_strategy: string; retry_delay_ms: number; max_delay_ms: number }): RetryStrategy {
  if (rule.retry_strategy === "fixed") return new FixedIntervalStrategy(rule.retry_delay_ms);
  return new ExponentialBackoffStrategy(rule.retry_delay_ms, rule.max_delay_ms);
}

// ---------- Constants ----------

const RETRYABLE_THROW_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"]);
const HTTP_BAD_REQUEST = 400;
const HTTP_TOO_MANY_REQUESTS = 429;
const MS_PER_SECOND = 1000;

// ---------- Shared helpers ----------

export function buildRetryConfig(maxRetries: number, baseDelayMs: number, ruleMatcher?: RetryRuleMatcher): RetryConfig {
  return {
    maxRetries,
    baseDelayMs,
    ruleMatcher,
  };
}

// ---------- Predicates ----------

export function isRetryableResult(statusCode: number, body?: string, config?: RetryConfig): boolean {
  if (body && config?.ruleMatcher?.test(statusCode, body)) return true;
  return false;
}

export function isRetryableThrow(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return RETRYABLE_THROW_CODES.has((err as NodeJS.ErrnoException).code ?? "");
  }
  return false;
}

// ---------- Internal helpers ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(headers: Record<string, string> | undefined): number | null {
  if (!headers) return null;
  const val = headers["retry-after"] ?? headers["Retry-After"];
  if (!val) return null;
  const seconds = parseInt(val, 10);
  return isNaN(seconds) ? null : seconds * MS_PER_SECOND;
}

function extractHeaders(result: ProxyResult | StreamProxyResult): Record<string, string> {
  return "headers" in result ? (result as ProxyResult).headers : (result as StreamProxyResult).upstreamResponseHeaders ?? {};
}

function extractBody(result: ProxyResult | StreamProxyResult): string | null {
  return "body" in result ? (result as ProxyResult).body : (result as StreamProxyResult).responseBody ?? null;
}

// ---------- Core ----------

export async function retryableCall<T extends ProxyResult | StreamProxyResult>(
  fn: ProxyFn<T>,
  config: RetryConfig,
  reply?: FastifyReply,
): Promise<RetryResult<T>> {
  const attempts: Attempt[] = [];

  for (let attempt = 0; ; attempt++) {
    const start = Date.now();

    try {
      const result = await fn();
      const elapsed = Date.now() - start;
      const body = extractBody(result);

      attempts.push({
        attemptIndex: attempt,
        statusCode: result.statusCode,
        error: null,
        latencyMs: elapsed,
        responseBody: body,
      });

      if (result.statusCode < HTTP_BAD_REQUEST) return { result, attempts };

      // 通过 matcher 获取匹配规则（含策略参数）
      const matchedRule = body ? config.ruleMatcher?.match(result.statusCode, body) ?? null : null;
      if (!matchedRule) return { result, attempts };

      const maxAttempts = matchedRule.max_retries;
      if (attempt >= maxAttempts) return { result, attempts };
      if (reply && (reply.raw.writableFinished || reply.raw.headersSent)) return { result, attempts };

      const strategy = createStrategy(matchedRule);
      const headers = extractHeaders(result);
      const retryAfterMs = result.statusCode === HTTP_TOO_MANY_REQUESTS ? parseRetryAfter(headers) : null;
      const delay = Math.max(strategy.getDelay(attempt), retryAfterMs ?? 0);
      await sleep(delay);
    } catch (err: unknown) {
      const elapsed = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : String(err);

      attempts.push({
        attemptIndex: attempt,
        statusCode: null,
        error: errMsg,
        latencyMs: elapsed,
        responseBody: null,
      });

      if (!isRetryableThrow(err)) throw err;
      if (attempt >= config.maxRetries) throw err;
      if (reply && (reply.raw.writableFinished || reply.raw.headersSent)) throw err;

      await sleep(config.baseDelayMs);
    }
  }
}
