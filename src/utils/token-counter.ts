import { encode } from "gpt-tokenizer";

/** 对长文本采用采样策略：只编码前 SAMPLE_SIZE 个字符，按比率外推 */
const SAMPLE_SIZE = 4000;

/** 使用 gpt-tokenizer (o200k_base) 估算文本的 token 数 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  if (text.length <= SAMPLE_SIZE) return encode(text).length;
  const sample = text.slice(0, SAMPLE_SIZE);
  const sampleTokens = encode(sample).length;
  return Math.ceil((sampleTokens / sample.length) * text.length);
}

type ContentBlock = { type: string; text?: string; content?: unknown; input?: unknown };

/** 从 message content 中提取文本（兼容 OpenAI 和 Anthropic 格式） */
function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((block): block is ContentBlock =>
      typeof block === "object" && block !== null && "type" in block
    )
    .map(block => {
      if (block.type === "text" && typeof block.text === "string") return block.text;
      if (block.type === "tool_result") {
        if (typeof block.content === "string") return block.content;
        if (Array.isArray(block.content)) return extractTextFromContent(block.content);
      }
      if (block.type === "tool_use" && typeof block.input === "object" && block.input !== null) {
        return JSON.stringify(block.input);
      }
      return "";
    })
    .join(" ");
}

/** 从请求体中提取所有需要计算 token 的文本 */
function extractAllText(body: Record<string, unknown>): string {
  const parts: string[] = [];

  const messages = body.messages as Array<{ role?: string; content?: unknown }> | undefined;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      parts.push(extractTextFromContent(msg.content));
    }
  }

  if (typeof body.system === "string") {
    parts.push(body.system);
  } else if (Array.isArray(body.system)) {
    parts.push(extractTextFromContent(body.system));
  }

  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      const t = tool as Record<string, unknown>;
      const fn = t.function as Record<string, unknown> | undefined;
      if (fn) {
        parts.push((fn.name as string) ?? "");
        parts.push((fn.description as string) ?? "");
        if (fn.parameters) parts.push(JSON.stringify(fn.parameters));
      } else if (t.name) {
        parts.push(t.name as string);
        if (t.description) parts.push(t.description as string);
        if (t.input_schema) parts.push(JSON.stringify(t.input_schema));
      }
    }
  }

  return parts.join(" ");
}

/**
 * 估算请求的输入 token 数（不含开销系数）。
 * 当 API 未返回 usage.input_tokens 时使用（如 GLM 等第三方模型）。
 */
export function estimateInputTokens(body: Record<string, unknown>): number {
  const allText = extractAllText(body);
  return countTokens(allText);
}
