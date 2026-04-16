import { describe, it, expect } from "vitest";
import { ScheduledStrategy } from "../src/proxy/strategy/scheduled.js";
import type { Target } from "../src/proxy/strategy/types.js";

const defaultTarget: Target = { backend_model: "gpt-4", provider_id: "openai" };
const windowTarget: Target = { backend_model: "claude-3", provider_id: "anthropic" };
const secondWindowTarget: Target = { backend_model: "gemini", provider_id: "google" };

function makeContext(hour: number, minute: number) {
  return { now: new Date(2024, 0, 1, hour, minute) };
}

describe("ScheduledStrategy", () => {
  it("returns default target when no windows", () => {
    const strategy = new ScheduledStrategy();
    const result = strategy.select({ default: defaultTarget }, makeContext(12, 0));
    expect(result).toEqual(defaultTarget);
  });

  it("returns window target when current time matches window", () => {
    const strategy = new ScheduledStrategy();
    const result = strategy.select(
      {
        default: defaultTarget,
        windows: [{ start: "09:00", end: "17:00", target: windowTarget }],
      },
      makeContext(12, 0)
    );
    expect(result).toEqual(windowTarget);
  });

  it("returns default when current time does not match window", () => {
    const strategy = new ScheduledStrategy();
    const result = strategy.select(
      {
        default: defaultTarget,
        windows: [{ start: "09:00", end: "17:00", target: windowTarget }],
      },
      makeContext(18, 0)
    );
    expect(result).toEqual(defaultTarget);
  });

  it("matches cross-midnight window correctly", () => {
    const strategy = new ScheduledStrategy();
    const result1 = strategy.select(
      {
        default: defaultTarget,
        windows: [{ start: "22:00", end: "06:00", target: windowTarget }],
      },
      makeContext(23, 30)
    );
    expect(result1).toEqual(windowTarget);

    const result2 = strategy.select(
      {
        default: defaultTarget,
        windows: [{ start: "22:00", end: "06:00", target: windowTarget }],
      },
      makeContext(3, 0)
    );
    expect(result2).toEqual(windowTarget);

    const result3 = strategy.select(
      {
        default: defaultTarget,
        windows: [{ start: "22:00", end: "06:00", target: windowTarget }],
      },
      makeContext(12, 0)
    );
    expect(result3).toEqual(defaultTarget);
  });

  it("returns first matching window when multiple windows match", () => {
    const strategy = new ScheduledStrategy();
    const result = strategy.select(
      {
        default: defaultTarget,
        windows: [
          { start: "09:00", end: "17:00", target: windowTarget },
          { start: "10:00", end: "16:00", target: secondWindowTarget },
        ],
      },
      makeContext(12, 0)
    );
    expect(result).toEqual(windowTarget);
  });

  it("returns undefined when no default and no match", () => {
    const strategy = new ScheduledStrategy();
    const result = strategy.select(
      {
        windows: [{ start: "09:00", end: "17:00", target: windowTarget }],
      },
      makeContext(18, 0)
    );
    expect(result).toBeUndefined();
  });

  it("returns default when windows is empty array", () => {
    const strategy = new ScheduledStrategy();
    const result = strategy.select(
      {
        default: defaultTarget,
        windows: [],
      },
      makeContext(12, 0)
    );
    expect(result).toEqual(defaultTarget);
  });

  it("returns undefined when rule structure is invalid", () => {
    const strategy = new ScheduledStrategy();
    expect(strategy.select(null, makeContext(12, 0))).toBeUndefined();
    expect(strategy.select(undefined, makeContext(12, 0))).toBeUndefined();
    expect(strategy.select("invalid", makeContext(12, 0))).toBeUndefined();
    expect(strategy.select({ windows: "not-array" }, makeContext(12, 0))).toBeUndefined();
    expect(strategy.select({ default: "not-target" }, makeContext(12, 0))).toBeUndefined();
    expect(
      strategy.select(
        {
          windows: [{ start: "09:00", end: "17:00", target: "bad" }],
        },
        makeContext(12, 0)
      )
    ).toBeUndefined();
  });
});
