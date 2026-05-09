import { describe, it, expect } from "vitest";
import { FormatRegistry } from "../../../src/proxy/format/registry.js";
import { openaiAdapter } from "../../../src/proxy/format/adapters/openai.js";
import { anthropicAdapter } from "../../../src/proxy/format/adapters/anthropic.js";
import { responsesAdapter } from "../../../src/proxy/format/adapters/responses.js";
import { openaiToAnthropicConverter } from "../../../src/proxy/format/converters/openai-anthropic.js";
import { anthropicToOpenAIConverter } from "../../../src/proxy/format/converters/anthropic-openai.js";
import { responsesToAnthropicConverter } from "../../../src/proxy/format/converters/responses-anthropic.js";
import { anthropicToResponsesConverter } from "../../../src/proxy/format/converters/anthropic-responses.js";
import { openaiToResponsesConverter } from "../../../src/proxy/format/converters/openai-responses.js";
import { responsesToOpenAIConverter } from "../../../src/proxy/format/converters/responses-openai.js";

function createRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registry.registerAdapter(openaiAdapter);
  registry.registerAdapter(anthropicAdapter);
  registry.registerAdapter(responsesAdapter);
  registry.registerConverter(openaiToAnthropicConverter);
  registry.registerConverter(anthropicToOpenAIConverter);
  registry.registerConverter(responsesToAnthropicConverter);
  registry.registerConverter(anthropicToResponsesConverter);
  registry.registerConverter(openaiToResponsesConverter);
  registry.registerConverter(responsesToOpenAIConverter);
  return registry;
}

const registry = createRegistry();

