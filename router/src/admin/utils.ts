/**
 * admin 层共享校验工具函数和常量。
 * 各 admin 文件统一从此模块导入，消除重复定义。
 */

import type Database from "better-sqlite3";
import { getProviderById } from "../db/index.js";

/** Provider 名称合法字符：英文、数字、横线、下划线 */
export const PROVIDER_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** 熔断链最小 target 数：单 target 熔断无转移目标，无意义（设计文档 §4.6） */
const MIN_CHAIN_TARGETS = 2;
/** status_codes 合法下界：HTTP 客户端错误起始码 */
const STATUS_CODE_MIN = 400;
/** status_codes 合法上界：HTTP 服务端错误终止码 */
const STATUS_CODE_MAX = 599;

/** 校验 base_url 是否为合法的 HTTP(S) URL */
export function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 校验单个 target 的 circuit_breaker 配置字段（内部辅助函数）。
 * 返回首个错误消息或 undefined（通过）。
 */
function validateSingleCircuitBreaker(
  cb: unknown,
  label: string,
): string | undefined {
  if (typeof cb !== "object" || cb === null) {
    return `${label} must be an object`;
  }
  const c = cb as Record<string, unknown>;

  if (typeof c.enabled !== "boolean") {
    return `${label}.enabled must be a boolean`;
  }

  const windowSec = c.window_sec;
  if (
    typeof windowSec !== "number" ||
    !Number.isInteger(windowSec) ||
    windowSec < 1
  ) {
    return `${label}.window_sec must be an integer >= 1`;
  }

  const failureRate = c.failure_rate;
  if (
    typeof failureRate !== "number" ||
    failureRate <= 0 ||
    failureRate > 1
  ) {
    return `${label}.failure_rate must be a number between 0 (exclusive) and 1 (inclusive)`;
  }

  const minSamples = c.min_samples;
  if (
    typeof minSamples !== "number" ||
    !Number.isInteger(minSamples) ||
    minSamples < 1
  ) {
    return `${label}.min_samples must be an integer >= 1`;
  }

  const cooldownSec = c.cooldown_sec;
  if (
    typeof cooldownSec !== "number" ||
    !Number.isInteger(cooldownSec) ||
    cooldownSec < 1
  ) {
    return `${label}.cooldown_sec must be an integer >= 1`;
  }

  const statusCodes = c.status_codes;
  if (statusCodes !== undefined && statusCodes !== null) {
    if (!Array.isArray(statusCodes)) {
      return `${label}.status_codes must be an array of integers between ${STATUS_CODE_MIN} and ${STATUS_CODE_MAX}`;
    }
    for (const code of statusCodes) {
      if (
        typeof code !== "number" ||
        !Number.isInteger(code) ||
        code < STATUS_CODE_MIN ||
        code > STATUS_CODE_MAX
      ) {
        return `${label}.status_codes must be an array of integers between ${STATUS_CODE_MIN} and ${STATUS_CODE_MAX}`;
      }
    }
  }
  return undefined;
}

/**
 * 校验 targets 中配置的 circuit_breaker 字段（供 validateRule 与 validateMappingRule 复用）。
 * - 无 circuit_breaker 配置的 target 跳过（向后兼容）
 * - 链约束：任一 target 配 circuit_breaker 则 targets 总数 >= 2（单 target 熔断无意义，设计文档 §4.6）
 * 返回首个错误消息或 undefined（通过）。
 */
export function validateCircuitBreaker(
  targets: ReadonlyArray<{ circuit_breaker?: unknown }>,
): string | undefined {
  const hasAnyCb = targets.some(
    t => t.circuit_breaker !== undefined && t.circuit_breaker !== null,
  );
  if (hasAnyCb && targets.length < MIN_CHAIN_TARGETS) {
    return "circuit_breaker requires at least 2 targets in the chain";
  }
  for (let i = 0; i < targets.length; i++) {
    const cb = targets[i].circuit_breaker;
    if (cb === undefined || cb === null) continue;
    const err = validateSingleCircuitBreaker(cb, `targets[${i}].circuit_breaker`);
    if (err) return err;
  }
  return undefined;
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

  const cbErr = validateCircuitBreaker(
    r.targets as ReadonlyArray<{ circuit_breaker?: unknown }>,
  );
  if (cbErr) return cbErr;

  return undefined;
}
