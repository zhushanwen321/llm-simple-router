export function sanitizeToolUseId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized || "toolu_unknown";
}

export function ensureNonEmptyContent(messages: unknown[]): void {
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    // assistant 的 null content 是正常的（仅有 tool_calls），跳过
    if (m.role === "assistant") continue;
    if (!m.content || m.content === "" ||
        (Array.isArray(m.content) && m.content.length === 0)) {
      m.content = " ";
    }
  }
}
