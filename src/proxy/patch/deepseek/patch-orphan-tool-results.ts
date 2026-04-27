type ContentBlock = Record<string, unknown>;

/**
 * 修复孤儿 tool_result 块——Claude Code 的 context management 截断历史消息时
 * 可能丢失 tool_use 块但保留对应的 tool_result，导致 DeepSeek 严格校验失败。
 *
 * 算法：
 * 1. 收集所有 assistant 消息中的 tool_use ID
 * 2. 移除 tool_use_id 不在集合中的 tool_result 块
 * 3. 移除清空后的空 user 消息
 * 4. 合并相邻的 user 消息（Anthropic API 不允许连续 user 消息）
 * 5. 合并相邻的 assistant 消息（同理）
 */
export function patchOrphanToolResults(
  body: Record<string, unknown>,
): void {
  if (!body.messages) return;
  const messages = body.messages as Array<{ role: string; content: unknown }>;
  if (!Array.isArray(messages) || messages.length === 0) return;

  // Step 1: 收集所有已知的 tool_use ID
  const knownToolUseIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content as ContentBlock[]) {
      if (block?.type === "tool_use" && typeof block.id === "string") {
        knownToolUseIds.add(block.id);
      }
    }
  }
  // Step 2: 移除孤儿 tool_result 块
  let removedAny = false;
  for (const msg of messages) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    const blocks = msg.content as ContentBlock[];
    const before = blocks.length;
    const filtered = blocks.filter(block => {
      if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
        return knownToolUseIds.has(block.tool_use_id);
      }
      return true;
    });
    if (filtered.length < before) {
      msg.content = filtered;
      removedAny = true;
    }
  }
  if (!removedAny) return;

  // Step 3: 移除清空后的空 user 消息（向后遍历避免索引错乱）
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (Array.isArray(msg.content) && msg.content.length === 0) {
      messages.splice(i, 1);
    } else if (typeof msg.content === "string" && msg.content.trim() === "") {
      messages.splice(i, 1);
    }
  }

  // Step 4: 合并相邻的 user 消息
  mergeConsecutive(messages, "user");

  // Step 5: 合并相邻的 assistant 消息（删除空 user 消息后可能产生）
  mergeConsecutive(messages, "assistant");
}

function mergeConsecutive(messages: Array<{ role: string; content: unknown }>, role: string): void {
  let i = 1;
  while (i < messages.length) {
    if (messages[i].role === role && messages[i - 1].role === role) {
      const prev = messages[i - 1];
      const curr = messages[i];
      const prevContent = normalizeToArray(prev.content);
      const currContent = normalizeToArray(curr.content);
      prev.content = [...prevContent, ...currContent];
      messages.splice(i, 1);
    } else {
      i++;
    }
  }
}

function normalizeToArray(content: unknown): ContentBlock[] {
  if (Array.isArray(content)) return content as ContentBlock[];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [{ type: "text", text: String(content ?? "") }];
}
