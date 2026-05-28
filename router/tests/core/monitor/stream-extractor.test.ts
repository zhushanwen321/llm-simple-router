import { describe, it, expect } from "vitest";
import { extractStreamText } from "../../../src/core/monitor/stream-extractor.js";

const PREFIX = "data: ";

describe("extractStreamText - OpenAI format", () => {
  const apiType = "openai" as const;

  it("extracts text from content delta", () => {
    const fixture = `${PREFIX}${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("hello");
    expect(result.block?.type).toBe("text");
    expect(result.block?.index).toBe(1);
    expect(result.block?.content).toBe("hello");
  });

  it("extracts reasoning content as thinking block", () => {
    const fixture = `${PREFIX}${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking..." } }] })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("thinking...");
    expect(result.block?.type).toBe("thinking");
    expect(result.block?.index).toBe(0);
    expect(result.block?.content).toBe("thinking...");
  });

  it("extracts tool_calls with name and arguments", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "fn1", arguments: '{"a":1}' },
          }],
        },
      }],
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block?.type).toBe("tool_use");
    expect(result.block?.index).toBe(2);
    expect(result.block?.content).toBe('{"a":1}');
    expect(result.block?.name).toBe("fn1");
  });

  it("assigns block index OPENAI_BLOCK_TOOLS + tool_call index", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 1,
            id: "call_1",
            type: "function",
            function: { name: "fn2", arguments: "{}" },
          }],
        },
      }],
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.block?.index).toBe(3);
    expect(result.block?.name).toBe("fn2");
  });

  it("returns empty for [DONE]", () => {
    const fixture = `${PREFIX}[DONE]`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });

  it("returns empty for invalid JSON", () => {
    const fixture = `${PREFIX}not-json`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });

  it("returns empty for JSON without choices", () => {
    const fixture = `${PREFIX}${JSON.stringify({ usage: {} })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });

  it("returns empty for empty delta", () => {
    const fixture = `${PREFIX}${JSON.stringify({ choices: [{ delta: {} }] })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });

  it("returns empty for tool_calls without function", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0 }] } }],
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });

  it("prefers reasoning over content when both present", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      choices: [{ delta: { reasoning_content: "think...", content: "hello" } }],
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.block?.type).toBe("thinking");
    expect(result.block?.content).toBe("think...");
    expect(result.text).toBe("think...");
  });

  it("extracts tool_calls with name but no arguments", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "fn1" },
          }],
        },
      }],
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.block?.type).toBe("tool_use");
    expect(result.block?.name).toBe("fn1");
    expect(result.block?.content).toBe("");
    expect(result.text).toBe("");
  });

  it("returns empty for line without data: prefix", () => {
    const result = extractStreamText("raw line with no prefix", apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });
});

describe("extractStreamText - Anthropic format", () => {
  const apiType = "anthropic" as const;

  it("handles content_block_start for thinking", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking" },
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block?.type).toBe("thinking");
    expect(result.block?.index).toBe(0);
    expect(result.block?.content).toBe("");
  });

  it("handles content_block_start for tool_use with name", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", name: "search" },
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.block?.type).toBe("tool_use");
    expect(result.block?.name).toBe("search");
    expect(result.block?.content).toBe("");
  });

  it("handles content_block_delta thinking_delta", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "hmm" },
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.block?.type).toBe("thinking");
    expect(result.block?.content).toBe("hmm");
    expect(result.text).toBe("");
  });

  it("handles content_block_delta text_delta", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "hello" },
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.block?.type).toBe("text");
    expect(result.block?.content).toBe("hello");
    expect(result.text).toBe("hello");
  });

  it("handles content_block_delta input_json_delta", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"a":1}' },
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.block?.type).toBe("tool_use");
    expect(result.block?.content).toBe('{"a":1}');
    expect(result.text).toBe("");
  });

  it("returns empty for content_block_stop", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "content_block_stop",
      index: 0,
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });

  it("handles content_block_start for text", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text" },
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.block?.type).toBe("text");
    expect(result.block?.content).toBe("");
  });

  it("returns empty for unknown content_block type", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "image", source: { media_type: "image/png", data: "abc" } },
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });

  it("handles content_block_start tool_use with input field", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", name: "search", input: {} },
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.block?.type).toBe("tool_use");
    expect(result.block?.name).toBe("search");
  });
});

describe("extractStreamText - OpenAI Responses format", () => {
  const apiType = "openai-responses" as const;

  it("handles response.output_text.delta", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.output_text.delta",
      delta: "hello",
      output_index: 0,
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("hello");
    expect(result.block?.type).toBe("text");
    expect(result.block?.index).toBe(0);
    expect(result.block?.content).toBe("hello");
  });

  it("handles response.function_call_arguments.delta", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.function_call_arguments.delta",
      delta: '{"a":1}',
      output_index: 0,
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block?.type).toBe("tool_use");
    expect(result.block?.content).toBe('{"a":1}');
  });

  it("handles response.reasoning_summary_text.delta", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.reasoning_summary_text.delta",
      delta: "thinking...",
      output_index: 0,
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block?.type).toBe("thinking");
    expect(result.block?.content).toBe("thinking...");
  });

  it("returns empty for unknown event type", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.unknown",
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });

  it("defaults output_index to 0 when missing", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.output_text.delta",
      delta: "hi",
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.block?.index).toBe(0);
    expect(result.block?.content).toBe("hi");
  });

  it("returns null block for empty delta in output_text.delta", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.output_text.delta",
      delta: "",
      output_index: 0,
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });
});
