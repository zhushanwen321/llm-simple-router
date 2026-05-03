export type ContentBlock = Record<string, unknown>;
export type Message = { role: string; content: unknown };

export function normalizeToArray(content: unknown): ContentBlock[] {
  if (Array.isArray(content)) return content as ContentBlock[];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [{ type: "text", text: String(content ?? "") }];
}

export function mergeConsecutive(
  messages: Message[],
  role: string,
  mergeAssistant?: (prev: ContentBlock[], curr: ContentBlock[]) => ContentBlock[],
): void {
  let i = 1;
  while (i < messages.length) {
    if (messages[i].role === role && messages[i - 1].role === role) {
      const prev = messages[i - 1];
      const curr = messages[i];
      const prevContent = normalizeToArray(prev.content);
      const currContent = normalizeToArray(curr.content);
      if (role === "assistant" && mergeAssistant) {
        prev.content = mergeAssistant(prevContent, currContent);
      } else {
        prev.content = [...prevContent, ...currContent];
      }
      messages.splice(i, 1);
    } else {
      i++;
    }
  }
}

export function mergeAssistantContent(prev: ContentBlock[], curr: ContentBlock[]): ContentBlock[] {
  const seenToolIds = new Set<string>();
  for (const b of prev) {
    if (b?.type === "tool_use" && typeof b.id === "string") {
      seenToolIds.add(b.id);
    }
  }
  const deduped = curr.filter(b =>
    !(b?.type === "tool_use" && typeof b.id === "string" && seenToolIds.has(b.id)),
  );
  return [...prev, ...deduped];
}
