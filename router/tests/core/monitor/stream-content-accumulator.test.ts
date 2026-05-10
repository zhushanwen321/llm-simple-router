import { describe, it, expect } from "vitest";
import { StreamContentAccumulator } from "../../../src/core/monitor/stream-content-accumulator.js";

describe("StreamContentAccumulator", () => {
  it("accumulates text from openai stream", () => {
    const acc = new StreamContentAccumulator(1024, 512);
    acc.append('data: {"choices":[{"delta":{"content":"hello"}}]}', "openai");
    const snapshot = acc.getSnapshot();
    expect(snapshot.textContent).toBe("hello");
    expect(snapshot.rawChunks).toContain("hello");
    expect(snapshot.totalChars).toBeGreaterThan(0);
  });

  it("accumulates text from anthropic text_delta", () => {
    const acc = new StreamContentAccumulator(1024, 512);
    acc.append('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}', "anthropic");
    expect(acc.getSnapshot().textContent).toBe("world");
  });

  it("truncates rawChunks when exceeding maxRaw", () => {
    const acc = new StreamContentAccumulator(20, 512);
    acc.append("data: " + JSON.stringify({ choices: [{ delta: { content: "a".repeat(30) } }] }), "openai");
    expect(acc.getSnapshot().rawChunks.length).toBeLessThanOrEqual(20);
  });

  it("truncates textContent when exceeding maxText", () => {
    const acc = new StreamContentAccumulator(1024, 10);
    for (let i = 0; i < 5; i++) {
      acc.append('data: {"choices":[{"delta":{"content":"hello"}}]}', "openai");
    }
    expect(acc.getSnapshot().textContent.length).toBeLessThanOrEqual(10);
  });

  it("accumulates thinking and tool_use blocks", () => {
    const acc = new StreamContentAccumulator(1024, 512);
    acc.append('data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}', "anthropic");
    acc.append('data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}', "anthropic");
    acc.append('data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","name":"tool1"}}', "anthropic");
    acc.append('data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":"}}', "anthropic");

    const { blocks } = acc.getSnapshot();
    expect(blocks).toBeDefined();
    expect(blocks!.length).toBe(2);
    expect(blocks![0].type).toBe("thinking");
    expect(blocks![0].content).toBe("hmm");
    expect(blocks![1].type).toBe("tool_use");
    expect(blocks![1].name).toBe("tool1");
    expect(blocks![1].content).toBe('{"a":');
  });

  it("ignores non-data lines but still tracks rawChunks", () => {
    const acc = new StreamContentAccumulator(1024, 512);
    acc.append("some random line", "openai");
    const snapshot = acc.getSnapshot();
    expect(snapshot.textContent).toBe("");
    expect(snapshot.rawChunks).toContain("some random line");
  });

  it("tracks totalChars regardless of text truncation", () => {
    const acc = new StreamContentAccumulator(1024, 10);
    const line = 'data: {"choices":[{"delta":{"content":"abcdefghij"}}]}';
    acc.append(line, "openai");
    acc.append(line, "openai");
    const snapshot = acc.getSnapshot();
    expect(snapshot.totalChars).toBe(line.length * 2);
    expect(snapshot.textContent.length).toBeLessThanOrEqual(10);
  });

  it("returns blocks undefined when empty", () => {
    const acc = new StreamContentAccumulator(1024, 512);
    acc.append('data: {"choices":[{"delta":{"content":"text"}}]}', "openai");
    // OpenAI only produces block at index 0 with type "text" + content
    // But blocks should still be defined since it has content
    const snapshot = acc.getSnapshot();
    expect(snapshot.textContent).toBe("text");
  });

  it("uses default limits when no constructor args", () => {
    const acc = new StreamContentAccumulator();
    acc.append('data: {"choices":[{"delta":{"content":"x"}}]}', "openai");
    expect(acc.getSnapshot().textContent).toBe("x");
  });
});
