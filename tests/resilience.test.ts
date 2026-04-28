import { describe, it, expect, vi } from "vitest";
import type { Target } from "../src/proxy/strategy/types.js";
import type { TransportResult } from "../src/proxy/types.js";
import type { ResilienceConfig } from "../src/proxy/resilience.js";
import { ResilienceLayer, FixedIntervalStrategy, ExponentialBackoffStrategy, createStrategy } from "../src/proxy/resilience.js";
import { RetryRuleMatcher } from "../src/proxy/retry-rules.js";
import type { RetryRule } from "../src/db/retry-rules.js";

// ---------- Targets ----------

function makeTarget(overrides: Partial<Target> = {}): Target {
  return { backend_model: "gpt-4", provider_id: "p1", ...overrides };
}
const t1 = makeTarget({ backend_model: "gpt-4", provider_id: "p1" });
const t2 = makeTarget({ backend_model: "claude-3", provider_id: "p2" });

// ---------- TransportResult factories ----------

function makeSuccess(statusCode = 200, body = "ok"): TransportResult {
  return { kind: "success", statusCode, body, headers: {}, sentHeaders: {}, sentBody: "" };
}
function makeStreamSuccess(statusCode = 200): TransportResult {
  return { kind: "stream_success", statusCode, sentHeaders: {} };
}
function makeStreamAbort(statusCode = 200): TransportResult {
  return { kind: "stream_abort", statusCode, sentHeaders: {} };
}
function makeStreamError(statusCode = 429, body = "rate limited"): TransportResult {
  return { kind: "stream_error", statusCode, body, headers: {}, sentHeaders: {} };
}
function makeError(statusCode: number, body = "error"): TransportResult {
  return { kind: "error", statusCode, body, headers: {}, sentHeaders: {}, sentBody: "" };
}

// ---------- Config factories ----------

function defaultConfig(overrides: Partial<ResilienceConfig> = {}): ResilienceConfig {
  return { baseDelayMs: 1, failoverThreshold: 400, isFailover: false, ...overrides };
}
function failoverConfig(overrides: Partial<ResilienceConfig> = {}): ResilienceConfig {
  return defaultConfig({ isFailover: true, ...overrides });
}

// ---------- Matcher factory ----------

function createMatcherWithDefaults(): RetryRuleMatcher {
  const matcher = new RetryRuleMatcher();
  function makeRule(code: number): { rule: RetryRule; pattern: RegExp } {
    return {
      rule: {
        id: `rule-${code}`, name: `rule-${code}`, status_code: code, body_pattern: ".*",
        is_active: 1, created_at: "", retry_strategy: "fixed", retry_delay_ms: 1,
        max_retries: 2, max_delay_ms: 100,
      },
      pattern: /^.*$/,
    };
  }
  matcher["cache"] = new Map([[429, [makeRule(429)]], [503, [makeRule(503)]]]);
  return matcher;
}

// ============================================================
// decide() 单元测试 (14 cases)
// ============================================================

