import { describe, it, expect } from "vitest";
import {
  responsesToAnthropicResponse,
  anthropicToResponsesResponse,
} from "../../../src/proxy/transform/response-transform-responses.js";

// ---------- Fixtures: Responses API responses ----------

const RESP_TEXT = JSON.stringify({
  id: "resp_abc123",
  object: "response",
  model: "gpt-4o",
  status: "completed",
  output: [
    {
      type: "message",
      id: "msg_001",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello, world!" }],
    },
  ],
  usage: { input_tokens: 15, output_tokens: 8, total_tokens: 23 },
});

const RESP_FUNCTION_CALL = JSON.stringify({
  id: "resp_def456",
  object: "response",
  model: "gpt-4o",
  status: "completed",
  output: [
    {
      type: "function_call",
      id: "fc_001",
      call_id: "call_abc",
      name: "get_weather",
      arguments: '{"city":"NYC"}',
    },
  ],
  usage: { input_tokens: 20, output_tokens: 12, total_tokens: 32 },
});

const RESP_REASONING = JSON.stringify({
  id: "resp_ghi789",
  object: "response",
  model: "o3",
  status: "completed",
  output: [
    {
      type: "reasoning",
      id: "rs_001",
      summary: [
        { type: "summary_text", text: "Step 1: " },
        { type: "summary_text", text: "Analyze the problem." },
      ],
    },
    {
      type: "message",
      id: "msg_002",
      role: "assistant",
      content: [{ type: "output_text", text: "The answer is 42." }],
    },
  ],
  usage: { input_tokens: 30, output_tokens: 50, total_tokens: 80 },
});

