import { describe, it, expect } from "vitest";
import { isRetryableResult, isRetryableThrow, retryableCall, FixedIntervalStrategy, ExponentialBackoffStrategy, createStrategy } from "../src/proxy/retry.js";
import type { RetryConfig } from "../src/proxy/retry.js";
import { RetryRuleMatcher } from "../src/proxy/retry-rules.js";
import type { RetryRule } from "../src/db/retry-rules.js";
import type { ProxyResult } from "../src/proxy/proxy-core.js";

function makeDefaultRule(overrides: Partial<RetryRule> = {}): RetryRule {
  return {
    id: "0", name: "default", status_code: 0, body_pattern: ".*", is_active: 1, created_at: "",
    retry_strategy: "exponential", retry_delay_ms: 10, max_retries: 2, max_delay_ms: 60000,
    ...overrides,
  };
}

// 模拟 DB 规则加载后的 matcher（429/503 通配 + 400 特定模式）
function createMatcherWithDefaults(): RetryRuleMatcher {
  const matcher = new RetryRuleMatcher();
  matcher["cache"] = new Map([
    [429, [{ rule: makeDefaultRule({ status_code: 429 }), pattern: /^.*$/ }]],
    [503, [{ rule: makeDefaultRule({ status_code: 503 }), pattern: /^.*$/ }]],
  ]);
  return matcher;
}

const DEFAULT_MATCHER = createMatcherWithDefaults();
const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 10,
  ruleMatcher: DEFAULT_MATCHER,
};

function mockResult(statusCode: number, body = ""): ProxyResult {
  return { statusCode, body, headers: {}, sentHeaders: {}, sentBody: "" };
}

describe("isRetryableResult", () => {
  it("returns true for 429", () => expect(isRetryableResult(429, "any", DEFAULT_CONFIG)).toBe(true));
  it("returns true for 503", () => expect(isRetryableResult(503, "any", DEFAULT_CONFIG)).toBe(true));
  it("returns false for 200", () => expect(isRetryableResult(200, "ok", DEFAULT_CONFIG)).toBe(false));
  it("returns false for 401", () => expect(isRetryableResult(401, "unauthorized", DEFAULT_CONFIG)).toBe(false));
  it("returns false for 502", () => expect(isRetryableResult(502, "bad gateway", DEFAULT_CONFIG)).toBe(false));
  it("returns false without body", () => expect(isRetryableResult(429, undefined, DEFAULT_CONFIG)).toBe(false));

  it("returns true for 400 when ruleMatcher matches", () => {
    const matcher = new RetryRuleMatcher();
    matcher["cache"] = new Map([[400, [{ rule: makeDefaultRule({ status_code: 400 }), pattern: /请稍后重试/ }]]]);
    const config: RetryConfig = { maxRetries: 2, baseDelayMs: 10, ruleMatcher: matcher };
    expect(isRetryableResult(400, JSON.stringify({ error: { code: "9999", message: "网络错误，请稍后重试" } }), config)).toBe(true);
  });

  it("returns false for 400 when ruleMatcher does not match", () => {
    const matcher = new RetryRuleMatcher();
    matcher["cache"] = new Map([[400, [{ rule: makeDefaultRule({ status_code: 400 }), pattern: /请稍后重试/ }]]]);
    const config: RetryConfig = { maxRetries: 2, baseDelayMs: 10, ruleMatcher: matcher };
    expect(isRetryableResult(400, JSON.stringify({ error: { code: "1211", message: "模型不存在" } }), config)).toBe(false);
  });

  it("returns false for 400 without config", () => {
    expect(isRetryableResult(400, JSON.stringify({ error: { code: "1234" } }))).toBe(false);
  });
});

describe("isRetryableThrow", () => {
  function sysErr(code: string) { const e = new Error(code) as NodeJS.ErrnoException; e.code = code; return e; }
  it("ETIMEDOUT", () => expect(isRetryableThrow(sysErr("ETIMEDOUT"))).toBe(true));
  it("ECONNRESET", () => expect(isRetryableThrow(sysErr("ECONNRESET"))).toBe(true));
  it("ECONNREFUSED", () => expect(isRetryableThrow(sysErr("ECONNREFUSED"))).toBe(true));
  it("regular Error", () => expect(isRetryableThrow(new Error("x"))).toBe(false));
  it("string", () => expect(isRetryableThrow("x")).toBe(false));
});

