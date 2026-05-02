import { describe, it, expect } from "vitest";
import {
  responsesToChatRequest,
  chatToResponsesRequest,
} from "../../../src/proxy/transform/request-bridge-responses.js";

// ============================================================
// responsesToChatRequest
// ============================================================

describe("responsesToChatRequest", () => {
  // --- 1. Basic: instructions → system, input string → user ---
  describe("basic text input", () => {
    it("converts instructions → system message and input string → user message", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "Hello, world!",
        instructions: "Be helpful",
      });

      expect(result.model).toBe("gpt-4o");
      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toEqual({ role: "system", content: "Be helpful" });
      expect(msgs[1]).toEqual({ role: "user", content: "Hello, world!" });
    });

    it("omits system message when instructions is empty", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "Hello",
        instructions: "",
      });

      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe("user");
    });

    it("omits system message when instructions is undefined", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "Hello",
      });

      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe("user");
    });

    it("handles null input gracefully", () => {
      const result = responsesToChatRequest({ model: "gpt-4o" });
      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(0);
    });
  });

  // --- 2. Input array items → messages ---
  describe("input array items", () => {
    it("converts message items with roles", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "user", content: "What's the weather?" },
          { type: "message", role: "assistant", content: "Let me check." },
        ],
      });

      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toEqual({ role: "user", content: "What's the weather?" });
      expect(msgs[1]).toEqual({ role: "assistant", content: "Let me check." });
    });

    it("extracts text from content parts in message items", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "Hello " },
              { type: "input_text", text: "World" },
            ],
          },
        ],
      });

      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toEqual({ role: "user", content: "Hello World" });
    });

    it("converts input_text items → user messages", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: [
          { type: "input_text", text: "Hello" },
        ],
      });

      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toEqual({ role: "user", content: "Hello" });
    });

    it("converts developer role messages", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "developer", content: "Be precise" },
        ],
      });

      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toEqual({ role: "developer", content: "Be precise" });
    });
  });

  // --- 3. function_call items → tool_calls in assistant message ---
  describe("function_call items", () => {
    it("merges consecutive function_calls into one assistant message with tool_calls", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "user", content: "Check weather" },
          {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "get_weather",
            arguments: '{"city":"SF"}',
          },
          {
            type: "function_call",
            id: "fc_2",
            call_id: "call_2",
            name: "get_time",
            arguments: '{"tz":"PST"}',
          },
        ],
      });

      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(2);

      // Second message should be assistant with tool_calls
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[1].content).toBeNull();
      const toolCalls = msgs[1].tool_calls as Array<Record<string, unknown>>;
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0]).toEqual({
        id: "fc_1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"SF"}' },
      });
      expect(toolCalls[1]).toEqual({
        id: "fc_2",
        type: "function",
        function: { name: "get_time", arguments: '{"tz":"PST"}' },
      });
    });

    it("handles single function_call", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "user", content: "Go" },
          {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "do_stuff",
            arguments: "{}",
          },
        ],
      });

      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(2);
      expect(msgs[1].role).toBe("assistant");
      const toolCalls = msgs[1].tool_calls as Array<Record<string, unknown>>;
      expect(toolCalls).toHaveLength(1);
    });

    it("flushes function_calls at end of input array", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "user", content: "Go" },
          {
            type: "function_call",
            id: "fc_last",
            call_id: "call_last",
            name: "last_fn",
            arguments: "{}",
          },
          // No more items — function_calls should still be flushed
        ],
      });

      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(2);
      expect(msgs[1].role).toBe("assistant");
    });

    it("flushes function_calls before non-function_call items", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "user", content: "Go" },
          {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "fn",
            arguments: "{}",
          },
          { type: "message", role: "assistant", content: "Done" },
        ],
      });

      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(3);
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[2]).toEqual({ role: "assistant", content: "Done" });
    });
  });

  // --- 4. function_call_output → tool messages ---
  describe("function_call_output items", () => {
    it("converts function_call_output → tool message", () => {
      const result = responsesToChatRequest({
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

      const msgs = result.messages as Array<Record<string, unknown>>;
      expect(msgs).toHaveLength(3);
      expect(msgs[2]).toEqual({
        role: "tool",
        tool_call_id: "call_1",
        content: "Sunny, 72°F",
      });
    });
  });

  // --- 5. Tools conversion ---
  describe("tools conversion", () => {
    it("wraps function tools in Chat Completions format", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [
          {
            type: "function",
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        ],
      });

      const tools = result.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      });
    });

    it("filters out non-function tools", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [
          { type: "function", name: "fn", parameters: {} },
          { type: "web_search_preview" } as Record<string, unknown>,
          { type: "file_search", vector_store_ids: ["vs_1"] } as Record<string, unknown>,
        ],
      });

      const tools = result.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(1);
      expect((tools[0].function as Record<string, unknown>).name).toBe("fn");
    });

    it("omits tools when only non-function tools present", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [
          { type: "web_search_preview" } as Record<string, unknown>,
        ],
      });

      expect(result.tools).toBeUndefined();
    });

    it("passes tool_choice through", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [{ type: "function", name: "fn", parameters: {} }],
        tool_choice: "auto",
      });
      expect(result.tool_choice).toBe("auto");
    });

    it("passes tool_choice {type:'function', name} through", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "hi",
        tools: [{ type: "function", name: "fn", parameters: {} }],
        tool_choice: { type: "function", name: "fn" },
      });
      expect(result.tool_choice).toEqual({ type: "function", name: "fn" });
    });
  });

  // --- 6. Reasoning & other params ---
  describe("pass-through fields", () => {
    it("maps max_output_tokens → max_completion_tokens", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "hi",
        max_output_tokens: 2048,
      });
      expect(result.max_completion_tokens).toBe(2048);
    });

    it("passes temperature, top_p, stream through", () => {
      const result = responsesToChatRequest({
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

    it("passes reasoning through", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "hi",
        reasoning: { effort: "high", max_tokens: 10000 },
      });
      expect(result.reasoning).toEqual({ effort: "high", max_tokens: 10000 });
    });

    it("maps text.format → response_format", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "hi",
        text: { format: { type: "json_schema", json_schema: { name: "test" } } },
      });
      expect(result.response_format).toEqual({
        type: "json_schema",
        json_schema: { name: "test" },
      });
    });

    it("passes stream_options through", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: "hi",
        stream: true,
        stream_options: { include_usage: true },
      });
      expect(result.stream_options).toEqual({ include_usage: true });
    });
  });

  // --- 7. Reasoning items → skip ---
  describe("lossy conversions", () => {
    it("skips reasoning items (no Chat equivalent)", () => {
      const result = responsesToChatRequest({
        model: "gpt-4o",
        input: [
          { type: "message", role: "user", content: "Think" },
          {
            type: "reasoning",
            id: "rs_1",
            summary: [{ type: "summary_text", text: "I thought about it" }],
          },
          { type: "message", role: "assistant", content: "Here's my answer" },
        ],
      });

      const msgs = result.messages as Array<Record<string, unknown>>;
      // Only user and assistant; reasoning is skipped
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");
    });
  });
});

