import type { ProxyResult, StreamProxyResult } from "./proxy-core.js";
import type { FastifyReply } from "fastify";

// ---------- Types ----------

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  retryableStatuses: Set<number>;   // 429, 503. 502 only via throw (ETIMEDOUT etc.)
  isRetryableBody?: (body: string) => boolean;
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

// ---------- Constants ----------

const RETRYABLE_THROW_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"]);
const HTTP_BAD_REQUEST = 400;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVICE_UNAVAILABLE = 503;
const BACKOFF_BASE = 2;
const MS_PER_SECOND = 1000;

// ---------- Shared helpers ----------

/** Detect ZAI middleware 400 temp network errors (provider-specific) */
export function isRetryable400Body(body: string): boolean {
  try {
    const parsed = JSON.parse(body);
    const err = parsed?.error ?? (parsed?.type === "error" ? parsed.error : null);
    if (!err) return false;
    return err.code === "1234" || (err.message?.includes("请稍后重试") ?? false);
  } catch { return false; }
}

export function buildRetryConfig(maxRetries: number, baseDelayMs: number): RetryConfig {
  return {
    maxRetries,
    baseDelayMs,
    retryableStatuses: new Set([HTTP_TOO_MANY_REQUESTS, HTTP_SERVICE_UNAVAILABLE]),
    isRetryableBody: isRetryable400Body,
  };
}

// ---------- Predicates ----------

export function isRetryableResult(statusCode: number, body?: string, config?: RetryConfig): boolean {
  if (config?.retryableStatuses.has(statusCode)) return true;
  if (statusCode === HTTP_BAD_REQUEST && body && config?.isRetryableBody?.(body)) return true;
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

function getBackoffMs(baseDelayMs: number, attempt: number): number {
  // 指数退避：baseDelay * 2^attempt
  return baseDelayMs * BACKOFF_BASE ** attempt;
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

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
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

      if (result.statusCode < HTTP_BAD_REQUEST || !isRetryableResult(result.statusCode, body ?? undefined, config)) {
        return { result, attempts };
      }

      if (attempt === config.maxRetries) {
        return { result, attempts };
      }

      if (reply && (reply.raw.writableFinished || reply.raw.headersSent)) {
        return { result, attempts };
      }

      const headers = extractHeaders(result);
      const retryAfterMs = result.statusCode === HTTP_TOO_MANY_REQUESTS ? parseRetryAfter(headers) : null;
      const delay = retryAfterMs ?? getBackoffMs(config.baseDelayMs, attempt);
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
      if (attempt === config.maxRetries) throw err;
      if (reply && (reply.raw.writableFinished || reply.raw.headersSent)) throw err;

      await sleep(config.baseDelayMs);
    }
  }

  throw new Error("retryableCall: unreachable");
}
