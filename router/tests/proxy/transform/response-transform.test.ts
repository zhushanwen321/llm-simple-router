import { describe, it, expect } from "vitest";
import {
  openaiResponseToAnthropic,
  anthropicResponseToOpenAI,
  transformResponseBody,
  transformErrorResponse,
} from "../../../src/proxy/transform/response-transform.js";

const OA_SUCCESS = JSON.stringify({
  id: "chatcmpl-1", model: "gpt-4",
  choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

const OA_TOOL_CALL = JSON.stringify({
  id: "chatcmpl-2", model: "gpt-4",
  choices: [{
    index: 0,
    message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"NYC\"}" } }] },
    finish_reason: "tool_calls",
  }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
});

const OA_REASONING = JSON.stringify({
  id: "chatcmpl-3", model: "o1",
  choices: [{
    index: 0,
    message: { role: "assistant", content: "The answer is 42", reasoning_content: "Let me think..." },
    finish_reason: "stop",
  }],
  usage: { prompt_tokens: 10, completion_tokens: 15 },
});

const ANT_SUCCESS = JSON.stringify({
  id: "msg_1", model: "claude-3", role: "assistant",
  content: [{ type: "text", text: "Hello" }],
  stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 },
});

const ANT_TOOL_USE = JSON.stringify({
  id: "msg_2", model: "claude-3", role: "assistant",
  content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "NYC" } }],
  stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 20 },
});

const ANT_THINKING = JSON.stringify({
  id: "msg_3", model: "claude-3", role: "assistant",
  content: [
    { type: "thinking", thinking: "Let me think..." },
    { type: "text", text: "The answer is 42" },
  ],
  stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 15 },
});

describe("openaiResponseToAnthropic", () => {
  it("converts basic text response", () => {
  const result = openaiResponseToAnthropic(JSON.parse(OA_SUCCESS));
  expect(result.type).toBe("message");
  expect(result.role).toBe("assistant");
  expect(result.content).toEqual([{ type: "text", text: "Hello" }]);
  expect(result.stop_reason).toBe("end_turn");
  expect((result.usage as Record<string, unknown>).input_tokens).toBe(10);
  expect((result.usage as Record<string, unknown>).output_tokens).toBe(5);
  });

  it("converts tool_calls response", () => {
  const result = openaiResponseToAnthropic(JSON.parse(OA_TOOL_CALL));
  expect((result.content as Array<Record<string, unknown>>)[0].type).toBe("tool_use");
  expect((result.content as Array<Record<string, unknown>>)[0].id).toBe("call_1");
  expect((result.content as Array<Record<string, unknown>>)[0].input).toEqual({ city: "NYC" });
  expect(result.stop_reason).toBe("tool_use");
  });

  it("converts reasoning_content to thinking block", () => {
  const result = openaiResponseToAnthropic(JSON.parse(OA_REASONING));
  expect((result.content as Array<Record<string, unknown>>)[0]).toEqual({ type: "thinking", thinking: "Let me think..." });
  expect((result.content as Array<Record<string, unknown>>)[1]).toEqual({ type: "text", text: "The answer is 42" });
  });

  it("generates msg_ prefix id", () => {
  const result = openaiResponseToAnthropic(JSON.parse(OA_SUCCESS));
  expect(result.id).toMatch(/^msg_/);
  });
});

