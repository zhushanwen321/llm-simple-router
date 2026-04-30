import type { AnthropicContentBlock } from "./types.js";
import { sanitizeToolUseId, ensureNonEmptyContent, parseToolArguments } from "./sanitize.js";

// ---------- extractSystemMessages ----------

export function extractSystemMessages(
  messages: unknown[],
): { systemParts: string[]; nonSystemMsgs: unknown[] } {
  const systemParts: string[] = [];
  const nonSystemMsgs: unknown[] = [];
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    if (m.role === "system" || m.role === "developer") {
      systemParts.push(String(m.content ?? ""));
    } else {
      nonSystemMsgs.push(msg);
    }
  }
  return { systemParts, nonSystemMsgs };
}

// ---------- Content 归一化 ----------

function normalizeToTextBlocks(content: unknown): AnthropicContentBlock[] {
  if (content == null || content === "") return [];
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>).flatMap((p): AnthropicContentBlock[] => {
      if (p.type === "text" && p.text) {
        return [{ type: "text" as const, text: String(p.text) }];
      }
      // Convert OpenAI image_url to Anthropic image source
      if (p.type === "image_url") {
        const imageUrl = (p.image_url as { url: string })?.url;
        if (imageUrl) {
          if (imageUrl.startsWith("data:")) {
            // base64 data URL → base64 source
            const match = imageUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
            if (match) {
              return [{ type: "image" as const, source: { type: "base64", media_type: match[1], data: match[2] } }];
            }
          }
          return [{ type: "image" as const, source: { type: "url", url: imageUrl } }];
        }
      }
      return [];
    });
  }
  return [];
}

// ---------- OpenAI → Anthropic ----------

interface AntMessage { role: string; content: AnthropicContentBlock[] }

export function convertMessagesOA2Ant(
  messages: unknown[],
): { system?: string; messages: AntMessage[] } {
  ensureNonEmptyContent(messages);
  const { systemParts, nonSystemMsgs } = extractSystemMessages(messages);
  const system = systemParts.length > 0 ? systemParts.join("\n") : undefined;

  const raw: AntMessage[] = [];

  for (const msg of nonSystemMsgs) {
    const m = msg as Record<string, unknown>;
    if (m.role === "user") {
      raw.push({ role: "user", content: normalizeToTextBlocks(m.content) });
    } else if (m.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      // reasoning_content → thinking block (before text)
      if (m.reasoning_content) {
        blocks.push({ type: "thinking", thinking: String(m.reasoning_content) });
      }
      // text content (skip null/undefined/empty string)
      if (m.content != null && m.content !== "") {
        blocks.push(...normalizeToTextBlocks(m.content));
      }
      // tool_calls → tool_use blocks
      const toolCalls = m.tool_calls as Array<Record<string, unknown>> | undefined;
      if (toolCalls) {
        for (const tc of toolCalls) {
          const fn = tc.function as Record<string, unknown>;
          const input = parseToolArguments(fn.arguments);
          blocks.push({ type: "tool_use", id: sanitizeToolUseId(String(tc.id)), name: String(fn.name), input });
        }
      }
      if (blocks.length === 0) blocks.push({ type: "text", text: "" });
      raw.push({ role: "assistant", content: blocks });
    } else if (m.role === "tool") {
      // role:"tool" → role:"user" + tool_result
      const toolResult: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: sanitizeToolUseId(String(m.tool_call_id ?? "")),
        content: String(m.content ?? ""),
      };
      // 尝试合并到前一条 user 消息（或已有的 tool result 序列）
      const last = raw[raw.length - 1];
      if (last && last.role === "user" && last.content.every(b => b.type === "tool_result" || b.type === "text")) {
        last.content.push(toolResult);
      } else {
        raw.push({ role: "user", content: [toolResult] });
      }
    }
  }

  // 强制交替：合并同 role
  const merged: AntMessage[] = [];
  for (const msg of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content = [...prev.content, ...msg.content];
    } else {
      merged.push({ ...msg, content: [...msg.content] });
    }
  }

  // 确保首条是 user
  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", content: [{ type: "text", text: "" }] });
  }

  return { system, messages: merged };
}

// ---------- Anthropic → OpenAI ----------

export function convertMessagesAnt2OA(
  system: unknown,
  messages: unknown[],
): unknown[] {
  const result: unknown[] = [];

  // system → role:"system"
  if (system != null) {
    const text = typeof system === "string"
      ? system
      : Array.isArray(system)
        ? (system as Array<Record<string, unknown>>).map(b => b.text ?? "").join("\n")
        : String(system);
    if (text) result.push({ role: "system", content: text });
  }

  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const content = m.content as Array<Record<string, unknown>> | undefined;

    if (m.role === "user") {
      if (!content || !Array.isArray(content)) continue;
      const textParts = content.filter(b => b.type === "text");
      const toolResults = content.filter(b => b.type === "tool_result");

      if (textParts.length > 0) {
        result.push({ role: "user", content: textParts.map(b => b.text ?? "").join("") });
      }
      for (const tr of toolResults) {
        result.push({ role: "tool", tool_call_id: tr.tool_use_id, content: tr.content ?? "" });
      }
    } else if (m.role === "assistant") {
      if (!content || !Array.isArray(content)) continue;
      const textBlocks = content.filter(b => b.type === "text");
      const toolBlocks = content.filter(b => b.type === "tool_use");

      const oaiMsg: Record<string, unknown> = { role: "assistant" };

      // thinking → reasoning_content（保留 DeepSeek 原生思考信息，
      // 避免 A→O 转换后被 patchNonDeepSeekToolMessages 误判为非 DeepSeek 消息）
      const thinkingBlocks = content.filter(b => b.type === "thinking");
      if (thinkingBlocks.length > 0) {
        oaiMsg.reasoning_content = thinkingBlocks.map(b => b.thinking ?? "").join("");
      }

      // text → content
      if (textBlocks.length > 0) {
        oaiMsg.content = textBlocks.map(b => b.text ?? "").join("");
      }
      // tool_use → tool_calls
      if (toolBlocks.length > 0) {
        oaiMsg.tool_calls = toolBlocks.map(b => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      }

      if (oaiMsg.content || oaiMsg.tool_calls) {
        result.push(oaiMsg);
      }
    }
  }

  return result;
}
