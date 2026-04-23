import Database from "better-sqlite3";

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function isInitialized(db: Database.Database): boolean {
  return getSetting(db, "initialized") === "true";
}

export function getLogRetentionDays(db: Database.Database): number {
  const val = getSetting(db, "log_retention_days");
  return val ? parseInt(val, 10) : 3;
}

export function setLogRetentionDays(db: Database.Database, days: number): void {
  setSetting(db, "log_retention_days", String(days));
}