describe("anthropicResponseToOpenAI", () => {
  it("converts basic text response", () => {
  const result = anthropicResponseToOpenAI(JSON.parse(ANT_SUCCESS));
  expect(result.object).toBe("chat.completion");
  const choices = result.choices as Array<Record<string, unknown>>;
  const msg = (choices[0] as Record<string, unknown>).message as Record<string, unknown>;
  expect(msg.content).toBe("Hello");
  expect((choices[0] as Record<string, unknown>).finish_reason).toBe("stop");
  const usage = result.usage as Record<string, unknown>;
  expect(usage.prompt_tokens).toBe(10);
  expect(usage.completion_tokens).toBe(5);
  });

  it("converts tool_use to tool_calls", () => {
  const result = anthropicResponseToOpenAI(JSON.parse(ANT_TOOL_USE));
  const choices = result.choices as Array<Record<string, unknown>>;
  const msg = (choices[0] as Record<string, unknown>).message as Record<string, unknown>;
  const tc = (msg.tool_calls as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
  expect(tc.id).toBe("toolu_1");
  const fn = tc.function as Record<string, unknown>;
  expect(fn.name).toBe("get_weather");
  expect(JSON.parse(fn.arguments as string)).toEqual({ city: "NYC" });
  expect((choices[0] as Record<string, unknown>).finish_reason).toBe("tool_calls");
  });

  it("converts thinking to reasoning_content", () => {
  const result = anthropicResponseToOpenAI(JSON.parse(ANT_THINKING));
  const choices = result.choices as Array<Record<string, unknown>>;
  const msg = (choices[0] as Record<string, unknown>).message as Record<string, unknown>;
  expect(msg.reasoning_content).toBe("Let me think...");
  expect(msg.content).toBe("The answer is 42");
  });

  it("preserves thinking signature in provider_meta", () => {
  const antWithSig = {
    id: "msg_sig", model: "claude-3", role: "assistant",
    content: [
    { type: "thinking", thinking: "hmm", signature: "sig_abc" },
    { type: "text", text: "answer" },
    ],
    stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 },
  };
  const result = anthropicResponseToOpenAI(antWithSig as Record<string, unknown>);
  const meta = (result.provider_meta as Record<string, unknown>).anthropic as Record<string, unknown>;
  expect(meta.thinking_signatures).toEqual([
    { index: 0, signature: "sig_abc" },
  ]);
  });

  it("preserves cache usage in provider_meta", () => {
  const antWithCache = {
    id: "msg_cache", model: "claude-3", role: "assistant",
    content: [{ type: "text", text: "hi" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
  };
  const result = anthropicResponseToOpenAI(antWithCache as Record<string, unknown>);
  const meta = (result.provider_meta as Record<string, unknown>).anthropic as Record<string, unknown>;
  expect(meta.cache_usage).toEqual({
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 50,
  });
  });

  it("no provider_meta when no PSF present", () => {
  const result = anthropicResponseToOpenAI(JSON.parse(ANT_SUCCESS));
  expect(result.provider_meta).toBeUndefined();
  });
});

describe("transformResponseBody", () => {
  it("returns body unchanged when same apiType", () => {
  const body = { choices: [] } as Record<string, unknown>;
  expect(transformResponseBody(body, "openai", "openai")).toBe(body);
  });

  it("transforms OA→Ant", () => {
  const result = transformResponseBody(JSON.parse(OA_SUCCESS) as Record<string, unknown>, "openai", "anthropic");
  expect(result.type).toBe("message");
  });

  it("transforms Ant→OA", () => {
  const result = transformResponseBody(JSON.parse(ANT_SUCCESS) as Record<string, unknown>, "anthropic", "openai");
  expect(result.object).toBe("chat.completion");
  });
});

describe("transformErrorResponse", () => {
  it("converts Anthropic error to OpenAI format", () => {
  const antError = { type: "error", error: { type: "invalid_request_error", message: "Bad request" } } as Record<string, unknown>;
  const result = JSON.parse(transformErrorResponse(antError, "anthropic", "openai"));
  expect(result.error.message).toBe("Bad request");
  expect(result.error.type).toBe("invalid_request_error");
  expect(result.error.code).toBe("upstream_error");
  });

  it("converts OpenAI error to Anthropic format", () => {
  const oaiError = { error: { message: "Rate limited", type: "rate_limit_error", code: "rate_limit_exceeded" } } as Record<string, unknown>;
  const result = JSON.parse(transformErrorResponse(oaiError, "openai", "anthropic"));
  expect(result.type).toBe("error");
  expect(result.error.message).toBe("Rate limited");
  expect(result.error.type).toBe("rate_limit_error");
  });

  it("returns body unchanged when same apiType", () => {
  const body = { error: { message: "x" } } as Record<string, unknown>;
  expect(transformErrorResponse(body, "openai", "openai")).toBe(JSON.stringify(body));
  });
});

