import Database from "better-sqlite3";
import { countTokens } from "../utils/token-counter.js";
import { getModelContextWindowOverride } from "../db/model-info.js";
import { lookupContextWindow } from "../config/model-context.js";
import type { Target } from "./strategy/types.js";

const ESTIMATED_TOKENS_PER_IMAGE = 2000;

// 安全系数：覆盖格式化开销（role 标签、分隔符）+ 不同模型 tokenizer 的差异
const FORMAT_OVERHEAD_RATIO = 1.3;

// 上下文窗口使用阈值：当估算 token 超过上下文窗口的 90% 时即触发溢出，
// 留出余量覆盖不同模型 tokenizer 差异和难以精确估算的格式开销
const CONTEXT_WINDOW_USAGE_THRESHOLD = 0.9;

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

  // messages（OpenAI 和 Anthropic 共有）
  const messages = body.messages as Array<{ role?: string; content?: unknown }> | undefined;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      parts.push(extractTextFromContent(msg.content));
    }
  }

  // Anthropic 格式的 system prompt
  if (typeof body.system === "string") {
    parts.push(body.system);
  } else if (Array.isArray(body.system)) {
    parts.push(extractTextFromContent(body.system));
  }

  // tools（OpenAI 格式带 function 字段，Anthropic 格式带 name + input_schema）
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

/** 统计 messages 中的图片块数量 */
function countImageBlocks(obj: unknown): number {
  if (Array.isArray(obj)) return obj.reduce((sum: number, item) => sum + countImageBlocks(item), 0);
  if (obj && typeof obj === "object") {
    const r = obj as Record<string, unknown>;
    if (r.type === "image" || r.type === "image_url") return 1;
    return Object.values(r).reduce((sum: number, v) => sum + countImageBlocks(v), 0);
  }
  return 0;
}

/**
 * 估算请求的 token 消耗。
 * 覆盖 messages、system prompt、tools 的全部文本内容，
 * 并加乘格式化开销安全系数。
 */
export function estimateTokens(body: Record<string, unknown>): number {
  const allText = extractAllText(body);
  const textTokens = Math.ceil(countTokens(allText) * FORMAT_OVERHEAD_RATIO);
  const messages = (body.messages ?? []) as unknown[];
  const imageTokens = countImageBlocks(messages) * ESTIMATED_TOKENS_PER_IMAGE;
  return textTokens + imageTokens;
}

function getContextWindow(db: Database.Database, providerId: string, modelName: string): number {
  return getModelContextWindowOverride(db, providerId, modelName) ?? lookupContextWindow(modelName);
}

interface OverflowResult {
  provider_id: string;
  backend_model: string;
}

/**
 * 检查请求是否超出当前模型的上下文窗口，若超出且配置了溢出目标，则返回重定向信息。
 * 返回 null 表示无需溢出。
 */
export function applyOverflowRedirect(
  target: Target,
  db: Database.Database,
  body: Record<string, unknown>,
): OverflowResult | null {
  if (!target.overflow_provider_id || !target.overflow_model) return null;

  const estimated = estimateTokens(body);
  const contextWindow = getContextWindow(db, target.provider_id, target.backend_model);

  if (estimated > contextWindow * CONTEXT_WINDOW_USAGE_THRESHOLD) {
    return { provider_id: target.overflow_provider_id, backend_model: target.overflow_model };
  }
  return null;
}