const RESP_INCOMPLETE = JSON.stringify({
  id: "resp_inc",
  object: "response",
  model: "gpt-4o",
  status: "incomplete",
  output: [
    {
      type: "message",
      id: "msg_003",
      role: "assistant",
      content: [{ type: "output_text", text: "Partial..." }],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
});

const RESP_FAILED = JSON.stringify({
  id: "resp_fail",
  object: "response",
  model: "gpt-4o",
  status: "failed",
  output: [],
  usage: { input_tokens: 5, output_tokens: 0, total_tokens: 5 },
});

const RESP_WITH_SKIP_ITEMS = JSON.stringify({
  id: "resp_skip",
  object: "response",
  model: "gpt-4o",
  status: "completed",
  output: [
    { type: "web_search_call", id: "ws_001", status: "completed" },
    {
      type: "message",
      id: "msg_004",
      role: "assistant",
      content: [{ type: "output_text", text: "Search result." }],
    },
  ],
  usage: { input_tokens: 25, output_tokens: 10, total_tokens: 35 },
});

// ---------- Fixtures: Anthropic Messages responses ----------

const ANT_TEXT = JSON.stringify({
  id: "msg_ant1",
  type: "message",
  role: "assistant",
  model: "claude-3",
  content: [{ type: "text", text: "Hello from Claude!" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 15, output_tokens: 8 },
});

const ANT_TOOL_USE = JSON.stringify({
  id: "msg_ant2",
  type: "message",
  role: "assistant",
  model: "claude-3",
  content: [
    { type: "tool_use", id: "toolu_call_xyz", name: "get_weather", input: { city: "NYC" } },
  ],
  stop_reason: "tool_use",
  usage: { input_tokens: 20, output_tokens: 12 },
});

const ANT_THINKING = JSON.stringify({
  id: "msg_ant3",
  type: "message",
  role: "assistant",
  model: "claude-3",
  content: [
    { type: "thinking", thinking: "Let me reason about this..." },
    { type: "text", text: "The result." },
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 30, output_tokens: 50 },
});

const ANT_MAX_TOKENS = JSON.stringify({
  id: "msg_ant4",
  type: "message",
  role: "assistant",
  model: "claude-3",
  content: [{ type: "text", text: "Cut off..." }],
  stop_reason: "max_tokens",
  usage: { input_tokens: 10, output_tokens: 5 },
});

const ANT_WITH_CACHE = JSON.stringify({
  id: "msg_ant5",
  type: "message",
  role: "assistant",
  model: "claude-3",
  content: [{ type: "text", text: "cached" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 20 },
});

// ========== responsesToAnthropicResponse ==========

describe("responsesToAnthropicResponse", () => {
  it("converts basic text output", () => {
    const result = JSON.parse(responsesToAnthropicResponse(RESP_TEXT));
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.content).toEqual([{ type: "text", text: "Hello, world!" }]);
    expect(result.model).toBe("gpt-4o");
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage.input_tokens).toBe(15);
    expect(result.usage.output_tokens).toBe(8);
    expect(result.id).toMatch(/^msg_/);
    expect(result.stop_sequence).toBeNull();
  });

  it("converts function_call output to tool_use block", () => {
    const result = JSON.parse(responsesToAnthropicResponse(RESP_FUNCTION_CALL));
    expect(result.content).toEqual([
      { type: "tool_use", id: "toolu_call_abc", name: "get_weather", input: { city: "NYC" } },
    ]);
    expect(result.stop_reason).toBe("end_turn");
  });

  it("converts reasoning output to thinking block", () => {
    const result = JSON.parse(responsesToAnthropicResponse(RESP_REASONING));
    expect(result.content[0]).toEqual({ type: "thinking", thinking: "Step 1: Analyze the problem." });
    expect(result.content[1]).toEqual({ type: "text", text: "The answer is 42." });
  });

  it("maps status completed → end_turn", () => {
    const result = JSON.parse(responsesToAnthropicResponse(RESP_TEXT));
    expect(result.stop_reason).toBe("end_turn");
  });

  it("maps status incomplete → max_tokens", () => {
    const result = JSON.parse(responsesToAnthropicResponse(RESP_INCOMPLETE));
    expect(result.stop_reason).toBe("max_tokens");
  });

  it("maps status failed → end_turn", () => {
    const result = JSON.parse(responsesToAnthropicResponse(RESP_FAILED));
    expect(result.stop_reason).toBe("end_turn");
  });

  it("adds empty text block when no content produced", () => {
    const result = JSON.parse(responsesToAnthropicResponse(RESP_FAILED));
    expect(result.content).toEqual([{ type: "text", text: "" }]);
  });

  it("skips non-convertible output types (web_search_call, etc.)", () => {
    const result = JSON.parse(responsesToAnthropicResponse(RESP_WITH_SKIP_ITEMS));
    expect(result.content).toEqual([{ type: "text", text: "Search result." }]);
  });

  it("maps usage correctly", () => {
    const result = JSON.parse(responsesToAnthropicResponse(RESP_TEXT));
    expect(result.usage).toEqual({ input_tokens: 15, output_tokens: 8 });
  });
});

// ========== anthropicToResponsesResponse ==========

describe("anthropicToResponsesResponse", () => {
  it("converts basic Anthropic text to Responses output message", () => {
    const result = JSON.parse(anthropicToResponsesResponse(ANT_TEXT));
    expect(result.object).toBe("response");
    expect(result.model).toBe("claude-3");
    expect(result.status).toBe("completed");
    expect(result.id).toMatch(/^resp_/);
    expect(result.output).toHaveLength(1);
    expect(result.output[0].type).toBe("message");
    expect(result.output[0].role).toBe("assistant");
    expect(result.output[0].content).toEqual([{ type: "output_text", text: "Hello from Claude!" }]);
  });

  it("converts Anthropic tool_use to Responses function_call", () => {
    const result = JSON.parse(anthropicToResponsesResponse(ANT_TOOL_USE));
    expect(result.output).toHaveLength(1);
    const fc = result.output[0];
    expect(fc.type).toBe("function_call");
    expect(fc.call_id).toBe("call_xyz");
    expect(fc.id).toBe("fc_call_xyz");
    expect(fc.name).toBe("get_weather");
    expect(JSON.parse(fc.arguments)).toEqual({ city: "NYC" });
    expect(result.status).toBe("completed");
  });

  it("converts Anthropic thinking to Responses reasoning", () => {
    const result = JSON.parse(anthropicToResponsesResponse(ANT_THINKING));
    expect(result.output).toHaveLength(2);
    const reasoning = result.output[0];
    expect(reasoning.type).toBe("reasoning");
    expect(reasoning.id).toMatch(/^rs_/);
    expect(reasoning.summary).toEqual([{ type: "summary_text", text: "Let me reason about this..." }]);
    const message = result.output[1];
    expect(message.type).toBe("message");
    expect(message.content).toEqual([{ type: "output_text", text: "The result." }]);
  });

  it("maps stop_reason end_turn → completed", () => {
    const result = JSON.parse(anthropicToResponsesResponse(ANT_TEXT));
    expect(result.status).toBe("completed");
  });

  it("maps stop_reason tool_use → completed", () => {
    const result = JSON.parse(anthropicToResponsesResponse(ANT_TOOL_USE));
    expect(result.status).toBe("completed");
  });

  it("maps stop_reason max_tokens → incomplete", () => {
    const result = JSON.parse(anthropicToResponsesResponse(ANT_MAX_TOKENS));
    expect(result.status).toBe("incomplete");
  });

  it("remaps usage with cache tokens included in input_tokens", () => {
    const result = JSON.parse(anthropicToResponsesResponse(ANT_WITH_CACHE));
    // input_tokens = 100 + 50 (cache_read) + 20 (cache_creation) = 170
    expect(result.usage.input_tokens).toBe(170);
    expect(result.usage.output_tokens).toBe(10);
    expect(result.usage.total_tokens).toBe(180);
  });

  it("handles usage without cache fields", () => {
    const result = JSON.parse(anthropicToResponsesResponse(ANT_TEXT));
    expect(result.usage.input_tokens).toBe(15);
    expect(result.usage.output_tokens).toBe(8);
    expect(result.usage.total_tokens).toBe(23);
  });
});
