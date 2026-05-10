import { randomUUID } from "crypto";
import type {
  ChatCompletionMessage,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicTextBlock,
  AnthropicThinkingBlock,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
} from "./types.js";
import { sanitizeToolUseId, ensureNonEmptyContent, parseToolArguments } from "./sanitize.js";

// ---------- extractSystemMessages ----------

export function extractSystemMessages(
  messages: ChatCompletionMessage[],
): { systemParts: string[]; nonSystemMsgs: ChatCompletionMessage[] } {
  const systemParts: string[] = [];
  const nonSystemMsgs: ChatCompletionMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      systemParts.push(msg.content ?? "");
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
        return [{ type: "text" as const, text: p.text as string }];
      }
      // Convert OpenAI image_url to Anthropic image source
      if (p.type === "image_url") {
        const imageUrl = (p.image_url as { url: string })?.url;
        if (imageUrl) {
          if (imageUrl.startsWith("data:")) {
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
  messages: ChatCompletionMessage[],
): { system?: string; messages: AntMessage[] } {
  ensureNonEmptyContent(messages);
  const { systemParts, nonSystemMsgs } = extractSystemMessages(messages);
  const system = systemParts.length > 0 ? systemParts.join("\n") : undefined;

  const raw: AntMessage[] = [];

  for (const msg of nonSystemMsgs) {
    if (msg.role === "user") {
      raw.push({ role: "user", content: normalizeToTextBlocks(msg.content) });
    } else if (msg.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      // reasoning_content → thinking block (before text)
      if (msg.reasoning_content) {
        blocks.push({ type: "thinking", thinking: msg.reasoning_content });
      }
      // text content (skip null/undefined/empty string)
      if (msg.content != null && msg.content !== "") {
        blocks.push(...normalizeToTextBlocks(msg.content));
      }
      // tool_calls → tool_use blocks
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const input = parseToolArguments(tc.function.arguments);
          blocks.push({ type: "tool_use", id: sanitizeToolUseId(tc.id), name: tc.function.name, input });
        }
      }
      if (blocks.length === 0) blocks.push({ type: "text", text: "" });
      raw.push({ role: "assistant", content: blocks });
    } else if (msg.role === "tool") {
      // role:"tool" → role:"user" + tool_result
      const toolResult: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: sanitizeToolUseId(msg.tool_call_id ?? ""),
        content: msg.content ?? "",
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
  messages: AnthropicMessage[],
): unknown[] {
  const result: unknown[] = [];

  // 预扫描：收集无 id 的 tool_use，为每个生成唯一 UUID。
  // OpenAI 格式要求 tool_calls[].id 非空，且 tool.tool_call_id 与之匹配。
  const syntheticIds: string[] = [];
  const assistantToolMap = new Map<number, Map<number, string>>();
  {
    let assistantIdx = 0;
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      if (!msg.content) { assistantIdx++; continue; }
      const toolBlocks = msg.content.filter((b): b is AnthropicToolUseBlock => b.type === "tool_use");
      if (toolBlocks.length > 0) {
        const idxMap = new Map<number, string>();
        for (let i = 0; i < toolBlocks.length; i++) {
          if (!toolBlocks[i].id) {
            const uid = randomUUID();
            idxMap.set(i, uid);
            syntheticIds.push(uid);
          }
        }
        if (idxMap.size > 0) assistantToolMap.set(assistantIdx, idxMap);
      }
      assistantIdx++;
    }
  }
  // 空 tool_use_id 的 tool_result 按出现顺序配对到 syntheticIds
  let syntheticCursor = 0;
  let assistantCounter = 0;

  // system → role:"system"
  if (system != null) {
    const text = typeof system === "string"
      ? system
      : Array.isArray(system)
        ? (system as Array<{ text?: string }>).map(b => b.text ?? "").join("\n")
        : JSON.stringify(system);
    if (text) result.push({ role: "system", content: text });
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      // content 在运行时可能是 string（非标准但需兼容）
      const content = Array.isArray(msg.content) ? msg.content : undefined;
      if (!content?.length) continue;
      const textParts = content.filter((b): b is AnthropicTextBlock => b.type === "text");
      const toolResults = content.filter((b): b is AnthropicToolResultBlock => b.type === "tool_result");

      if (textParts.length > 0) {
        result.push({ role: "user", content: textParts.map(b => b.text).join("") });
      }
      for (const tr of toolResults) {
        let toolCallId = tr.tool_use_id;
        // 空 tool_use_id → 按顺序配对到预生成的 UUID
        if (!toolCallId && syntheticCursor < syntheticIds.length) {
          toolCallId = syntheticIds[syntheticCursor++];
        }
        result.push({ role: "tool", tool_call_id: toolCallId, content: tr.content ?? "" });
      }
    } else if (msg.role === "assistant") {
      const content = Array.isArray(msg.content) ? msg.content : undefined;
      if (!content?.length) { assistantCounter++; continue; }
      const textBlocks = content.filter((b): b is AnthropicTextBlock => b.type === "text");
      const toolBlocks = content.filter((b): b is AnthropicToolUseBlock => b.type === "tool_use");
      const thinkingBlocks = content.filter((b): b is AnthropicThinkingBlock => b.type === "thinking");

      const oaiMsg: Record<string, unknown> = { role: "assistant" };

      // thinking → reasoning_content（保留 DeepSeek 原生思考信息，
      // 便于 patchThinkingConsistency 判断 thinking 模式是否激活）
      if (thinkingBlocks.length > 0) {
        oaiMsg.reasoning_content = thinkingBlocks.map(b => b.thinking).join("");
      }

      // text → content
      if (textBlocks.length > 0) {
        oaiMsg.content = textBlocks.map(b => b.text).join("");
      }
      // tool_use → tool_calls（无 id 的 tool_use 使用预生成的 UUID）
      if (toolBlocks.length > 0) {
        const idMap = assistantToolMap.get(assistantCounter);
        oaiMsg.tool_calls = toolBlocks.map((b, i) => ({
          id: b.id || (idMap ? idMap.get(i) || randomUUID() : randomUUID()),
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      }

      if (oaiMsg.content || oaiMsg.tool_calls) {
        result.push(oaiMsg);
      }
      assistantCounter++;
    }
  }

  return result;
}
