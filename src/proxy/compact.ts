import Database from "better-sqlite3";
import { countTokens } from "gpt-tokenizer";
import type { EnhancementConfig } from "./enhancement-config.js";
import { lookupContextWindow, COMPACT_THRESHOLD } from "../config/model-context.js";
import { getModelContextWindowOverride } from "../db/model-info.js";
import { getProviderById } from "../db/index.js";
import type { Provider } from "../db/providers.js";
import type { FastifyRequest } from "fastify";

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

export interface CompactRedirect {
  resolved: { backend_model: string; provider_id: string };
  provider: Provider;
  model: string;
  messages: unknown[];
}

/**
 * 处理 1M Context Compact 分支逻辑：
 * - compact 请求 -> 重定向到 1M 模型
 * - 普通请求 -> 检查上下文超限
 * 返回 null 表示无需特殊处理（继续正常流程）。
 */
export function applyCompactRedirect(params: {
  db: Database.Database;
  config: EnhancementConfig;
  apiType: "openai" | "anthropic";
  body: Record<string, unknown>;
  resolved: { backend_model: string; provider_id: string };
  log: FastifyRequest["log"];
}): CompactRedirect | "overflow" | null {
  const { db, config, apiType, body, resolved, log } = params;

  if (!config.context_compact_enabled) return null;

  if (isCompactRequest(body.messages as unknown[])) {
    const compactProvider = config.compact_provider_id
      ? getProviderById(db, config.compact_provider_id)
      : undefined;
    if (compactProvider && config.compact_model) {
      if (compactProvider.api_type !== apiType) {
        log.warn({ expected: apiType, got: compactProvider.api_type }, "compact provider api_type mismatch, skipping redirect");
      } else {
        log.info({ from: resolved.backend_model, to: config.compact_model }, "redirecting compact request to 1M model");
        return {
          resolved: { backend_model: config.compact_model, provider_id: compactProvider.id },
          provider: compactProvider,
          model: config.compact_model,
          messages: config.custom_prompt_enabled && config.custom_prompt
            ? replaceCompactPrompt(body.messages as unknown[], config.custom_prompt)
            : (body.messages as unknown[]),
        };
      }
    }
    return null;
  }

  // 普通请求 -> 检查上下文超限（仅对 context_window < 1M 的模型检查）
  const modelCtx = getModelContextWindow(db, resolved.provider_id, resolved.backend_model);
  if (modelCtx && modelCtx < COMPACT_THRESHOLD) {
    const estimated = estimateTokens(body);
    if (estimated > modelCtx) {
      log.info({ model: resolved.backend_model, estimated, limit: modelCtx }, "context overflow detected");
      return "overflow";
    }
  }
  return null;
}

export { COMPACT_THRESHOLD };
