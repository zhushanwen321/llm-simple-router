export function sanitizeToolUseId(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized || "toolu_unknown";
}

export function parseToolArguments(args: unknown): Record<string, unknown> {
  try { return JSON.parse(JSON.stringify(args ?? {})); }
  catch { console.warn("[transform] Failed to parse tool arguments, using empty object"); return {}; }
}

export function ensureNonEmptyContent(messages: unknown[]): void {
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    if (m.role === "assistant") continue;
    if (!m.content || m.content === "" ||
        (Array.isArray(m.content) && m.content.length === 0)) {
      m.content = " ";
    }
  }
}
