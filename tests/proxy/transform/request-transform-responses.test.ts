import { describe, it, expect } from "vitest";
import {
  responsesToAnthropicRequest,
  anthropicToResponsesRequest,
} from "../../../src/proxy/transform/request-transform-responses.js";

// ============================================================
// responsesToAnthropicRequest
// ============================================================

describe("responsesToAnthropicRequest", () => {
  // --- 1. Basic text input ---
  describe("basic text input", () => {
    it("converts string input → user message and instructions → system", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "Hello, world!",
        instructions: "Be helpful",
      });

      expect(result.model).toBe("gpt-4o");
      expect(result.system).toBe("Be helpful");
      expect(result.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Hello, world!" }] },
      ]);
    });

    it("handles empty input gracefully", () => {
      const result = responsesToAnthropicRequest({ model: "gpt-4o", input: "" });
      expect(result.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "" }] },
      ]);
    });

    it("passes through temperature, top_p, stream", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        temperature: 0.5,
        top_p: 0.9,
        stream: true,
      });
      expect(result.temperature).toBe(0.5);
      expect(result.top_p).toBe(0.9);
      expect(result.stream).toBe(true);
    });

    it("maps max_output_tokens → max_tokens", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        max_output_tokens: 2048,
      });
      expect(result.max_tokens).toBe(2048);
    });

    it("maps metadata.user_id", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        metadata: { user_id: "user123" },
      });
      expect(result.metadata).toEqual({ user_id: "user123" });
    });
  });

  // --- 2. Multi-turn with function_call / function_call_output ---
  describe("multi-turn with function items", () => {
    it("converts message items with roles", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "user", content: "What's the weather?" },
          { type: "message", role: "assistant", content: "Let me check." },
        ],
      });

      const msgs = result.messages as Array<{ role: string; content: unknown }>;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");
    });

    it("converts function_call → assistant tool_use", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "user", content: "Check weather" },
          {
            type: "function_call",
            id: "fc_123",
            call_id: "call_abc",
            name: "get_weather",
            arguments: '{"city":"SF"}',
          },
        ],
      });

      const msgs = result.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
      expect(msgs).toHaveLength(2);
      expect(msgs[1].role).toBe("assistant");
      const toolUse = msgs[1].content[0];
      expect(toolUse.type).toBe("tool_use");
      expect(toolUse.name).toBe("get_weather");
      expect(toolUse.id).toBe("toolu_call_abc");
      expect(toolUse.input).toEqual({ city: "SF" });
    });

    it("converts function_call_output → user tool_result", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "user", content: "Check weather" },
          {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "get_weather",
            arguments: "{}",
          },
          {
            type: "function_call_output",
            call_id: "call_1",
            output: "Sunny, 72°F",
          },
        ],
      });

      const msgs = result.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
      // After merge: user, assistant, user
      expect(msgs).toHaveLength(3);
      expect(msgs[2].role).toBe("user");
      const toolResult = msgs[2].content[0];
      expect(toolResult.type).toBe("tool_result");
      expect(toolResult.tool_use_id).toBe("toolu_call_1");
      expect(toolResult.content).toBe("Sunny, 72°F");
    });

    it("handles input_text items as user messages", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: [
          { type: "input_text", text: "Hello" },
          { type: "input_text", text: "World" },
        ],
      });

      const msgs = result.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
      // Two consecutive user messages should be merged
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe("user");
      expect(msgs[0].content).toHaveLength(2);
      expect(msgs[0].content[0]).toEqual({ type: "text", text: "Hello" });
      expect(msgs[0].content[1]).toEqual({ type: "text", text: "World" });
    });
  });

  // --- 3. Reasoning → thinking ---
  describe("reasoning → thinking", () => {
    it("maps reasoning.effort to thinking.budget_tokens", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        reasoning: { effort: "high" },
      });
      expect(result.thinking).toEqual({ type: "enabled", budget_tokens: 32768 });
    });

    it("maps reasoning.effort=low correctly", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        reasoning: { effort: "low" },
      });
      expect(result.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    });

    it("maps reasoning.effort=medium correctly", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        reasoning: { effort: "medium" },
      });
      expect(result.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    });

    it("reasoning.max_tokens overrides effort mapping", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        reasoning: { effort: "low", max_tokens: 5000 },
      });
      expect(result.thinking).toEqual({ type: "enabled", budget_tokens: 5000 });
    });

    it("defaults to 8192 budget when no effort specified", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        reasoning: {},
      });
      expect(result.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    });

    it("ensures max_tokens >= budget_tokens", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        max_output_tokens: 100,
        reasoning: { effort: "high" },
      });
      expect(result.max_tokens).toBe(32768);
    });

    it("converts reasoning input items to assistant thinking blocks", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "user", content: "Think about this" },
          {
            type: "reasoning",
            id: "rs_1",
            summary: [{ type: "summary_text", text: "I considered the options" }],
          },
        ],
      });

      const msgs = result.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
      // user, assistant (thinking)
      expect(msgs).toHaveLength(2);
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[1].content[0].type).toBe("thinking");
      expect(msgs[1].content[0].thinking).toBe("I considered the options");
    });
  });

  // --- 4. Tool definitions and tool_choice ---
  describe("tools and tool_choice", () => {
    it("converts function tools and filters non-function tools", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [
          { type: "function", name: "get_weather", description: "Get weather", parameters: { type: "object" } },
          { type: "web_search_preview" } as Record<string, unknown>,
          { type: "file_search", vector_store_ids: ["vs_1"] } as Record<string, unknown>,
        ],
      });

      const tools = result.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        name: "get_weather",
        description: "Get weather",
        input_schema: { type: "object" },
      });
    });

    it("maps tool_choice 'auto'", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [{ type: "function", name: "fn", parameters: {} }],
        tool_choice: "auto",
      });
      expect(result.tool_choice).toEqual({ type: "auto" });
    });

    it("maps tool_choice 'required' → {type:'any'}", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [{ type: "function", name: "fn", parameters: {} }],
        tool_choice: "required",
      });
      expect(result.tool_choice).toEqual({ type: "any" });
    });

    it("drops tools when tool_choice is 'none'", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [{ type: "function", name: "fn", parameters: {} }],
        tool_choice: "none",
      });
      expect(result.tools).toBeUndefined();
      expect(result.tool_choice).toBeUndefined();
    });

    it("maps tool_choice {type:'function', name} → {type:'tool', name}", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [{ type: "function", name: "my_fn", parameters: {} }],
        tool_choice: { type: "function", name: "my_fn" },
      });
      expect(result.tool_choice).toEqual({ type: "tool", name: "my_fn" });
    });
  });

  // --- 5. parallel_tool_calls ---
  describe("parallel_tool_calls", () => {
    it("adds disable_parallel_tool_use when parallel_tool_calls=false", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [{ type: "function", name: "fn", parameters: {} }],
        tool_choice: "auto",
        parallel_tool_calls: false,
      });
      expect(result.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    });

    it("adds disable_parallel_tool_use with tool_choice=function", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [{ type: "function", name: "my_fn", parameters: {} }],
        tool_choice: { type: "function", name: "my_fn" },
        parallel_tool_calls: false,
      });
      expect(result.tool_choice).toEqual({ type: "tool", name: "my_fn", disable_parallel_tool_use: true });
    });

    it("creates auto tool_choice when parallel_tool_calls=false without explicit tool_choice", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [{ type: "function", name: "fn", parameters: {} }],
        parallel_tool_calls: false,
      });
      expect(result.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    });
  });

  // --- 6. Message merge and alternation ---
  describe("message alternation", () => {
    it("merges consecutive same-role messages", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "user", content: "Hello" },
          { type: "input_text", text: "Additional" },
        ],
      });

      const msgs = result.messages as Array<{ role: string }>;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe("user");
    });

    it("prepends empty user message when first message is assistant", () => {
      const result = responsesToAnthropicRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "assistant", content: "Hi there" },
        ],
      });

      const msgs = result.messages as Array<{ role: string }>;
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");
    });
  });
});