// ============================================================
// chatToResponsesRequest
// ============================================================

describe("chatToResponsesRequest", () => {
  // --- 7. system → instructions ---
  describe("instructions extraction", () => {
    it("converts system messages → instructions", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Be helpful" },
          { role: "user", content: "Hello" },
        ],
      });

      expect(result.model).toBe("gpt-4o");
      expect(result.instructions).toBe("Be helpful");
      const input = result.input as Array<Record<string, unknown>>;
      expect(input).toHaveLength(1);
      expect(input[0]).toEqual({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
      });
    });

    it("joins multiple system messages into instructions", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Rule 1" },
          { role: "system", content: "Rule 2" },
          { role: "user", content: "Hi" },
        ],
      });

      expect(result.instructions).toBe("Rule 1\nRule 2");
    });

    it("includes developer messages in instructions (prepended)", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [
          { role: "developer", content: "Be precise" },
          { role: "system", content: "Be helpful" },
          { role: "user", content: "Hi" },
        ],
      });

      expect(result.instructions).toBe("Be precise\nBe helpful");
    });

    it("omits instructions when no system/developer messages", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [
          { role: "user", content: "Hi" },
        ],
      });

      expect(result.instructions).toBeFalsy();
    });
  });

  // --- 8. tool_calls → function_call items ---
  describe("assistant tool_calls", () => {
    it("converts tool_calls → function_call items", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [
          { role: "user", content: "Check weather" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"SF"}' },
              },
            ],
          },
        ],
      });

      const input = result.input as Array<Record<string, unknown>>;
      expect(input).toHaveLength(2);
      expect(input[1]).toEqual({
        type: "function_call",
        id: "call_abc",
        call_id: "call_abc",
        name: "get_weather",
        arguments: '{"city":"SF"}',
      });
    });

    it("converts multiple tool_calls to separate function_call items", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [
          { role: "user", content: "Go" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "fn1", arguments: "{}" } },
              { id: "call_2", type: "function", function: { name: "fn2", arguments: "{}" } },
            ],
          },
        ],
      });

      const input = result.input as Array<Record<string, unknown>>;
      expect(input).toHaveLength(3);
      expect(input[1].type).toBe("function_call");
      expect(input[2].type).toBe("function_call");
    });
  });

  // --- 9. tool messages → function_call_output ---
  describe("tool messages", () => {
    it("converts tool messages → function_call_output", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [
          { role: "user", content: "Check weather" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "get_weather", arguments: "{}" } },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "Sunny, 72°F" },
        ],
      });

      const input = result.input as Array<Record<string, unknown>>;
      expect(input).toHaveLength(3);
      expect(input[2]).toEqual({
        type: "function_call_output",
        call_id: "call_1",
        output: "Sunny, 72°F",
      });
    });
  });

  // --- 10. max_completion_tokens → max_output_tokens ---
  describe("field mappings", () => {
    it("maps max_completion_tokens → max_output_tokens", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [],
        max_completion_tokens: 2048,
      });
      expect(result.max_output_tokens).toBe(2048);
    });

    it("falls back to max_tokens → max_output_tokens", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [],
        max_tokens: 1024,
      });
      expect(result.max_output_tokens).toBe(1024);
    });

    it("prefers max_completion_tokens over max_tokens", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [],
        max_completion_tokens: 2048,
        max_tokens: 1024,
      });
      expect(result.max_output_tokens).toBe(2048);
    });

    it("passes temperature, top_p, stream through", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [],
        temperature: 0.5,
        top_p: 0.9,
        stream: true,
      });
      expect(result.temperature).toBe(0.5);
      expect(result.top_p).toBe(0.9);
      expect(result.stream).toBe(true);
    });
  });

  // --- Tools conversion ---
  describe("tools conversion (reverse)", () => {
    it("flattens function wrapper in tools", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather",
              parameters: { type: "object" },
            },
          },
        ],
      });

      const tools = result.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        type: "function",
        name: "get_weather",
        description: "Get weather",
        parameters: { type: "object" },
      });
    });

    it("passes tool_choice through", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [],
        tools: [{ type: "function", function: { name: "fn" } }],
        tool_choice: "auto",
      });
      expect(result.tool_choice).toBe("auto");
    });
  });

  // --- response_format → text.format ---
  describe("response_format conversion", () => {
    it("maps response_format → text.format", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [],
        response_format: { type: "json_schema", json_schema: { name: "test" } },
      });
      expect(result.text).toEqual({
        format: { type: "json_schema", json_schema: { name: "test" } },
      });
    });
  });

  // --- Assistant text → message ---
  describe("assistant text content", () => {
    it("converts assistant text → message with output_text", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello!" },
        ],
      });

      const input = result.input as Array<Record<string, unknown>>;
      expect(input).toHaveLength(2);
      expect(input[1]).toEqual({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello!" }],
      });
    });

    it("skips assistant message when content is null and no tool_calls", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: null },
        ],
      });

      const input = result.input as Array<Record<string, unknown>>;
      expect(input).toHaveLength(1);
    });

    it("includes assistant text alongside tool_calls", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [
          { role: "user", content: "Go" },
          {
            role: "assistant",
            content: "Let me check",
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "fn", arguments: "{}" } },
            ],
          },
        ],
      });

      const input = result.input as Array<Record<string, unknown>>;
      expect(input).toHaveLength(3);
      // First: assistant message with text
      expect(input[1]).toEqual({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Let me check" }],
      });
      // Second: function_call
      expect(input[2].type).toBe("function_call");
    });
  });

  // --- Reasoning pass-through ---
  describe("reasoning pass-through", () => {
    it("passes reasoning through", () => {
      const result = chatToResponsesRequest({
        model: "gpt-4o",
        messages: [],
        reasoning: { effort: "low" },
      });
      expect(result.reasoning).toEqual({ effort: "low" });
    });
  });
});

