/**
 * 映射表：Anthropic stop_reason → OpenAI finish_reason
 *
 * | Anthropic stop_reason | OpenAI finish_reason | 含义 |
 * |---|---|---|
 * | end_turn | stop | 模型自然结束 |
 * | stop_sequence | stop | 命中停止条件 |
 * | max_tokens | length | 达到 token 上限 |
 * | tool_use | tool_calls | 模型发起工具调用 |
 */
const ANTHROPIC_TO_OPENAI: Record<string, string> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
};

/**
 * 映射表：OpenAI finish_reason → Anthropic stop_reason
 *
 * | OpenAI finish_reason | Anthropic stop_reason |
 * |---|---|
 * | stop | end_turn |
 * | length | max_tokens |
 * | tool_calls | tool_use |
 */
const OPENAI_TO_ANTHROPIC: Record<string, string> = {
  stop: "end_turn",
  length: "max_tokens",
  tool_calls: "tool_use",
};

/**
 * 将 Anthropic stop_reason 映射为 OpenAI finish_reason。
 * 未知值直接透传原样返回。
 */
export function anthropicToOpenAI(stopReason: string | null | undefined): string | null | undefined {
  if (stopReason === null || stopReason === undefined) {
    return stopReason;
  }
  return ANTHROPIC_TO_OPENAI[stopReason] ?? stopReason;
}

/**
 * 将 OpenAI finish_reason 映射为 Anthropic stop_reason。
 * 未知值直接透传原样返回。
 */
export function openAIToAnthropic(finishReason: string | null | undefined): string | null | undefined {
  if (finishReason === null || finishReason === undefined) {
    return finishReason;
  }
  return OPENAI_TO_ANTHROPIC[finishReason] ?? finishReason;
}
