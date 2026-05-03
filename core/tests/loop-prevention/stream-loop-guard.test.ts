import { describe, it, expect, vi } from "vitest";
import { StreamLoopGuard } from "../../src/loop-prevention/stream-loop-guard.js";
import { NGramLoopDetector } from "../../src/loop-prevention/ngram-detector.js";

describe("StreamLoopGuard", () => {
  const config = { enabled: true, detectorConfig: { n: 6, windowSize: 1000, repeatThreshold: 5 } };

  it("does not trigger with normal content", () => {
    const onDetected = vi.fn();
    const guard = new StreamLoopGuard(config, new NGramLoopDetector(config.detectorConfig), onDetected);
    guard.feed("这是正常的不重复文本内容。");
    expect(onDetected).not.toHaveBeenCalled();
    expect(guard.isTriggered()).toBe(false);
  });

  it("triggers callback when loop detected", () => {
    const onDetected = vi.fn();
    const guard = new StreamLoopGuard(config, new NGramLoopDetector(config.detectorConfig), onDetected);
    for (let i = 0; i < 10; i++) {
      guard.feed("我来编写完整的设计文档。");
    }
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected.mock.calls[0][0]).toContain("repeated");
    expect(guard.isTriggered()).toBe(true);
  });

  it("stops feeding after triggered", () => {
    const onDetected = vi.fn();
    const guard = new StreamLoopGuard(config, new NGramLoopDetector(config.detectorConfig), onDetected);
    for (let i = 0; i < 6; i++) guard.feed("重复内容。");
    expect(onDetected).toHaveBeenCalledTimes(1);
    guard.feed("更多重复内容。");
    expect(onDetected).toHaveBeenCalledTimes(1);
  });

  it("reset clears triggered state", () => {
    const guard = new StreamLoopGuard(config, new NGramLoopDetector(config.detectorConfig), vi.fn());
    for (let i = 0; i < 10; i++) guard.feed("重复内容。");
    expect(guard.isTriggered()).toBe(true);
    guard.reset();
    expect(guard.isTriggered()).toBe(false);
  });
});
