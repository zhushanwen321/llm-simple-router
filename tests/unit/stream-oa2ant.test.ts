import { describe, it, expect } from "vitest";
import { OpenAIToAnthropicTransform } from "../../router/src/proxy/transform/stream-oa2ant.js";

describe("OpenAIToAnthropicTransform behavior table", () => {
  function createTransform(): {
    transform: OpenAIToAnthropicTransform;
    collect: () => string[];
  } {
    const chunks: string[] = [];
    const transform = new OpenAIToAnthropicTransform("test-model");
    transform.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString());
    });
    return { transform, collect: () => chunks };
  }

  function makeChunk(overrides: Record<string, unknown>): string {
    return JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      model: "gpt-4",
      ...overrides,
    });
  }

  it("TC-3-01: text delta emits message_start + block_start + block_delta", () => {
    const { transform, collect } = createTransform();
    transform.write(
      `data: ${makeChunk({ choices: [{ delta: { content: "hello" }, index: 0 }] })}\n\n`,
    );
    transform.end();
    const output = collect().join("");
    expect(output).toContain("event: message_start");
    expect(output).toContain("event: content_block_start");
    expect(output).toContain("text_delta");
    expect(output).toContain("hello");
  });

  it("TC-3-02: thinking delta emits thinking block", () => {
    const { transform, collect } = createTransform();
    transform.write(
      `data: ${makeChunk({ choices: [{ delta: { reasoning_content: "think" }, index: 0 }] })}\n\n`,
    );
    transform.end();
    const output = collect().join("");
    expect(output).toContain("event: content_block_start");
    expect(output).toContain("thinking");
    expect(output).toContain("thinking_delta");
    expect(output).toContain("think");
  });

  it("TC-3-03: tool_calls multi-index", () => {
    const { transform, collect } = createTransform();
    // 第一个 tool call
    transform.write(
      `data: ${makeChunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_weather", arguments: "" } }] }, index: 0 }] })}\n\n`,
    );
    // 第二个 tool call
    transform.write(
      `data: ${makeChunk({ choices: [{ delta: { tool_calls: [{ index: 1, id: "call_2", function: { name: "get_time", arguments: "" } }] }, index: 0 }] })}\n\n`,
    );
    transform.end();
    const output = collect().join("");
    expect(output).toContain("get_weather");
    expect(output).toContain("get_time");
    expect(output).toContain("tool_use");
  });

  it("TC-3-04: finish_reason stop maps to end_turn", () => {
    const { transform, collect } = createTransform();
    transform.write(
      `data: ${makeChunk({ choices: [{ delta: { content: "hi" }, index: 0 }] })}\n\n`,
    );
    transform.write(
      `data: ${makeChunk({ choices: [{ delta: {}, finish_reason: "stop", index: 0 }] })}\n\n`,
    );
    transform.write(
      `data: ${makeChunk({ usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`,
    );
    transform.end();
    const output = collect().join("");
    expect(output).toContain("end_turn");
  });

  it("TC-3-04b: finish_reason tool_calls maps to tool_use", () => {
    const { transform, collect } = createTransform();
    transform.write(
      `data: ${makeChunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "f", arguments: "" } }] }, index: 0 }] })}\n\n`,
    );
    transform.write(
      `data: ${makeChunk({ choices: [{ delta: {}, finish_reason: "tool_calls", index: 0 }] })}\n\n`,
    );
    transform.write(
      `data: ${makeChunk({ usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`,
    );
    transform.end();
    const output = collect().join("");
    expect(output).toContain("tool_use");
  });

  it("TC-3-05: usage-only chunk triggers stop sequence", () => {
    const { transform, collect } = createTransform();
    transform.write(
      `data: ${makeChunk({ choices: [{ delta: { content: "hi" }, index: 0 }] })}\n\n`,
    );
    transform.write(
      `data: ${makeChunk({ choices: [{ delta: {}, finish_reason: "stop", index: 0 }] })}\n\n`,
    );
    transform.write(
      `data: ${makeChunk({ usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 20 } } })}\n\n`,
    );
    transform.end();
    const output = collect().join("");
    expect(output).toContain("message_delta");
    expect(output).toContain("message_stop");
    // cache_read_input_tokens
    expect(output).toContain("20");
  });

  it("[DONE] is skipped", () => {
    const { transform, collect } = createTransform();
    transform.write(`data: [DONE]\n\n`);
    transform.end();
    const output = collect().join("");
    expect(output).not.toContain("event: message_start");
  });
});
