import { createHash } from "crypto";
import type { ContentBlock } from "@llm-router/core/monitor";
import type { ToolCallRecord } from "@llm-router/core/loop-prevention";
import type { TransportResult } from "../types.js";
import { parseToolArguments } from "../transform/sanitize.js";
import type { RawHeaders } from "../types.js";

const HASH_DIGEST_LENGTH = 16;

// ---------- Tool Error Logging ----------

export type ClientAgentType = "claude-code" | "pi" | "unknown";

export interface FailedToolResult {
  toolName: string;
  toolUseId: string | undefined;
  toolInput: string | undefined;
  errorContent: string;
}

/**
 * 根据请求头识别客户端类型。
 * - Claude Code 独有 x-claude-code-session-id 头
 * - pi 的 User-Agent 包含 "pi-coding-agent"
 */
export function detectClientAgentType(headers: RawHeaders): ClientAgentType {
  if (headers["x-claude-code-session-id"]) return "claude-code";
  const ua = String(headers["user-agent"] ?? "").toLowerCase();
  if (ua.includes("pi-coding-agent")) return "pi";
  return "unknown";
}

/**
 * 从请求体 messages 中提取本条请求新产生的失败 tool_result 块。
 *
 * 只扫描最后一条 role = "user" 且有 tool_result 的消息，
 * 避免重复记录前轮请求已记录的 tool 失败。
 *
 * 通过向前扫描 assistant 消息中的 tool_use 块
 * 关联对应的 tool_name 和 tool_input。
 */
export function extractFailedToolResults(
  body: Record<string, unknown>,
): FailedToolResult[] {
  const messages = body.messages as Array<{
    role?: string;
    content?: unknown;
  }> | undefined;
  if (!messages || messages.length === 0) return [];

  // 第一步：向后往前找最后一个包含 tool_result 的 user 消息
  let lastUserIndex = -1;
  const resultBlocks: Array<{ tool_use_id?: string; content: unknown; is_error?: boolean }> = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_result") {
        resultBlocks.push(block);
        lastUserIndex = i;
      }
    }
    if (resultBlocks.length > 0) break;
  }
  if (lastUserIndex < 0) return [];

  // 第二步：在整个 messages 中建立 tool_use_id → { name, input } 映射
  const toolUseMap = new Map<string, { name: string; input: string }>();
  for (let i = 0; i < lastUserIndex; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type === "tool_use" && block.id) {
        const inputText = block.input ? JSON.stringify(block.input) : "";
        toolUseMap.set(block.id, { name: block.name ?? "unknown", input: inputText });
      }
    }
  }

  // 第三步：提取 is_error === true 的 tool_result
  const failures: FailedToolResult[] = [];
  for (const block of resultBlocks) {
    if (block.is_error !== true) continue;
    const toolUse = block.tool_use_id && typeof block.tool_use_id === "string"
      ? toolUseMap.get(block.tool_use_id)
      : undefined;
    const errorContent = typeof block.content === "string"
      ? block.content
      : JSON.stringify(block.content ?? "");
    failures.push({
      toolName: toolUse?.name ?? "unknown",
      toolUseId: block.tool_use_id,
      toolInput: toolUse?.input,
      errorContent,
    });
  }
  return failures;
}

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
