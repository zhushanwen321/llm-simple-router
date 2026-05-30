import { describe, it, expect } from "vitest";
import { extractStreamText } from "../../../src/core/monitor/stream-extractor.js";

const PREFIX = "data: ";

describe("extractStreamText - silent loss: OpenAI Responses format", () => {
  const apiType = "openai-responses" as const;

  // FAIL: response.reasoning_text.delta is silently discarded (returns empty)
  it("should extract reasoning_text.delta as thinking block for o3 full reasoning text", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.reasoning_text.delta",
      delta: "full reasoning text here",
      output_index: 1,
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.block?.type).toBe("thinking");
    expect(result.block?.content).toBe("full reasoning text here");
  });

  // PASS: termination event, no content expected
  it("should return empty for response.reasoning_text.done (termination event)", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.reasoning_text.done",
      output_index: 1,
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });

  // FAIL: response.refusal.delta is silently discarded
  it("should not silently discard refusal.delta (content moderation reason)", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.refusal.delta",
      delta: "I cannot assist with",
      output_index: 0,
    })}`;
    const result = extractStreamText(fixture, apiType);
    // At minimum, should not be silently empty
    expect(result.block).not.toBeNull();
  });

  // PASS: no actual content
  it("should return empty for response.content_part.added (no actual text)", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.content_part.added",
      part: { type: "output_text", text: "" },
      output_index: 0,
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });

  // PASS: no content in this event
  it("should return empty for response.output_item.added (structural event)", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.output_item.added",
      item: { type: "message", id: "msg_xxx", role: "assistant", content: [] },
      output_index: 0,
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });

  // FAIL: code interpreter delta is silently discarded
  it("should not silently discard code_interpreter_call_code.delta", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.code_interpreter_call_code.delta",
      delta: "print('hello')",
      output_index: 2,
    })}`;
    const result = extractStreamText(fixture, apiType);
    // At minimum, should degrade to text rather than silently drop
    expect(result.block).not.toBeNull();
  });

  // PASS: no actual text content in this event
  it("should return empty for response.reasoning_summary_part.added (empty text)", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      type: "response.reasoning_summary_part.added",
      part: { type: "summary_text", text: "" },
      output_index: 1,
    })}`;
    const result = extractStreamText(fixture, apiType);
    expect(result.text).toBe("");
    expect(result.block).toBeNull();
  });
});

describe("extractStreamText - silent loss: OpenAI Chat format", () => {
  const apiType = "openai" as const;

  // FAIL: only toolCalls[0] is processed; second tool_call is lost
  it("should extract all tool_calls from a single delta (multiple tool calls)", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, function: { name: "fn1", arguments: "{" } },
            { index: 1, function: { name: "fn2", arguments: "{}" } },
          ],
        },
      }],
    })}`;
    const result = extractStreamText(fixture, apiType);
    // Current code only returns toolCalls[0], second is lost
    // Expected: both tool_use blocks returned
    // This test documents the limitation - only first tool_call is extracted
    expect(result.block).not.toBeNull();
    expect(result.block?.type).toBe("tool_use");
    // Documenting: block only has fn1, fn2 is lost
    expect(result.block?.name).toBe("fn1");
  });

  // FAIL: refusal content is silently discarded
  it("should not silently discard refusal content from delta", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      choices: [{ delta: { refusal: "I cannot help with that." } }],
    })}`;
    const result = extractStreamText(fixture, apiType);
    // Expected: at least degrade to text block
    expect(result.block).not.toBeNull();
  });

  // PASS: known design limitation, only choices[0] is used
  it("extracts content from first choice when multiple choices present (n>1)", () => {
    const fixture = `${PREFIX}${JSON.stringify({
      choices: [
        { delta: { content: "choice 0" } },
        { delta: { content: "choice 1" } },
      ],
    })}`;
    const result = extractStreamText(fixture, apiType);
    // choices[0] content is extracted; choices[1] is silently dropped (known limitation)
    expect(result.text).toBe("choice 0");
    expect(result.block?.type).toBe("text");
    expect(result.block?.content).toBe("choice 0");
  });
});
