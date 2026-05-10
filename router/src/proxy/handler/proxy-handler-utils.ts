import { createHash } from "crypto";
import type { ContentBlock } from "../../core/monitor/types.js";
import type { ToolCallRecord } from "../../core/loop-prevention/types.js";
import type { TransportResult } from "../types.js";
import { parseToolArguments } from "../transform/sanitize.js";
import type { RawHeaders } from "../types.js";

const HASH_DIGEST_LENGTH = 16;

// ---------- Tool Error Logging ----------

export interface ClientSessionHeaderEntry {
  client_type: string;
  session_header_key: string;
}

export interface ClientDetectionResult {
  client_type: string;
  session_id: string | undefined;
}

export interface FailedToolResult {
  toolName: string;
  toolUseId: string | undefined;
}

/**
 * 根据配置的 session header 匹配请求头，识别客户端类型并提取 session_id。
 * 遍历配置列表，第一个匹配的条目确定 client_type 和 session_id。
 * 无匹配返回 { client_type: "unknown", session_id: undefined }。
 */
export function detectClient(
  headers: RawHeaders,
  config: ClientSessionHeaderEntry[],
): ClientDetectionResult {
  for (const entry of config) {
    const value = headers[entry.session_header_key];
    if (value && typeof value === "string") {
      return { client_type: entry.client_type, session_id: value };
    }
  }
  return { client_type: "unknown", session_id: undefined };
}

/**
 * 从请求体 messages 中提取本条请求新产生的失败 tool_result 块。
 *
 * 只扫描最后一条 role = "user" 且有 tool_result 的消息，
 * 避免重复记录前轮请求已记录的 tool 失败。
 *
 * 通过向前扫描 assistant 消息中的 tool_use 块
 * 关联对应的 tool_name。完整 input/error 内容通过
 * request_log_id + tool_use_id 从 request_logs 回溯。
 */
export function extractFailedToolResults(
  body: Record<string, unknown>,
): FailedToolResult[] {
  const messages = body.messages as Array<{
    role?: string;
    content?: unknown;
  }> | undefined;
  if (!messages || messages.length === 0) return [];

  // 第一步：从后往前找最后一个包含 tool_result 的 user 消息
  let lastUserIndex = -1;
  const resultBlocks: Array<{ tool_use_id?: string; is_error?: boolean }> = [];
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

  // 第二步：建立 tool_use_id → tool_name 映射
  const toolUseMap = new Map<string, string>();
  for (let i = 0; i < lastUserIndex; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type === "tool_use" && block.id) {
        toolUseMap.set(block.id, block.name ?? "unknown");
      }
    }
  }

  // 第三步：提取 is_error === true 的 tool_result
  const failures: FailedToolResult[] = [];
  for (const block of resultBlocks) {
    if (block.is_error !== true) continue;
    const toolUseId = block.tool_use_id && typeof block.tool_use_id === "string"
      ? block.tool_use_id : undefined;
    failures.push({
      toolName: toolUseId ? (toolUseMap.get(toolUseId) ?? "unknown") : "unknown",
      toolUseId,
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
