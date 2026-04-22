import type { RetryRuleMatcher } from "./retry-rules.js";
import { ProviderSwitchNeeded } from "./types.js";
import type { TransportResult } from "./types.js";
import type { Target } from "./strategy/types.js";

// ---------- Strategy Pattern ----------

export interface RetryStrategy {
  getDelay(attempt: number): number;
}

export class FixedIntervalStrategy implements RetryStrategy {
  constructor(private delayMs: number) {}
  getDelay(): number { return this.delayMs; }
}

const EXPONENTIAL_BASE = 2;

export class ExponentialBackoffStrategy implements RetryStrategy {
  constructor(private baseMs: number, private capMs: number) {}
  getDelay(attempt: number): number {
    return Math.min(this.baseMs * EXPONENTIAL_BASE ** attempt, this.capMs);
  }
}

export function createStrategy(
  rule: { retry_strategy: string; retry_delay_ms: number; max_delay_ms: number }
): RetryStrategy {
  if (rule.retry_strategy === "fixed") return new FixedIntervalStrategy(rule.retry_delay_ms);
  return new ExponentialBackoffStrategy(rule.retry_delay_ms, rule.max_delay_ms);
}

// ---------- Resilience types ----------

export interface ResilienceConfig {
  maxRetries: number;
  baseDelayMs: number;
  failoverThreshold: number;
  ruleMatcher?: RetryRuleMatcher;
  isFailover: boolean;
}

export interface ResilienceAttempt {
  target: Target;
  attemptIndex: number;
  statusCode: number | null;
  error: string | null;
  latencyMs: number;
  responseBody: string | null;
}

export interface ResilienceResult {
  result: TransportResult;
  attempts: ResilienceAttempt[];
  excludedTargets: Target[];
}

export type ResilienceDecision =
  | { action: "done" }
  | { action: "retry"; delayMs: number }
  | { action: "failover"; excludeTarget: Target }
  | { action: "abort"; reason: string };

export interface ResilienceState {
  attemptCount: number;
  currentTarget: Target;
  excludedTargets: Target[];
}

// ---------- Constants ----------

const RETRYABLE_THROW_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"]);
const HTTP_TOO_MANY_REQUESTS = 429;
const MS_PER_SECOND = 1000;

// ---------- Internal helpers ----------

function isRetryableThrow(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return RETRYABLE_THROW_CODES.has((err as NodeJS.ErrnoException).code ?? "");
  }
  return false;
}

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

function extractBody(result: TransportResult): string | null {
  if ("body" in result) return (result as { body: string }).body;
  return null;
}

function extractHeaders(result: TransportResult): Record<string, string> | undefined {
  if ("headers" in result) return (result as { headers: Record<string, string> }).headers;
  return undefined;
}

// ---------- ResilienceLayer ----------

export class ResilienceLayer {
  decide(
    result: TransportResult,
    state: ResilienceState,
    config: ResilienceConfig,
  ): ResilienceDecision {
    // stream_abort -> 不可恢复
    if (result.kind === "stream_abort") {
      return { action: "abort", reason: "stream_abort" };
    }

    // success + statusCode < failoverThreshold -> done
    if (
      (result.kind === "success" || result.kind === "stream_success") &&
      result.statusCode < config.failoverThreshold
    ) {
      return { action: "done" };
    }

    // throw -> 网络异常
    if (result.kind === "throw") {
      if (!isRetryableThrow(result.error)) {
        return { action: "abort", reason: result.error.message };
      }
      if (state.attemptCount < config.maxRetries) {
        return { action: "retry", delayMs: config.baseDelayMs };
      }
      return config.isFailover
        ? { action: "failover", excludeTarget: state.currentTarget }
        : { action: "abort", reason: "throw exhausted retries" };
    }

    // statusCode >= failoverThreshold -> retry or failover
    if (result.statusCode >= config.failoverThreshold) {
      const body = extractBody(result);
      const matchedRule = body && config.ruleMatcher
        ? config.ruleMatcher.match(result.statusCode, body)
        : null;

      const effectiveMaxRetries = Math.min(matchedRule?.max_retries ?? 0, config.maxRetries);
      if (matchedRule && state.attemptCount < effectiveMaxRetries) {
        const strategy = createStrategy(matchedRule);
        const headers = extractHeaders(result);
        const retryAfterMs = result.statusCode === HTTP_TOO_MANY_REQUESTS
          ? parseRetryAfter(headers) : null;
        const delay = Math.max(strategy.getDelay(state.attemptCount), retryAfterMs ?? 0);
        return { action: "retry", delayMs: delay };
      }
      return config.isFailover
        ? { action: "failover", excludeTarget: state.currentTarget }
        : { action: "done" };
    }

    // 其他响应（< failoverThreshold 的非成功） -> 仅当 rule 匹配才 retry
    const body = extractBody(result);
    if (body && config.ruleMatcher) {
      const matchedRule = config.ruleMatcher.match(result.statusCode, body);
      const effectiveMaxRetries = Math.min(matchedRule?.max_retries ?? 0, config.maxRetries);
      if (matchedRule && state.attemptCount < effectiveMaxRetries) {
        const strategy = createStrategy(matchedRule);
        return { action: "retry", delayMs: strategy.getDelay(state.attemptCount) };
      }
    }

    return { action: "done" };
  }

