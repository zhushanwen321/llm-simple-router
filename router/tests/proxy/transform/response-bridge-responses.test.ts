import { describe, it, expect } from "vitest";
import {
  responsesToChatResponse,
  chatToResponsesResponse,
} from "../../../src/proxy/transform/response-bridge-responses.js";

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

// ---------- Fixtures: Chat Completions responses ----------

const CHAT_TEXT = JSON.stringify({
  id: "chatcmpl-abc123",
  object: "chat.completion",
  created: 1700000000,
  model: "gpt-4o",
  choices: [{
    index: 0,
    message: { role: "assistant", content: "Hello from Chat!" },
    finish_reason: "stop",
  }],
  usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
});

const CHAT_TOOL_CALLS = JSON.stringify({
  id: "chatcmpl-def456",
  object: "chat.completion",
  created: 1700000000,
  model: "gpt-4o",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call_abc",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"NYC"}' },
      }],
    },
    finish_reason: "tool_calls",
  }],
  usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 },
});

const CHAT_REASONING = JSON.stringify({
  id: "chatcmpl-ghi789",
  object: "chat.completion",
  created: 1700000000,
  model: "o3",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      reasoning_content: "Let me think about this step by step...",
      content: "The answer is 42.",
    },
    finish_reason: "stop",
  }],
  usage: { prompt_tokens: 30, completion_tokens: 50, total_tokens: 80 },
});

const CHAT_LENGTH = JSON.stringify({
  id: "chatcmpl-length",
  object: "chat.completion",
  created: 1700000000,
  model: "gpt-4o",
  choices: [{
    index: 0,
    message: { role: "assistant", content: "Cut off..." },
    finish_reason: "length",
  }],
  usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
});

// ========== responsesToChatResponse ==========

describe("responsesToChatResponse", () => {
  it("converts basic text output", () => {
    const result = JSON.parse(responsesToChatResponse(RESP_TEXT));
    expect(result.object).toBe("chat.completion");
    expect(result.id).toMatch(/^chatcmpl-/);
    expect(result.model).toBe("gpt-4o");
    expect(result.created).toBeTypeOf("number");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.role).toBe("assistant");
    expect(result.choices[0].message.content).toBe("Hello, world!");
    expect(result.choices[0].finish_reason).toBe("stop");
  });

  it("converts function_call output to tool_calls", () => {
    const result = JSON.parse(responsesToChatResponse(RESP_FUNCTION_CALL));
    const msg = result.choices[0].message;
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls[0]).toEqual({
      id: "fc_001",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"NYC"}' },
    });
    expect(result.choices[0].finish_reason).toBe("tool_calls");
  });

  it("converts reasoning output to reasoning_content (flattened)", () => {
    const result = JSON.parse(responsesToChatResponse(RESP_REASONING));
    const msg = result.choices[0].message;
    // Structured summaries are LOSSY joined into a single string
    expect(msg.reasoning_content).toBe("Step 1: Analyze the problem.");
    expect(msg.content).toBe("The answer is 42.");
  });

  it("maps status completed → stop", () => {
    const result = JSON.parse(responsesToChatResponse(RESP_TEXT));
    expect(result.choices[0].finish_reason).toBe("stop");
  });

  it("maps status incomplete → length", () => {
    const result = JSON.parse(responsesToChatResponse(RESP_INCOMPLETE));
    expect(result.choices[0].finish_reason).toBe("length");
  });

  it("overrides finish_reason to tool_calls when function_call present", () => {
    // Even if status were incomplete, function_call forces tool_calls
    const result = JSON.parse(responsesToChatResponse(RESP_FUNCTION_CALL));
    expect(result.choices[0].finish_reason).toBe("tool_calls");
  });

  it("skips non-convertible output types (web_search_call)", () => {
    const result = JSON.parse(responsesToChatResponse(RESP_WITH_SKIP_ITEMS));
    expect(result.choices[0].message.content).toBe("Search result.");
  });

  it("maps usage correctly", () => {
    const result = JSON.parse(responsesToChatResponse(RESP_TEXT));
    expect(result.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 8,
      total_tokens: 23,
    });
  });
});

// ========== chatToResponsesResponse ==========

describe("chatToResponsesResponse", () => {
  it("converts basic Chat text to Responses output message", () => {
    const result = JSON.parse(chatToResponsesResponse(CHAT_TEXT));
    expect(result.object).toBe("response");
    expect(result.id).toMatch(/^resp_/);
    expect(result.model).toBe("gpt-4o");
    expect(result.status).toBe("completed");
    expect(result.output).toHaveLength(1);
    expect(result.output[0].type).toBe("message");
    expect(result.output[0].role).toBe("assistant");
    expect(result.output[0].content).toEqual([{ type: "output_text", text: "Hello from Chat!" }]);
  });

  it("converts Chat tool_calls to Responses function_call items", () => {
    const result = JSON.parse(chatToResponsesResponse(CHAT_TOOL_CALLS));
    const fc = result.output.find((o: Record<string, unknown>) => o.type === "function_call");
    expect(fc).toBeDefined();
    expect(fc.call_id).toBe("call_abc");
    expect(fc.id).toBe("call_abc");
    expect(fc.name).toBe("get_weather");
    expect(fc.arguments).toBe('{"city":"NYC"}');
    expect(result.status).toBe("completed");
  });

  it("converts Chat reasoning_content to Responses reasoning output", () => {
    const result = JSON.parse(chatToResponsesResponse(CHAT_REASONING));
    const reasoning = result.output.find((o: Record<string, unknown>) => o.type === "reasoning");
    expect(reasoning).toBeDefined();
    expect(reasoning.summary).toEqual([{ type: "summary_text", text: "Let me think about this step by step..." }]);

    const message = result.output.find((o: Record<string, unknown>) => o.type === "message");
    expect(message).toBeDefined();
    expect(message.content).toEqual([{ type: "output_text", text: "The answer is 42." }]);
  });

  it("maps finish_reason stop → completed", () => {
    const result = JSON.parse(chatToResponsesResponse(CHAT_TEXT));
    expect(result.status).toBe("completed");
  });

  it("maps finish_reason length → incomplete", () => {
    const result = JSON.parse(chatToResponsesResponse(CHAT_LENGTH));
    expect(result.status).toBe("incomplete");
  });

  it("maps finish_reason tool_calls → completed", () => {
    const result = JSON.parse(chatToResponsesResponse(CHAT_TOOL_CALLS));
    expect(result.status).toBe("completed");
  });

  it("maps usage correctly", () => {
    const result = JSON.parse(chatToResponsesResponse(CHAT_TEXT));
    expect(result.usage).toEqual({
      input_tokens: 15,
      output_tokens: 8,
      total_tokens: 23,
    });
  });

  it("handles multiple tool_calls", () => {
    const multiToolChat = JSON.stringify({
      id: "chatcmpl-multi",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "fn1", arguments: "{}" } },
            { id: "call_2", type: "function", function: { name: "fn2", arguments: '{"a":1}' } },
          ],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const result = JSON.parse(chatToResponsesResponse(multiToolChat));
    const fcItems = result.output.filter((o: Record<string, unknown>) => o.type === "function_call");
    expect(fcItems).toHaveLength(2);
    expect(fcItems[0].name).toBe("fn1");
    expect(fcItems[1].name).toBe("fn2");
  });
});
