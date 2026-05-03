/**
 * DeepSeek 的 Anthropic 兼容 API 不支持 cache_control。
 * Claude Code 等客户端会在 content block 和 system prompt 上标注
 * cache_control: { type: "ephemeral" }，需要剥离以避免上游报错。
 */
export function stripCacheControl(body: Record<string, unknown>): void {
  // 处理顶级 system 字段（Anthropic 协议中 system 可以是 content block 数组）
  if (Array.isArray(body.system)) {
    for (const block of body.system as Array<Record<string, unknown>>) {
      delete block.cache_control;
    }
  }

  // 处理 messages 中的 content block
  if (!body.messages) return;
  const messages = body.messages as Array<Record<string, unknown>>;

  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content as Array<Record<string, unknown>>) {
        delete block.cache_control;
      }
    }
  }

  // 处理 tools 上的 cache_control
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools as Array<Record<string, unknown>>) {
      delete tool.cache_control;
    }
  }
}