// ============================================================
// anthropicToResponsesRequest
// ============================================================

describe("anthropicToResponsesRequest", () => {
  // --- 7. Basic text ---
  describe("basic text conversion", () => {
    it("converts system → instructions and messages → input items", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        system: "Be helpful",
        messages: [
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
      });

      expect(result.model).toBe("claude-3");
      expect(result.instructions).toBe("Be helpful");
      expect(result.input).toEqual([
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      ]);
    });

    it("joins system array into instructions", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        system: [
          { type: "text", text: "Rule 1" },
          { type: "text", text: "Rule 2" },
        ],
        messages: [],
      });

      expect(result.instructions).toBe("Rule 1\nRule 2");
    });

    it("maps max_tokens → max_output_tokens", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [],
        max_tokens: 4096,
      });
      expect(result.max_output_tokens).toBe(4096);
    });

    it("passes through temperature, top_p, stream", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [],
        temperature: 0.7,
        top_p: 0.95,
        stream: true,
      });
      expect(result.temperature).toBe(0.7);
      expect(result.top_p).toBe(0.95);
      expect(result.stream).toBe(true);
    });

    it("maps metadata.user_id", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [],
        metadata: { user_id: "user456" },
      });
      expect(result.metadata).toEqual({ user_id: "user456" });
    });
  });

  // --- 8. Tool_use and tool_result ---
  describe("tool_use and tool_result conversion", () => {
    it("converts assistant tool_use → function_call items", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [
          { role: "user", content: [{ type: "text", text: "Check weather" }] },
          {
            role: "assistant",
            content: [{
              type: "tool_use",
              id: "toolu_call_abc",
              name: "get_weather",
              input: { city: "SF" },
            }],
          },
        ],
      });

      const input = result.input as Array<Record<string, unknown>>;
      expect(input).toHaveLength(2);
      // Second item should be function_call
      expect(input[1].type).toBe("function_call");
      expect(input[1].call_id).toBe("call_abc");
      expect(input[1].name).toBe("get_weather");
      expect(input[1].arguments).toBe('{"city":"SF"}');
    });

    it("converts user tool_result → function_call_output items", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [
          { role: "user", content: [{ type: "text", text: "Check weather" }] },
          {
            role: "assistant",
            content: [{
              type: "tool_use",
              id: "toolu_call_1",
              name: "get_weather",
              input: {},
            }],
          },
          {
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: "toolu_call_1",
              content: "Sunny, 72°F",
            }],
          },
        ],
      });

      const input = result.input as Array<Record<string, unknown>>;
      // user message, function_call, function_call_output
      expect(input).toHaveLength(3);
      expect(input[2].type).toBe("function_call_output");
      expect(input[2].call_id).toBe("call_1");
      expect(input[2].output).toBe("Sunny, 72°F");
    });

    it("converts assistant text → assistant message with output_text", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [
          { role: "user", content: [{ type: "text", text: "Hi" }] },
          { role: "assistant", content: [{ type: "text", text: "Hello!" }] },
        ],
      });

      const input = result.input as Array<Record<string, unknown>>;
      expect(input[1].type).toBe("message");
      expect(input[1].role).toBe("assistant");
      expect((input[1].content as Array<Record<string, unknown>>[])[0].type).toBe("output_text");
    });
  });

  // --- 9. Thinking ---
  describe("thinking → reasoning", () => {
    it("converts thinking blocks → reasoning items", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [
          { role: "user", content: [{ type: "text", text: "Think" }] },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Deep thoughts..." },
              { type: "text", text: "Here's my answer" },
            ],
          },
        ],
      });

      const input = result.input as Array<Record<string, unknown>>;
      // user message, reasoning, assistant message
      expect(input).toHaveLength(3);
      expect(input[1].type).toBe("reasoning");
      const summary = input[1].summary as Array<Record<string, unknown>>;
      expect(summary[0].type).toBe("summary_text");
      expect(summary[0].text).toBe("Deep thoughts...");
    });

    it("maps thinking.budget_tokens → reasoning.max_tokens", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [],
        thinking: { type: "enabled", budget_tokens: 10000 },
      });
      expect(result.reasoning).toEqual({ max_tokens: 10000 });
    });

    it("does not map thinking when type is not 'enabled'", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [],
        thinking: { type: "disabled" },
      });
      expect(result.reasoning).toBeUndefined();
    });
  });

  // --- Tool mapping ---
  describe("tools and tool_choice (reverse)", () => {
    it("converts Anthropic tools → Responses function tools", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [],
        tools: [
          { name: "get_weather", description: "Get weather", input_schema: { type: "object" } },
        ],
      });

      const tools = result.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(1);
      expect(tools[0].type).toBe("function");
      expect(tools[0].name).toBe("get_weather");
      expect(tools[0].parameters).toEqual({ type: "object" });
    });

    it("maps tool_choice auto → 'auto'", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [],
        tool_choice: { type: "auto" },
      });
      expect(result.tool_choice).toBe("auto");
    });

    it("maps tool_choice any → 'required'", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [],
        tool_choice: { type: "any" },
      });
      expect(result.tool_choice).toBe("required");
    });

    it("maps tool_choice tool+name → {type:'function', name}", () => {
      const result = anthropicToResponsesRequest({
        model: "claude-3",
        messages: [],
        tool_choice: { type: "tool", name: "my_fn" },
      });
      expect(result.tool_choice).toEqual({ type: "function", name: "my_fn" });
    });
  });
});

