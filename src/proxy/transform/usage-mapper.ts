/** finish_reason (OpenAI) → stop_reason (Anthropic) 映射 */
const OA_TO_ANT_STOP: Record<string, string> = {
  stop: "end_turn",
  length: "max_tokens",
  tool_calls: "tool_use",
};

/** stop_reason (Anthropic) → finish_reason (OpenAI) 映射 */
const ANT_TO_OA_STOP: Record<string, string> = {
  end_turn: "stop",
  max_tokens: "length",
  stop_sequence: "stop",
  tool_use: "tool_calls",
};

export function mapFinishReasonToStopReason(reason: string): string {
  return OA_TO_ANT_STOP[reason] ?? "end_turn";
}

export function mapStopReasonToFinishReason(reason: string): string {
  return ANT_TO_OA_STOP[reason] ?? "stop";
}
