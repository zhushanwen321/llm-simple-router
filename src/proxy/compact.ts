import Database from "better-sqlite3";
import { countTokens } from "gpt-tokenizer";
import { getSetting } from "../db/settings.js";
import { lookupContextWindow, COMPACT_THRESHOLD } from "../config/model-context.js";
import { getModelContextWindowOverride } from "../db/model-info.js";

export interface CompactConfig {
  context_compact_enabled: boolean;
  compact_provider_id: string | null;
  compact_model: string | null;
  custom_prompt_enabled: boolean;
  custom_prompt: string | null;
}

// Claude Code compact prompt 一定以 NO_TOOLS_PREAMBLE 开头，且 content 是纯字符串（非数组）
const COMPACT_PREAMBLE = "CRITICAL: Respond with TEXT ONLY";

// Anthropic API 对图片按固定 ~2000 tokens 计费，而非 base64 字符数
const ESTIMATED_TOKENS_PER_IMAGE = 2000;

const BASE64_PLACEHOLDER = "[BASE64]";
const DATA_URL_PLACEHOLDER = "[DATA_URL]";

export function isCompactRequest(messages: unknown[]): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const last = messages[messages.length - 1] as Record<string, unknown> | undefined;
  if (!last || last.role !== "user") return false;
  return typeof last.content === "string" && last.content.startsWith(COMPACT_PREAMBLE);
}

/** 递归剥离 base64 数据，用占位符替代，避免 gpt-tokenizer 对 base64 过度计数 */
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

export function estimateTokens(body: Record<string, unknown>): number {
  const imageCount = countImageBlocks(body);
  const cleaned = stripBase64ForEstimation(body);
  return countTokens(JSON.stringify(cleaned)) + imageCount * ESTIMATED_TOKENS_PER_IMAGE;
}

export function getCompactConfig(db: Database.Database): CompactConfig | null {
  const raw = getSetting(db, "proxy_enhancement");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.context_compact_enabled ? (parsed as CompactConfig) : null;
  } catch { /* eslint-disable-line taste/no-silent-catch -- proxy_enhancement 配置无效时静默降级 */ }
  return null;
}

export function getModelContextWindow(db: Database.Database, providerId: string, modelName: string): number | null {
  const override = getModelContextWindowOverride(db, providerId, modelName);
  return override ?? lookupContextWindow(modelName);
}

export function replaceCompactPrompt(messages: unknown[], customPrompt: string): unknown[] {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const last = { ...(messages[messages.length - 1] as Record<string, unknown>) };
  last.content = customPrompt;
  return [...messages.slice(0, -1), last];
}

export { COMPACT_THRESHOLD };
