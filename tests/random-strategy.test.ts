import { describe, it, expect } from "vitest";
import { RandomStrategy } from "../src/proxy/strategy/random.js";
import type { Target } from "../src/proxy/strategy/types.js";

const t1: Target = { backend_model: "gpt-4", provider_id: "p1" };
const t2: Target = { backend_model: "claude-3", provider_id: "p2" };
const t3: Target = { backend_model: "gemini", provider_id: "p3" };

function makeContext() {
  return { now: new Date() };
}

describe("RandomStrategy", () => {
  it("returns a target from the list", () => {
    const strategy = new RandomStrategy();
    const rule = { targets: [t1, t2, t3] };
    const result = strategy.select(rule, makeContext());
    expect([t1, t2, t3]).toContainEqual(result);
  });

  it("returns undefined for empty targets", () => {
    const strategy = new RandomStrategy();
    expect(strategy.select({ targets: [] }, makeContext())).toBeUndefined();
  });

  it("skips excluded targets", () => {
    const strategy = new RandomStrategy();
    const rule = { targets: [t1, t2] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1] });
    expect(result).toEqual(t2);
  });

  it("returns undefined when all excluded", () => {
    const strategy = new RandomStrategy();
    const rule = { targets: [t1, t2] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1, t2] });
    expect(result).toBeUndefined();
  });

  it("returns single target when only one remains after exclude", () => {
    const strategy = new RandomStrategy();
    const rule = { targets: [t1, t2, t3] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1, t3] });
    expect(result).toEqual(t2);
  });

  it("returns undefined for invalid rule", () => {
    const strategy = new RandomStrategy();
    expect(strategy.select(null, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: "not-array" }, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: [123] }, makeContext())).toBeUndefined();
  });
});
