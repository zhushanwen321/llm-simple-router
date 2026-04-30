/**
 * 修复孤儿 tool 消息 — OpenAI 格式版本。
 *
 * 当 context management 截断历史消息时，可能丢失含 tool_calls 的 assistant 消息，
 * 但保留对应的 role:"tool" 消息。上游会拒绝没有配对 tool_calls 的 tool 消息：
 * "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"
 *
 * 算法：
 * 1. 收集所有 assistant 消息中 tool_calls[].id
 * 2. 移除 tool_call_id 不在集合中的 tool 消息
 * 3. 移除后若产生连续 user 消息则合并（可选优化，OpenAI 格式不强制）
 *
 * 注意：在 patchNonDeepSeekToolMessages 之后执行，
 * 非DeepSeek 的 tool 消息已被降级为 user 消息，这里只需处理 DeepSeek 原生消息。
 */
export function patchOrphanToolResults(body: Record<string, unknown>): void {
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages || !Array.isArray(messages) || messages.length === 0) return;

  // Step 1: 收集所有已知的 tool_call IDs
  const knownToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined;
    if (!toolCalls) continue;
    for (const tc of toolCalls) {
      if (typeof tc.id === "string") knownToolCallIds.add(tc.id);
    }
  }

  // Step 2: 移除孤儿 tool 消息（逆序遍历避免索引偏移）
  let removedAny = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "tool") continue;
    const toolCallId = String(msg.tool_call_id ?? "");
    if (!knownToolCallIds.has(toolCallId)) {
      messages.splice(i, 1);
      removedAny = true;
    }
  }

  if (!removedAny) return;

  // Step 3: 合并连续的 user 消息（清理降级和删除后可能产生的连续 user）
  let i = 1;
  while (i < messages.length) {
    if (messages[i].role === "user" && messages[i - 1].role === "user") {
      const prev = messages[i - 1];
      const curr = messages[i];
      const prevContent = typeof prev.content === "string" ? prev.content : JSON.stringify(prev.content ?? "");
      const currContent = typeof curr.content === "string" ? curr.content : JSON.stringify(curr.content ?? "");
      prev.content = prevContent + "\n" + currContent;
      messages.splice(i, 1);
    } else {
      i++;
    }
  }
}