describe("ResilienceLayer.decide()", () => {
  it("stream_abort -> abort", () => {
    const layer = new ResilienceLayer();
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(makeStreamAbort(), state, defaultConfig());
    expect(decision.action).toBe("abort");
  });

  it("success + statusCode < 400 -> done", () => {
    const layer = new ResilienceLayer();
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(makeSuccess(200), state, defaultConfig());
    expect(decision.action).toBe("done");
  });

  it("stream_success + statusCode < 400 -> done", () => {
    const layer = new ResilienceLayer();
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(makeStreamSuccess(200), state, defaultConfig());
    expect(decision.action).toBe("done");
  });

  it("throw + retryable error + retries left -> retry", () => {
    const layer = new ResilienceLayer();
    const err = new Error("timeout") as NodeJS.ErrnoException;
    err.code = "ETIMEDOUT";
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide({ kind: "throw", error: err }, state, defaultConfig());
    expect(decision.action).toBe("retry");
    if (decision.action === "retry") expect(decision.delayMs).toBe(1);
  });

  it("throw + retryable error + retries exhausted + non-failover -> abort", () => {
    const layer = new ResilienceLayer();
    const err = new Error("timeout") as NodeJS.ErrnoException;
    err.code = "ETIMEDOUT";
    const state = { attemptCount: 3, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide({ kind: "throw", error: err }, state, defaultConfig({ isFailover: false }));
    expect(decision.action).toBe("abort");
  });

  it("throw + retryable error + retries exhausted + failover -> failover", () => {
    const layer = new ResilienceLayer();
    const err = new Error("timeout") as NodeJS.ErrnoException;
    err.code = "ETIMEDOUT";
    const state = { attemptCount: 3, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide({ kind: "throw", error: err }, state, failoverConfig());
    expect(decision.action).toBe("failover");
    if (decision.action === "failover") expect(decision.excludeTarget).toEqual(t1);
  });

  it("throw + non-retryable error -> abort", () => {
    const layer = new ResilienceLayer();
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide({ kind: "throw", error: new Error("fatal") }, state, defaultConfig());
    expect(decision.action).toBe("abort");
  });

  it("error + statusCode >= threshold + rule matches + retries left -> retry", () => {
    const layer = new ResilienceLayer();
    const matcher = createMatcherWithDefaults();
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(makeError(429, "rate limited"), state, defaultConfig({ ruleMatcher: matcher }));
    expect(decision.action).toBe("retry");
  });

  it("error + statusCode >= threshold + rule matches + exhausted + failover -> failover", () => {
    const layer = new ResilienceLayer();
    const matcher = createMatcherWithDefaults();
    const state = { attemptCount: 2, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(makeError(429, "rate limited"), state, failoverConfig({ ruleMatcher: matcher }));
    expect(decision.action).toBe("failover");
  });

  it("error + statusCode >= threshold + no rule match + failover -> failover", () => {
    const layer = new ResilienceLayer();
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(makeError(500, "internal error"), state, failoverConfig());
    expect(decision.action).toBe("failover");
  });

  it("error + statusCode >= threshold + no rule match + non-failover -> done", () => {
    const layer = new ResilienceLayer();
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(makeError(500, "internal error"), state, defaultConfig());
    expect(decision.action).toBe("done");
  });

  it("stream_error + statusCode >= threshold + rule matches -> retry", () => {
    const layer = new ResilienceLayer();
    const matcher = createMatcherWithDefaults();
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(makeStreamError(429, "rate limited"), state, defaultConfig({ ruleMatcher: matcher }));
    expect(decision.action).toBe("retry");
  });

  it("stream_error + statusCode < threshold + rule matches -> retry", () => {
    const layer = new ResilienceLayer();
    const matcher = new RetryRuleMatcher();
    matcher["cache"] = new Map([
      [200, [{ rule: { id: "r1", name: "SSE error 1234", status_code: 200, body_pattern: '"code"\\s*:\\s*"1234"',
        is_active: 1, created_at: "", retry_strategy: "fixed", retry_delay_ms: 1,
        max_retries: 2, max_delay_ms: 100 }, pattern: /"code"\s*:\s*"1234"/ }]],
    ]);
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(
      makeStreamError(200, '{"error":{"code":"1234","message":"网络错误"}}'),
      state,
      defaultConfig({ ruleMatcher: matcher }),
    );
    expect(decision.action).toBe("retry");
  });

  it("stream_error + statusCode < threshold + rule matches + isFailover -> retry (not failover)", () => {
    const layer = new ResilienceLayer();
    const matcher = new RetryRuleMatcher();
    matcher["cache"] = new Map([
      [200, [{ rule: { id: "r1", name: "SSE error 1234", status_code: 200, body_pattern: '"code"\\s*:\\s*"1234"',
        is_active: 1, created_at: "", retry_strategy: "fixed", retry_delay_ms: 1,
        max_retries: 2, max_delay_ms: 100 }, pattern: /"code"\s*:\s*"1234"/ }]],
    ]);
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(
      makeStreamError(200, '{"error":{"code":"1234","message":"网络错误"}}'),
      state,
      failoverConfig({ ruleMatcher: matcher }),
    );
    expect(decision.action).toBe("retry");
  });

  it("stream_error + statusCode < threshold + rule matches + exhausted + failover -> failover", () => {
    const layer = new ResilienceLayer();
    const matcher = new RetryRuleMatcher();
    matcher["cache"] = new Map([
      [200, [{ rule: { id: "r1", name: "SSE error 1234", status_code: 200, body_pattern: '"code"\\s*:\\s*"1234"',
        is_active: 1, created_at: "", retry_strategy: "fixed", retry_delay_ms: 1,
        max_retries: 2, max_delay_ms: 100 }, pattern: /"code"\s*:\s*"1234"/ }]],
    ]);
    const state = { attemptCount: 2, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(
      makeStreamError(200, '{"error":{"code":"1234","message":"网络错误"}}'),
      state,
      failoverConfig({ ruleMatcher: matcher }),
    );
    expect(decision.action).toBe("failover");
  });

  it("stream_error + statusCode < threshold + no rule match + failover -> failover", () => {
    const layer = new ResilienceLayer();
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(
      makeStreamError(200, '{"error":{"code":"unknown"}}'),
      state,
      failoverConfig(),
    );
    expect(decision.action).toBe("failover");
  });

  it("stream_error + statusCode < threshold + no rule match + non-failover -> abort", () => {
    const layer = new ResilienceLayer();
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(
      makeStreamError(200, '{"error":{"code":"unknown"}}'),
      state,
      defaultConfig(),
    );
    expect(decision.action).toBe("abort");
  });

  it("other 4xx + rule matches -> retry", () => {
    const layer = new ResilienceLayer();
    const matcher = new RetryRuleMatcher();
    matcher["cache"] = new Map([
      [400, [{ rule: { id: "r1", name: "test", status_code: 400, body_pattern: "请稍后",
        is_active: 1, created_at: "", retry_strategy: "fixed", retry_delay_ms: 1,
        max_retries: 2, max_delay_ms: 100 }, pattern: /请稍后/ }]],
    ]);
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(makeError(400, "网络错误请稍后重试"), state, defaultConfig({ ruleMatcher: matcher }));
    expect(decision.action).toBe("retry");
  });

  it("other 4xx + no rule match -> done", () => {
    const layer = new ResilienceLayer();
    const state = { attemptCount: 0, currentTarget: t1, excludedTargets: [] };
    const decision = layer.decide(makeError(401, "unauthorized"), state, defaultConfig());
    expect(decision.action).toBe("done");
  });
});

// ============================================================
// execute() 集成测试 (12 cases)
// ============================================================

describe("ResilienceLayer.execute()", () => {
  it("单次成功：第一次调用即返回 200", async () => {
    const layer = new ResilienceLayer();
    const fn = vi.fn().mockResolvedValue(makeSuccess(200));
    const targets = () => [t1];
    const result = await layer.execute(targets, fn, defaultConfig());
    expect(result.result).toEqual(makeSuccess(200));
    expect(result.attempts).toHaveLength(1);
    expect(fn).toHaveBeenCalledWith(t1);
  });

  it("重试成功：第一次 429 第二次 200", async () => {
    const layer = new ResilienceLayer();
    const matcher = createMatcherWithDefaults();
    const fn = vi.fn()
      .mockResolvedValueOnce(makeError(429, "rate limited"))
      .mockResolvedValueOnce(makeSuccess(200));
    const targets = () => [t1];
    const result = await layer.execute(targets, fn, defaultConfig({ ruleMatcher: matcher }));
    expect(result.result.kind).toBe("success");
    expect(result.attempts).toHaveLength(2);
  });

  it("重试耗尽 + 非 failover：返回最后一次结果", async () => {
    const layer = new ResilienceLayer();
    const matcher = createMatcherWithDefaults();
    const fn = vi.fn().mockResolvedValue(makeError(429, "rate limited"));
    const targets = () => [t1];
    const result = await layer.execute(targets, fn, defaultConfig({ ruleMatcher: matcher }));
    expect((result.result as { statusCode: number }).statusCode).toBe(429);
    expect(result.attempts).toHaveLength(3);
  });

  it("网络异常重试成功", async () => {
    const layer = new ResilienceLayer();
    const err = new Error("timeout") as NodeJS.ErrnoException;
    err.code = "ETIMEDOUT";
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(makeSuccess(200));
    const targets = () => [t1];
    const result = await layer.execute(targets, fn, defaultConfig());
    expect(result.result.kind).toBe("success");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].statusCode).toBeNull();
    expect(result.attempts[0].error).toBe("timeout");
  });

  it("failover：第一个 target 失败，切换到第二个", async () => {
    const layer = new ResilienceLayer();
    const t1a = makeTarget({ backend_model: "gpt-4", provider_id: "p1" });
    const t1b = makeTarget({ backend_model: "gpt-3.5", provider_id: "p1" });
    const fn = vi.fn()
      .mockResolvedValueOnce(makeError(500, "internal error"))
      .mockResolvedValueOnce(makeSuccess(200));
    const targets = () => [t1a, t1b];
    const result = await layer.execute(targets, fn, failoverConfig());
    expect(result.result.kind).toBe("success");
    expect(result.attempts[0].target).toEqual(t1a);
    expect(result.attempts[1].target).toEqual(t1b);
    expect(result.excludedTargets).toEqual([t1a]);
  });

  it("failover：所有 target 耗尽，返回最后一次失败", async () => {
    const layer = new ResilienceLayer();
    const t1a = makeTarget({ backend_model: "gpt-4", provider_id: "p1" });
    const t1b = makeTarget({ backend_model: "gpt-3.5", provider_id: "p1" });
    const fn = vi.fn()
      .mockResolvedValueOnce(makeError(500, "err1"))
      .mockResolvedValueOnce(makeError(503, "err2"));
    const targets = () => [t1a, t1b];
    const result = await layer.execute(targets, fn, failoverConfig());
    expect((result.result as { statusCode: number }).statusCode).toBe(503);
    expect(result.excludedTargets).toEqual([t1a, t1b]);
  });

  it("failover + retry：t1 先重试 2 次再 failover 到 t1b", async () => {
    const layer = new ResilienceLayer();
    const matcher = createMatcherWithDefaults();
    const t1a = makeTarget({ backend_model: "gpt-4", provider_id: "p1" });
    const t1b = makeTarget({ backend_model: "gpt-3.5", provider_id: "p1" });
    const fn = vi.fn()
      .mockResolvedValueOnce(makeError(429, "rate limited"))
      .mockResolvedValueOnce(makeError(429, "rate limited"))
      .mockResolvedValueOnce(makeError(429, "rate limited"))
      .mockResolvedValueOnce(makeSuccess(200));
    const targets = () => [t1a, t1b];
    const result = await layer.execute(targets, fn, failoverConfig({ ruleMatcher: matcher }));
    expect(result.result.kind).toBe("success");
    expect(result.attempts).toHaveLength(4);
    expect(result.attempts.slice(0, 3).every(a => a.target === t1a)).toBe(true);
    expect(result.attempts[3].target).toEqual(t1b);
  });

  it("stream_abort 立即中止，不重试", async () => {
    const layer = new ResilienceLayer();
    const fn = vi.fn().mockResolvedValue(makeStreamAbort());
    const targets = () => [t1];
    const result = await layer.execute(targets, fn, defaultConfig());
    expect(result.result.kind).toBe("stream_abort");
    expect(result.attempts).toHaveLength(1);
  });

  it("targets 懒加载：每次 failover 后重新获取", async () => {
    const layer = new ResilienceLayer();
    const t1a = makeTarget({ backend_model: "gpt-4", provider_id: "p1" });
    const t1b = makeTarget({ backend_model: "gpt-3.5", provider_id: "p1" });
    const fn = vi.fn()
      .mockResolvedValueOnce(makeError(500, "err"))
      .mockResolvedValueOnce(makeSuccess(200));
    let callCount = 0;
    const targets = () => { callCount++; return callCount === 1 ? [t1a, t1b] : [t1b]; };
    const result = await layer.execute(targets, fn, failoverConfig());
    expect(result.result.kind).toBe("success");
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("rule max_retries=0 不重试", async () => {
    const layer = new ResilienceLayer();
    const matcher = new RetryRuleMatcher();
    matcher["cache"] = new Map([
      [429, [{ rule: {
        id: "r0", name: "no retry", status_code: 429, body_pattern: ".*",
        is_active: 1, created_at: "", retry_strategy: "fixed", retry_delay_ms: 1,
        max_retries: 0, max_delay_ms: 100,
      }, pattern: /^.*$/ }]],
    ]);
    const fn = vi.fn().mockResolvedValue(makeError(429, "rate limited"));
    const targets = () => [t1];
    const result = await layer.execute(targets, fn, defaultConfig({ ruleMatcher: matcher }));
    expect((result.result as { statusCode: number }).statusCode).toBe(429);
    expect(result.attempts).toHaveLength(1);
  });

  it("非 failover 模式不切换 target", async () => {
    const layer = new ResilienceLayer();
    const fn = vi.fn().mockResolvedValue(makeError(500, "internal error"));
    const targets = () => [t1, t2];
    const result = await layer.execute(targets, fn, defaultConfig());
    expect((result.result as { statusCode: number }).statusCode).toBe(500);
    expect(result.attempts).toHaveLength(1);
    expect(result.excludedTargets).toHaveLength(0);
  });

  it("401 unauthorized 不重试不 failover", async () => {
    const layer = new ResilienceLayer();
    const fn = vi.fn().mockResolvedValue(makeError(401, "unauthorized"));
    const targets = () => [t1];
    const result = await layer.execute(targets, fn, failoverConfig());
    expect((result.result as { statusCode: number }).statusCode).toBe(401);
    expect(result.attempts).toHaveLength(1);
  });

  it("cross-provider failover throws ProviderSwitchNeeded", async () => {
    const layer = new ResilienceLayer();
    const fn = vi.fn()
      .mockResolvedValueOnce(makeError(500, "err"))
      .mockResolvedValueOnce(makeSuccess(200));
    const targets = () => [t1, t2];
    await expect(
      layer.execute(targets, fn, failoverConfig()),
    ).rejects.toThrow("Provider switch needed: p2");
  });
});

// ============================================================
// RetryStrategy 测试 (3 cases)
// ============================================================

describe("RetryStrategy", () => {
  it("FixedIntervalStrategy returns constant delay", () => {
    const s = new FixedIntervalStrategy(5000);
    expect(s.getDelay(0)).toBe(5000);
    expect(s.getDelay(5)).toBe(5000);
  });

  it("ExponentialBackoffStrategy doubles and caps", () => {
    const s = new ExponentialBackoffStrategy(5000, 60000);
    expect(s.getDelay(0)).toBe(5000);
    expect(s.getDelay(1)).toBe(10000);
    expect(s.getDelay(4)).toBe(60000);
  });

  it("createStrategy returns correct type", () => {
    expect(createStrategy({ retry_strategy: "fixed", retry_delay_ms: 3000, max_delay_ms: 60000 }))
      .toBeInstanceOf(FixedIntervalStrategy);
    expect(createStrategy({ retry_strategy: "exponential", retry_delay_ms: 3000, max_delay_ms: 60000 }))
      .toBeInstanceOf(ExponentialBackoffStrategy);
  });
});
