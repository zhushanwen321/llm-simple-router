import { describe, it, expect } from "vitest";

// 以下内部类型和函数从 frontend/src/components/request-detail/response-parser.ts 内联复制而来
// 原因: router 的 vitest 无法解析前端的 @/ alias

const JSON_INDENT = 2;

type ContentBlock = {
  type: "thinking" | "text" | "tool_use" | "tool_result";
  content: string;
  name?: string;
};

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
          const fn = (p.function ?? p.input ?? {}) as Record<string, unknown>;
          result.push({ type: "tool_use", content: JSON.stringify(fn, null, JSON_INDENT), name: typeof p.name === "string" ? p.name : (typeof fn.name === "string" ? fn.name : "") });
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
  _apiType: "openai" | "anthropic",
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

// ---- Tests ----

describe("tryDirectParse - format auto-detection", () => {
  it("parses Anthropic format {content:[{type:'text'}]}", () => {
    const raw = JSON.stringify({ content: [{ type: "text", text: "hi" }] });
    const result = tryDirectParse(raw, null, "anthropic");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect(result[0].content).toBe("hi");
  });

  it("parses OpenAI Chat format {choices:[{message:{content}}]}", () => {
    const raw = JSON.stringify({ choices: [{ message: { content: "hi" } }] });
    const result = tryDirectParse(raw, null, "openai");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect(result[0].content).toBe("hi");
  });

  it("parses Responses API format {output:[{type:'message',content:...}]}", () => {
    const raw = JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "hi" }] }],
    });
    const result = tryDirectParse(raw, null, "openai");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect(result[0].content).toBe("hi");
  });

  it("unwraps body field from wrapped format", () => {
    const raw = JSON.stringify({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ content: [{ type: "text", text: "hi" }] }),
    });
    const result = tryDirectParse(raw, null, "anthropic");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("hi");
  });

  it("returns empty array for non-JSON responseBody", () => {
    const result = tryDirectParse("not-json", null, "openai");
    expect(result).toEqual([]);
  });

  it("returns empty array when both inputs are null", () => {
    const result = tryDirectParse(null, null, "openai");
    expect(result).toEqual([]);
  });

  it("falls back to upstreamResponse when responseBody is null", () => {
    const upstream = JSON.stringify({ content: [{ type: "text", text: "hi" }] });
    const result = tryDirectParse(null, upstream, "anthropic");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("hi");
  });

  it("prefers responseBody over upstreamResponse when both provided", () => {
    const responseBody = JSON.stringify({ content: [{ type: "text", text: "fromBody" }] });
    const upstream = JSON.stringify({ content: [{ type: "text", text: "fromUpstream" }] });
    const result = tryDirectParse(responseBody, upstream, "anthropic");
    expect(result[0].content).toBe("fromBody");
  });
});

