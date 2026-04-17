import { describe, it, expect } from "vitest";
import { FailoverStrategy } from "../src/proxy/strategy/failover.js";
import type { Target } from "../src/proxy/strategy/types.js";

const t1: Target = { backend_model: "gpt-4", provider_id: "p1" };
const t2: Target = { backend_model: "claude-3", provider_id: "p2" };
const t3: Target = { backend_model: "gemini", provider_id: "p3" };

function makeContext() {
  return { now: new Date() };
}

describe("FailoverStrategy", () => {
  it("returns first target by default", () => {
    const strategy = new FailoverStrategy();
    const rule = { targets: [t1, t2, t3] };
    expect(strategy.select(rule, makeContext())).toEqual(t1);
  });

  it("returns second target when first is excluded", () => {
    const strategy = new FailoverStrategy();
    const rule = { targets: [t1, t2, t3] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1] });
    expect(result).toEqual(t2);
  });

  it("returns third target when first two are excluded", () => {
    const strategy = new FailoverStrategy();
    const rule = { targets: [t1, t2, t3] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1, t2] });
    expect(result).toEqual(t3);
  });

  it("returns undefined when all targets excluded", () => {
    const strategy = new FailoverStrategy();
    const rule = { targets: [t1, t2] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1, t2] });
    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid rule", () => {
    const strategy = new FailoverStrategy();
    expect(strategy.select(null, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: "not-array" }, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: [null] }, makeContext())).toBeUndefined();
  });

  it("returns undefined for empty targets", () => {
    const strategy = new FailoverStrategy();
    expect(strategy.select({ targets: [] }, makeContext())).toBeUndefined();
  });
});
