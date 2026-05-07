/**
 * 方案 7（OpenAI 格式）：将非 DeepSeek 生成的 tool 消息降级为 text。
 *
 * 当 agent 从其他模型切换到 DeepSeek 时，历史中的 tool_calls 消息
 * 可能不包含 DeepSeek 要求的 reasoning_content，导致上游校验失败或
 * 工具调用无限循环。
 *
 * 前置条件：仅 thinking 模式激活时执行。
 * DeepSeek 只在 thinking 模式下才要求 reasoning_content，未激活时
 * 降级既无必要又可能导致模型学会以文本形式输出 tool_calls。
 *
 * 判断标准：assistant 消息有 tool_calls 但无 reasoning_content → 非 DeepSeek 生成。
 *
 * 转换：
 * - assistant.tool_calls → JSON 序列化到 content，删除 tool_calls
 * - role:"tool" → role:"user"，内容 JSON 序列化，删除 tool_call_id
 *
 * 设计文档：docs/deepseek-patch-investigation.md §5
 */
export function patchNonDeepSeekToolMessages(body: Record<string, unknown>): void {
  // thinking 模式未激活时，DeepSeek 不要求 reasoning_content，无需降级
  if (!body.thinking && !body.reasoning) return;

  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages || !Array.isArray(messages)) return;

  // Step 1: 收集需要降级的 tool_call IDs
  const downgradeIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined;
    if (!toolCalls || toolCalls.length === 0) continue;
    // 有 tool_calls 但无 reasoning_content → 非 DeepSeek 生成
    if (!msg.reasoning_content) {
      for (const tc of toolCalls) {
        if (typeof tc.id === "string") downgradeIds.add(tc.id);
      }
    }
  }

  if (downgradeIds.size === 0) return;

  // Step 2: 降级 assistant 消息 — tool_calls → text content
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined;
    if (!toolCalls || toolCalls.length === 0) continue;
    if (msg.reasoning_content) continue;

    const serialized = JSON.stringify(
      toolCalls.map(tc => ({
        id: tc.id,
        type: "function",
        function: {
          name: (tc.function as Record<string, unknown>)?.name,
          arguments: (tc.function as Record<string, unknown>)?.arguments,
        },
      })),
    );

    const existing = typeof msg.content === "string" ? msg.content : "";
    msg.content = existing ? `${existing}\n[tool_calls]: ${serialized}` : `[tool_calls]: ${serialized}`;
    delete msg.tool_calls;
  }

  // Step 3: 降级对应的 tool 消息 — role:"tool" → role:"user"
  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    const toolCallId = String(msg.tool_call_id ?? "");
    if (!downgradeIds.has(toolCallId)) continue;

    msg.role = "user";
    msg.content = JSON.stringify({
      type: "tool_result",
      tool_use_id: toolCallId,
      content: msg.content,
    });
    delete msg.tool_call_id;
  }
}