  async execute(
    targets: () => Target[],
    fn: (target: Target) => Promise<TransportResult>,
    config: ResilienceConfig,
  ): Promise<ResilienceResult> {
    const allAttempts: ResilienceAttempt[] = [];
    const excludedTargets: Target[] = [];
    const perTargetCounts = new Map<string, number>();
    let globalAttemptIndex = 0;
    let lastResult: TransportResult | undefined;

    const targetKey = (t: Target) => `${t.provider_id}:${t.backend_model}`;
    const getTargetCount = (t: Target) => perTargetCounts.get(targetKey(t)) ?? 0;
    const incrementTarget = (t: Target) => {
      perTargetCounts.set(targetKey(t), (perTargetCounts.get(targetKey(t)) ?? 0) + 1);
    };

    while (true) {
      const available = targets().filter(
        t => !excludedTargets.some(e =>
          e.backend_model === t.backend_model && e.provider_id === t.provider_id
        ),
      );

      if (available.length === 0) {
        return {
          result: lastResult ?? { kind: "error" as const, statusCode: 502, body: "All targets exhausted", headers: {}, sentHeaders: {}, sentBody: "" },
          attempts: allAttempts,
          excludedTargets,
        };
      }

      const currentTarget = available[0];
      incrementTarget(currentTarget);
      const start = Date.now();

      let transportResult: TransportResult;
      try {
        transportResult = await fn(currentTarget);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        transportResult = { kind: "throw", error: err instanceof Error ? err : new Error(errMsg) };
      }

      lastResult = transportResult;

      if (transportResult.kind === "throw") {
        const throwErr = transportResult.error;
        allAttempts.push({
          target: currentTarget, attemptIndex: globalAttemptIndex,
          statusCode: null, error: throwErr instanceof Error ? throwErr.message : String(throwErr),
          latencyMs: Date.now() - start, responseBody: null,
        });
      } else {
        allAttempts.push({
          target: currentTarget, attemptIndex: globalAttemptIndex,
          statusCode: transportResult.statusCode, error: null,
          latencyMs: Date.now() - start, responseBody: extractBody(transportResult),
        });
      }

      const state: ResilienceState = {
        attemptCount: getTargetCount(currentTarget) - 1,
        currentTarget,
        excludedTargets,
      };
      const decision = this.decide(transportResult, state, config);

      switch (decision.action) {
        case "done":
          return { result: transportResult, attempts: allAttempts, excludedTargets };
        case "retry":
          globalAttemptIndex++;
          await sleep(decision.delayMs);
          continue;
        case "failover":
          excludedTargets.push(decision.excludeTarget);
          globalAttemptIndex++;
          // 跨 provider failover 需要切换信号量，抛出异常让上层处理
          const nextAvail = targets().filter(
            t => !excludedTargets.some(e =>
              e.backend_model === t.backend_model && e.provider_id === t.provider_id
            ),
          );
          if (nextAvail.length > 0 && nextAvail[0].provider_id !== currentTarget.provider_id) {
            throw new ProviderSwitchNeeded(nextAvail[0].provider_id);
          }
          continue;
        case "abort":
          return { result: transportResult, attempts: allAttempts, excludedTargets };
      }
    }
  }
}
