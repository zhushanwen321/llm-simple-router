import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { buildUpdateQuery, deleteById } from "./helpers.js";

export interface ModelMapping {
  id: string;
  client_model: string;
  backend_model: string;
  provider_id: string;
  is_active: number;
  created_at: string;
}

export interface MappingGroup {
  id: string;
  client_model: string;
  strategy: string;
  rule: string;
  created_at: string;
}

const MAPPING_FIELDS = new Set(["client_model", "backend_model", "provider_id", "is_active"]);
const GROUP_FIELDS = new Set(["client_model", "strategy", "rule"]);

// --- ModelMapping CRUD ---

export function getModelMapping(
  db: Database.Database,
  clientModel: string,
): ModelMapping | undefined {
  return db
    .prepare("SELECT * FROM model_mappings WHERE client_model = ? AND is_active = 1")
    .get(clientModel) as ModelMapping | undefined;
}

export function getAllModelMappings(db: Database.Database): ModelMapping[] {
  return db.prepare("SELECT * FROM model_mappings ORDER BY created_at DESC").all() as ModelMapping[];
}

export function createModelMapping(
  db: Database.Database,
  mapping: { client_model: string; backend_model: string; provider_id: string; is_active?: number },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, mapping.client_model, mapping.backend_model, mapping.provider_id, mapping.is_active ?? 1, now);
  return id;
}

export function updateModelMapping(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<ModelMapping, "client_model" | "backend_model" | "provider_id" | "is_active">>,
): void {
  buildUpdateQuery(db, "model_mappings", id, fields, MAPPING_FIELDS);
}

export function deleteModelMapping(db: Database.Database, id: string): void {
  deleteById(db, "model_mappings", id);
}

// --- MappingGroups CRUD ---

export function getMappingGroup(
  db: Database.Database,
  clientModel: string,
): MappingGroup | undefined {
  return db
    .prepare("SELECT * FROM mapping_groups WHERE client_model = ?")
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
  mapping: { client_model: string; strategy: string; rule: string },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, mapping.client_model, mapping.strategy, mapping.rule, now);
  return id;
}

export function updateMappingGroup(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<MappingGroup, "client_model" | "strategy" | "rule">>,
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
      const models: string[] = JSON.parse(p.models);
      for (const m of models) {
        results.push({ provider_name: p.name, backend_model: m });
      }
    } catch { /* 忽略解析失败 */ }
  }
  return results;
}

// --- 从 mapping_groups rule JSON 中提取 target 条目 ---

interface TargetEntry {
  backend_model: string;
  provider_id: string;
}

function isTargetLike(obj: unknown): obj is TargetEntry {
  return typeof obj === "object" && obj !== null &&
    typeof (obj as Record<string, unknown>).backend_model === "string" &&
    typeof (obj as Record<string, unknown>).provider_id === "string";
}

function extractTargets(rule: Record<string, unknown>): TargetEntry[] {
  const results: TargetEntry[] = [];
  if (isTargetLike(rule.default)) results.push(rule.default);
  if (Array.isArray(rule.targets)) {
    for (const t of rule.targets) {
      if (isTargetLike(t)) results.push(t);
    }
  }
  if (Array.isArray(rule.windows)) {
    for (const w of rule.windows) {
      if (w && typeof w === "object" && isTargetLike((w as Record<string, unknown>).target)) {
        results.push((w as Record<string, unknown>).target as TargetEntry);
      }
    }
  }
  return results;
}

/**
 * 根据 "provider_name/backend_model" 验证模型是否存在于 provider 配置中。
 * 同时尝试从 mapping_groups 中找到对应的 client_model 用于路由。
 * 如果找不到 mapping，返回 backend_model 本身（由 proxy-core 兜底处理）。
 */
export function resolveByProviderModel(
  db: Database.Database,
  providerName: string,
  backendModel: string,
): { client_model: string; provider_id: string; backend_model: string } | null {
  const providerRow = db.prepare("SELECT id, models FROM providers WHERE name = ? AND is_active = 1").get(providerName) as { id: string; models: string } | undefined;
  if (!providerRow) return null;
  try {
    const models: string[] = JSON.parse(providerRow.models);
    if (!models.includes(backendModel)) return null;
  } catch { return null; }

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
    } catch { /* continue */ }
  }
  // provider 有这个模型但没有 mapping group，直接返回 provider 维度信息
  return { client_model: backendModel, provider_id: providerRow.id, backend_model: backendModel };
}
