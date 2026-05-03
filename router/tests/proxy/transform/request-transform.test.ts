import { describe, it, expect, vi } from "vitest";
import { openaiToAnthropicRequest, anthropicToOpenAIRequest, transformRequestBody } from "../../../src/proxy/transform/request-transform.js";

describe("openaiToAnthropicRequest", () => {
  it("maps basic fields", () => {
    const result = openaiToAnthropicRequest({
      model: "gpt-4", messages: [
        { role: "system", content: "Be helpful" },
        { role: "user", content: "Hi" },
      ],
      stream: true, temperature: 0.7,
    });
    expect(result.model).toBe("gpt-4");
    expect(result.system).toBe("Be helpful");
    expect(result.messages).toHaveLength(1);
    expect(result.stream).toBe(true);
    expect(result.temperature).toBe(0.7);
    expect(result.max_tokens).toBe(4096);
  });

  it("defaults max_tokens to 4096 when not provided", () => {
    const result = openaiToAnthropicRequest({ model: "gpt-4", messages: [] });
    expect(result.max_tokens).toBe(4096);
  });

  it("prefers max_completion_tokens over max_tokens", () => {
    const result = openaiToAnthropicRequest({ model: "gpt-4", messages: [], max_completion_tokens: 2048, max_tokens: 1024 });
    expect(result.max_tokens).toBe(2048);
  });

  it("wraps stop string into stop_sequences array", () => {
    const result = openaiToAnthropicRequest({ model: "gpt-4", messages: [], stop: "END" });
    expect(result.stop_sequences).toEqual(["END"]);
  });

  it("passes stop array as stop_sequences", () => {
    const result = openaiToAnthropicRequest({ model: "gpt-4", messages: [], stop: ["END", "STOP"] });
    expect(result.stop_sequences).toEqual(["END", "STOP"]);
  });

  it("maps tools and tool_choice", () => {
    const result = openaiToAnthropicRequest({
      model: "gpt-4", messages: [],
      tools: [{ type: "function", function: { name: "fn", parameters: { type: "object" } } }],
      tool_choice: "auto",
    });
    expect(result.tools).toEqual([{ name: "fn", input_schema: { type: "object" } }]);
    expect(result.tool_choice).toEqual({ type: "auto" });
  });

  it("drops tools when tool_choice is 'none'", () => {
    const result = openaiToAnthropicRequest({
      model: "gpt-4", messages: [],
      tools: [{ type: "function", function: { name: "fn", parameters: {} } }],
      tool_choice: "none",
    });
    expect(result.tools).toBeUndefined();
    expect(result.tool_choice).toBeUndefined();
  });

  it("maps parallel_tool_calls:false to disable_parallel_tool_use", () => {
    const result = openaiToAnthropicRequest({
      model: "gpt-4", messages: [],
      tools: [{ type: "function", function: { name: "fn", parameters: {} } }],
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
    expect(result.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
  });

  it("maps reasoning to thinking and ensures max_tokens >= budget", () => {
    const result = openaiToAnthropicRequest({
      model: "gpt-4", messages: [], max_tokens: 100,
      reasoning: { effort: "high" },
    });
    expect(result.thinking).toEqual({ type: "enabled", budget_tokens: 32768 });
    expect(result.max_tokens).toBe(32768);
  });

  it("maps user to metadata.user_id", () => {
    const result = openaiToAnthropicRequest({ model: "gpt-4", messages: [], user: "user123" });
    expect(result.metadata).toEqual({ user_id: "user123" });
  });

  it("drops response_format json_object and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = openaiToAnthropicRequest({
      model: "gpt-4", messages: [],
      response_format: { type: "json_object" },
    });
    expect(result.response_format).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("response_format"));
    warnSpy.mockRestore();
  });

  it("drops response_format json_schema and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = openaiToAnthropicRequest({
      model: "gpt-4", messages: [],
      response_format: { type: "json_schema", json_schema: { name: "test", schema: {} } },
    });
    expect(result.response_format).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("response_format"));
    warnSpy.mockRestore();
  });

  it("does not warn when response_format is absent", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    openaiToAnthropicRequest({ model: "gpt-4", messages: [] });
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("response_format"));
    warnSpy.mockRestore();
  });
});

