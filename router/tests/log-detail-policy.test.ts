// tests/log-detail-policy.test.ts
import { describe, it, expect } from "vitest";
import { shouldPreserveDetail } from "../src/proxy/log-detail-policy.js";

describe("shouldPreserveDetail", () => {
  it("returns true for error status codes", () => {
    expect(shouldPreserveDetail(500, null, { test: () => false })).toBe(true);
    expect(shouldPreserveDetail(400, null, { test: () => false })).toBe(true);
  });

  it("returns true when no file writer", () => {
    expect(shouldPreserveDetail(200, "body", { test: () => false }, false)).toBe(true);
  });

  it("returns true when no matcher", () => {
    expect(shouldPreserveDetail(200, "body", null)).toBe(true);
  });

  it("returns true when matcher matches", () => {
    expect(shouldPreserveDetail(200, "body", { test: () => true })).toBe(true);
  });

  it("returns false for success without matching", () => {
    expect(shouldPreserveDetail(200, "body", { test: () => false })).toBe(false);
  });
});
