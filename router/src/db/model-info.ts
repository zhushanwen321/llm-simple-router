import Database from "better-sqlite3";

export interface ProviderModelInfo {
  provider_id: string;
  model_name: string;
  context_window: number;
}

export function getModelContextWindowOverride(
  db: Database.Database,
  providerId: string,
  modelName: string,
): number | null {
  const row = db
    .prepare("SELECT context_window FROM provider_model_info WHERE provider_id = ? AND model_name = ?")
    .get(providerId, modelName) as { context_window: number } | undefined;
  return row?.context_window ?? null;
}

export function getModelInfoForProvider(
  db: Database.Database,
  providerId: string,
): ProviderModelInfo[] {
  return db
    .prepare("SELECT * FROM provider_model_info WHERE provider_id = ?")
    .all(providerId) as ProviderModelInfo[];
}

export function setModelInfoForProvider(
  db: Database.Database,
  providerId: string,
  entries: Array<{ model_name: string; context_window: number }>,
): void {
  const del = db.prepare("DELETE FROM provider_model_info WHERE provider_id = ?");
  const ins = db.prepare("INSERT INTO provider_model_info (provider_id, model_name, context_window) VALUES (?, ?, ?)");
  db.transaction(() => {
    del.run(providerId);
    for (const e of entries) {
      ins.run(providerId, e.model_name, e.context_window);
    }
  })();
}

export function deleteAllModelInfoForProvider(
  db: Database.Database,
  providerId: string,
): void {
  db.prepare("DELETE FROM provider_model_info WHERE provider_id = ?").run(providerId);
}

export function getAllModelInfo(db: Database.Database): ProviderModelInfo[] {
  return db.prepare("SELECT * FROM provider_model_info").all() as ProviderModelInfo[];
}
