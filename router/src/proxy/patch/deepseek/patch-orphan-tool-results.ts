import { type ContentBlock, type Message, mergeConsecutive, mergeAssistantContent } from "./utils.js";

/**
 * 修复 Anthropic 格式消息中的 tool_use / tool_result 配对断裂。
 *
 * Claude Code 的 context management 截断历史消息时可能产生两种方向的不匹配：
 * - 正向：tool_result 存在但对应的 tool_use 被截断（孤儿 tool_result）
 * - 反向：tool_use 存在但对应的 tool_result 被截断（孤儿 tool_use）
 *
 * 两种都会导致 DeepSeek Anthropic 端点校验失败。
 *
 * 算法（正向 + 反向）：
 * 1. 正向：收集所有 tool_use ID，移除无主的 tool_result 块
 * 2. 反向：收集所有 tool_result ID，从非末尾 assistant 中移除无主的 tool_use 块
 * 3. 移除清空后的空 user 消息
 * 4-7. 合并/清理消息链
 */
export function patchOrphanToolResults(
  body: Record<string, unknown>,
): void {
  if (!body.messages) return;
  const messages = body.messages as Message[];
  if (!Array.isArray(messages) || messages.length === 0) return;

  let changed = false;

  // ---- 正向：移除孤儿 tool_result（tool_result 无对应 tool_use）----
  const knownToolUseIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content as ContentBlock[]) {
      if (block?.type === "tool_use" && typeof block.id === "string") {
        knownToolUseIds.add(block.id);
      }
    }
  }
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
      changed = true;
    }
  }

  // ---- 反向：移除孤儿 tool_use（非末尾 assistant 的 tool_use 无对应 tool_result）----
  const knownToolResultIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content as ContentBlock[]) {
      if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
        knownToolResultIds.add(block.tool_use_id);
      }
    }
  }
  const lastMsgIdx = messages.length - 1;
  for (let i = 0; i <= lastMsgIdx; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    // 跳过最后一条 assistant：它可能是正常的工具调用中间状态
    if (i === lastMsgIdx) break;
    const blocks = msg.content as ContentBlock[];
    const hasToolUse = blocks.some(b => b?.type === "tool_use");
    if (!hasToolUse) continue;
    const before = blocks.length;
    const filtered = blocks.filter(block => {
      if (block?.type === "tool_use" && typeof block.id === "string") {
        return knownToolResultIds.has(block.id);
      }
      return true;
    });
    if (filtered.length < before) {
      msg.content = filtered;
      changed = true;
    }
  }

  if (!changed) return;

  // 移除清空后的空 user 消息（向后遍历避免索引错乱）
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (Array.isArray(msg.content) && msg.content.length === 0) {
      messages.splice(i, 1);
    } else if (typeof msg.content === "string" && msg.content.trim() === "") {
      messages.splice(i, 1);
    }
  }

  // 合并相邻的 user 消息
  mergeConsecutive(messages, "user");

  // 合并相邻的 assistant 消息（带 tool_use 去重）+ 移除空 assistant
  mergeConsecutive(messages, "assistant", mergeAssistantContent);
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && Array.isArray(msg.content) && msg.content.length === 0) {
      messages.splice(i, 1);
    }
  }

  // 删除空 assistant 后可能产生连续同角色消息，再合并一次
  mergeConsecutive(messages, "user");
  mergeConsecutive(messages, "assistant", mergeAssistantContent);
}

/**
 * OpenAI 格式版本的 tool_calls / tool 消息配对修复。
 *
 * 检测两种方向的不匹配：
 * - 正向：role:"tool" 消息的 tool_call_id 无对应 assistant tool_calls[].id → 移除孤儿 tool 消息
 * - 反向：非末尾 assistant 的 tool_calls[].id 无对应 tool 消息 → 移除该 tool_call 条目
 *
 * 反向跳过最后一条 assistant：它可能是正常的工具调用中间状态（模型刚返回 tool_calls，
 * 客户端还没来得及执行并回传 tool 消息）。
 */
export function patchOrphanToolResultsOA(body: Record<string, unknown>): void {
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages || !Array.isArray(messages) || messages.length === 0) return;

  // ---- 正向：移除孤儿 tool 消息 ----
  // 收集所有 assistant tool_calls IDs
  const knownToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined;
    if (!toolCalls) continue;
    for (const tc of toolCalls) {
      if (typeof tc.id === "string") knownToolCallIds.add(tc.id);
    }
  }

  // 移除无主 tool 消息（逆序遍历避免索引偏移）
  let changed = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "tool") continue;
    const toolCallId = (msg.tool_call_id ?? "") as string;
    if (!knownToolCallIds.has(toolCallId)) {
      messages.splice(i, 1);
      changed = true;
    }
  }

  // ---- 反向：移除孤儿 tool_calls 条目（非末尾 assistant）----
  // 收集所有 tool 消息的 ID
  const knownToolMsgIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    const toolCallId = (msg.tool_call_id ?? "") as string;
    if (toolCallId) knownToolMsgIds.add(toolCallId);
  }

  const lastMsgIdx = messages.length - 1;
  for (let i = 0; i <= lastMsgIdx; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    // 跳过最后一条 assistant：它可能是正常的工具调用中间状态
    if (i === lastMsgIdx) break;
    const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined;
    if (!toolCalls || toolCalls.length === 0) continue;
    const before = toolCalls.length;
    const filtered = toolCalls.filter(tc => {
      const id = tc.id as string | undefined;
      return !id || knownToolMsgIds.has(id);
    });
    if (filtered.length < before) {
      if (filtered.length === 0) {
        delete msg.tool_calls;
      } else {
        msg.tool_calls = filtered;
      }
      changed = true;
    }
  }

  if (!changed) return;

  // 合并连续 user 消息
  let i = 1;
  while (i < messages.length) {
    if (messages[i].role === "user" && messages[i - 1].role === "user") {
      const prev = messages[i - 1];
      const curr = messages[i];
      const prevContent = typeof prev.content === "string" ? prev.content : JSON.stringify(prev.content ?? "") as string;
      const currContent = typeof curr.content === "string" ? curr.content : JSON.stringify(curr.content ?? "") as string;
      prev.content = prevContent + "\n" + currContent;
      messages.splice(i, 1);
    } else {
      i++;
    }
  }
}
