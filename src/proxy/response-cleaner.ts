const RE_ROUTER_RESPONSE = /<router-response[^>]*>[\s\S]*?<\/router-response>/g;
const RE_COMMAND = /<!--\s*router:command=/;

export function cleanRouterResponses(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages as Array<{ role: string; content: unknown }> | undefined;
  if (!messages?.length) return body;

  const cleaned = JSON.parse(JSON.stringify(body));
  const cleanedMsgs = (cleaned.messages as Array<{ role: string; content: unknown }>)
    .filter((msg) => {
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

  for (const msg of cleanedMsgs) {
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

  cleaned.messages = cleanedMsgs;
  return cleaned;
}