describe("retryableCall", () => {
  it("returns immediately on 200", async () => {
    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(200)), DEFAULT_CONFIG);
    expect(result.statusCode).toBe(200);
    expect(attempts).toHaveLength(1);
  });

  it("retries on 429, returns last when all fail", async () => {
    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(429, "rate limited")), DEFAULT_CONFIG);
    expect(result.statusCode).toBe(429);
    expect(attempts).toHaveLength(3);
  });

  it("succeeds after retry", async () => {
    let n = 0;
    const { result, attempts } = await retryableCall(() => {
      n++;
      if (n === 1) return Promise.resolve(mockResult(429, "rate limited"));
      return Promise.resolve(mockResult(200));
    }, DEFAULT_CONFIG);
    expect(result.statusCode).toBe(200);
    expect(attempts).toHaveLength(2);
  });

  it("retries on ETIMEDOUT", async () => {
    let n = 0;
    const fn = () => { n++; if (n === 1) { const e = new Error("timeout") as NodeJS.ErrnoException; e.code = "ETIMEDOUT"; return Promise.reject(e); } return Promise.resolve(mockResult(200)); };
    const { result, attempts } = await retryableCall(fn, DEFAULT_CONFIG);
    expect(result.statusCode).toBe(200);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].statusCode).toBeNull();
    expect(attempts[0].error).toBe("timeout");
  });

  it("throws on non-retryable error", async () => {
    await expect(retryableCall(() => Promise.reject(new Error("fatal")), DEFAULT_CONFIG)).rejects.toThrow("fatal");
  });

  it("returns immediately on 401", async () => {
    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(401)), DEFAULT_CONFIG);
    expect(result.statusCode).toBe(401);
    expect(attempts).toHaveLength(1);
  });

  it("throws when retries exhausted for throw", async () => {
    const fn = () => { const e = new Error("timeout") as NodeJS.ErrnoException; e.code = "ETIMEDOUT"; return Promise.reject(e); };
    await expect(retryableCall(fn, DEFAULT_CONFIG)).rejects.toThrow("timeout");
  });

  it("respects maxRetries=0", async () => {
    const config: RetryConfig = { maxRetries: 0, baseDelayMs: 1 };
    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(429, "rate limited")), config);
    expect(result.statusCode).toBe(429);
    expect(attempts).toHaveLength(1);
  });

  it("uses per-rule max_retries from matched rule", async () => {
    const matcher = new RetryRuleMatcher();
    const rule = {
      id: "test", name: "limited", status_code: 429, body_pattern: ".*", is_active: 1, created_at: "",
      retry_strategy: "fixed" as const, retry_delay_ms: 1, max_retries: 2, max_delay_ms: 60000,
    };
    matcher["cache"] = new Map([[429, [{ rule, pattern: /^.*$/ }]]]);
    const config: RetryConfig = { maxRetries: 99, baseDelayMs: 1, ruleMatcher: matcher };

    const { attempts } = await retryableCall(() => Promise.resolve(mockResult(429, "rate limited")), config);
    expect(attempts).toHaveLength(3);
  });

  it("does not retry when no rule matches", async () => {
    const matcher = new RetryRuleMatcher();
    const config: RetryConfig = { maxRetries: 99, baseDelayMs: 1, ruleMatcher: matcher };

    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(429, "rate limited")), config);
    expect(result.statusCode).toBe(429);
    expect(attempts).toHaveLength(1);
  });

  it("respects max_retries=0 from rule", async () => {
    const matcher = new RetryRuleMatcher();
    const rule = {
      id: "test", name: "no-retry", status_code: 429, body_pattern: ".*", is_active: 1, created_at: "",
      retry_strategy: "fixed" as const, retry_delay_ms: 1, max_retries: 0, max_delay_ms: 60000,
    };
    matcher["cache"] = new Map([[429, [{ rule, pattern: /^.*$/ }]]]);
    const config: RetryConfig = { maxRetries: 99, baseDelayMs: 1, ruleMatcher: matcher };

    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(429, "rate limited")), config);
    expect(result.statusCode).toBe(429);
    expect(attempts).toHaveLength(1);
  });
});

describe("RetryStrategy", () => {
  it("FixedIntervalStrategy returns constant delay", () => {
    const s = new FixedIntervalStrategy(5000);
    expect(s.getDelay(0)).toBe(5000);
    expect(s.getDelay(1)).toBe(5000);
    expect(s.getDelay(5)).toBe(5000);
  });

  it("ExponentialBackoffStrategy doubles and caps", () => {
    const s = new ExponentialBackoffStrategy(5000, 60000);
    expect(s.getDelay(0)).toBe(5000);
    expect(s.getDelay(1)).toBe(10000);
    expect(s.getDelay(2)).toBe(20000);
    expect(s.getDelay(3)).toBe(40000);
    expect(s.getDelay(4)).toBe(60000);
  });

  it("createStrategy returns correct type", () => {
    expect(createStrategy({ retry_strategy: "fixed", retry_delay_ms: 3000, max_delay_ms: 60000 })).toBeInstanceOf(FixedIntervalStrategy);
    expect(createStrategy({ retry_strategy: "exponential", retry_delay_ms: 3000, max_delay_ms: 60000 })).toBeInstanceOf(ExponentialBackoffStrategy);
    expect(createStrategy({ retry_strategy: "linear", retry_delay_ms: 3000, max_delay_ms: 60000 })).toBeInstanceOf(ExponentialBackoffStrategy);
  });
});

describe("RetryRuleMatcher.match()", () => {
  it("returns matched rule with strategy fields", () => {
    const matcher = new RetryRuleMatcher();
    const rule: RetryRule = {
      id: "1", name: "test", status_code: 429, body_pattern: ".*", is_active: 1, created_at: "",
      retry_strategy: "fixed", retry_delay_ms: 3000, max_retries: 5, max_delay_ms: 30000,
    };
    matcher["cache"] = new Map([[429, [{ rule, pattern: /^.*$/ }]]]);
    expect(matcher.match(429, "rate limited")).toEqual(rule);
  });

  it("returns null when no match", () => {
    const matcher = new RetryRuleMatcher();
    expect(matcher.match(200, "ok")).toBeNull();
  });

  it("test() delegates to match()", () => {
    const matcher = new RetryRuleMatcher();
    const rule: RetryRule = {
      id: "1", name: "test", status_code: 429, body_pattern: ".*", is_active: 1, created_at: "",
      retry_strategy: "exponential", retry_delay_ms: 5000, max_retries: 10, max_delay_ms: 60000,
    };
    matcher["cache"] = new Map([[429, [{ rule, pattern: /^.*$/ }]]]);
    expect(matcher.test(429, "any")).toBe(true);
    expect(matcher.test(200, "ok")).toBe(false);
  });
});
