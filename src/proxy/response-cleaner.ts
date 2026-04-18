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
    }
    if (msg.role === "assistant") {
      const blocks = Array.isArray(msg.content) ? msg.content : [msg.content];
      const texts = blocks
        .filter((b): b is { type: string; text: string } => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text);
      const combined = texts.join("");
      const stripped = combined.replace(RE_ROUTER_RESPONSE, "").trim();
      if (!stripped) return false;
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