// ============================================================
// Round-trip: Responses → Anthropic → Responses
// ============================================================

describe("round-trip: Responses → Anthropic → Responses", () => {
  it("preserves core fields for a basic text conversation", () => {
    const original = {
      model: "gpt-4o",
      input: "Hello",
      instructions: "Be helpful",
      max_output_tokens: 2048,
      temperature: 0.7,
    };

    const anthropic = responsesToAnthropicRequest(original);
    const roundTrip = anthropicToResponsesRequest(anthropic);

    expect(roundTrip.model).toBe("gpt-4o");
    expect(roundTrip.instructions).toBe("Be helpful");
    expect(roundTrip.max_output_tokens).toBe(2048);
    expect(roundTrip.temperature).toBe(0.7);

    // input should come back as message items with same text
    const input = roundTrip.input as Array<Record<string, unknown>>;
    expect(input[0].type).toBe("message");
    expect(input[0].role).toBe("user");
    const content = (input[0].content as Array<Record<string, unknown>>)[0];
    expect(content.text).toBe("Hello");
  });

  it("preserves tool definitions and tool_choice in round-trip", () => {
    const original = {
      model: "gpt-4o",
      input: "Use the tool",
      tools: [
        { type: "function", name: "my_fn", description: "A function", parameters: { type: "object" } },
      ],
      tool_choice: "auto" as const,
    };

    const anthropic = responsesToAnthropicRequest(original);
    const roundTrip = anthropicToResponsesRequest(anthropic);

    const tools = roundTrip.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("my_fn");
    expect(roundTrip.tool_choice).toBe("auto");
  });

  it("preserves reasoning budget in round-trip", () => {
    const original = {
      model: "gpt-4o",
      input: "Think deeply",
      reasoning: { max_tokens: 5000 },
    };

    const anthropic = responsesToAnthropicRequest(original);
    const roundTrip = anthropicToResponsesRequest(anthropic);

    expect(roundTrip.reasoning).toEqual({ max_tokens: 5000 });
  });

  it("preserves multi-turn conversation structure", () => {
    const original = {
      model: "gpt-4o",
      input: [
        { type: "message", role: "user", content: "What's the weather?" },
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "get_weather",
          arguments: '{"city":"SF"}',
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "Sunny",
        },
        { type: "message", role: "assistant", content: "It's sunny in SF!" },
      ],
    };

    const anthropic = responsesToAnthropicRequest(original);
    const roundTrip = anthropicToResponsesRequest(anthropic);

    const input = roundTrip.input as Array<Record<string, unknown>>;
    // Should have: user message, function_call, function_call_output, assistant message
    expect(input.length).toBeGreaterThanOrEqual(4);

    const types = input.map(i => i.type);
    expect(types).toContain("message");
    expect(types).toContain("function_call");
    expect(types).toContain("function_call_output");
  });
});
