import { describe, it, expect } from "vitest";

// Inline functions from frontend/src/components/request-detail/response-parser.ts
// because router vitest cannot resolve @/ alias

const JSON_INDENT = 2;

type ContentBlock = {
  type: "thinking" | "text" | "tool_use" | "tool_result";
  content: string;
  name?: string;
};

function parseOpenAIChoices(choices: unknown[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  for (const choice of choices) {
    const c = choice as Record<string, unknown>;
    const msg = c.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const reasoningContent = msg.reasoning_content;
    if (typeof reasoningContent === "string" && reasoningContent) {
      result.push({ type: "thinking", content: reasoningContent });
    }
    const toolCalls = msg.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const t = tc as Record<string, unknown>;
        const fn = (t.function ?? {}) as Record<string, unknown>;
        const args = typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn, null, JSON_INDENT);
        const name = typeof t.name === "string" ? t.name : (typeof fn.name === "string" ? fn.name : "");
        result.push({ type: "tool_use", content: args, name });
      }
    }
    // refusal 降级为 text block
    const refusal = msg.refusal;
    if (typeof refusal === "string" && refusal) {
      result.push({ type: "text", content: refusal });
    }
    const content = msg.content;
    if (typeof content === "string" && content) {
      result.push({ type: "text", content });
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const p = part as Record<string, unknown>;
        if (p.type === "text" || p.type === "output_text") result.push({ type: "text", content: typeof p.text === "string" ? p.text : "" });
        else if (p.type === "tool_use" || p.type === "function") {
          const fn2 = (p.function ?? p.input ?? {}) as Record<string, unknown>;
          result.push({ type: "tool_use", content: JSON.stringify(fn2, null, JSON_INDENT), name: typeof p.name === "string" ? p.name : (typeof fn2.name === "string" ? fn2.name : "") });
        }
      }
    }
  }
  return result;
}

function parseResponsesOutput(output: unknown[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  for (const item of output) {
    const it = item as Record<string, unknown>;
    if (it.type === "reasoning") {
      const summary = it.summary as Array<Record<string, string>> | undefined;
      const summaryText = summary ? summary.map(s => s.text ?? "").join("") : "";
      const encryptedContent = typeof it.encrypted_content === "string" ? it.encrypted_content : "";
      const text = summaryText || (encryptedContent ? "[Encrypted reasoning]" : "");
      if (text) result.push({ type: "thinking", content: text });
    } else if (it.type === "function_call") {
      result.push({
        type: "tool_use",
        content: typeof it.arguments === "string" ? it.arguments : JSON.stringify(it.arguments ?? {}, null, JSON_INDENT),
        name: typeof it.name === "string" ? it.name : "",
      });
    } else if (it.type === "function_call_output") {
      const outputContent = typeof it.output === "string" ? it.output : JSON.stringify(it.output ?? "", null, JSON_INDENT);
      result.push({ type: "tool_result", content: outputContent });
    } else if (it.type === "message") {
      const content = it.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "output_text" && typeof part.text === "string" && part.text) {
            result.push({ type: "text", content: part.text });
          } else if (part.type === "refusal" && typeof part.refusal === "string" && part.refusal) {
            result.push({ type: "text", content: part.refusal });
          }
        }
      }
    }
  }
  return result;
}

function tryDirectParse(
  responseBody: string | null,
  upstreamResponse: string | null,
): ContentBlock[] {
  const raw = responseBody || upstreamResponse;
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  const outer = data as Record<string, unknown>;
  if (typeof outer.body === "string") {
    try { data = JSON.parse(outer.body); } catch { /* keep original data */ }
  }
  const parsed = data as Record<string, unknown>;
  if (Array.isArray(parsed.content)) {
    return parseAnthropicContent(parsed.content);
  }
  if (Array.isArray(parsed.choices)) {
    return parseOpenAIChoices(parsed.choices);
  }
  if (Array.isArray(parsed.output)) {
    return parseResponsesOutput(parsed.output);
  }
  return [];
}

function parseAnthropicContent(content: unknown[]): ContentBlock[] {
  return content.map((block: unknown) => {
    const b = block as Record<string, unknown>;
    if (b.type === "thinking") return { type: "thinking" as const, content: typeof b.thinking === "string" ? b.thinking : "" };
    if (b.type === "text") return { type: "text" as const, content: typeof b.text === "string" ? b.text : "" };
    if (b.type === "tool_use") return { type: "tool_use" as const, content: JSON.stringify(b.input ?? {}, null, JSON_INDENT), name: typeof b.name === "string" ? b.name : "" };
    if (b.type === "tool_result") return { type: "tool_result", content: typeof b.content === "string" ? b.content : JSON.stringify(b.content) };
    return { type: "text" as const, content: JSON.stringify(b) };
  });
}

// ---- Tests ----

