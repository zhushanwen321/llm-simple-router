// ---------- Stop reason / finish_reason 映射 ----------

const OA_TO_ANT_STOP: Record<string, string> = {
  stop: "end_turn",
  length: "max_tokens",
  tool_calls: "tool_use",
  content_filter: "end_turn",
  function_call: "tool_use",
};

const ANT_TO_OA_STOP: Record<string, string> = {
  end_turn: "stop",
  max_tokens: "length",
  stop_sequence: "stop",
  tool_use: "tool_calls",
  content_filtered: "content_filter",
  pause_turn: "stop",
};

/** finish_reason (OpenAI) → stop_reason (Anthropic) */
export function mapFinishReasonToStopReason(reason: string): string {
  return OA_TO_ANT_STOP[reason] ?? "end_turn";
}

/** stop_reason (Anthropic) → finish_reason (OpenAI) */
export function mapStopReasonToFinishReason(reason: string): string {
  return ANT_TO_OA_STOP[reason] ?? "stop";
}

// ---------- Usage 映射 ----------

/** OpenAI usage → Anthropic usage */
export function mapUsageOA2Ant(u: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!u) return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  const cachedTokens = Number(details?.cached_tokens ?? 0) || 0;
  return {
    input_tokens: Math.max(0, (Number(u.prompt_tokens ?? 0) || 0) - cachedTokens),
    output_tokens: Number(u.completion_tokens ?? 0) || 0,
    cache_read_input_tokens: Number(details?.cached_tokens ?? 0) || 0,
    cache_creation_input_tokens: Number(details?.cached_write_tokens ?? 0) || 0,
  };
}

/** Anthropic usage → OpenAI usage */
export function mapUsageAnt2OA(u: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!u) return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const inputTokens = Number(u.input_tokens) || 0;
  const cacheRead = Number(u.cache_read_input_tokens) || 0;
  const cacheCreation = Number(u.cache_creation_input_tokens) || 0;
  const outputTokens = Number(u.output_tokens) || 0;
  const totalInput = inputTokens + cacheRead + cacheCreation;
  return {
    prompt_tokens: totalInput,
    completion_tokens: outputTokens,
    total_tokens: totalInput + outputTokens,
    prompt_tokens_details: { cached_tokens: cacheRead, cached_write_tokens: cacheCreation },
  };
}
