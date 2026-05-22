import { describe, it, expect } from "vitest";

// ---------- Helper functions extracted from RetryRules.vue ----------

function getProviderName(
  id: string,
  providers: Array<{ id: string; name: string }>,
): string {
  return providers.find((p) => p.id === id)?.name ?? id;
}

function shouldShowGlobalBadge(providerId: string | null): boolean {
  return !providerId;
}

function isRegexMode(bodyMatchers: string | null): boolean {
  return !bodyMatchers;
}

describe("RetryRule Provider Column (AC6)", () => {
  it("getProviderName returns provider name for bound rules", () => {
    const providers = [
      { id: "provider-kimi", name: "Kimi AI" },
      { id: "provider-ds", name: "DeepSeek" },
    ];
    expect(getProviderName("provider-kimi", providers)).toBe("Kimi AI");
    expect(getProviderName("provider-ds", providers)).toBe("DeepSeek");
  });

  it("getProviderName falls back to id for unknown providers", () => {
    expect(getProviderName("provider-unknown", [])).toBe("provider-unknown");
  });

  it("shouldShowGlobalBadge returns true for null provider_id", () => {
    expect(shouldShowGlobalBadge(null)).toBe(true);
    expect(shouldShowGlobalBadge("provider-kimi")).toBe(false);
  });
});

describe("RetryRule JSON Matcher Editor (AC7)", () => {
  it("body_matchers round-trips through JSON", () => {
    const matchers = [
      {
        path: "error.type",
        operator: "equals" as const,
        value: "rate_limit_error",
      },
      { path: "error.message", operator: "contains" as const, value: "usage" },
      { path: "error.code", operator: "exists" as const },
    ];

    // Frontend saves: JSON.stringify → API stores as text
    const stored = JSON.stringify(matchers);

    // Frontend loads: JSON.parse → editor renders rows
    const loaded = JSON.parse(stored) as Array<{
      path: string;
      operator: string;
      value?: string;
    }>;
    expect(loaded).toHaveLength(3);

    // Frontend checks operator === "exists" to hide value input
    expect(!!loaded[0].value).toBe(true);
    expect(!!loaded[2].value).toBe(false); // exists has no value
  });

  it("isRegexMode returns true when body_matchers is null", () => {
    expect(isRegexMode(null)).toBe(true);
    expect(isRegexMode("[]")).toBe(false);
  });
});
