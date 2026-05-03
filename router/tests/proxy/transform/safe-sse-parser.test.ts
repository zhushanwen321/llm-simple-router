import { describe, it, expect } from "vitest";
import { SafeSSEParser } from "../../../src/proxy/patch/safe-sse-parser.js";

describe("SafeSSEParser", () => {
  it("parses normal SSE events", () => {
    const parser = new SafeSSEParser();
    const events = parser.feed('data: {"type":"ping"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"type":"ping"}');
  });

  it("accumulates partial events across feeds", () => {
    const parser = new SafeSSEParser();
    parser.feed('data: {"type":"ping"}\n');
    const events = parser.feed('\n');
    expect(events).toHaveLength(1);
  });

  it("throws when unparsed buffer exceeds limit (malformed SSE without \\n\\n)", () => {
    const parser = new SafeSSEParser();
    expect(() => {
      // 不含 \n\n，数据无法被消费，缓冲区持续增长
      for (let i = 0; i < 10000; i++) {
        parser.feed("data: " + "x".repeat(10) + "\n");
      }
    }).toThrow("SSE buffer exceeded");
  });

  it("does not throw when many normal events are parsed (buffer stays small)", () => {
    const parser = new SafeSSEParser();
    // 每个 feed 都含 \n\n，事件立即被消费，buffer 不会积压
    for (let i = 0; i < 10000; i++) {
      parser.feed("data: " + "x".repeat(10) + "\n\n");
    }
    // 能正常完成不抛异常即可
    expect(true).toBe(true);
  });

  it("handles flush for remaining data", () => {
    const parser = new SafeSSEParser();
    parser.feed('data: {"type":"test"}');
    const events = parser.flush();
    expect(events).toHaveLength(1);
  });
});
