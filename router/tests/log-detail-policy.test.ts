// tests/log-detail-policy.test.ts
import { describe, it, expect } from "vitest";
import { shouldPreserveDetail } from "../src/proxy/log-detail-policy.js";

describe("shouldPreserveDetail", () => {
  it("always returns true to preserve client_request for thinking level extraction", () => {
    expect(shouldPreserveDetail(500, null, { test: () => false })).toBe(true);
    expect(shouldPreserveDetail(200, '{"choices":[]}', { test: () => false })).toBe(true);
    expect(shouldPreserveDetail(200, null, { test: () => false })).toBe(true);
    expect(shouldPreserveDetail(200, "body", null)).toBe(true);
    expect(shouldPreserveDetail(200, "body", { test: () => false }, false)).toBe(true);
  });
});
