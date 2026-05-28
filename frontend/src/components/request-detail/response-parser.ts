import type { ContentBlock } from "@/types/monitor";

const JSON_INDENT = 2;

export function parseAnthropicContent(content: unknown[]): ContentBlock[] {
  return content.map((block: unknown) => {
    const b = block as Record<string, unknown>;
    if (b.type === "thinking")
      return {
        type: "thinking" as const,
        content: typeof b.thinking === "string" ? b.thinking : "",
      };
    if (b.type === "text")
      return {
        type: "text" as const,
        content: typeof b.text === "string" ? b.text : "",
      };
    if (b.type === "tool_use")
      return {
        type: "tool_use" as const,
        content: JSON.stringify(b.input ?? {}, null, JSON_INDENT),
        name: typeof b.name === "string" ? b.name : "",
      };
    if (b.type === "tool_result")
      return {
        type: "tool_result",
        content:
          typeof b.content === "string" ? b.content : JSON.stringify(b.content),
      };
    return { type: "text" as const, content: JSON.stringify(b) };
  });
}

export function parseOpenAIChoices(choices: unknown[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  for (const choice of choices) {
    const c = choice as Record<string, unknown>;
    const msg = c.message as Record<string, unknown> | undefined;
    if (!msg) continue;

    // reasoning_content → thinking block（优先于 content，思考过程在前）
    const reasoningContent = msg.reasoning_content;
    if (typeof reasoningContent === "string" && reasoningContent) {
      result.push({ type: "thinking", content: reasoningContent });
    }

    // tool_calls → tool_use blocks
    const toolCalls = msg.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const t = tc as Record<string, unknown>;
        const fn = (t.function ?? {}) as Record<string, unknown>;
        const args =
          typeof fn.arguments === "string"
            ? fn.arguments
            : JSON.stringify(fn, null, JSON_INDENT);
        const name =
          typeof t.name === "string"
            ? t.name
            : typeof fn.name === "string"
              ? fn.name
              : "";
        result.push({ type: "tool_use", content: args, name });
      }
    }

    // refusal 降级为 text block（内容审核拒绝原因）
    const refusal = msg.refusal;
    if (typeof refusal === "string" && refusal) {
      result.push({ type: "text", content: refusal });
    }

    // content（字符串或结构化数组）
    const content = msg.content;
    if (typeof content === "string" && content) {
      result.push({ type: "text", content });
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const p = part as Record<string, unknown>;
        if (p.type === "text" || p.type === "output_text")
          result.push({
            type: "text",
            content: typeof p.text === "string" ? p.text : "",
          });
        else if (p.type === "tool_use" || p.type === "function") {
          const fn = (p.function ?? p.input ?? {}) as Record<string, unknown>;
          result.push({
            type: "tool_use",
            content: JSON.stringify(fn, null, JSON_INDENT),
            name:
              typeof p.name === "string"
                ? p.name
                : typeof fn.name === "string"
                  ? fn.name
                  : "",
          });
        }
      }
    }
  }
  return result;
}

/** 解析 Responses API 输出格式：output 数组中的 message/function_call/reasoning items */
export function parseResponsesOutput(output: unknown[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  for (const item of output) {
    const it = item as Record<string, unknown>;
    if (it.type === "reasoning") {
      // reasoning → thinking（从 summary 提取文本）
      const summary = it.summary as Array<Record<string, string>> | undefined;
      const summaryText = summary
        ? summary.map((s) => s.text ?? "").join("")
        : "";
      // 无 summary 但有 encrypted_content 时用占位文本
      const encryptedContent =
        typeof it.encrypted_content === "string" ? it.encrypted_content : "";
      const text =
        summaryText || (encryptedContent ? "[Encrypted reasoning]" : "");
      if (text) result.push({ type: "thinking", content: text });
    } else if (it.type === "function_call") {
      // function_call → tool_use
      result.push({
        type: "tool_use",
        content:
          typeof it.arguments === "string"
            ? it.arguments
            : JSON.stringify(it.arguments ?? {}, null, JSON_INDENT),
        name: typeof it.name === "string" ? it.name : "",
      });
    } else if (it.type === "function_call_output") {
      // function_call_output → tool_result
      const outputContent =
        typeof it.output === "string"
          ? it.output
          : JSON.stringify(it.output ?? "", null, JSON_INDENT);
      result.push({ type: "tool_result", content: outputContent });
    } else if (it.type === "message") {
      // message → 遍历 content 数组提取 output_text / refusal
      const content = it.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (
            part.type === "output_text" &&
            typeof part.text === "string" &&
            part.text
          ) {
            result.push({ type: "text", content: part.text });
          } else if (
            part.type === "refusal" &&
            typeof part.refusal === "string" &&
            part.refusal
          ) {
            // refusal 降级为 text block
            result.push({ type: "text", content: part.refusal });
          }
        }
      }
    }
  }
  return result;
}

export function tryDirectParse(
  responseBody: string | null,
  upstreamResponse: string | null,
): ContentBlock[] {
  const raw = responseBody || upstreamResponse;
  if (!raw) return [];

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    /* 响应体不是合法 JSON，直接返回空数组 */ return [];
  }

  const outer = data as Record<string, unknown>;
  if (typeof outer.body === "string") {
    try {
      data = JSON.parse(outer.body);
    } catch {
      /* use outer data */ data = data;
    }
  }

  const parsed = data as Record<string, unknown>;

  // 格式自动检测，不依赖 apiType（"openai-responses" 在前端被降级为 "openai"，但实际响应格式不同）
  if (Array.isArray(parsed.content)) {
    return parseAnthropicContent(parsed.content);
  }

  if (Array.isArray(parsed.choices)) {
    return parseOpenAIChoices(parsed.choices);
  }

  // Responses API 格式：{ object: "response", output: [{ type: "message"/"function_call"/"reasoning" }] }
  if (Array.isArray(parsed.output)) {
    return parseResponsesOutput(parsed.output);
  }

  return [];
}