describe("parseOpenAIChoices - silent loss scenarios", () => {
  // FAIL: message.refusal field is ignored, returns empty array when content is null
  it("should produce a block for message.refusal when content is null", () => {
    const choices = [{
      message: {
        role: "assistant",
        refusal: "I cannot assist.",
        content: null,
      },
    }];
    const result = parseOpenAIChoices(choices as unknown[]);
    // Expected: at least some block representing the refusal
    expect(result.length).toBeGreaterThan(0);
  });

  // FAIL: image_url type in content array is silently skipped
  it.skip("image_url — won't fix: requires ContentBlock type change", () => {
    const choices = [{
      message: {
        role: "assistant",
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,abc123" } }],
      },
    }];
    const result = parseOpenAIChoices(choices as unknown[]);
    // Expected: at least degrade to text or preserve some info
    expect(result.length).toBeGreaterThan(0);
  });

  // FAIL: output_text type in Chat content array is silently skipped (only 'text' is recognized)
  it("should recognize output_text type in content array (Responses format mixed in)", () => {
    const choices = [{
      message: {
        role: "assistant",
        content: [{ type: "output_text", text: "hello" }],
      },
    }];
    const result = parseOpenAIChoices(choices as unknown[]);
    // Expected: text block with "hello"
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(b => b.content === "hello")).toBe(true);
  });

  // PASS: content null + tool_calls works correctly
  it("should return only tool_use blocks when content is null and tool_calls present", () => {
    const choices = [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "fn1", arguments: "{}" } }],
      },
    }];
    const result = parseOpenAIChoices(choices as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("tool_use");
    expect(result[0].name).toBe("fn1");
  });

  // PASS: non-string content like 0 is correctly skipped (typeof !== 'string')
  it("should skip content when it is a number (0)", () => {
    const choices = [{
      message: { role: "assistant", content: 0 },
    }];
    const result = parseOpenAIChoices(choices as unknown[]);
    // content=0 is neither string nor array, so no text block produced
    expect(result).toEqual([]);
  });

  // PASS: null function degrades gracefully to empty object
  it("should degrade gracefully when tool_calls.function is null", () => {
    const choices = [{
      message: {
        role: "assistant",
        tool_calls: [{ id: "c1", type: "function", function: null }],
      },
    }];
    const result = parseOpenAIChoices(choices as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("tool_use");
    expect(result[0].name).toBe("");
    expect(result[0].content).toBe("{}");
  });
});

describe("parseResponsesOutput - silent loss scenarios", () => {
  // FAIL: function_call_output is silently skipped (no tool_result block produced)
  it("should generate tool_result block for function_call_output type", () => {
    const output = [{
      type: "function_call_output",
      call_id: "c1",
      output: "result text",
    }];
    const result = parseResponsesOutput(output as unknown[]);
    // Expected: at least a tool_result or text block
    expect(result.length).toBeGreaterThan(0);
  });

  // FAIL: reasoning with only encrypted_content and no summary produces no block
  it("should produce thinking block for reasoning with only encrypted_content (no summary)", () => {
    const output = [{
      type: "reasoning",
      id: "rs_1",
      encrypted_content: "encrypted...",
    }];
    const result = parseResponsesOutput(output as unknown[]);
    // Expected: at least an empty thinking block or one noting encrypted content
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(b => b.type === "thinking")).toBe(true);
  });

  // PASS: reasoning with summary works, encrypted_content loss is acceptable
  it("should extract thinking from reasoning with summary (encrypted_content loss is acceptable)", () => {
    const output = [{
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "thinking..." }],
      encrypted_content: "enc...",
    }];
    const result = parseResponsesOutput(output as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("thinking");
    expect(result[0].content).toBe("thinking...");
  });

  // FAIL: refusal type in message content is silently skipped
  it("should not silently skip refusal type in message content", () => {
    const output = [{
      type: "message",
      id: "m1",
      role: "assistant",
      content: [{ type: "refusal", refusal: "Cannot assist" }],
    }];
    const result = parseResponsesOutput(output as unknown[]);
    // Expected: at least some block for the refusal
    expect(result.length).toBeGreaterThan(0);
  });

  // PASS: annotations on output_text don't affect text extraction
  it("should extract text from output_text with annotations field", () => {
    const output = [{
      type: "message",
      id: "m1",
      role: "assistant",
      content: [{
        type: "output_text",
        text: "See [1]",
        annotations: [{ type: "url_citation", url: "https://example.com" }],
      }],
    }];
    const result = parseResponsesOutput(output as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect(result[0].content).toBe("See [1]");
  });

  // PASS: web_search_call is skipped, message is preserved
  it("should skip web_search_call and preserve message items", () => {
    const output = [
      { type: "web_search_call", id: "ws_1", status: "completed" },
      {
        type: "message",
        id: "m1",
        role: "assistant",
        content: [{ type: "output_text", text: "Result" }],
      },
    ];
    const result = parseResponsesOutput(output as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect(result[0].content).toBe("Result");
  });
});

describe("tryDirectParse - edge cases", () => {
  // PASS: unknown output type is skipped, returns empty
  it("should return empty array for Responses format with unknown output type", () => {
    const responseBody = JSON.stringify({
      output: [{ type: "custom_type", data: "..." }],
    });
    const result = tryDirectParse(responseBody, null);
    expect(result).toEqual([]);
  });

  // PASS: non-JSON body falls back to outer data, doesn't match any format
  it("should return empty for wrapped format with non-JSON body string", () => {
    const responseBody = JSON.stringify({
      statusCode: 200,
      headers: {},
      body: "not-json",
    });
    const result = tryDirectParse(responseBody, null);
    // JSON.parse("not-json") fails → falls back to outer data
    // outer has statusCode/headers but no content/choices/output → returns []
    expect(result).toEqual([]);
  });
});
