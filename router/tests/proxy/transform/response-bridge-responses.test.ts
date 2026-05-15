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
  const result = responsesToChatResponse(JSON.parse(RESP_TEXT) as Record<string, unknown>);
  expect(result.object).toBe("chat.completion");
  expect(result.id).toMatch(/^chatcmpl-/);
  expect(result.model).toBe("gpt-4o");
  expect(result.created).toBeTypeOf("number");
  const choices = result.choices as Array<Record<string, unknown>>;
  expect(choices).toHaveLength(1);
  const msg = (choices[0] as Record<string, unknown>).message as Record<string, unknown>;
  expect(msg.role).toBe("assistant");
  expect(msg.content).toBe("Hello, world!");
  expect((choices[0] as Record<string, unknown>).finish_reason).toBe("stop");
  });

  it("converts function_call output to tool_calls", () => {
  const result = responsesToChatResponse(JSON.parse(RESP_FUNCTION_CALL) as Record<string, unknown>);
  const choices = result.choices as Array<Record<string, unknown>>;
  const msg = (choices[0] as Record<string, unknown>).message as Record<string, unknown>;
  const toolCalls = msg.tool_calls as Array<Record<string, unknown>>;
  expect(toolCalls).toHaveLength(1);
  expect(toolCalls[0]).toEqual({
    id: "call_abc",
    type: "function",
    function: { name: "get_weather", arguments: '{"city":"NYC"}' },
  });
  expect((choices[0] as Record<string, unknown>).finish_reason).toBe("tool_calls");
  });

  it("converts reasoning output to reasoning_content (flattened)", () => {
  const result = responsesToChatResponse(JSON.parse(RESP_REASONING) as Record<string, unknown>);
  const choices = result.choices as Array<Record<string, unknown>>;
  const msg = (choices[0] as Record<string, unknown>).message as Record<string, unknown>;
  // Structured summaries are LOSSY joined into a single string
  expect(msg.reasoning_content).toBe("Step 1: Analyze the problem.");
  expect(msg.content).toBe("The answer is 42.");
  });

  it("maps status completed → stop", () => {
  const result = responsesToChatResponse(JSON.parse(RESP_TEXT) as Record<string, unknown>);
  const choices = result.choices as Array<Record<string, unknown>>;
  expect((choices[0] as Record<string, unknown>).finish_reason).toBe("stop");
  });

  it("maps status incomplete → length", () => {
  const result = responsesToChatResponse(JSON.parse(RESP_INCOMPLETE) as Record<string, unknown>);
  const choices = result.choices as Array<Record<string, unknown>>;
  expect((choices[0] as Record<string, unknown>).finish_reason).toBe("length");
  });

  it("overrides finish_reason to tool_calls when function_call present", () => {
  // Even if status were incomplete, function_call forces tool_calls
  const result = responsesToChatResponse(JSON.parse(RESP_FUNCTION_CALL) as Record<string, unknown>);
  const choices = result.choices as Array<Record<string, unknown>>;
  expect((choices[0] as Record<string, unknown>).finish_reason).toBe("tool_calls");
  });

  it("skips non-convertible output types (web_search_call)", () => {
  const result = responsesToChatResponse(JSON.parse(RESP_WITH_SKIP_ITEMS) as Record<string, unknown>);
  const choices = result.choices as Array<Record<string, unknown>>;
  const msg = (choices[0] as Record<string, unknown>).message as Record<string, unknown>;
  expect(msg.content).toBe("Search result.");
  });

  it("maps usage correctly", () => {
  const result = responsesToChatResponse(JSON.parse(RESP_TEXT) as Record<string, unknown>);
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
  const result = chatToResponsesResponse(JSON.parse(CHAT_TEXT) as Record<string, unknown>);
  expect(result.object).toBe("response");
  expect(result.id).toMatch(/^resp_/);
  expect(result.model).toBe("gpt-4o");
  expect(result.status).toBe("completed");
  const output = result.output as Array<Record<string, unknown>>;
  expect(output).toHaveLength(1);
  expect(output[0].type).toBe("message");
  expect(output[0].role).toBe("assistant");
  expect(output[0].content).toEqual([{ type: "output_text", text: "Hello from Chat!" }]);
  });

  it("converts Chat tool_calls to Responses function_call items", () => {
  const result = chatToResponsesResponse(JSON.parse(CHAT_TOOL_CALLS) as Record<string, unknown>);
  const output = result.output as Array<Record<string, unknown>>;
  const fc = output.find((o: Record<string, unknown>) => o.type === "function_call") as Record<string, unknown>;
  expect(fc).toBeDefined();
  expect(fc.call_id).toBe("call_abc");
  expect(fc.id).toBe("call_abc");
  expect(fc.name).toBe("get_weather");
  expect(fc.arguments).toBe('{"city":"NYC"}');
  expect(result.status).toBe("completed");
  });

  it("converts Chat reasoning_content to Responses reasoning output", () => {
  const result = chatToResponsesResponse(JSON.parse(CHAT_REASONING) as Record<string, unknown>);
  const output = result.output as Array<Record<string, unknown>>;
  const reasoning = output.find((o: Record<string, unknown>) => o.type === "reasoning") as Record<string, unknown>;
  expect(reasoning).toBeDefined();
  expect(reasoning.summary).toEqual([{ type: "summary_text", text: "Let me think about this step by step..." }]);

  const message = output.find((o: Record<string, unknown>) => o.type === "message") as Record<string, unknown>;
  expect(message).toBeDefined();
  expect(message.content).toEqual([{ type: "output_text", text: "The answer is 42." }]);
  });

  it("maps finish_reason stop → completed", () => {
  const result = chatToResponsesResponse(JSON.parse(CHAT_TEXT) as Record<string, unknown>);
  expect(result.status).toBe("completed");
  });

  it("maps finish_reason length → incomplete", () => {
  const result = chatToResponsesResponse(JSON.parse(CHAT_LENGTH) as Record<string, unknown>);
  expect(result.status).toBe("incomplete");
  });

  it("maps finish_reason tool_calls → completed", () => {
  const result = chatToResponsesResponse(JSON.parse(CHAT_TOOL_CALLS) as Record<string, unknown>);
  expect(result.status).toBe("completed");
  });

  it("maps usage correctly", () => {
  const result = chatToResponsesResponse(JSON.parse(CHAT_TEXT) as Record<string, unknown>);
  expect(result.usage).toEqual({
    input_tokens: 15,
    output_tokens: 8,
    total_tokens: 23,
  });
  });

  it("handles multiple tool_calls", () => {
  const multiToolChat = {
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
  } as Record<string, unknown>;

  const result = chatToResponsesResponse(multiToolChat);
  const output = result.output as Array<Record<string, unknown>>;
  const fcItems = output.filter((o: Record<string, unknown>) => o.type === "function_call");
  expect(fcItems).toHaveLength(2);
  expect((fcItems[0] as Record<string, unknown>).name).toBe("fn1");
  expect((fcItems[1] as Record<string, unknown>).name).toBe("fn2");
  });
});