describe("anthropicToOpenAIRequest", () => {
  it("maps basic fields", () => {
    const result = anthropicToOpenAIRequest({
      model: "claude-3", system: "Be helpful",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      stream: true, temperature: 0.7, max_tokens: 4096,
    });
    expect(result.model).toBe("claude-3");
    expect(result.messages[0]).toEqual({ role: "system", content: "Be helpful" });
    expect(result.max_completion_tokens).toBe(4096);
    expect(result.stream).toBe(true);
    expect(result.temperature).toBe(0.7);
  });

  it("injects stream_options when stream is true", () => {
    const result = anthropicToOpenAIRequest({ model: "c", messages: [], stream: true });
    expect(result.stream_options).toEqual({ include_usage: true });
  });

  it("does not inject stream_options when stream is false", () => {
    const result = anthropicToOpenAIRequest({ model: "c", messages: [], stream: false });
    expect(result.stream_options).toBeUndefined();
  });

  it("maps stop_sequences to stop", () => {
    const result = anthropicToOpenAIRequest({ model: "c", messages: [], stop_sequences: ["END"] });
    expect(result.stop).toEqual(["END"]);
  });

  it("maps tools and tool_choice", () => {
    const result = anthropicToOpenAIRequest({
      model: "c", messages: [],
      tools: [{ name: "fn", input_schema: { type: "object" } }],
      tool_choice: { type: "auto" },
    });
    expect(result.tools).toEqual([{ type: "function", function: { name: "fn", parameters: { type: "object" } } }]);
    expect(result.tool_choice).toBe("auto");
  });

  it("maps thinking to reasoning", () => {
    const result = anthropicToOpenAIRequest({
      model: "c", messages: [],
      thinking: { type: "enabled", budget_tokens: 10000 },
    });
    expect(result.reasoning).toEqual({ max_tokens: 10000 });
  });

  it("maps metadata.user_id to user", () => {
    const result = anthropicToOpenAIRequest({ model: "c", messages: [], metadata: { user_id: "u1" } });
    expect(result.user).toBe("u1");
  });
});

describe("transformRequestBody", () => {
  it("returns body unchanged when same apiType", () => {
    const body = { model: "gpt-4", messages: [] };
    const result = transformRequestBody(body, "openai", "openai", "gpt-4");
    expect(result).toBe(body);
  });

  it("transforms OA→Ant", () => {
    const result = transformRequestBody({ model: "gpt-4", messages: [], stream: true }, "openai", "anthropic", "gpt-4");
    expect(result.max_tokens).toBe(4096);
    expect(result.stream).toBe(true);
  });

  it("transforms Ant→OA", () => {
    const result = transformRequestBody({ model: "claude-3", messages: [], stream: true }, "anthropic", "openai", "claude-3");
    expect(result.stream_options).toEqual({ include_usage: true });
  });
});

describe("openaiToAnthropicRequest — provider_meta", () => {
  it("strips provider_meta from request body", () => {
    const result = openaiToAnthropicRequest({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      provider_meta: { anthropic: { cache_usage: { cache_read_input_tokens: 100 } } },
    });
    expect(result.provider_meta).toBeUndefined();
    expect(result.model).toBe("gpt-4");
  });

  it("restores thinking_signatures to assistant message thinking blocks", () => {
    const result = openaiToAnthropicRequest({
      model: "gpt-4",
      messages: [
        { role: "user", content: "solve" },
        { role: "assistant", content: null, reasoning_content: "thinking..." },
      ],
      provider_meta: {
        anthropic: { thinking_signatures: [{ index: 0, signature: "sig_abc" }] },
      },
    });
    const assistantMsg = (result.messages as Array<Record<string, unknown>>).find(
      (m) => m.role === "assistant",
    );
    const thinkingBlock = (assistantMsg?.content as Array<Record<string, unknown>>)?.find(
      (b) => b.type === "thinking",
    );
    expect(thinkingBlock?.signature).toBe("sig_abc");
  });

  it("restores redacted_thinking blocks before assistant content", () => {
    const redacted = { type: "redacted_thinking", data: "blob" };
    const result = openaiToAnthropicRequest({
      model: "gpt-4",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "answer" },
      ],
      provider_meta: { anthropic: { redacted_thinking: [redacted] } },
    });
    const assistantMsg = (result.messages as Array<Record<string, unknown>>).find(
      (m) => m.role === "assistant",
    );
    const content = assistantMsg?.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("redacted_thinking");
  });

  it("does not warn about provider_meta as dropped field", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    openaiToAnthropicRequest({
      model: "gpt-4",
      messages: [],
      provider_meta: { anthropic: {} },
    });
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("provider_meta"));
    warnSpy.mockRestore();
  });
});