// ============================================================
// Round-trip: Responses → Chat → Responses
// ============================================================

describe("round-trip: Responses → Chat → Responses", () => {
  it("preserves basic fields", () => {
    const original = {
      model: "gpt-4o",
      input: "Hello",
      instructions: "Be helpful",
      max_output_tokens: 2048,
      temperature: 0.7,
    };

    const chat = responsesToChatRequest(original);
    const roundTrip = chatToResponsesRequest(chat);

    expect(roundTrip.model).toBe("gpt-4o");
    expect(roundTrip.instructions).toBe("Be helpful");
    expect(roundTrip.max_output_tokens).toBe(2048);
    expect(roundTrip.temperature).toBe(0.7);

    // input should come back as a message item
    const input = roundTrip.input as Array<Record<string, unknown>>;
    expect(input).toHaveLength(1);
    expect(input[0]).toEqual({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Hello" }],
    });
  });

  it("preserves tool definitions in round-trip", () => {
    const original = {
      model: "gpt-4o",
      input: "Use the tool",
      tools: [
        {
          type: "function",
          name: "my_fn",
          description: "A function",
          parameters: { type: "object" },
        },
      ],
      tool_choice: "auto" as const,
    };

    const chat = responsesToChatRequest(original);
    const roundTrip = chatToResponsesRequest(chat);

    const tools = roundTrip.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("my_fn");
    expect(tools[0].description).toBe("A function");
    expect(tools[0].parameters).toEqual({ type: "object" });
    expect(roundTrip.tool_choice).toBe("auto");
  });

  it("preserves reasoning in round-trip", () => {
    const original = {
      model: "gpt-4o",
      input: "Think deeply",
      reasoning: { effort: "high", max_tokens: 10000 },
    };

    const chat = responsesToChatRequest(original);
    const roundTrip = chatToResponsesRequest(chat);

    expect(roundTrip.reasoning).toEqual({ effort: "high", max_tokens: 10000 });
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

    const chat = responsesToChatRequest(original);
    const roundTrip = chatToResponsesRequest(chat);

    const input = roundTrip.input as Array<Record<string, unknown>>;
    // Should have: user message, function_call, function_call_output, assistant message
    expect(input.length).toBeGreaterThanOrEqual(4);

    const types = input.map((i) => i.type as string);
    expect(types).toContain("message");
    expect(types).toContain("function_call");
    expect(types).toContain("function_call_output");
  });

  it("preserves response_format / text.format in round-trip", () => {
    const original = {
      model: "gpt-4o",
      input: "hi",
      text: { format: { type: "json_object" } },
    };

    const chat = responsesToChatRequest(original);
    const roundTrip = chatToResponsesRequest(chat);

    expect(roundTrip.text).toEqual({ format: { type: "json_object" } });
  });
});
