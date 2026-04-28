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

  it("throws when total fed bytes exceed limit", () => {
    const parser = new SafeSSEParser();
    expect(() => {
      for (let i = 0; i < 10000; i++) {
        parser.feed("data: " + "x".repeat(10) + "\n\n");
      }
    }).toThrow("SSE buffer exceeded");
  });

  it("handles flush for remaining data", () => {
    const parser = new SafeSSEParser();
    parser.feed('data: {"type":"test"}');
    const events = parser.flush();
    expect(events).toHaveLength(1);
  });
});
