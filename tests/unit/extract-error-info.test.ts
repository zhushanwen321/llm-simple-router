import { describe, it, expect } from "vitest";
import { extractErrorInfo } from "../../router/src/db/upstream-error-logs.js";

describe("TC-6-01: extractErrorInfo", () => {
  it("extracts error.type as errorType", () => {
    const body = JSON.stringify({ error: { type: "rate_limit_error", message: "Too many" } });
    const result = extractErrorInfo(body);
    expect(result.errorType).toBe("rate_limit_error");
    expect(result.errorMessage).toBe("Too many");
  });

  it("falls back to error.code when error.type is missing", () => {
    const body = JSON.stringify({ error: { code: "insufficient_quota", message: "No quota" } });
    const result = extractErrorInfo(body);
    expect(result.errorType).toBe("insufficient_quota");
    expect(result.errorMessage).toBe("No quota");
  });

  it("returns null when no error field", () => {
    const body = JSON.stringify({ status: "ok" });
    const result = extractErrorInfo(body);
    expect(result.errorType).toBeNull();
    expect(result.errorMessage).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const result = extractErrorInfo("not json");
    expect(result.errorType).toBeNull();
    expect(result.errorMessage).toBeNull();
  });

  it("prioritizes error.type over error.code", () => {
    const body = JSON.stringify({ error: { type: "type_a", code: "code_b", message: "msg" } });
    const result = extractErrorInfo(body);
    expect(result.errorType).toBe("type_a");
  });

  it("returns null errorType when error.type and error.code are non-string", () => {
    const body = JSON.stringify({ error: { type: 123, code: true } });
    const result = extractErrorInfo(body);
    expect(result.errorType).toBeNull();
  });
});
