import Database from "better-sqlite3";

/** WeakMap 按 db 实例缓存 prepared statements，避免重复 prepare() */
const stmtCache = new WeakMap<Database.Database, Map<string, Database.Statement>>();

export function getCachedStmt(db: Database.Database, sql: string): Database.Statement {
  let cache = stmtCache.get(db);
  if (!cache) { cache = new Map(); stmtCache.set(db, cache); }
  let stmt = cache.get(sql);
  if (!stmt) { stmt = db.prepare(sql); cache.set(sql, stmt); }
  return stmt;
}

/**
 * 通用 UPDATE 构建器。
 * 用白名单过滤安全字段，拼接 SET 子句。
 *
 * table 参数来自代码中的字符串常量（非用户输入），不存在 SQL 注入风险。
 */
export function buildUpdateQuery(
  db: Database.Database,
  table: string,
  id: string,
  fields: Record<string, unknown>,
  allowedKeys: Set<string>,
  options?: { updatedAt?: boolean },
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (allowedKeys.has(key)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return;
  if (options?.updatedAt) {
    sets.push("updated_at = ?");
    values.push(new Date().toISOString());
  }
  values.push(id);
  db.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

/** 通用 DELETE by ID */
export function deleteById(db: Database.Database, table: string, id: string): void {
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}
