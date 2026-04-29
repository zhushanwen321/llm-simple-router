import { describe, it, expect } from "vitest";
import { classifyError } from "../../../src/proxy/transform/error-classifier.js";

describe("classifyError", () => {
  it("classifies Anthropic 401 authentication_error", () => {
    const r = classifyError(401, JSON.stringify({ type: "error", error: { type: "authentication_error" } }));
    expect(r.category).toBe("authentication");
    expect(r.retryable).toBe(false);
  });

  it("classifies OpenAI 400 context_length_exceeded", () => {
    const r = classifyError(400, JSON.stringify({ error: { code: "context_length_exceeded" } }));
    expect(r.category).toBe("context_too_long");
  });

  it("classifies Anthropic 529 overloaded_error", () => {
    const r = classifyError(529, JSON.stringify({ type: "error", error: { type: "overloaded_error" } }));
    expect(r.category).toBe("overloaded");
    expect(r.retryable).toBe(true);
  });

  it("classifies OpenAI 429 insufficient_quota as quota_exceeded (not retryable)", () => {
    const r = classifyError(429, JSON.stringify({ error: { type: "insufficient_quota" } }));
    expect(r.category).toBe("quota_exceeded");
    expect(r.retryable).toBe(false);
  });

  it("classifies OpenAI 429 rate_limit_error as rate_limit (retryable)", () => {
    const r = classifyError(429, JSON.stringify({ error: { type: "rate_limit_error" } }));
    expect(r.category).toBe("rate_limit");
    expect(r.retryable).toBe(true);
  });

  it("classifies Anthropic 429 rate_limit_error (retryable)", () => {
    const r = classifyError(429, JSON.stringify({ type: "error", error: { type: "rate_limit_error" } }));
    expect(r.category).toBe("rate_limit");
    expect(r.retryable).toBe(true);
  });

  it("classifies 403 permission_error", () => {
    const r = classifyError(403, JSON.stringify({ error: { type: "permission_error" } }));
    expect(r.category).toBe("permission");
    expect(r.retryable).toBe(false);
  });

  it("classifies 500 as server_error (retryable)", () => {
    const r = classifyError(500, "{}");
    expect(r.category).toBe("server_error");
    expect(r.retryable).toBe(true);
  });

  it("classifies 502 as server_error (retryable)", () => {
    const r = classifyError(502, "{}");
    expect(r.category).toBe("server_error");
    expect(r.retryable).toBe(true);
  });

  it("classifies unknown status 418 as unknown", () => {
    const r = classifyError(418, "I'm a teapot");
    expect(r.category).toBe("unknown");
    expect(r.retryable).toBe(false);
  });

  it("classifies 400 with content_filter", () => {
    const r = classifyError(400, JSON.stringify({ error: { code: "content_filter" } }));
    expect(r.category).toBe("content_filter");
    expect(r.retryable).toBe(false);
  });

  it("classifies 400 generic as validation", () => {
    const r = classifyError(400, JSON.stringify({ error: { type: "invalid_request_error" } }));
    expect(r.category).toBe("validation");
    expect(r.retryable).toBe(false);
  });
});
