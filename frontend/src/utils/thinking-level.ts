/**
 * 从 client_request JSON 字符串中提取 thinking level。
 * client_request 格式: JSON.stringify({ headers: {...}, body: {...} })
 */
export function extractThinkingLevel(
  clientRequestJson: string | null | undefined,
  apiType: string,
): string {
  if (!clientRequestJson) return "off";
  try {
    const parsed = JSON.parse(clientRequestJson);
    const body = parsed?.body;
    if (!body) return "off";

    if (apiType === "anthropic") {
      return body.thinking?.type ?? "off";
    }

    // openai / openai-responses: reasoning.effort 优先于 reasoning_effort
    return body.reasoning?.effort ?? body.reasoning_effort ?? "off";
  } catch {
    return "off";
  }
}
