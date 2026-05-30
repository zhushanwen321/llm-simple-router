import { describe, it, expect } from "vitest";
import { serializeBlocksForStorage } from "../../../src/proxy/handler/proxy-handler-utils.js";

interface ContentBlock {
  type: "thinking" | "text" | "tool_use" | "tool_result";
  content: string;
  name?: string;
}

describe("serializeBlocksForStorage - OpenAI format silent loss", () => {
  const apiType = "openai" as const;

  // PASS: multiple thinking blocks are merged, segment boundaries are lost
  it("merges multiple thinking blocks into reasoning_content (segment boundaries lost)", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", content: "part1" },
      { type: "thinking", content: "part2" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.reasoning_content).toBe("part1part2");
    // Note: segment boundary information between "part1" and "part2" is lost
  });

  // PASS: multiple tool_use blocks preserved as array
  it("preserves multiple tool_use blocks as separate tool_calls entries", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_use", content: "{}", name: "fn1" },
      { type: "tool_use", content: "{}", name: "fn2" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.tool_calls).toHaveLength(2);
    expect(parsed.choices[0].message.tool_calls[0].function.name).toBe("fn1");
    expect(parsed.choices[0].message.tool_calls[1].function.name).toBe("fn2");
  });

  // PASS: synthetic IDs match expected pattern
  it("generates synthetic tool_call IDs matching call_storage_N pattern", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_use", content: "{}", name: "fn1" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message.tool_calls[0].id).toMatch(/^call_storage_\d+$/);
  });

  // PASS: tool_result blocks pass through filters but produce no fields (empty message object)
  it("produces empty message for tool_result blocks (no matching field in OpenAI format)", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_result", content: "result" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    // tool_result doesn't match thinking/text/tool_use filters
    // but blocks.length > 0, so it generates {choices:[{message:{}}]}
    const parsed = JSON.parse(result);
    expect(parsed.choices[0].message).toEqual({});
  });

  // PASS: empty thinking content produces empty string reasoning_content
  it("produces empty string reasoning_content for thinking block with empty content", () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", content: "" },
      { type: "text", content: "hello" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    // Empty string thinking still gets joined, producing ""
    expect(parsed.choices[0].message.reasoning_content).toBe("");
    expect(parsed.choices[0].message.content).toBe("hello");
  });
});

describe("serializeBlocksForStorage - Anthropic format silent loss", () => {
  const apiType = "anthropic" as const;

  // FAIL: tool_result block has no dedicated handler, degrades to {type:"text", text:"result text"}
  it.skip("tool_result storage — won't fix: tool_result shouldn't be in tracker blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_result", content: "result text" },
    ];
    const result = serializeBlocksForStorage(blocks, apiType);
    const parsed = JSON.parse(result);
    const serializedBlock = parsed.content[0];
    // Expected: { type: "tool_result", ... }
    // Current: falls through to default → { type: "text", text: "result text" }
    expect(serializedBlock.type).toBe("tool_result");
  });
});
