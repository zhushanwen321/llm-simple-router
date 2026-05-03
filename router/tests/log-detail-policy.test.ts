// tests/log-detail-policy.test.ts
import { describe, it, expect } from "vitest";
import { shouldPreserveDetail } from "../src/proxy/log-detail-policy.js";

describe("shouldPreserveDetail", () => {
  it("returns true for HTTP status >= 400", () => {
    expect(shouldPreserveDetail(500, null, { test: () => false })).toBe(true);
    expect(shouldPreserveDetail(429, null, { test: () => false })).toBe(true);
    expect(shouldPreserveDetail(400, null, { test: () => false })).toBe(true);
  });

  it("returns false for HTTP 200 with no retry rule match", () => {
    expect(shouldPreserveDetail(200, '{"choices":[]}', { test: () => false })).toBe(false);
  });

  it("returns true for HTTP 200 when retry rule matches body", () => {
    const matcher = { test: (_code: number, body: string) => body.includes("content_filter") };
    expect(shouldPreserveDetail(200, '{"error":{"code":"content_filter"}}', matcher)).toBe(true);
  });

  it("returns false for null body when no retry match", () => {
    expect(shouldPreserveDetail(200, null, { test: () => false })).toBe(false);
  });

  it("returns true for HTTP 200 when retry rule matches by status code", () => {
    const matcher = { test: (code: number, _body: string) => code === 200 };
    expect(shouldPreserveDetail(200, "anything", matcher)).toBe(true);
  });

  it("returns true when matcher is null (conservative fallback)", () => {
    expect(shouldPreserveDetail(200, "body", null)).toBe(true);
  });

  it("returns true when hasFileWriter is false regardless of other conditions", () => {
    expect(shouldPreserveDetail(200, "body", { test: () => false }, false)).toBe(true);
  });
});
