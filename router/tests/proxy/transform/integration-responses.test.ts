import { describe, it, expect } from "vitest";
import { TransformCoordinator } from "../../../src/proxy/transform/transform-coordinator.js";

const coordinator = new TransformCoordinator();

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
    const { body: antReq } = coordinator.transformRequest(
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
    const respResponse = coordinator.transformResponse(
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
    const { body: chatReq } = coordinator.transformRequest(
      request,
      "openai-responses",
      "openai",
      "gpt-4o",
    );
    expect(chatReq.messages).toBeDefined();
    expect(chatReq.max_completion_tokens).toBe(1024);

    // Chat → Responses
    const { body: respReq } = coordinator.transformRequest(
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
    const { body: respReq } = coordinator.transformRequest(
      request,
      "openai",
      "openai-responses",
      "gpt-4o",
    );
    expect(respReq.instructions).toBe("Be helpful");
    expect(respReq.max_output_tokens).toBe(1024);

    // Responses → Chat
    const { body: chatReq } = coordinator.transformRequest(
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

    const { body: chatReq } = coordinator.transformRequest(
      request,
      "anthropic",
      "openai",
      "claude",
    );
    expect(chatReq.messages).toBeDefined();

    const { body: antReq } = coordinator.transformRequest(
      chatReq,
      "openai",
      "anthropic",
      "claude",
    );
    expect(antReq.messages).toBeDefined();
  });

  it("needsTransform returns false for same api_type", () => {
    expect(coordinator.needsTransform("openai", "openai")).toBe(false);
    expect(coordinator.needsTransform("anthropic", "anthropic")).toBe(false);
    expect(
      coordinator.needsTransform("openai-responses", "openai-responses"),
    ).toBe(false);
  });

  it("needsTransform returns true for different api_types", () => {
    expect(coordinator.needsTransform("openai", "anthropic")).toBe(true);
    expect(coordinator.needsTransform("openai", "openai-responses")).toBe(true);
    expect(
      coordinator.needsTransform("openai-responses", "anthropic"),
    ).toBe(true);
    expect(coordinator.needsTransform("anthropic", "openai")).toBe(true);
    expect(
      coordinator.needsTransform("anthropic", "openai-responses"),
    ).toBe(true);
    expect(
      coordinator.needsTransform("openai-responses", "openai"),
    ).toBe(true);
  });

  it("error response transforms work for all directions", () => {
    const anthropicError = JSON.stringify({
      type: "error",
      error: { type: "not_found_error", message: "Model not found" },
    });

    // Anthropic → Responses
    const r1 = coordinator.transformErrorResponse(
      anthropicError,
      "anthropic",
      "openai-responses",
    );
    const parsed1 = JSON.parse(r1);
    expect(parsed1.error).toBeDefined();
    expect(parsed1.error.message).toContain("Model not found");

    // Anthropic → OpenAI (existing path)
    const r2 = coordinator.transformErrorResponse(
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

    const { body: antReq } = coordinator.transformRequest(
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
    const respResp = coordinator.transformResponse(
      anthropicResp,
      "anthropic",
      "openai-responses",
    );
    const parsed = JSON.parse(respResp);
    expect(parsed.model).toBe("claude-3-opus");
    expect(parsed.status).toBe("completed");

    // Anthropic → Chat (existing path)
    const chatResp = coordinator.transformResponse(
      anthropicResp,
      "anthropic",
      "openai",
    );
    const chatParsed = JSON.parse(chatResp);
    expect(chatParsed.model).toBe("claude-3-opus");
  });

  it("createFormatTransform returns correct stream transform for each direction", () => {
    // Tier-1: Responses → Anthropic
    const t1 = coordinator.createFormatTransform(
      "openai-responses",
      "anthropic",
      "gpt-4o",
    );
    expect(t1).toBeDefined();
    expect(t1!.constructor.name).toContain("ResponsesToAnthropic");

    // Tier-1: Anthropic → Responses
    const t2 = coordinator.createFormatTransform(
      "anthropic",
      "openai-responses",
      "gpt-4o",
    );
    expect(t2).toBeDefined();
    expect(t2!.constructor.name).toContain("AnthropicToResponses");

    // Bridge: Responses → Chat
    const t3 = coordinator.createFormatTransform(
      "openai-responses",
      "openai",
      "gpt-4o",
    );
    expect(t3).toBeDefined();
    expect(t3!.constructor.name).toContain("ResponsesToChat");

    // Bridge: Chat → Responses
    const t4 = coordinator.createFormatTransform(
      "openai",
      "openai-responses",
      "gpt-4o",
    );
    expect(t4).toBeDefined();
    expect(t4!.constructor.name).toContain("ChatToResponses");

    // Identity: no transform
    const t5 = coordinator.createFormatTransform(
      "openai",
      "openai",
      "gpt-4o",
    );
    expect(t5).toBeUndefined();
  });
});
