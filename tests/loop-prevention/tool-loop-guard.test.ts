// tests/loop-prevention/tool-loop-guard.test.ts

import { describe, it, expect } from "vitest";
import { ToolLoopGuard } from "../../src/proxy/loop-prevention/tool-loop-guard.js";
import { SessionTracker } from "../../src/proxy/loop-prevention/session-tracker.js";

describe("ToolLoopGuard", () => {
  const trackerConfig = { sessionTtlMs: 60000, maxToolCallRecords: 50, cleanupIntervalMs: 0 };
  const guardConfig = { enabled: true, minConsecutiveCount: 3, detectorConfig: { n: 6, windowSize: 500, repeatThreshold: 5 } };

  it("returns false when tool call count below threshold", () => {
    const tracker = new SessionTracker(trackerConfig);
    const guard = new ToolLoopGuard(tracker, guardConfig);
    const result = guard.check("s1", { toolName: "read", inputHash: "a", inputText: '{"path":"a"}', timestamp: 1 });
    expect(result.detected).toBe(false);
  });

  it("detects repeated same-tool calls with similar input", () => {
    const tracker = new SessionTracker(trackerConfig);
    const guard = new ToolLoopGuard(tracker, guardConfig);
    for (let i = 0; i < 5; i++) {
      const result = guard.check("s1", {
        toolName: "write_file", inputHash: "abc", inputText: '{"path":"/tmp/a","content":"hello"}', timestamp: i,
      });
      // 非重复输入需要 5 次相同调用才能达到 repeatThreshold=5
      if (i < 4) expect(result.detected).toBe(false);
      else expect(result.detected).toBe(true);
    }
  });

  it("incrementally upgrades degradation tier", () => {
    const tracker = new SessionTracker(trackerConfig);
    const guard = new ToolLoopGuard(tracker, guardConfig);
    // 使用内部有重复的输入 "aaaaaaaa"（8个a）
    // 每次 feed 产生 3 个 "aaaaaa" 6-gram，第二个 feed 时 peak 跃升到 11 触发检测
    const input = "aaaaaaaa";
    for (let i = 0; i < 3; i++) {
      guard.check("s1", { toolName: "write_file", inputHash: "a", inputText: input, timestamp: i });
    }
    // 仅第3次调用触发检测
    expect(tracker.getLoopCount("s1")).toBe(1);

    // 后续每个同工具调用都会通过 minConsecutiveCount 检查并触发 n-gram 检测
    for (let i = 0; i < 3; i++) {
      guard.check("s1", { toolName: "write_file", inputHash: "a", inputText: input, timestamp: 10 + i });
    }
    // 3 次调用每次均触发检测：1 + 3 = 4
    expect(tracker.getLoopCount("s1")).toBe(4);

    for (let i = 0; i < 3; i++) {
      guard.check("s1", { toolName: "write_file", inputHash: "a", inputText: input, timestamp: 20 + i });
    }
    // 再累加 3 次：4 + 3 = 7
    expect(tracker.getLoopCount("s1")).toBe(7);
  });

  it("preserves loop count across mixed tool names", () => {
    const tracker = new SessionTracker(trackerConfig);
    const guard = new ToolLoopGuard(tracker, guardConfig);
    // 使用内部有重复的输入触发检测
    const input = "aaaaaaaa";
    for (let i = 0; i < 3; i++) {
      guard.check("s1", { toolName: "write_file", inputHash: "a", inputText: input, timestamp: i });
    }
    expect(tracker.getLoopCount("s1")).toBe(1);
    // 不同工具名不会重置 loopCount，保留升级到层级 2/3 的可能性
    guard.check("s1", { toolName: "read_file", inputHash: "b", inputText: '{"p":"b"}', timestamp: 10 });
    expect(tracker.getLoopCount("s1")).toBe(1);
  });

  it("injects loop break prompt for anthropic format", () => {
    const tracker = new SessionTracker(trackerConfig);
    const guard = new ToolLoopGuard(tracker, guardConfig);
    const body: Record<string, unknown> = { system: "原始提示词", messages: [] };
    guard.injectLoopBreakPrompt(body, "anthropic", "write_file");
    expect(body.system).toEqual([
      { type: "text", text: "原始提示词" },
      { type: "text", text: expect.stringContaining("write_file") },
    ]);
  });

  it("injects loop break prompt for openai format", () => {
    const tracker = new SessionTracker(trackerConfig);
    const guard = new ToolLoopGuard(tracker, guardConfig);
    const body: Record<string, unknown> = { messages: [{ role: "user", content: "hi" }] };
    guard.injectLoopBreakPrompt(body, "openai", "write_file");
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content as string).toContain("write_file");
  });
});
