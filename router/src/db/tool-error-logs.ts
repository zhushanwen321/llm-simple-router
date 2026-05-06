import Database from "better-sqlite3";

/**
 * 删除 created_at 早于 beforeDate 的 tool_error_logs 记录。
 * 外键 ON DELETE SET NULL 确保 request_logs 被删后 tool_error_logs 仍保留。
 */
export function deleteToolErrorLogsBefore(db: Database.Database, beforeDate: string): number {
  const changes = db.prepare("DELETE FROM tool_error_logs WHERE created_at < ?").run(beforeDate).changes;
  return changes;
}
