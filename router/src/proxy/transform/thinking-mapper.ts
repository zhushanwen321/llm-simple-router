const EFFORT_BUDGET: Record<string, number> = { low: 1024, medium: 8192, high: 32768 };
const DEFAULT_BUDGET = 8192;
// 反向映射：budget_tokens → effort（精确匹配时还原）
const BUDGET_TO_EFFORT: Record<number, string> = {};
for (const [effort, budget] of Object.entries(EFFORT_BUDGET)) {
  BUDGET_TO_EFFORT[budget] = effort;
}

/** OpenAI reasoning → Anthropic thinking */
export function mapReasoningToThinking(reasoning: Record<string, unknown>): Record<string, unknown> {
  const r = reasoning as { effort?: string; max_tokens?: number };
  const budget = r.max_tokens ?? EFFORT_BUDGET[r.effort ?? ""] ?? DEFAULT_BUDGET;
  return { type: "enabled", budget_tokens: budget };
}

/** Anthropic thinking → OpenAI reasoning */
export function mapThinkingToReasoning(thinking: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!thinking) return undefined;
  const t = thinking as { type?: string; budget_tokens?: number };
  if (t.type !== "enabled") return undefined;
  const result: Record<string, unknown> = { max_tokens: t.budget_tokens };
  // 精确匹配 standard budget → 还原 effort 级别
  if (t.budget_tokens != null && BUDGET_TO_EFFORT[t.budget_tokens] != null) {
  result.effort = BUDGET_TO_EFFORT[t.budget_tokens];
  }
  return result;
}
