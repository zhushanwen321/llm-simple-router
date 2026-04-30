const EFFORT_BUDGET: Record<string, number> = { low: 1024, medium: 8192, high: 32768 };
const DEFAULT_BUDGET = 8192;

/** OpenAI reasoning → Anthropic thinking */
export function mapReasoningToThinking(reasoning: Record<string, unknown>): Record<string, unknown> {
  const effort = reasoning.effort as string | undefined;
  const maxTokens = reasoning.max_tokens as number | undefined;
  const budget = maxTokens ?? EFFORT_BUDGET[effort ?? ""] ?? DEFAULT_BUDGET;
  return { type: "enabled", budget_tokens: budget };
}

/** Anthropic thinking → OpenAI reasoning */
export function mapThinkingToReasoning(thinking: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!thinking || thinking.type !== "enabled") return undefined;
  return { max_tokens: thinking.budget_tokens as number };
}