describe("Responses API integration — full conversion pipeline", () => {
  it("Responses → Anthropic → Responses (round-trip preserves intent)", () => {
    const request = {
      model: "gpt-4o",
      input: [
        { type: "message", role: "user", content: "What's the weather?" },
      ],
      instructions: "You are a weather assistant.",
      tools: [
        {
          type: "function",
          name: "get_weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
      max_output_tokens: 2048,
    };

    // Responses → Anthropic
    const { body: antReq } = registry.transformRequest(
      request,
      "openai-responses",
      "anthropic",
      "gpt-4o",
    );
    expect(antReq.system).toBe("You are a weather assistant.");
    expect(antReq.messages).toBeDefined();
    expect(antReq.tools).toBeDefined();

    // Anthropic → Responses (response direction)
    const antResponse = JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "gpt-4o",
      content: [{ type: "text", text: "The weather is sunny." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 20, output_tokens: 10 },
    });
    const respResponse = registry.transformResponse(
      antResponse,
      "anthropic",
      "openai-responses",
    );
    const parsed = JSON.parse(respResponse);
    expect(parsed.object).toBe("response");
    expect(parsed.status).toBe("completed");
  });

  it("Responses → Chat (bridge) → back to Responses (round-trip)", () => {
    const request = {
      model: "gpt-4o",
      input: "Hello",
      instructions: "Be helpful",
      max_output_tokens: 1024,
    };

    // Responses → Chat
    const { body: chatReq } = registry.transformRequest(
      request,
      "openai-responses",
      "openai",
      "gpt-4o",
    );
    expect(chatReq.messages).toBeDefined();
    expect(chatReq.max_completion_tokens).toBe(1024);

    // Chat → Responses
    const { body: respReq } = registry.transformRequest(
      chatReq,
      "openai",
      "openai-responses",
      "gpt-4o",
    );
    expect(respReq.instructions).toBe("Be helpful");
    expect(respReq.max_output_tokens).toBe(1024);
  });

  it("Chat → Responses → Chat (bridge round-trip)", () => {
    const request = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Be helpful" },
        { role: "user", content: "Hello" },
      ],
      max_completion_tokens: 1024,
      temperature: 0.7,
    };

    // Chat → Responses
    const { body: respReq } = registry.transformRequest(
      request,
      "openai",
      "openai-responses",
      "gpt-4o",
    );
    expect(respReq.instructions).toBe("Be helpful");
    expect(respReq.max_output_tokens).toBe(1024);

    // Responses → Chat
    const { body: chatReq } = registry.transformRequest(
      respReq,
      "openai-responses",
      "openai",
      "gpt-4o",
    );
    expect(chatReq.messages).toBeDefined();
    expect(chatReq.max_completion_tokens).toBe(1024);
    expect(chatReq.temperature).toBe(0.7);
  });

  it("existing Anthropic ↔ Chat path still works (regression check)", () => {
    const request = {
      model: "claude",
      system: "Be helpful",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    };

    const { body: chatReq } = registry.transformRequest(
      request,
      "anthropic",
      "openai",
      "claude",
    );
    expect(chatReq.messages).toBeDefined();

    const { body: antReq } = registry.transformRequest(
      chatReq,
      "openai",
      "anthropic",
      "claude",
    );
    expect(antReq.messages).toBeDefined();
  });

  it("needsTransform returns false for same api_type", () => {
    expect(registry.needsTransform("openai", "openai")).toBe(false);
    expect(registry.needsTransform("anthropic", "anthropic")).toBe(false);
    expect(
      registry.needsTransform("openai-responses", "openai-responses"),
    ).toBe(false);
  });

  it("needsTransform returns true for different api_types", () => {
    expect(registry.needsTransform("openai", "anthropic")).toBe(true);
    expect(registry.needsTransform("openai", "openai-responses")).toBe(true);
    expect(
      registry.needsTransform("openai-responses", "anthropic"),
    ).toBe(true);
    expect(registry.needsTransform("anthropic", "openai")).toBe(true);
    expect(
      registry.needsTransform("anthropic", "openai-responses"),
    ).toBe(true);
    expect(
      registry.needsTransform("openai-responses", "openai"),
    ).toBe(true);
  });

  it("error response transforms work for all directions", () => {
    const anthropicError = JSON.stringify({
      type: "error",
      error: { type: "not_found_error", message: "Model not found" },
    });

    // Anthropic → Responses
    const r1 = registry.transformError(
      anthropicError,
      "anthropic",
      "openai-responses",
    );
    const parsed1 = JSON.parse(r1);
    expect(parsed1.error).toBeDefined();
    expect(parsed1.error.message).toContain("Model not found");

    // Anthropic → OpenAI (existing path)
    const r2 = registry.transformError(
      anthropicError,
      "anthropic",
      "openai",
    );
    const parsed2 = JSON.parse(r2);
    expect(parsed2.error).toBeDefined();
  });

  it("Responses request with function_call items converts to Anthropic tool_use", () => {
    const request = {
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "user",
          content: "What's the weather in Tokyo?",
        },
        {
          type: "function_call",
          id: "fc_001",
          call_id: "call_001",
          name: "get_weather",
          arguments: '{"city":"Tokyo"}',
        },
        {
          type: "function_call_output",
          call_id: "call_001",
          output: '{"temp":22,"condition":"sunny"}',
        },
      ],
      tools: [
        {
          type: "function",
          name: "get_weather",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    };

    const { body: antReq } = registry.transformRequest(
      request,
      "openai-responses",
      "anthropic",
      "gpt-4o",
    );
    expect(antReq.messages).toBeDefined();
    // Should have tool_use and tool_result blocks
    const msgs = antReq.messages as Array<Record<string, unknown>>;
    expect(msgs.length).toBeGreaterThanOrEqual(2);
  });

  it("response transform preserves model info across all paths", () => {
    const anthropicResp = JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-3-opus",
      content: [{ type: "text", text: "Hello!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    // Anthropic → Responses
    const respResp = registry.transformResponse(
      anthropicResp,
      "anthropic",
      "openai-responses",
    );
    const parsed = JSON.parse(respResp);
    expect(parsed.model).toBe("claude-3-opus");
    expect(parsed.status).toBe("completed");

    // Anthropic → Chat (existing path)
    const chatResp = registry.transformResponse(
      anthropicResp,
      "anthropic",
      "openai",
    );
    const chatParsed = JSON.parse(chatResp);
    expect(chatParsed.model).toBe("claude-3-opus");
  });

  it("createStreamTransform returns correct stream transform for each direction", () => {
    // Tier-1: Responses → Anthropic
    const t1 = registry.createStreamTransform(
      "openai-responses",
      "anthropic",
      "gpt-4o",
    );
    expect(t1).toBeDefined();
    expect(t1!.constructor.name).toContain("ResponsesToAnthropic");

    // Tier-1: Anthropic → Responses
    const t2 = registry.createStreamTransform(
      "anthropic",
      "openai-responses",
      "gpt-4o",
    );
    expect(t2).toBeDefined();
    expect(t2!.constructor.name).toContain("AnthropicToResponses");

    // Bridge: Responses → Chat
    const t3 = registry.createStreamTransform(
      "openai-responses",
      "openai",
      "gpt-4o",
    );
    expect(t3).toBeDefined();
    expect(t3!.constructor.name).toContain("ResponsesToChat");

    // Bridge: Chat → Responses
    const t4 = registry.createStreamTransform(
      "openai",
      "openai-responses",
      "gpt-4o",
    );
    expect(t4).toBeDefined();
    expect(t4!.constructor.name).toContain("ChatToResponses");

    // Identity: no transform
    const t5 = registry.createStreamTransform(
      "openai",
      "openai",
      "gpt-4o",
    );
    expect(t5).toBeUndefined();
  });
});
