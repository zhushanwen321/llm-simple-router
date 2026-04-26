/**
 * DeepSeek thinking 协议实现不完整：开启 thinking 模式后部分轮次不返回 thinking block，
 * 但后续请求要求历史 assistant 消息必须携带 thinking block。
 * 在 content 数组开头补一个空 thinking block 以绕过上游校验。
 */
export function patchMissingThinkingBlocks(
  body: Record<string, unknown>,
): void {
  if (!body.messages) return;

  const messages = body.messages as Array<{ role: string; content: unknown }>;

  // DeepSeek 可能在不传 thinking 参数时也启用 thinking 模式（从历史推断），
  // 所以只要历史中存在任何 thinking block，就视为 thinking 模式激活。
  const thinkingActive = !!body.thinking || messages.some(
    (msg) => msg.role === "assistant" && Array.isArray(msg.content)
      && (msg.content as Array<Record<string, unknown>>).some(
        (b) => b && typeof b === "object" && b.type === "thinking",
      ),
  );
  if (!thinkingActive) return;

  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    const hasThinking = (msg.content as Array<Record<string, unknown>>).some(
      (b) => b && typeof b === "object" && b.type === "thinking",
    );
    if (!hasThinking) {
      (msg.content as Array<Record<string, unknown>>).unshift({ type: "thinking", thinking: "", signature: "" });
    }
  }
}
