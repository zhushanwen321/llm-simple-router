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
    const result = JSON.parse(openaiResponseToAnthropic(OA_SUCCESS));
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(5);
  });

  it("converts tool_calls response", () => {
    const result = JSON.parse(openaiResponseToAnthropic(OA_TOOL_CALL));
    expect(result.content[0].type).toBe("tool_use");
    expect(result.content[0].id).toBe("call_1");
    expect(result.content[0].input).toEqual({ city: "NYC" });
    expect(result.stop_reason).toBe("tool_use");
  });

  it("converts reasoning_content to thinking block", () => {
    const result = JSON.parse(openaiResponseToAnthropic(OA_REASONING));
    expect(result.content[0]).toEqual({ type: "thinking", thinking: "Let me think..." });
    expect(result.content[1]).toEqual({ type: "text", text: "The answer is 42" });
  });

  it("generates msg_ prefix id", () => {
    const result = JSON.parse(openaiResponseToAnthropic(OA_SUCCESS));
    expect(result.id).toMatch(/^msg_/);
  });
});

describe("anthropicResponseToOpenAI", () => {
  it("converts basic text response", () => {
    const result = JSON.parse(anthropicResponseToOpenAI(ANT_SUCCESS));
    expect(result.object).toBe("chat.completion");
    expect(result.choices[0].message.content).toBe("Hello");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(5);
  });

  it("converts tool_use to tool_calls", () => {
    const result = JSON.parse(anthropicResponseToOpenAI(ANT_TOOL_USE));
    const tc = result.choices[0].message.tool_calls[0];
    expect(tc.id).toBe("toolu_1");
    expect(tc.function.name).toBe("get_weather");
    expect(JSON.parse(tc.function.arguments)).toEqual({ city: "NYC" });
    expect(result.choices[0].finish_reason).toBe("tool_calls");
  });

  it("converts thinking to reasoning_content", () => {
    const result = JSON.parse(anthropicResponseToOpenAI(ANT_THINKING));
    expect(result.choices[0].message.reasoning_content).toBe("Let me think...");
    expect(result.choices[0].message.content).toBe("The answer is 42");
  });

  it("preserves thinking signature in provider_meta", () => {
    const antWithSig = JSON.stringify({
      id: "msg_sig", model: "claude-3", role: "assistant",
      content: [
        { type: "thinking", thinking: "hmm", signature: "sig_abc" },
        { type: "text", text: "answer" },
      ],
      stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 },
    });
    const result = JSON.parse(anthropicResponseToOpenAI(antWithSig));
    expect(result.provider_meta.anthropic.thinking_signatures).toEqual([
      { index: 0, signature: "sig_abc" },
    ]);
  });

  it("preserves cache usage in provider_meta", () => {
    const antWithCache = JSON.stringify({
      id: "msg_cache", model: "claude-3", role: "assistant",
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
    });
    const result = JSON.parse(anthropicResponseToOpenAI(antWithCache));
    expect(result.provider_meta.anthropic.cache_usage).toEqual({
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 50,
    });
  });

  it("no provider_meta when no PSF present", () => {
    const result = JSON.parse(anthropicResponseToOpenAI(ANT_SUCCESS));
    expect(result.provider_meta).toBeUndefined();
  });
});

describe("transformResponseBody", () => {
  it("returns body unchanged when same apiType", () => {
    const body = '{"choices":[]}';
    expect(transformResponseBody(body, "openai", "openai")).toBe(body);
  });

  it("transforms OA→Ant", () => {
    const result = JSON.parse(transformResponseBody(OA_SUCCESS, "openai", "anthropic"));
    expect(result.type).toBe("message");
  });

  it("transforms Ant→OA", () => {
    const result = JSON.parse(transformResponseBody(ANT_SUCCESS, "anthropic", "openai"));
    expect(result.object).toBe("chat.completion");
  });
});

describe("transformErrorResponse", () => {
  it("converts Anthropic error to OpenAI format", () => {
    const antError = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Bad request" } });
    const result = JSON.parse(transformErrorResponse(antError, "anthropic", "openai"));
    expect(result.error.message).toBe("Bad request");
    expect(result.error.type).toBe("invalid_request_error");
    expect(result.error.code).toBe("upstream_error");
  });

  it("converts OpenAI error to Anthropic format", () => {
    const oaiError = JSON.stringify({ error: { message: "Rate limited", type: "rate_limit_error", code: "rate_limit_exceeded" } });
    const result = JSON.parse(transformErrorResponse(oaiError, "openai", "anthropic"));
    expect(result.type).toBe("error");
    expect(result.error.message).toBe("Rate limited");
    expect(result.error.type).toBe("rate_limit_error");
  });

  it("returns body unchanged when same apiType", () => {
    const body = '{"error":{"message":"x"}}';
    expect(transformErrorResponse(body, "openai", "openai")).toBe(body);
  });
});

