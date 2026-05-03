import { TOOL_USE_ID_PREFIX } from "./directive-parser.js";

const RE_ROUTER_RESPONSE = /<router-response[^>]*>[\s\S]*?<\/router-response>/g;
const RE_COMMAND = /\[router-command:/;

/**
 * 清理历史消息中的路由相关内容（命令消息和 router-response 标签）。
 * 只清理历史轮次，跳过最后一条 user 消息（当前轮由 directive-parser 处理）。
 */
export function cleanRouterResponses(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages as Array<{ role: string; content: unknown }> | undefined;
  if (!messages?.length) return body;

  const cleaned = JSON.parse(JSON.stringify(body));
  const cleanedMsgs = (cleaned.messages as Array<{ role: string; content: unknown }>);

  // 定位最后一条 user 消息（当前轮），不参与整条过滤
  let lastUserIdx = -1;
  for (let i = cleanedMsgs.length - 1; i >= 0; i--) {
    if (cleanedMsgs[i].role === "user") { lastUserIdx = i; break; }
  }

  const filtered = cleanedMsgs.filter((msg, idx) => {
    // 当前轮的 user 消息保留，由 directive-parser 处理
    if (idx === lastUserIdx) return true;

    if (msg.role === "user") {
      const blocks = Array.isArray(msg.content) ? msg.content : [msg.content];
      for (const b of blocks) {
        if (b && typeof b === "object" && "text" in b && typeof b.text === "string") {
          if (RE_COMMAND.test(b.text)) return false;
        }
      }
      // 清理 router synthetic AskUserQuestion 的 tool_result 回调
      const toolResultBlocks = blocks.filter(
        (b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_result"
          && typeof (b as { tool_use_id?: string }).tool_use_id === "string"
          && (b as { tool_use_id?: string }).tool_use_id!.startsWith(TOOL_USE_ID_PREFIX),
      );
      if (toolResultBlocks.length > 0 && toolResultBlocks.length === blocks.length) return false;
    }
    if (msg.role === "assistant") {
      const blocks = Array.isArray(msg.content) ? msg.content : [msg.content];
      // 清理 router synthetic AskUserQuestion 的 tool_use 消息（Anthropic content blocks）
      const toolUseBlocks = blocks.filter(
        (b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_use"
          && (b as { name?: string }).name === "AskUserQuestion"
          && typeof (b as { id?: string }).id === "string"
          && (b as { id?: string }).id!.startsWith(TOOL_USE_ID_PREFIX),
      );
      if (toolUseBlocks.length > 0 && toolUseBlocks.length === blocks.length) return false;
      // 提取文本：兼容 Anthropic content blocks 和 OpenAI 纯字符串
      const textParts: string[] = [];
      for (const b of blocks) {
        if (typeof b === "string") {
          textParts.push(b);
        } else if (b && typeof b === "object" && b.type === "text" && typeof b.text === "string") {
          textParts.push(b.text);
        }
      }
      const combined = textParts.join("");
      const stripped = combined.replace(RE_ROUTER_RESPONSE, "").trim();
      // 有 tool_calls 的消息即使 text 为空也保留（OpenAI 格式）
      if (!stripped && !(msg as Record<string, unknown>).tool_calls) return false;
    }
    return true;
  });

  // 剥离所有消息中的 <router-response> 标签（包括当前轮）
  for (const msg of filtered) {
    const blocks = Array.isArray(msg.content) ? msg.content : [msg.content];
    for (const b of blocks) {
      if (b && typeof b === "object" && "text" in b && typeof b.text === "string") {
        (b as { text: string }).text = b.text
          .replace(RE_ROUTER_RESPONSE, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
    }
  }

  cleaned.messages = filtered;
  return cleaned;
}
