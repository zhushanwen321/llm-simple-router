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
