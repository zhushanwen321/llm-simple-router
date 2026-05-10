const EFFORT_BUDGET: Record<string, number> = { low: 1024, medium: 8192, high: 32768 };
const DEFAULT_BUDGET = 8192;

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
  return { max_tokens: t.budget_tokens };
}
