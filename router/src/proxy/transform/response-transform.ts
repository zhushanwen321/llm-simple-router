import { generateMsgId, generateChatcmplId, MS_PER_SECOND } from "./id-utils.js";
import { mapFinishReasonToStopReason, mapStopReasonToFinishReason, mapUsageOA2Ant, mapUsageAnt2OA } from "./usage-mapper.js";
import { extractAnthropicMeta } from "./provider-meta.js";
import { parseToolArguments } from "./sanitize.js";
import type { AnthropicContentBlock, AnthropicTextBlock, AnthropicThinkingBlock, AnthropicToolUseBlock, OpenAIToolCall } from "./types.js";

export function openaiResponseToAnthropic(body: Record<string, unknown>): Record<string, unknown> {
  const oai = body;
  const choices = oai.choices as Array<{
  message?: {
    content?: string;
    reasoning_content?: string;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason?: string;
  }> | undefined;
  const choice = choices?.[0];
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
    if (!tc.function) continue;
    const input = parseToolArguments(tc.function.arguments);
    content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
  }
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  return {
  id: generateMsgId(),
  type: "message",
  role: "assistant",
  content,
  model: oai.model,
  stop_reason: mapFinishReasonToStopReason(choice?.finish_reason ?? "stop"),
  stop_sequence: null,
  usage: mapUsageOA2Ant(oai.usage as Record<string, unknown> | undefined),
  };
}

export function anthropicResponseToOpenAI(body: Record<string, unknown>): Record<string, unknown> {
  const ant = body;
  const blocks = Array.isArray(ant.content) ? (ant.content as AnthropicContentBlock[]) : [];

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
  choices: [{ index: 0, message, finish_reason: mapStopReasonToFinishReason(ant.stop_reason as string ?? "end_turn") }],
  usage: mapUsageAnt2OA(ant.usage as Record<string, unknown> | undefined),
  };
  if (antMeta) {
  result.provider_meta = { anthropic: antMeta };
  }

  return result;
}

export function transformResponseBody(body: Record<string, unknown>, sourceApiType: string, targetApiType: string): Record<string, unknown> {
  if (sourceApiType === targetApiType) return body;
  if (sourceApiType === "openai" && targetApiType === "anthropic") return openaiResponseToAnthropic(body);
  if (sourceApiType === "anthropic" && targetApiType === "openai") return anthropicResponseToOpenAI(body);
  return body;
}

export function transformErrorResponse(body: Record<string, unknown>, sourceApiType: string, targetApiType: string): string {
  if (sourceApiType === targetApiType) return JSON.stringify(body);
  try {
  if (sourceApiType === "anthropic" && targetApiType === "openai") {
  const err = (body.error as Record<string, unknown>) ?? {};
  return JSON.stringify({ error: { message: err.message ?? "Unknown error", type: err.type ?? "api_error", code: "upstream_error" } });
  }
  if (sourceApiType === "openai" && targetApiType === "anthropic") {
  const err = (body.error as Record<string, unknown>) ?? {};
  return JSON.stringify({
  type: "error",
  error: {
    type: err.type ?? "api_error",
    message: err.message ?? "Unknown error",
    code: err.code ?? undefined,
    param: err.param ?? undefined,
  },
  });
  }
  } catch {
  return JSON.stringify(body);
  }
  return JSON.stringify(body);
}