describe("parseOpenAIChoices - edge cases", () => {
  it("handles reasoning_content + tool_calls + content together", () => {
    const choices = [{
      message: {
        reasoning_content: "think",
        tool_calls: [{ id: "c1", function: { name: "fn1", arguments: "{}" } }],
        content: "text",
      },
    }];
    const result = parseOpenAIChoices(choices as unknown[]);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("thinking");
    expect(result[0].content).toBe("think");
    expect(result[1].type).toBe("tool_use");
    expect(result[1].name).toBe("fn1");
    expect(result[2].type).toBe("text");
    expect(result[2].content).toBe("text");
  });

  it("handles tool_calls with no content", () => {
    const choices = [{
      message: {
        tool_calls: [{ id: "c1", function: { name: "fn1", arguments: "{}" } }],
      },
    }];
    const result = parseOpenAIChoices(choices as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("tool_use");
  });

  it("skips empty string reasoning_content", () => {
    const choices = [{
      message: { reasoning_content: "", content: "text" },
    }];
    const result = parseOpenAIChoices(choices as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  it("uses empty name for tool_calls without function.name", () => {
    const choices = [{
      message: {
        tool_calls: [{ id: "c1", function: { arguments: "{}" } }],
      },
    }];
    const result = parseOpenAIChoices(choices as unknown[]);
    expect(result[0].name).toBe("");
  });

  it("stringifies function.arguments when it is an object", () => {
    const choices = [{
      message: {
        tool_calls: [{
          id: "c1",
          function: { name: "fn1", arguments: { a: 1 } },
        }],
      },
    }];
    const result = parseOpenAIChoices(choices as unknown[]);
    // When arguments is an object, code stringifies the whole fn object
    const parsed = JSON.parse(result[0].content);
    expect(parsed.name).toBe("fn1");
    expect(parsed.arguments.a).toBe(1);
  });

  it("returns empty array for empty choices", () => {
    const result = parseOpenAIChoices([]);
    expect(result).toEqual([]);
  });

  it("returns empty array for choice without message", () => {
    const choices = [{ notMessage: "x" }];
    const result = parseOpenAIChoices(choices as unknown[]);
    expect(result).toEqual([]);
  });
});

describe("parseResponsesOutput - edge cases", () => {
  it("does not produce thinking block when summary is empty array", () => {
    const output = [{ type: "reasoning", summary: [] }];
    const result = parseResponsesOutput(output as unknown[]);
    expect(result).toEqual([]);
  });

  it("does not produce thinking block when summary is missing", () => {
    const output = [{ type: "reasoning" }];
    const result = parseResponsesOutput(output as unknown[]);
    expect(result).toEqual([]);
  });

  it("stringifies function_call arguments when it is an object", () => {
    const output = [{
      type: "function_call",
      name: "fn1",
      arguments: { a: 1 },
    }];
    const result = parseResponsesOutput(output as unknown[]);
    expect(result[0].type).toBe("tool_use");
    const parsed = JSON.parse(result[0].content);
    expect(parsed.a).toBe(1);
  });

  it("uses empty name for function_call without name", () => {
    const output = [{
      type: "function_call",
      arguments: '{"a":1}',
    }];
    const result = parseResponsesOutput(output as unknown[]);
    expect(result[0].name).toBe("");
  });

  it("does not produce text block when message content is empty array", () => {
    const output = [{
      type: "message",
      content: [],
    }];
    const result = parseResponsesOutput(output as unknown[]);
    expect(result).toEqual([]);
  });

  it("skips non-output_text items in message content", () => {
    const output = [{
      type: "message",
      content: [{ type: "thinking", text: "hmm" }],
    }];
    const result = parseResponsesOutput(output as unknown[]);
    expect(result).toEqual([]);
  });

  it("skips unknown item types", () => {
    const output = [{ type: "unknown_type" }];
    const result = parseResponsesOutput(output as unknown[]);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty output", () => {
    const result = parseResponsesOutput([]);
    expect(result).toEqual([]);
  });
});

describe("parseAnthropicContent - edge cases", () => {
  it("handles thinking block with missing thinking field", () => {
    const content = [{ type: "thinking" }];
    const result = parseAnthropicContent(content as unknown[]);
    expect(result[0].type).toBe("thinking");
    expect(result[0].content).toBe("");
  });

  it("handles tool_use block with missing input", () => {
    const content = [{ type: "tool_use", name: "fn1" }];
    const result = parseAnthropicContent(content as unknown[]);
    expect(result[0].type).toBe("tool_use");
    expect(result[0].content).toBe("{}");
    expect(result[0].name).toBe("fn1");
  });

  it("handles tool_result block with object content", () => {
    const content = [{ type: "tool_result", content: { result: "data" } }];
    const result = parseAnthropicContent(content as unknown[]);
    expect(result[0].type).toBe("tool_result");
    const parsed = JSON.parse(result[0].content);
    expect(parsed.result).toBe("data");
  });

  it("downgrades unknown block type to text", () => {
    const content = [{ type: "image", source: { url: "x" } }];
    const result = parseAnthropicContent(content as unknown[]);
    expect(result[0].type).toBe("text");
    const parsed = JSON.parse(result[0].content);
    expect(parsed.source.url).toBe("x");
  });
});
