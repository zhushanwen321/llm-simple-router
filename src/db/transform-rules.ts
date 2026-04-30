import Database from "better-sqlite3";

export interface TransformRules {
  provider_id: string;
  inject_headers: Record<string, string> | null;
  request_defaults: Record<string, unknown> | null;
  drop_fields: string[] | null;
  field_overrides: Record<string, unknown> | null;
  plugin_name: string | null;
  is_active: number;
  created_at?: string;
  updated_at?: string;
}

const JSON_COLUMNS = ["inject_headers", "request_defaults", "drop_fields", "field_overrides"] as const;

function parseJsonColumns(row: Record<string, unknown>): TransformRules {
  const result = { ...row } as Record<string, unknown>;
  for (const col of JSON_COLUMNS) {
    if (result[col]) {
      try {
        result[col] = JSON.parse(result[col] as string);
      } catch {
        console.error(`[transform-rules] Failed to parse JSON column "${col}", keeping raw value`);
      }
    }
  }
  return result as unknown as TransformRules;
}

export function getTransformRule(db: Database.Database, providerId: string): TransformRules | null {
  const row = db.prepare("SELECT * FROM provider_transform_rules WHERE provider_id = ?").get(providerId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseJsonColumns(row);
}

export function upsertTransformRule(db: Database.Database, providerId: string, rules: Partial<Omit<TransformRules, "provider_id">>): void {
  const existing = db.prepare("SELECT provider_id FROM provider_transform_rules WHERE provider_id = ?").get(providerId);
  if (existing) {
    const fields: string[] = [];
    const values: unknown[] = [];
    const jsonFields = new Set(["inject_headers", "request_defaults", "drop_fields", "field_overrides"]);
    for (const [key, val] of Object.entries(rules)) {
      if (key === "provider_id") continue;
      fields.push(`${key} = ?`);
      values.push(jsonFields.has(key) && val ? JSON.stringify(val) : val);
    }
    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    values.push(providerId);
    db.prepare(`UPDATE provider_transform_rules SET ${fields.join(", ")} WHERE provider_id = ?`).run(...values);
  } else {
    db.prepare(
      `INSERT INTO provider_transform_rules (provider_id, inject_headers, request_defaults, drop_fields, field_overrides, plugin_name, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      providerId,
      rules.inject_headers ? JSON.stringify(rules.inject_headers) : null,
      rules.request_defaults ? JSON.stringify(rules.request_defaults) : null,
      rules.drop_fields ? JSON.stringify(rules.drop_fields) : null,
      rules.field_overrides ? JSON.stringify(rules.field_overrides) : null,
      rules.plugin_name ?? null,
      rules.is_active ?? 1,
    );
  }
}

export function deleteTransformRule(db: Database.Database, providerId: string): void {
  db.prepare("DELETE FROM provider_transform_rules WHERE provider_id = ?").run(providerId);
}

export function getAllActiveRules(db: Database.Database): TransformRules[] {
  const rows = db.prepare("SELECT * FROM provider_transform_rules WHERE is_active = 1").all() as Record<string, unknown>[];
  return rows.map(parseJsonColumns);
}
