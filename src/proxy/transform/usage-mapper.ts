// ---------- Stop reason / finish_reason 映射 ----------

const OA_TO_ANT_STOP: Record<string, string> = {
  stop: "end_turn",
  length: "max_tokens",
  tool_calls: "tool_use",
};

const ANT_TO_OA_STOP: Record<string, string> = {
  end_turn: "stop",
  max_tokens: "length",
  stop_sequence: "stop",
  tool_use: "tool_calls",
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
  return {
    input_tokens: u.prompt_tokens ?? 0,
    output_tokens: u.completion_tokens ?? 0,
    cache_read_input_tokens: details?.cached_tokens ?? 0,
    cache_creation_input_tokens: details?.cached_write_tokens ?? 0,
  };
}

/** Anthropic usage → OpenAI usage */
export function mapUsageAnt2OA(u: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!u) return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const input = (u.input_tokens as number ?? 0) + (u.cache_read_input_tokens as number ?? 0) + (u.cache_creation_input_tokens as number ?? 0);
  const output = u.output_tokens as number ?? 0;
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
    prompt_tokens_details: { cached_tokens: u.cache_read_input_tokens ?? 0, cached_write_tokens: u.cache_creation_input_tokens ?? 0 },
  };
}
