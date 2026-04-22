# PR-2 实现代码 - `src/proxy/resilience.ts`

> 主文档: [plan-pr2-resilience.md](./plan-pr2-resilience.md)

---

## 完整实现

以下代码为 `src/proxy/resilience.ts` 的完整实现，按步骤拆分。

### Step 2.1: 类型定义 + 策略类

```typescript
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { TransportResult } from "./types.js";
import type { Target } from "./strategy/types.js";

// ---------- Strategy Pattern (migrated from retry.ts) ----------

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
```

### Step 2.2-2.4: ResilienceLayer 类

```typescript
export class ResilienceLayer {
  decide(
    result: TransportResult,
    state: ResilienceState,
    config: ResilienceConfig,
  ): ResilienceDecision {
    // Priority 1: stream_abort -> 不可恢复
    if (result.kind === "stream_abort") {
      return { action: "abort", reason: "stream_abort" };
    }

    // Priority 2: success + statusCode < failoverThreshold -> done
    if (
      (result.kind === "success" || result.kind === "stream_success") &&
      result.statusCode < config.failoverThreshold
    ) {
      return { action: "done" };
    }

    // Priority 3: throw -> 网络异常
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

    // Priority 4: statusCode >= failoverThreshold -> retry or failover
    // 隐式假设：success/stream_success 的 statusCode < failoverThreshold 已在 Priority 2 处理
    // 到达此处的 success/stream_success 极少见（如 Provider 返回 200 但 statusCode 被篡改）
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

    // Priority 5: 其他响应（< failoverThreshold 的非成功） -> 仅当 rule 匹配才 retry
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
      const available = targets().filter(
        t => !excludedTargets.some(e =>
          e.backend_model === t.backend_model && e.provider_id === t.provider_id
        ),
      );

      if (available.length === 0) {
        return {
          result: lastResult ?? { kind: "error", statusCode: 502, body: "All targets exhausted", headers: {} },
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
        allAttempts.push({
          target: currentTarget, attemptIndex: globalAttemptIndex,
          statusCode: null, error: errMsg,
          latencyMs: Date.now() - start, responseBody: null,
        });
        transportResult = { kind: "throw", error: err instanceof Error ? err : new Error(errMsg) };
      }

      lastResult = transportResult;

      if (transportResult.kind !== "throw") {
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
          continue;
        case "abort":
          return { result: transportResult, attempts: allAttempts, excludedTargets };
      }
    }
  }
}
```

---

## proxy-logging.ts 适配

将 `src/proxy/proxy-logging.ts` 的 `Attempt` 导入改为 `ResilienceAttempt`：

```typescript
// 改这一行导入
// 旧: import type { Attempt } from "./retry.js";
// 新:
import type { ResilienceAttempt } from "./resilience.js";

// logRetryAttempts 签名中 attempts 参数类型改为 ResilienceAttempt[]
// 内部逻辑不变，因为 ResilienceAttempt 是 Attempt 的超集
```
