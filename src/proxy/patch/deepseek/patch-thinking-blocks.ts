type ContentBlock = Record<string, unknown>;

/**
 * 将非 DeepSeek 生成的消息中的 tool_use/tool_result 转为 text 块。
 *
 * 判断标准：assistant 消息含 tool_use 但（无 thinking 块或 thinking.signature 为空/缺失）。
 *
 * 背景：DeepSeek Anthropic API 开启 thinking 后要求含 tool_use 的 assistant 消息
 * 必须携带 thinking 块。跨模型切换（GLM → DeepSeek）时历史消息缺 thinking 会导致 400。
 * 转化为 text 规避格式校验，同时完整保留信息。
 */
export function patchNonDeepSeekToolMessages(
  body: Record<string, unknown>,
): void {
  if (!body.messages) return;
  const messages = body.messages as Array<{ role: string; content: unknown }>;
  if (!Array.isArray(messages) || messages.length === 0) return;

  // Step 1: 识别非 DeepSeek 的 assistant 消息，转换 tool_use → text
  const convertedIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    const blocks = msg.content as ContentBlock[];

    const hasToolUse = blocks.some(
      (b) => b && typeof b === "object" && b.type === "tool_use",
    );
    if (!hasToolUse) continue;

    const thinkingBlock = blocks.find(
      (b) => b && typeof b === "object" && b.type === "thinking",
    );
    const hasValidSignature =
      thinkingBlock &&
      typeof thinkingBlock.signature === "string" &&
      thinkingBlock.signature !== "";

    // 有合法 signature → DeepSeek 原生，不动
    if (hasValidSignature) continue;

    // 非 DeepSeek：将 tool_use 块替换为 text
    const newBlocks: ContentBlock[] = [];
    for (const block of blocks) {
      if (block && typeof block === "object" && block.type === "tool_use") {
        newBlocks.push({ type: "text", text: JSON.stringify(block) });
        if (typeof block.id === "string") {
          convertedIds.add(block.id);
        }
      } else {
        newBlocks.push(block);
      }
    }
    msg.content = newBlocks;
  }

  if (convertedIds.size === 0) return;

  // Step 2: 转换对应 user 消息中的 tool_result → text
  for (const msg of messages) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    const blocks = msg.content as ContentBlock[];

    const newBlocks: ContentBlock[] = [];
    for (const block of blocks) {
      if (
        block &&
        typeof block === "object" &&
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string" &&
        convertedIds.has(block.tool_use_id)
      ) {
        newBlocks.push({ type: "text", text: JSON.stringify(block) });
      } else {
        newBlocks.push(block);
      }
    }
    msg.content = newBlocks;
  }
}
