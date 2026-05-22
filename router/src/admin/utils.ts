import Database from "better-sqlite3";
import { getProviderById } from "../db/index.js";

// ──────────────────────────────────────────────
// HTTP 状态码（重新导出，统一从 core/constants.ts 导入）
// ──────────────────────────────────────────────
export {
  HTTP_OK,
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_CONFLICT,
  HTTP_INTERNAL_ERROR,
  HTTP_BAD_GATEWAY,
  HTTP_SERVICE_UNAVAILABLE,
} from "../core/constants.js";

// ──────────────────────────────────────────────
// 共享常量
// ──────────────────────────────────────────────

/** Provider 名称校验正则（仅允许英文大小写字母、数字、横线和下划线） */
export const PROVIDER_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** API Key 预览的最小长度阈值 */
export const API_KEY_PREVIEW_MIN_LENGTH = 8;

/** API Key 预览的前缀/后缀保留字符数 */
export const API_KEY_PREVIEW_PREFIX_LEN = 4;

// ──────────────────────────────────────────────
// 通用校验工具
// ──────────────────────────────────────────────

/** 校验 base_url 是否为合法的 HTTP(S) URL */
export function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** 校验 body_pattern 是否为合法正则 */
export function validateBodyPattern(pattern: string): string | undefined {
  try {
    new RegExp(pattern);
    return undefined;
  } catch {
    return "Invalid body_pattern regex";
  }
}

/** 生成 API Key 预览（取前后各 4 位，中间省略） */
export function formatApiKeyPreview(key: string): string {
  if (key.length > API_KEY_PREVIEW_MIN_LENGTH) {
    return `${key.slice(0, API_KEY_PREVIEW_PREFIX_LEN)}...${key.slice(-API_KEY_PREVIEW_PREFIX_LEN)}`;
  }
  return "****";
}

// ──────────────────────────────────────────────
// 映射规则校验（groups.ts 和 schedules.ts 共用）
// ──────────────────────────────────────────────

/**
 * 校验映射规则 JSON 的结构和字段有效性。
 * 验证项：JSON 解析、targets 非空数组、每个 target 的 backend_model/provider_id 必填、
 * provider 存在性、overflow 字段一致性、overflow provider 存在性。
 */
export function validateMappingRule(
  db: Database.Database,
  ruleJson: string,
): string | undefined {
  let rule: unknown;
  try {
    rule = JSON.parse(ruleJson);
  } catch {
    return "Invalid rule JSON";
  }

  if (typeof rule !== "object" || rule === null) return "Invalid rule";
  const r = rule as { targets?: unknown[] };

  if (!Array.isArray(r.targets) || r.targets.length === 0) {
    return "rule.targets must be a non-empty array";
  }

  for (let i = 0; i < r.targets.length; i++) {
    const t = r.targets[i] as Record<string, unknown>;
    if (!t.backend_model || !t.provider_id) {
      return `targets[${i}] missing backend_model or provider_id`;
    }
    const p = getProviderById(db, t.provider_id as string);
    if (!p) {
      return `targets[${i}] provider_id '${t.provider_id}' not found`;
    }

    // Overflow 字段一致性校验
    const hasOverflowProvider = !!t.overflow_provider_id;
    const hasOverflowModel = !!t.overflow_model;
    if (hasOverflowProvider && !hasOverflowModel) {
      return `targets[${i}]: overflow_provider_id requires overflow_model`;
    }
    if (hasOverflowModel && !hasOverflowProvider) {
      return `targets[${i}]: overflow_model requires overflow_provider_id`;
    }
    if (hasOverflowProvider) {
      const op = getProviderById(db, t.overflow_provider_id as string);
      if (!op) {
        return `targets[${i}]: overflow_provider_id '${t.overflow_provider_id}' not found`;
      }
    }
  }

  return undefined;
}
