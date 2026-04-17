import { describe, it, expect } from "vitest";
import { RoundRobinStrategy } from "../src/proxy/strategy/round-robin.js";
import type { Target } from "../src/proxy/strategy/types.js";

const t1: Target = { backend_model: "gpt-4", provider_id: "p1" };
const t2: Target = { backend_model: "claude-3", provider_id: "p2" };
const t3: Target = { backend_model: "gemini", provider_id: "p3" };

function makeContext() {
  return { now: new Date() };
}

describe("RoundRobinStrategy", () => {
  it("cycles through targets in order", () => {
    const strategy = new RoundRobinStrategy();
    const rule = { targets: [t1, t2, t3] };
    expect(strategy.select(rule, makeContext())).toEqual(t1);
    expect(strategy.select(rule, makeContext())).toEqual(t2);
    expect(strategy.select(rule, makeContext())).toEqual(t3);
    expect(strategy.select(rule, makeContext())).toEqual(t1);
  });

  it("returns undefined for empty targets", () => {
    const strategy = new RoundRobinStrategy();
    expect(strategy.select({ targets: [] }, makeContext())).toBeUndefined();
  });

  it("skips excluded targets", () => {
    const strategy = new RoundRobinStrategy();
    const rule = { targets: [t1, t2, t3] };
    strategy.select(rule, makeContext()); // t1
    strategy.select(rule, makeContext()); // t2
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t3] });
    expect(result).toEqual(t1);
  });

  it("returns undefined when all targets excluded", () => {
    const strategy = new RoundRobinStrategy();
    const rule = { targets: [t1, t2] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1, t2] });
    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid rule", () => {
    const strategy = new RoundRobinStrategy();
    expect(strategy.select(null, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: "not-array" }, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: [null] }, makeContext())).toBeUndefined();
  });

  it("maintains independent state per client model", () => {
    const strategy = new RoundRobinStrategy();
    const ruleA = { targets: [t1, t2] };
    const ruleB = { targets: [t3, t1] };
    expect(strategy.select(ruleA, makeContext(), "model-a")).toEqual(t1);
    expect(strategy.select(ruleB, makeContext(), "model-b")).toEqual(t3);
    expect(strategy.select(ruleA, makeContext(), "model-a")).toEqual(t2);
    expect(strategy.select(ruleB, makeContext(), "model-b")).toEqual(t1);
  });
});
