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
  client_model: string;
}

/** 从 mapping_groups 的 rule JSON 提取所有 target，JOIN providers 获取名称 */
export function getActiveProviderModels(db: Database.Database): ProviderModelEntry[] {
  const groups = db.prepare("SELECT client_model, rule FROM mapping_groups").all() as { client_model: string; rule: string }[];
  const providers = db.prepare("SELECT id, name FROM providers").all() as { id: string; name: string }[];
  const providerMap = new Map(providers.map(p => [p.id, p.name]));

  const results: ProviderModelEntry[] = [];
  for (const g of groups) {
    try {
      const rule = JSON.parse(g.rule);
      // 提取所有 Target（支持 scheduled/round-robin/random/failover 策略格式）
      const targets = extractTargets(rule);
      for (const t of targets) {
        const providerName = providerMap.get(t.provider_id);
        if (providerName) {
          results.push({ provider_name: providerName, backend_model: t.backend_model, client_model: g.client_model });
        }
      }
    } catch { /* 忽略解析失败的 rule */ }
  }
  return results;
}

/** 根据 "provider_name/backend_model" 从 mapping_groups 的 rule 中解析出 client_model */
export function resolveByProviderModel(
  db: Database.Database,
  providerName: string,
  backendModel: string,
): string | null {
  const providerRow = db.prepare("SELECT id FROM providers WHERE name = ?").get(providerName) as { id: string } | undefined;
  if (!providerRow) return null;

  const groups = db.prepare("SELECT client_model, rule FROM mapping_groups").all() as { client_model: string; rule: string }[];
  for (const g of groups) {
    try {
      const rule = JSON.parse(g.rule);
      const targets = extractTargets(rule);
      if (targets.some(t => t.provider_id === providerRow.id && t.backend_model === backendModel)) {
        return g.client_model;
      }
    } catch { /* continue */ }
  }
  return null;
}

interface Target { provider_id: string; backend_model: string }

/** 从 rule JSON 中提取所有 Target（覆盖各策略格式） */
function extractTargets(rule: unknown): Target[] {
  const targets: Target[] = [];
  if (typeof rule !== "object" || rule === null) return targets;
  const r = rule as Record<string, unknown>;

  // targets-based 策略（round-robin/random/failover）: { targets: [...] }
  if (Array.isArray(r.targets)) {
    for (const t of r.targets) {
      if (isTargetLike(t)) targets.push(t as Target);
    }
  }

  // scheduled 策略: { default: Target, windows: [{ target: Target }] }
  if (r.default && isTargetLike(r.default)) targets.push(r.default as Target);
  if (Array.isArray(r.windows)) {
    for (const w of r.windows) {
      if (w && typeof w === "object" && "target" in w && isTargetLike((w as Record<string, unknown>).target)) {
        targets.push((w as Record<string, unknown>).target as Target);
      }
    }
  }
  return targets;
}

function isTargetLike(v: unknown): v is Target {
  return typeof v === "object" && v !== null &&
    "provider_id" in v && typeof (v as Target).provider_id === "string" &&
    "backend_model" in v && typeof (v as Target).backend_model === "string";
}
