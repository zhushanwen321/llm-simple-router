import Database from "better-sqlite3";
import { getModelContextWindowOverride } from "../db/model-info.js";
import { lookupContextWindow } from "../config/model-context.js";
import type { Target } from "./strategy/types.js";

const ESTIMATED_TOKENS_PER_IMAGE = 2000;

const BASE64_PLACEHOLDER = "[BASE64]";
const DATA_URL_PLACEHOLDER = "[DATA_URL]";

/** 递归剥离 base64 数据，用占位符替代，避免 JSON.stringify 后长度膨胀导致过高估算 */
function stripBase64ForEstimation(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripBase64ForEstimation);
  if (obj && typeof obj === "object") {
    const record = obj as Record<string, unknown>;
    // Anthropic image block: { type: "image", source: { type: "base64", data: "..." } }
    if (record.type === "image" && record.source && typeof record.source === "object") {
      const src = record.source as Record<string, unknown>;
      if (src.type === "base64" && typeof src.data === "string") {
        return { ...record, source: { ...src, data: BASE64_PLACEHOLDER } };
      }
    }
    // OpenAI image_url block: { type: "image_url", image_url: { url: "data:image/...;base64,..." } }
    if (record.type === "image_url" && record.image_url && typeof record.image_url === "object") {
      const iu = record.image_url as Record<string, unknown>;
      if (typeof iu.url === "string" && iu.url.startsWith("data:")) {
        return { ...record, image_url: { ...iu, url: DATA_URL_PLACEHOLDER } };
      }
    }
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) result[k] = stripBase64ForEstimation(v);
    return result;
  }
  return obj;
}

function countImageBlocks(obj: unknown): number {
  if (Array.isArray(obj)) return obj.reduce((sum: number, item) => sum + countImageBlocks(item), 0);
  if (obj && typeof obj === "object") {
    const r = obj as Record<string, unknown>;
    if (r.type === "image" || r.type === "image_url") return 1;
    return Object.values(r).reduce((sum: number, v) => sum + countImageBlocks(v), 0);
  }
  return 0;
}

/** 估算 body 的 token 消耗（不含 gpt-tokenizer 依赖，使用字符数 / 3 近似） */
export function estimateTokens(body: Record<string, unknown>): number {
  const messages = (body.messages ?? []) as unknown[];
  const cleaned = stripBase64ForEstimation(messages);
  const textTokens = Math.ceil(JSON.stringify(cleaned).length / 3);
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

  if (estimated > contextWindow) {
    return { provider_id: target.overflow_provider_id, backend_model: target.overflow_model };
  }
  return null;
}
