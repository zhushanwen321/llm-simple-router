import { convertMessagesOA2Ant, convertMessagesAnt2OA } from "./message-mapper.js";
import { convertToolsOA2Ant, convertToolsAnt2OA, mapToolChoiceOA2Ant, mapToolChoiceAnt2OA } from "./tool-mapper.js";
import { mapReasoningToThinking, mapThinkingToReasoning } from "./thinking-mapper.js";
import { stripProviderMeta } from "./provider-meta.js";

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

export function openaiToAnthropicRequest(body: Record<string, unknown>): Record<string, unknown> {
  // strip provider_meta before processing, restore PSF to messages later
  const { meta: antMeta, body: cleanedBody } = stripProviderMeta(body);

  const result: Record<string, unknown> = {};
  result.model = cleanedBody.model;

  // messages + system extraction
  const { system, messages } = convertMessagesOA2Ant(cleanedBody.messages as unknown[] ?? []);
  if (system != null) result.system = system;
  result.messages = messages;

  // max_tokens (required by Anthropic)
  result.max_tokens = cleanedBody.max_completion_tokens ?? cleanedBody.max_tokens ?? DEFAULT_MAX_TOKENS;

  // stop
  if (cleanedBody.stop != null) {
    result.stop_sequences = Array.isArray(cleanedBody.stop) ? cleanedBody.stop : [cleanedBody.stop];
  }

  // pass-through params
  if (cleanedBody.temperature != null) result.temperature = cleanedBody.temperature;
  if (cleanedBody.top_p != null) result.top_p = cleanedBody.top_p;
  if (cleanedBody.stream != null) result.stream = cleanedBody.stream;

  // tools + tool_choice
  if (cleanedBody.tool_choice === "none" || (typeof cleanedBody.tool_choice === "object" && (cleanedBody.tool_choice as Record<string, unknown>).type === "none")) {
    // P1-6: Anthropic has no "none" — don't send tools
  } else {
    if (cleanedBody.tools) {
      result.tools = convertToolsOA2Ant(cleanedBody.tools as unknown[]);
    }
    if (cleanedBody.tool_choice != null) {
      const mapped = mapToolChoiceOA2Ant(cleanedBody.tool_choice);
      if (mapped != null) {
        result.tool_choice = cleanedBody.parallel_tool_calls === false
          ? { ...(mapped as Record<string, unknown>), disable_parallel_tool_use: true }
          : mapped;
      }
    } else if (cleanedBody.parallel_tool_calls === false) {
      result.tool_choice = { type: "auto", disable_parallel_tool_use: true };
    }
  }

  // reasoning → thinking
  if (cleanedBody.reasoning) {
    const thinking = mapReasoningToThinking(cleanedBody.reasoning as Record<string, unknown>);
    result.thinking = thinking;
    if (thinking.budget_tokens && (result.max_tokens as number) < (thinking.budget_tokens as number)) {
      result.max_tokens = thinking.budget_tokens;
    }
  }

  // user → metadata
  if (cleanedBody.user) {
    result.metadata = { user_id: cleanedBody.user };
  }

  // response_format — Anthropic doesn't support JSON mode
  if (cleanedBody.response_format) {
    console.warn(`[request-transform] response_format is not supported by Anthropic API, dropping: ${JSON.stringify(cleanedBody.response_format)}`);
  }

  // restore PSF: thinking_signatures back to assistant message thinking blocks
  if (antMeta?.thinking_signatures?.length) {
    let sigIdx = 0;
    for (const msg of result.messages as Array<Record<string, unknown>>) {
      if (msg.role !== "assistant") continue;
      const content = msg.content as Array<Record<string, unknown>> | undefined;
      if (!content) continue;
      for (const block of content) {
        if (block.type === "thinking" && sigIdx < antMeta.thinking_signatures.length) {
          block.signature = antMeta.thinking_signatures[sigIdx].signature;
          sigIdx++;
        }
      }
    }
  }

  // restore PSF: redacted_thinking blocks prepended to first assistant message
  if (antMeta?.redacted_thinking?.length) {
    for (const msg of result.messages as Array<Record<string, unknown>>) {
      if (msg.role !== "assistant") continue;
      const content = msg.content as Array<Record<string, unknown>>;
      msg.content = [...antMeta.redacted_thinking, ...content];
      break;
    }
  }

  logDroppedFields(cleanedBody, OA_KNOWN_FIELDS, "OA→Ant");
  return result;
}

export function anthropicToOpenAIRequest(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  result.model = body.model;

  // system + messages
  const antMessages = body.messages as unknown[] ?? [];
  result.messages = convertMessagesAnt2OA(body.system, antMessages);

  // max_tokens → max_completion_tokens
  if (body.max_tokens != null) result.max_completion_tokens = body.max_tokens;

  // stop_sequences → stop
  if (body.stop_sequences) result.stop = body.stop_sequences;

  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  if (body.stream != null) result.stream = body.stream;

  // stream_options injection for usage data
  if (body.stream === true) {
    result.stream_options = { include_usage: true };
  }

  // tools
  if (body.tools) {
    result.tools = convertToolsAnt2OA(body.tools as unknown[]);
  }
  if (body.tool_choice != null) {
    result.tool_choice = mapToolChoiceAnt2OA(body.tool_choice);
  }

  // thinking → reasoning
  if (body.thinking) {
    const reasoning = mapThinkingToReasoning(body.thinking as Record<string, unknown>);
    if (reasoning) result.reasoning = reasoning;
  }

  // metadata.user_id → user
  const metadata = body.metadata as Record<string, unknown> | undefined;
  if (metadata?.user_id) {
    result.user = metadata.user_id;
  }

  logDroppedFields(body, ANT_KNOWN_FIELDS, "Ant→OA");
  return result;
}

/** Entry point: transform request body based on direction */
export function transformRequestBody(
  body: Record<string, unknown>,
  sourceApiType: string,
  targetApiType: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
