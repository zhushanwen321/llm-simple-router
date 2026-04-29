import { TOOL_USE_ID_PREFIX } from "../enhancement/directive-parser.js";

type ContentBlock = Record<string, unknown>;
type Message = { role: string; content: unknown };

/**
 * 从消息中移除 router 注入的合成 tool_use/tool_result。
 *
 * Router 通过 AskUserQuestion 注入的 tool_use（ID 以 toolu_router_ 开头）是给客户端
 * UI 用的交互机制，不是任何 LLM 生成的内容，不应出现在发送给上游 provider 的上下文中。
 *
 * 处理步骤：
 * 1. 移除 assistant 消息中的 router 合成 tool_use 块
 * 2. 移除 user 消息中对应的 tool_result 块
 * 3. 移除内容为空的消息
 * 4. 合并连续的同角色消息
 */
export function patchRouterSyntheticToolCalls(
  body: Record<string, unknown>,
): void {
  if (!body.messages) return;
  const messages = body.messages as Message[];
  if (!Array.isArray(messages) || messages.length === 0) return;

  // Step 1: 收集 router 合成的 tool_use ID，移除这些块
  const removedIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    const blocks = msg.content as ContentBlock[];
    const filtered = blocks.filter((block) => {
      if (
        block?.type === "tool_use" &&
        typeof block.id === "string" &&
        block.id.startsWith(TOOL_USE_ID_PREFIX)
      ) {
        removedIds.add(block.id);
        return false;
      }
      return true;
    });
    if (filtered.length !== blocks.length) msg.content = filtered;
  }

  if (removedIds.size === 0) return;

  // Step 2: 移除对应的 tool_result
  for (const msg of messages) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    const blocks = msg.content as ContentBlock[];
    const filtered = blocks.filter(
      (block) =>
        !(
          block?.type === "tool_result" &&
          typeof block.tool_use_id === "string" &&
          removedIds.has(block.tool_use_id)
        ),
    );
    if (filtered.length !== blocks.length) msg.content = filtered;
  }

  // Step 3: 移除内容为空的消息
  for (let i = messages.length - 1; i >= 0; i--) {
    const content = messages[i].content;
    const empty =
      content == null ||
      content === "" ||
      (Array.isArray(content) && content.length === 0);
    if (empty) messages.splice(i, 1);
  }

  // Step 4: 合并连续的同角色消息
  mergeConsecutive(messages, "user");
  mergeConsecutive(messages, "assistant");
}

function mergeConsecutive(messages: Message[], role: string): void {
  let i = 1;
  while (i < messages.length) {
    if (messages[i].role === role && messages[i - 1].role === role) {
      const prev = messages[i - 1];
      const curr = messages[i];
      prev.content = [
        ...normalizeToArray(prev.content),
        ...normalizeToArray(curr.content),
      ];
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
