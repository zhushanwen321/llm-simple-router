import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionTracker } from "../../../src/core/loop-prevention/session-tracker.js";

describe("SessionTracker", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  const config = { sessionTtlMs: 60000, maxToolCallRecords: 50, cleanupIntervalMs: 0 };

  it("records and retrieves tool call history", () => {
    const tracker = new SessionTracker(config);
    const history = tracker.recordAndGetHistory("session-1", {
      toolName: "write_file", inputHash: "abc", inputText: '{"path":"a.md"}', timestamp: Date.now(),
    });
    expect(history).toHaveLength(1);
    expect(history[0].toolName).toBe("write_file");
  });

  it("separates different sessions", () => {
    const tracker = new SessionTracker(config);
    tracker.recordAndGetHistory("s1", { toolName: "read", inputHash: "a", inputText: "a", timestamp: 1 });
    tracker.recordAndGetHistory("s2", { toolName: "write", inputHash: "b", inputText: "b", timestamp: 2 });
    expect(tracker.getActiveSessionCount()).toBe(2);
  });

  it("enforces maxToolCallRecords", () => {
    const tracker = new SessionTracker({ ...config, maxToolCallRecords: 3 });
    for (let i = 0; i < 10; i++) {
      tracker.recordAndGetHistory("s1", { toolName: "t", inputHash: String(i), inputText: String(i), timestamp: i });
    }
    const history = tracker.recordAndGetHistory("s1", { toolName: "t", inputHash: "10", inputText: "10", timestamp: 10 });
    expect(history).toHaveLength(3);
    expect(history[0].inputHash).toBe("8");
  });

  it("loopDetectedCount increments and resets", () => {
    const tracker = new SessionTracker(config);
    tracker.recordAndGetHistory("s1", { toolName: "t", inputHash: "a", inputText: "a", timestamp: 1 });
    expect(tracker.incrementLoopCount("s1")).toBe(1);
    expect(tracker.incrementLoopCount("s1")).toBe(2);
    tracker.resetLoopCount("s1");
    expect(tracker.getLoopCount("s1")).toBe(0);
  });

  it("expires sessions after TTL", () => {
    const tracker = new SessionTracker(config);
    tracker.recordAndGetHistory("s1", { toolName: "t", inputHash: "a", inputText: "a", timestamp: 1 });
    expect(tracker.getActiveSessionCount()).toBe(1);
    vi.advanceTimersByTime(120_000);
    tracker.recordAndGetHistory("s1", { toolName: "t", inputHash: "b", inputText: "b", timestamp: 2 });
    expect(tracker.getActiveSessionCount()).toBe(1);
  });

  it("periodic cleanup removes expired sessions", () => {
    const tracker = new SessionTracker({ ...config, cleanupIntervalMs: 5000 });
    tracker.recordAndGetHistory("s1", { toolName: "t", inputHash: "a", inputText: "a", timestamp: 1 });
    vi.advanceTimersByTime(120_000);
    vi.advanceTimersByTime(5000);
    expect(tracker.getActiveSessionCount()).toBe(0);
    tracker.stop();
  });
});
