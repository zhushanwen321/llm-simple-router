import { describe, it, expect } from "vitest";
import { isRetryableResult, isRetryableThrow, retryableCall } from "../src/proxy/retry.js";
import type { RetryConfig } from "../src/proxy/retry.js";
import type { ProxyResult } from "../src/proxy/proxy-core.js";

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 10,
  retryableStatuses: new Set([429, 503]),
  isRetryableBody: (body: string) => {
    try {
      const parsed = JSON.parse(body);
      return parsed?.error?.code === "1234" || (parsed?.error?.message?.includes("请稍后重试") ?? false);
    } catch { return false; }
  },
};

function mockResult(statusCode: number, body = ""): ProxyResult {
  return { statusCode, body, headers: {}, sentHeaders: {}, sentBody: "" };
}

describe("isRetryableResult", () => {
  it("returns true for 429", () => expect(isRetryableResult(429, undefined, DEFAULT_CONFIG)).toBe(true));
  it("returns true for 503", () => expect(isRetryableResult(503, undefined, DEFAULT_CONFIG)).toBe(true));
  it("returns false for 200", () => expect(isRetryableResult(200, undefined, DEFAULT_CONFIG)).toBe(false));
  it("returns false for 401", () => expect(isRetryableResult(401, undefined, DEFAULT_CONFIG)).toBe(false));
  it("returns false for 502", () => expect(isRetryableResult(502, undefined, DEFAULT_CONFIG)).toBe(false));
  it("returns true for 400 with code=1234", () => {
    expect(isRetryableResult(400, JSON.stringify({ error: { code: "1234", message: "网络错误" } }), DEFAULT_CONFIG)).toBe(true);
  });
  it("returns true for 400 with 请稍后重试", () => {
    expect(isRetryableResult(400, JSON.stringify({ error: { code: "9999", message: "网络错误，请稍后重试" } }), DEFAULT_CONFIG)).toBe(true);
  });
  it("returns false for 400 non-retryable", () => {
    expect(isRetryableResult(400, JSON.stringify({ error: { code: "1211", message: "模型不存在" } }), DEFAULT_CONFIG)).toBe(false);
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
    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(++n === 1 ? 429 : 200)), DEFAULT_CONFIG);
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
    const config = { ...DEFAULT_CONFIG, maxRetries: 0 };
    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(429)), config);
    expect(result.statusCode).toBe(429);
    expect(attempts).toHaveLength(1);
  });
});
