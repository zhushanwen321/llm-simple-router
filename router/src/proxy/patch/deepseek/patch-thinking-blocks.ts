/**
 * DeepSeek thinking 协议实现不完整：开启 thinking 模式后部分轮次不返回 thinking block，
 * 但后续请求要求历史 assistant 消息必须携带 thinking block。
 *
 * 处理：
 * 1. 检测历史 thinking block 是否带 signature 字段，保持格式一致
 * 2. 对缺少 thinking block 的 assistant 消息，在 content 数组开头补一个空 thinking block
 * 3. 对 thinking block 不在首位的 assistant 消息，修正位置
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

  // 检测历史中 thinking block 是否带 signature 字段
  const needsSignature = detectSignatureUsage(messages);

  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    const blocks = msg.content as Array<Record<string, unknown>>;

    const thinkingIdx = blocks.findIndex(
      (b) => b && typeof b === "object" && b.type === "thinking",
    );

    if (thinkingIdx === -1) {
      // 不存在 thinking block → 补一个
      const emptyThinking: Record<string, unknown> = { type: "thinking", thinking: "" };
      if (needsSignature) emptyThinking.signature = "";
      blocks.unshift(emptyThinking);
    } else if (thinkingIdx > 0) {
      // thinking block 不在第一位 → 移到首位
      const [thinkingBlock] = blocks.splice(thinkingIdx, 1);
      blocks.unshift(thinkingBlock);
    }
  }
}

/**
 * 扫描历史 assistant 消息中的 thinking block，
 * 判断是否需要 signature 字段。
 */
function detectSignatureUsage(
  messages: Array<{ role: string; content: unknown }>,
): boolean {
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const b of (msg.content as Array<Record<string, unknown>>)) {
      if (b && typeof b === "object" && b.type === "thinking") {
        return "signature" in b;
      }
    }
  }
  // 无历史 thinking block 时，默认带 signature（保持向后兼容）
  return true;
}
