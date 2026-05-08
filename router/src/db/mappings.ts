import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { Target } from "../core/types.js";
import { buildUpdateQuery, deleteById } from "./helpers.js";
import { parseModels } from "../config/model-context.js";

export interface MappingGroup {
  id: string;
  client_model: string;
  strategy: string;
  rule: string;
  is_active: number;
  created_at: string;
}

const GROUP_FIELDS = new Set(["client_model", "strategy", "rule", "is_active"]);

// --- MappingGroups CRUD ---

export function getMappingGroup(
  db: Database.Database,
  clientModel: string,
): MappingGroup | undefined {
  return db
    .prepare("SELECT * FROM mapping_groups WHERE client_model = ? AND is_active = 1")
    .get(clientModel) as MappingGroup | undefined;
}

export function getMappingGroupById(
  db: Database.Database,
  id: string,
): MappingGroup | undefined {
  return db
    .prepare("SELECT * FROM mapping_groups WHERE id = ?")
    .get(id) as MappingGroup | undefined;
}

export function getAllMappingGroups(db: Database.Database): MappingGroup[] {
  return db
    .prepare("SELECT * FROM mapping_groups ORDER BY created_at DESC")
    .all() as MappingGroup[];
}

export function createMappingGroup(
  db: Database.Database,
  mapping: { client_model: string; rule: string },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at)
     VALUES (?, ?, 'scheduled', ?, ?)`,
  ).run(id, mapping.client_model, mapping.rule, now);
  return id;
}

export function updateMappingGroup(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<MappingGroup, "client_model" | "strategy" | "rule" | "is_active">>,
): void {
  buildUpdateQuery(db, "mapping_groups", id, fields, GROUP_FIELDS);
}

export function deleteMappingGroup(db: Database.Database, id: string): void {
  deleteById(db, "mapping_groups", id);
}

// --- Provider-Model 查询（代理增强用）---

export interface ProviderModelEntry {
  provider_name: string;
  backend_model: string;
}

/** 从 providers.models 获取所有可用模型 */
export function getActiveProviderModels(db: Database.Database): ProviderModelEntry[] {
  const providers = db.prepare("SELECT name, models, is_active FROM providers WHERE is_active = 1").all() as { name: string; models: string; is_active: number }[];
  const results: ProviderModelEntry[] = [];
  for (const p of providers) {
    try {
      const modelEntries = parseModels(p.models);
      for (const m of modelEntries) {
        results.push({ provider_name: p.name, backend_model: m.name });
      }
    } catch { continue }
  }
  return results;
}

// --- 内联 Target 类型守卫（原 targets-rule.ts 已删除） ---

function isTarget(value: unknown): value is Target {
  return (
    typeof value === "object" &&
    value !== null &&
    "backend_model" in value &&
    typeof (value as Target).backend_model === "string" &&
    "provider_id" in value &&
    typeof (value as Target).provider_id === "string"
  );
}

// --- 从 mapping_groups rule JSON 中提取 target 条目 ---
// 主格式为 { targets: [...] }，向后兼容旧 { default: {...} }。
// 与 mapping-resolver.ts 中 parseTargets 保持逻辑一致。
function extractTargets(rule: Record<string, unknown>): Target[] {
  const results: Target[] = [];
  if (Array.isArray(rule.targets)) {
    for (const t of rule.targets) {
      if (isTarget(t)) results.push(t);
    }
  }
  // 兼容旧格式 { default: {...} }（向后兼容 migration 026 前数据）
  // eslint-disable-next-line taste/no-deprecated-rule-format
  if (results.length === 0 && isTarget(rule.default)) {
    // eslint-disable-next-line taste/no-deprecated-rule-format
    results.push(rule.default);
  }
  return results;
}

/**
 * 根据 "provider_name/backend_model" 验证模型是否存在于 provider 配置中。
 * 同时尝试从 mapping_groups 中找到对应的 client_model 用于路由。
 */
export function resolveByProviderModel(
  db: Database.Database,
  providerName: string,
  backendModel: string,
): { client_model: string; provider_id: string; backend_model: string } | null {
  const providerRow = db.prepare("SELECT id, models FROM providers WHERE name = ? AND is_active = 1").get(providerName) as { id: string; models: string } | undefined;
  if (!providerRow) return null;
  try {
    const modelEntries = parseModels(providerRow.models);
    if (!modelEntries.some(m => m.name === backendModel)) return null;
  } catch { return null }

  // 尝试从 mapping_groups 找到包含此 provider+backend_model 的 client_model
  const groups = db.prepare("SELECT client_model, rule FROM mapping_groups").all() as { client_model: string; rule: string }[];
  for (const g of groups) {
    try {
      const rule = JSON.parse(g.rule);
      const targets = extractTargets(rule);
      const match = targets.find(t => t.provider_id === providerRow.id && t.backend_model === backendModel);
      if (match) {
        return { client_model: g.client_model, provider_id: providerRow.id, backend_model: backendModel };
      }
    } catch { continue }
  }
  // provider 有这个模型但没有 mapping group，直接返回 provider 维度信息
  return { client_model: backendModel, provider_id: providerRow.id, backend_model: backendModel };
}
