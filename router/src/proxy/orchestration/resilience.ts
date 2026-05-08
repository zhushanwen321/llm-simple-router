import { MS_PER_SECOND } from "../../core/constants.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import { ProviderSwitchNeeded } from "../types.js";
import type { TransportResult } from "../types.js";
import type { Target, ResilienceAttempt } from "../../core/types.js";

// ---------- Strategy Pattern ----------

export interface RetryStrategy {
  getDelay(attempt: number): number;
}

export class FixedIntervalStrategy implements RetryStrategy {
  constructor(private delayMs: number) {}
  getDelay(_attempt: number): number { return this.delayMs; }
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
  baseDelayMs: number;
  failoverThreshold: number;
  ruleMatcher?: RetryRuleMatcher;
  isFailover: boolean;
  /** 全局迭代上限，防止极端配置导致 while(true) 循环过多 */
  iterationCap?: number;
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
const DEFAULT_THROW_MAX_RETRIES = 3;
const DEFAULT_ITERATION_CAP = 50;

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

    // stream_error + statusCode < failoverThreshold -> 上游返回 200 但 body 包含错误内容（early error）
    // 先检查 retry rules 是否匹配，匹配则重试，否则不可恢复
    if (result.kind === "stream_error" && result.statusCode < config.failoverThreshold) {
      // headers 已发送给客户端时不能 retry/failover，只能 abort
      if (result.headersSent) {
        return { action: "abort", reason: "stream_error_headers_sent" };
      }
      const body = extractBody(result);
      if (body && config.ruleMatcher) {
        const matchedRule = config.ruleMatcher.match(result.statusCode, body);
        if (matchedRule && state.attemptCount < matchedRule.max_retries) {
          const strategy = createStrategy(matchedRule);
          return { action: "retry", delayMs: strategy.getDelay(state.attemptCount) };
        }
      }
      // failover 模式下，即使 stream_error 也可以尝试切换 provider
      if (config.isFailover) {
        return { action: "failover", excludeTarget: state.currentTarget };
      }
      return { action: "abort", reason: "stream_error" };
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
      // headers 已发送给客户端时不能 retry/failover
      if (result.headersSent) {
        return { action: "abort", reason: "throw_headers_sent" };
      }
      if (!isRetryableThrow(result.error)) {
        return { action: "abort", reason: result.error.message };
      }
      if (state.attemptCount < DEFAULT_THROW_MAX_RETRIES) {
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

      if (matchedRule && state.attemptCount < matchedRule.max_retries) {
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
      if (matchedRule && state.attemptCount < matchedRule.max_retries) {
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
      if (globalAttemptIndex >= (config.iterationCap ?? DEFAULT_ITERATION_CAP)) {
        return {
          result: lastResult ?? { kind: "error" as const, statusCode: 502, body: "Iteration cap exceeded", headers: {}, sentHeaders: {}, sentBody: "" },
          attempts: allAttempts,
          excludedTargets,
        };
      }

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
          responseHeaders: null, resultKind: transportResult.kind,
        });
      } else {
        allAttempts.push({
          target: currentTarget, attemptIndex: globalAttemptIndex,
          statusCode: transportResult.statusCode, error: null,
          latencyMs: Date.now() - start, responseBody: extractBody(transportResult),
          responseHeaders: extractHeaders(transportResult) ?? null,
          resultKind: transportResult.kind,
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
            throw new ProviderSwitchNeeded(nextAvail[0].provider_id, [...allAttempts], transportResult);
          }
          continue;
        case "abort":
          return { result: transportResult, attempts: allAttempts, excludedTargets };
      }
    }
  }
}
