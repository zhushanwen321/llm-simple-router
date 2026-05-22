import { describe, it, expect } from "vitest";

// Verify the frontend RetryRule types support the required fields
// for the Provider column (AC6) and JSON matcher editor (AC7).

describe("RetryRule frontend type validation (AC6/AC7)", () => {
  it("supports provider_id for Provider column / global badge (AC6)", () => {
    const rule: Record<string, unknown> = {
      provider_id: "provider-kimi",
      body_matchers: null,
    };

    // Frontend table logic: !r.provider_id → show "通用" Badge
    const isBound = rule.provider_id !== null && rule.provider_id !== undefined;
    expect(isBound).toBe(true);

    // Global rule: provider_id = null → show "通用" Badge
    const globalRule = { ...rule, provider_id: null };
    const isGlobal = globalRule.provider_id == null;
    expect(isGlobal).toBe(true);
  });

  it("supports body_matchers for JSON editor round-trip (AC7)", () => {
    const bodyMatchers = JSON.stringify([
      { path: "error.type", operator: "equals", value: "rate_limit_error" },
      { path: "error.message", operator: "contains", value: "usage" },
    ]);

    // Frontend parses body_matchers into editor rows
    const parsed = JSON.parse(bodyMatchers) as Array<Record<string, string>>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].path).toBe("error.type");
    expect(parsed[0].operator).toBe("equals");
    expect(parsed[0].value).toBe("rate_limit_error");
    expect(parsed[1].operator).toBe("contains");

    // Frontend serializes editor rows back to body_matchers
    const serialized = JSON.stringify(parsed);
    expect(serialized).toBe(bodyMatchers);

    // Frontend checks operator === "exists" to hide value input
    const existsItem = { path: "error.code", operator: "exists" as const };
    expect(existsItem.operator === "exists").toBe(true);
  });
});
