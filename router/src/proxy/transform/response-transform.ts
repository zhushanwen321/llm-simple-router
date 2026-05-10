import { generateMsgId, generateChatcmplId, MS_PER_SECOND } from "./id-utils.js";
import { mapFinishReasonToStopReason, mapStopReasonToFinishReason, mapUsageOA2Ant, mapUsageAnt2OA } from "./usage-mapper.js";
import { extractAnthropicMeta } from "./provider-meta.js";
import { parseToolArguments } from "./sanitize.js";
import type { AnthropicContentBlock, AnthropicTextBlock, AnthropicThinkingBlock, AnthropicToolUseBlock, OpenAIToolCall } from "./types.js";

export function openaiResponseToAnthropic(bodyStr: string): string {
  const oai = JSON.parse(bodyStr) as {
    model?: string;
    choices?: Array<{
      message?: {
        content?: string;
        reasoning_content?: string;
        tool_calls?: OpenAIToolCall[];
      };
      finish_reason?: string;
    }>;
    usage?: Record<string, unknown>;
  };
  const choice = oai.choices?.[0];
  const msg = choice?.message;
  const content: unknown[] = [];

  // reasoning_content → thinking block (first)
  if (msg?.reasoning_content) {
    content.push({ type: "thinking", thinking: msg.reasoning_content });
  }
  // text content
  if (msg?.content) {
    content.push({ type: "text", text: msg.content });
  }
  // tool_calls → tool_use blocks
  if (msg?.tool_calls) {
    for (const tc of msg.tool_calls) {
      const input = parseToolArguments(tc.function.arguments);
      content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  return JSON.stringify({
    id: generateMsgId(),
    type: "message",
    role: "assistant",
    content,
    model: oai.model,
    stop_reason: mapFinishReasonToStopReason(choice?.finish_reason ?? "stop"),
    stop_sequence: null,
    usage: mapUsageOA2Ant(oai.usage),
  });
}

export function anthropicResponseToOpenAI(bodyStr: string): string {
  const ant = JSON.parse(bodyStr) as {
    id?: string;
    model?: string;
    content?: AnthropicContentBlock[];
    stop_reason?: string;
    usage?: Record<string, unknown>;
  };
  const blocks = ant.content ?? [];

  const thinkingText = blocks.filter((b): b is AnthropicThinkingBlock => b.type === "thinking").map(b => b.thinking).join("");
  const textContent = blocks.filter((b): b is AnthropicTextBlock => b.type === "text").map(b => b.text).join("");
  const toolBlocks = blocks.filter((b): b is AnthropicToolUseBlock => b.type === "tool_use");

  const message: Record<string, unknown> = { role: "assistant" };
  if (thinkingText) message.reasoning_content = thinkingText;
  if (textContent) message.content = textContent;
  if (toolBlocks.length > 0) {
    message.tool_calls = toolBlocks.map(b => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));
  }

  // preserve Anthropic-specific fields that would be lost in conversion
  const antMeta = extractAnthropicMeta(ant as Record<string, unknown>);

  const result: Record<string, unknown> = {
    id: ant.id ?? generateChatcmplId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / MS_PER_SECOND),
    model: ant.model,
    choices: [{ index: 0, message, finish_reason: mapStopReasonToFinishReason(ant.stop_reason ?? "end_turn") }],
    usage: mapUsageAnt2OA(ant.usage),
  };
  if (antMeta) {
    result.provider_meta = { anthropic: antMeta };
  }

  return JSON.stringify(result);
}

export function transformResponseBody(bodyStr: string, sourceApiType: string, targetApiType: string): string {
  if (sourceApiType === targetApiType) return bodyStr;
  if (sourceApiType === "openai" && targetApiType === "anthropic") return openaiResponseToAnthropic(bodyStr);
  if (sourceApiType === "anthropic" && targetApiType === "openai") return anthropicResponseToOpenAI(bodyStr);
  return bodyStr;
}

export function transformErrorResponse(bodyStr: string, sourceApiType: string, targetApiType: string): string {
  if (sourceApiType === targetApiType) return bodyStr;
  try {
    if (sourceApiType === "anthropic" && targetApiType === "openai") {
      const ant = JSON.parse(bodyStr) as Record<string, unknown>;
      const err = (ant.error as Record<string, unknown>) ?? {};
      return JSON.stringify({ error: { message: err.message ?? "Unknown error", type: err.type ?? "api_error", code: "upstream_error" } });
    }
    if (sourceApiType === "openai" && targetApiType === "anthropic") {
      const oai = JSON.parse(bodyStr) as Record<string, unknown>;
      const err = (oai.error as Record<string, unknown>) ?? {};
      return JSON.stringify({ type: "error", error: { type: err.type ?? "api_error", message: err.message ?? "Unknown error" } });
    }
  } catch {
    return bodyStr;
  }
  return bodyStr;
}
