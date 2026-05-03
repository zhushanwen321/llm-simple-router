/** Date → SQLite datetime 文本 (YYYY-MM-DD HH:MM:SS)，UTC 时区，与 DEFAULT (datetime('now')) 对齐 */
export function toSqliteDatetime(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

/** 兼容 ISO 和 SQLite datetime 格式的日期解析，均视为 UTC */
export function parseSqliteDatetime(s: string): Date {
  if (s.includes("T")) return new Date(s);
  return new Date(s + "Z");
}
