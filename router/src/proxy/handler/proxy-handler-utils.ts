import { createHash } from "crypto";
import type { ContentBlock } from "@llm-router/core/monitor";
import type { ToolCallRecord } from "@llm-router/core/loop-prevention";
import type { TransportResult } from "../types.js";
import { parseToolArguments } from "../transform/sanitize.js";

const HASH_DIGEST_LENGTH = 16;

/** 从 TransportResult 中提取最终 HTTP status code */
export function getTransportStatusCode(result: TransportResult): number | null {
  if (result.kind === "success" || result.kind === "error" || result.kind === "stream_error") return result.statusCode;
  if (result.kind === "stream_success" || result.kind === "stream_abort") return result.statusCode;
  return null;
}

/** 将 tracker blocks 序列化为前端 tryDirectParse 可解析的 JSON */
export function serializeBlocksForStorage(blocks: ContentBlock[] | undefined, apiType: "openai" | "openai-responses" | "anthropic"): string {
  if (!blocks || blocks.length === 0) return "";
  if (apiType === "anthropic") {
    const content = blocks.map(b => {
      if (b.type === "thinking") return { type: "thinking", thinking: b.content };
      if (b.type === "tool_use") {
        return { type: "tool_use", name: b.name ?? "", input: parseToolArguments(b.content) };
      }
      return { type: "text", text: b.content };
    });
    return JSON.stringify({ content });
  }
  const text = blocks.filter(b => b.type === "text").map(b => b.content).join("");
  return JSON.stringify({ choices: [{ message: { content: text } }] });
}

/** 从请求体中提取最后一次工具调用记录 */
export function extractLastToolUse(body: Record<string, unknown>): ToolCallRecord | null {
  const messages = body.messages as Array<{ role?: string; content?: Array<{ type?: string; id?: string; name?: string; input?: unknown }> }> | undefined;
  if (!messages) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (block.type === "tool_use") {
        const inputText = JSON.stringify(block.input ?? {});
        const inputHash = createHash("sha256").update(inputText).digest("hex").slice(0, HASH_DIGEST_LENGTH);
        return {
          toolName: block.name ?? "unknown",
          toolUseId: block.id,
          inputHash,
          inputText,
          timestamp: Date.now(),
        };
      }
    }
  }
  return null;
}
