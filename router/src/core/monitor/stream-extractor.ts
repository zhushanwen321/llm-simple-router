import type { ContentBlock } from "./types.js";

const SSE_DATA_PREFIX = "data: ";

// OpenAI stream block index 分配：reasoning/text/tools 使用不同区间避免混合
const OPENAI_BLOCK_REASONING = 0;
const OPENAI_BLOCK_TEXT = 1;
const OPENAI_BLOCK_TOOLS = 2;

// Responses SSE 事件类型 → block 类型映射
// 与 transform/types-responses.ts 的 RESPONSES_SSE_EVENTS 保持同步
const RESPONSES_DELTA_MAP: Record<string, "text" | "thinking" | "tool_use"> = {
  "response.output_text.delta": "text",
  "response.function_call_arguments.delta": "tool_use",
  "response.reasoning_summary_text.delta": "thinking",
  "response.reasoning_text.delta": "thinking",
  "response.refusal.delta": "text",
  "response.code_interpreter_call_code.delta": "text",
};

// 多种 Provider 的思考内容字段名（按优先级排列）
const REASONING_FIELDS = ["reasoning_content", "reasoning", "reasoning_text"] as const;

export interface StreamExtraction {
  text: string;
  block?: { index: number; type: ContentBlock["type"]; content: string; name?: string } | null;
}

export function extractStreamText(line: string, apiType: "openai" | "openai-responses" | "anthropic"): StreamExtraction {
  const empty: StreamExtraction = { text: "", block: null };
  if (!line.startsWith(SSE_DATA_PREFIX)) return empty;
  const jsonStr = line.slice(SSE_DATA_PREFIX.length);
  if (jsonStr === "[DONE]") return empty;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return empty;
  }

  if (apiType === "openai") {
    const choices = obj.choices as Array<Record<string, unknown>> | undefined;
    const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
    const text = (delta?.content as string) ?? "";
    // 多种 Provider 的思考字段名：reasoning_content（标准）、reasoning、reasoning_text
    let reasoning = "";
    for (const field of REASONING_FIELDS) {
      const val = delta?.[field];
      if (typeof val === "string" && val) {
        reasoning = val;
        break;
      }
    }

    // OpenAI 不像 Anthropic 那样为不同 content type 分配独立 index。
    // 策略：reasoning → OPENAI_BLOCK_REASONING, text → OPENAI_BLOCK_TEXT,
    // tool_calls[N] → OPENAI_BLOCK_TOOLS + N。
    // 这样不同类型的内容不会混在同一个 block 中。
    if (reasoning) {
      return { text: reasoning, block: { index: OPENAI_BLOCK_REASONING, type: "thinking", content: reasoning } };
    }
    if (text) {
      return { text, block: { index: OPENAI_BLOCK_TEXT, type: "text", content: text } };
    }
    // refusal 降级为 text block（内容审核拒绝原因）
    const refusal = (delta?.refusal as string) ?? "";
    if (refusal) {
      return { text: refusal, block: { index: OPENAI_BLOCK_TEXT, type: "text", content: refusal } };
    }
    const toolCalls = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      const tc = toolCalls[0];
      if (tc) {
        const tcIndex = (tc.index as number) ?? 0;
        const fn = tc.function as Record<string, unknown> | undefined;
        const args = (fn?.arguments as string) ?? "";
        const name = (fn?.name as string) ?? "";
        if (args || name) {
          return { text: "", block: { index: OPENAI_BLOCK_TOOLS + tcIndex, type: "tool_use", content: args, name: name || undefined } };
        }
      }
    }
    return empty;
  }

  if (apiType === "openai-responses") {
    // Responses SSE uses named events, but line format is "data: {json}" (same as Anthropic)
    // The event type is in the data JSON's "type" field
    const type = obj.type as string;
    const blockType = RESPONSES_DELTA_MAP[type];
    if (blockType) {
      const delta = (obj.delta as string) ?? "";
      const outputIndex = (obj.output_index as number) ?? 0;
      if (delta) {
        return { text: blockType === "text" ? delta : "", block: { index: outputIndex, type: blockType, content: delta } };
      }
    }
    return empty;
  }

  // Anthropic
  const type = obj.type as string | undefined;
  const index = obj.index as number | undefined;
  const delta = obj.delta as Record<string, unknown> | undefined;

  if (type === "content_block_start") {
    const contentBlock = obj.content_block as Record<string, unknown> | undefined;
    const blockType = contentBlock?.type as string | undefined;
    const name = blockType === "tool_use" ? (contentBlock?.name as string | undefined) : undefined;
    if (blockType === "thinking" || blockType === "text" || blockType === "tool_use") {
      return { text: "", block: { index: index ?? 0, type: blockType, content: "", name } };
    }
    return empty;
  }

  if (type === "content_block_delta" && delta) {
    const deltaType = delta.type as string | undefined;
    if (deltaType === "thinking_delta") {
      const thinking = (delta.thinking as string) ?? "";
      return { text: "", block: { index: index ?? 0, type: "thinking", content: thinking } };
    }
    if (deltaType === "text_delta") {
      const text = (delta.text as string) ?? "";
      return { text, block: { index: index ?? 0, type: "text", content: text } };
    }
    if (deltaType === "input_json_delta") {
      const partialJson = (delta.partial_json as string) ?? "";
      return { text: "", block: { index: index ?? 0, type: "tool_use", content: partialJson } };
    }
  }

  return empty;
}
