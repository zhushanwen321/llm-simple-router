import type { ContentBlock } from "./types.js";

const SSE_DATA_PREFIX = "data: ";

export interface StreamExtraction {
  text: string;
  block?: { index: number; type: ContentBlock["type"]; content: string; name?: string } | null;
}

export function extractStreamText(line: string, apiType: "openai" | "anthropic"): StreamExtraction {
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
    return { text, block: text ? { index: 0, type: "text", content: text } : null };
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
