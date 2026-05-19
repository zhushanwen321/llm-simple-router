import { mapReasoningToThinking, EFFORT_BUDGET } from "./thinking-mapper.js";

/**
 * 统一 thinking 参数解析。
 * 优先级：reasoning (显式对象) > thinking (DeepSeek compat) > reasoning_effort (OpenAI standard)
 *
 * 所有转换函数都应使用此类函数确保行为一致，避免重复实现导致的不一致。
 */

export interface ThinkingResult {
  /** Responses API 的 reasoning 参数 */
  reasoning?: Record<string, unknown>;
  /** Anthropic API 的 thinking 参数 */
  thinking?: Record<string, unknown>;
}

/**
 * 从请求 body 中解析 thinking 参数。
 * @param body 原始请求 body
 * @param reqReasoning 已经从 body 解析出的 req.reasoning 字段
 * @returns 解析结果，包含 reasoning (Responses API) 和 thinking (Anthropic API) 两种格式
 */
export function resolveThinkingParams(
  body: Record<string, unknown>,
  reqReasoning: Record<string, unknown> | undefined,
): ThinkingResult {
  // 1. 显式 reasoning 对象（最高优先级）
  if (reqReasoning != null) {
    return {
      reasoning: reqReasoning,
      thinking: mapReasoningToThinking(reqReasoning),
    };
  }

  // 2. DeepSeek compat: thinking: {type: "enabled", budget_tokens?}
  const thinkingParam = body.thinking as Record<string, unknown> | undefined;
  if (thinkingParam?.type === "disabled") {
    // 显式禁用 thinking，不执行任何转换
    return { reasoning: undefined, thinking: undefined };
  }
  if (thinkingParam && thinkingParam.type === "enabled") {
    const budget = thinkingParam.budget_tokens as number | undefined;
    if (budget != null) {
      // 有 budget: 转换为 reasoning 格式和 thinking 格式
      return {
        reasoning: { max_tokens: budget },
        thinking: { type: "enabled", budget_tokens: budget },
      };
    }
    // 无 budget: 透传 enabled 状态
    return {
      reasoning: undefined,
      thinking: { type: "enabled" },
    };
  }

  // 3. OpenAI standard: reasoning_effort: "high" | "medium" | "low"
  const effort = body.reasoning_effort as string | undefined;
  if (effort) {
    return {
      reasoning: { effort },
      thinking: { type: "enabled", budget_tokens: effortToBudget(effort) },
    };
  }

  return { reasoning: undefined, thinking: undefined };
}

const DEFAULT_EFFORT_BUDGET = 8192;

/** Map reasoning_effort level to budget_tokens, 复用 thinking-mapper 的映射表 */
function effortToBudget(effort: string): number {
  return EFFORT_BUDGET[effort] ?? DEFAULT_EFFORT_BUDGET;
}
