/**
 * admin 层共享校验工具函数和常量。
 * 各 admin 文件统一从此模块导入，消除重复定义。
 */

import type Database from "better-sqlite3";
import { getProviderById } from "../db/index.js";

/** Provider 名称合法字符：英文、数字、横线、下划线 */
export const PROVIDER_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** 校验 base_url 是否为合法的 HTTP(S) URL */
export function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** 校验 mapping_rule JSON 结构和引用完整性 */
export function validateMappingRule(
  db: Database.Database,
  ruleJson: string,
): string | undefined {
  let rule: unknown;
  try {
    rule = JSON.parse(ruleJson);
  } catch {
    return "Invalid mapping_rule JSON";
  }

  if (typeof rule !== "object" || rule === null) return "Invalid mapping_rule";
  const r = rule as { targets?: unknown[] };

  if (!Array.isArray(r.targets) || r.targets.length === 0) {
    return "mapping_rule.targets must be a non-empty array";
  }

  for (let i = 0; i < r.targets.length; i++) {
    const t = r.targets[i] as Record<string, unknown>;
    if (!t.backend_model || !t.provider_id) {
      return `targets[${i}] missing backend_model or provider_id`;
    }
    const p = getProviderById(db, t.provider_id as string);
    if (!p) return `targets[${i}] provider_id '${t.provider_id}' not found`;

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
