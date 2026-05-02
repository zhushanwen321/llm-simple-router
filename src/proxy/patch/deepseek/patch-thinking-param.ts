/**
 * DeepSeek 开启 thinking 后，后续请求必须显式传 thinking 参数。
 * 客户端（如 Claude Code）可能在后续轮次省略此参数。
 * 检测历史中是否存在 thinking 内容，自动补上参数。
 */
export function patchThinkingParam(
  body: Record<string, unknown>,
  apiType: "openai" | "openai-responses" | "anthropic",
): void {
  if (body.thinking) return;

  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages) return;

  const hasThinking = messages.some(msg => {
    if (msg.role !== "assistant") return false;
    if (apiType === "openai") {
      return msg.reasoning_content !== undefined;
    }
    // Anthropic 格式
    return Array.isArray(msg.content) &&
      (msg.content as Array<Record<string, unknown>>)
        .some(b => b?.type === "thinking");
  });

  if (!hasThinking) return;

  if (apiType === "openai") {
    body.thinking = { type: "enabled" };
  } else {
    // Anthropic 格式要求 budget_tokens
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }
}
