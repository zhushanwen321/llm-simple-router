import { convertMessagesOA2Ant, convertMessagesAnt2OA } from "./message-mapper.js";
import { convertToolsOA2Ant, convertToolsAnt2OA, mapToolChoiceOA2Ant, mapToolChoiceAnt2OA } from "./tool-mapper.js";
import { mapReasoningToThinking, mapThinkingToReasoning } from "./thinking-mapper.js";
import { stripProviderMeta } from "./provider-meta.js";
import type { ChatCompletionRequest, AnthropicMessage, AnthropicContentBlock, AnthropicRequest } from "./types.js";

const DEFAULT_MAX_TOKENS = 4096;
const OA_KNOWN_FIELDS = new Set([
  "model", "messages", "max_completion_tokens", "max_tokens",
  "stop", "temperature", "top_p", "stream", "tools", "tool_choice",
  "parallel_tool_calls", "reasoning", "user", "n", "stream_options",
  "response_format", "provider_meta",
]);

const ANT_KNOWN_FIELDS = new Set([
  "model", "system", "messages", "max_tokens",
  "stop_sequences", "temperature", "top_p", "stream", "tools", "tool_choice",
  "thinking", "metadata",
]);

/** Log dropped fields for debugging */
function logDroppedFields(body: Record<string, unknown>, known: Set<string>, direction: string): void {
  const dropped = Object.keys(body).filter(k => !known.has(k));
  if (dropped.length > 0) {
    console.warn(`[request-transform] ${direction}: dropped unknown fields: ${dropped.join(", ")}`);
  }
}

/** ChatCompletionRequest 补充工具层使用的额外字段 */
type FullOARequest = ChatCompletionRequest & {
  stop?: string | string[];
  parallel_tool_calls?: boolean;
  user?: string;
};

export function openaiToAnthropicRequest(body: Record<string, unknown>): Record<string, unknown> {
  // strip provider_meta before processing, restore PSF to messages later
  const { meta: antMeta, body: cleanedBody } = stripProviderMeta(body);
  const req = cleanedBody as unknown as FullOARequest;

  const result: Record<string, unknown> = {};
  result.model = req.model;

  const { system, messages } = convertMessagesOA2Ant(req.messages ?? []);
  if (system != null) result.system = system;
  result.messages = messages;

  result.max_tokens = req.max_completion_tokens ?? req.max_tokens ?? DEFAULT_MAX_TOKENS;

  if (req.stop != null) {
    result.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
  }

  if (req.temperature != null) result.temperature = req.temperature;
  if (req.top_p != null) result.top_p = req.top_p;
  if (req.stream != null) result.stream = req.stream;

  if (req.tool_choice === "none" || (typeof req.tool_choice === "object" && (req.tool_choice as Record<string, unknown>).type === "none")) {
    // Anthropic has no "none" tool_choice — skip tools entirely
  } else {
    if (req.tools) {
      result.tools = convertToolsOA2Ant(req.tools);
    }
    if (req.tool_choice != null) {
      const mapped = mapToolChoiceOA2Ant(req.tool_choice);
      if (mapped != null) {
        result.tool_choice = req.parallel_tool_calls === false
          ? { ...(mapped as Record<string, unknown>), disable_parallel_tool_use: true }
          : mapped;
      }
    } else if (req.parallel_tool_calls === false) {
      result.tool_choice = { type: "auto", disable_parallel_tool_use: true };
    }
  }

  if (req.reasoning) {
    const thinking = mapReasoningToThinking(req.reasoning);
    result.thinking = thinking;
    if (thinking.budget_tokens && (result.max_tokens as number) < (thinking.budget_tokens as number)) {
      result.max_tokens = thinking.budget_tokens;
    }
  }

  if (req.user) {
    result.metadata = { user_id: req.user };
  }

  if (req.response_format) {
    console.warn("[request-transform] response_format dropped: Anthropic has no JSON mode");
  }

  // PSF restore in single pass: signatures + redacted blocks
  if (antMeta?.thinking_signatures?.length || antMeta?.redacted_thinking?.length) {
    let sigIdx = 0;
    let redactedApplied = false;
    for (const msg of result.messages as Array<{ role: string; content: AnthropicContentBlock[] }>) {
      if (msg.role !== "assistant") continue;
      if (!msg.content) continue;
      if (antMeta?.redacted_thinking?.length && !redactedApplied) {
        msg.content = [...antMeta.redacted_thinking as AnthropicContentBlock[], ...msg.content];
        redactedApplied = true;
      }
      if (antMeta?.thinking_signatures?.length) {
        for (const block of msg.content) {
          if (block.type === "thinking" && sigIdx < antMeta.thinking_signatures.length) {
            // PSF extension: signature not in AnthropicThinkingBlock
            (block as unknown as Record<string, unknown>).signature = antMeta.thinking_signatures[sigIdx].signature;
            sigIdx++;
          }
        }
      }
    }
  }

  logDroppedFields(cleanedBody, OA_KNOWN_FIELDS, "OA→Ant");
  return result;
}

export function anthropicToOpenAIRequest(body: Record<string, unknown>): Record<string, unknown> {
  const req = body as unknown as AnthropicRequest;

  const result: Record<string, unknown> = {};
  result.model = req.model;

  result.messages = convertMessagesAnt2OA(req.system, req.messages ?? []);

  if (req.max_tokens != null) result.max_completion_tokens = req.max_tokens;
  if (req.stop_sequences) result.stop = req.stop_sequences;

  if (req.temperature != null) result.temperature = req.temperature;
  if (req.top_p != null) result.top_p = req.top_p;
  if (req.stream != null) result.stream = req.stream;

  if (req.stream === true) {
    result.stream_options = { include_usage: true };
  }

  if (req.tools) {
    result.tools = convertToolsAnt2OA(req.tools);
  }
  if (req.tool_choice != null) {
    result.tool_choice = mapToolChoiceAnt2OA(req.tool_choice);
  }

  if (req.thinking) {
    const reasoning = mapThinkingToReasoning(req.thinking);
    if (reasoning) result.reasoning = reasoning;
  }

  if (req.metadata?.user_id) {
    result.user = req.metadata.user_id;
  }

  logDroppedFields(body, ANT_KNOWN_FIELDS, "Ant→OA");
  return result;
}

/** Entry point: transform request body based on direction */
export function transformRequestBody(
  body: Record<string, unknown>,
  sourceApiType: string,
  targetApiType: string,
  _model: string,
): Record<string, unknown> {
  if (sourceApiType === targetApiType) return body;
  if (sourceApiType === "openai" && targetApiType === "anthropic") {
    return openaiToAnthropicRequest(body);
  }
  if (sourceApiType === "anthropic" && targetApiType === "openai") {
    return anthropicToOpenAIRequest(body);
  }
  return body;
}
