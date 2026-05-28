import { describe, it, expect } from "vitest";
import { serializeBlocksForStorage } from "../../../src/proxy/handler/proxy-handler-utils.js";

interface ContentBlock {
  type: "thinking" | "text" | "tool_use" | "tool_result";
  content: string;
  name?: string;
}

describe("serializeBlocksForStorage - Anthropic format", () => {
  const apiType = "anthropic" as const;

  it("serializes pure text blocks", () => {
    const blocks: ContentBlock[] = [{ type: "text", content: "Hello" }];
    const result = serializeBlocksForStorage(blocks, apiType);
    expect(result).toBe(JSON.stringify({ content: [{ type: "text", text: "Hello" }] }));
  });

  it("serializes thinking + text blocks with thinking first", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", content: "I think" },
      { type: "text", content: " therefore" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.content).toEqual([
      { type: "thinking", thinking: "I think" },
      { type: "text", text: " therefore" },
    ]);
  });

  it("serializes tool_use block with parsed input from valid JSON content", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_use", content: '{"a":1}', name: "fn1" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.content[0].type).toBe("tool_use");
    expect(parsed.content[0].name).toBe("fn1");
    expect(parsed.content[0].input).toEqual({ a: 1 });
  });

  it("serializes tool_use block with empty input when content is invalid JSON", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_use", content: "not-json", name: "fn1" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.content[0].type).toBe("tool_use");
    expect(parsed.content[0].input).toEqual({});
  });

  it("returns empty string for empty blocks array", () => {
    const result = serializeBlocksForStorage([], apiType);
    expect(result).toBe("");
  });

  it("returns empty string for undefined blocks", () => {
    const result = serializeBlocksForStorage(undefined, apiType);
    expect(result).toBe("");
  });
});

describe("serializeBlocksForStorage - OpenAI format", () => {
  const apiType = "openai" as const;

  it("serializes pure text blocks", () => {
    const blocks: ContentBlock[] = [{ type: "text", content: "Hello" }];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.content).toBe("Hello");
    expect(parsed.choices[0].message.reasoning_content).toBeUndefined();
    expect(parsed.choices[0].message.tool_calls).toBeUndefined();
  });

  it("serializes thinking blocks as reasoning_content", () => {
    const blocks: ContentBlock[] = [{ type: "thinking", content: "I think" }];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.reasoning_content).toBe("I think");
    expect(parsed.choices[0].message.content).toBeUndefined();
  });

  it("serializes thinking + text with both fields", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", content: "I think" },
      { type: "text", content: "Hello" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.reasoning_content).toBe("I think");
    expect(parsed.choices[0].message.content).toBe("Hello");
    expect(parsed.choices[0].message.tool_calls).toBeUndefined();
  });

  it("serializes tool_use blocks as tool_calls", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_use", content: '{"a":1}', name: "fn1" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.tool_calls).toHaveLength(1);
    expect(parsed.choices[0].message.tool_calls[0].function.name).toBe("fn1");
    expect(parsed.choices[0].message.tool_calls[0].function.arguments).toBe('{"a":1}');
    expect(parsed.choices[0].message.tool_calls[0].id).toBe("call_storage_0");
  });

  it("serializes thinking + tool_use + text mixed", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", content: "think" },
      { type: "text", content: "text" },
      { type: "tool_use", content: "{}", name: "fn1" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.reasoning_content).toBe("think");
    expect(parsed.choices[0].message.content).toBe("text");
    expect(parsed.choices[0].message.tool_calls).toHaveLength(1);
  });

  it("returns empty string for empty blocks", () => {
    const result = serializeBlocksForStorage([], apiType);
    expect(result).toBe("");
  });

  it("serializes only tool_use blocks without extra fields", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_use", content: "{}", name: "fn1" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    const message = parsed.choices[0].message;
    expect(message.tool_calls).toHaveLength(1);
    expect(message.content).toBeUndefined();
    expect(message.reasoning_content).toBeUndefined();
  });

  it("uses empty name for tool_use when name is empty string", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_use", content: "{}", name: "" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.tool_calls[0].function.name).toBe("");
  });
});
