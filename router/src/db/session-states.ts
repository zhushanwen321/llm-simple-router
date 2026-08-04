import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const BINDING_TTL_MS = 172_800_000; // 48h
const CLEANUP_INTERVAL_MS = 3_600_000; // 1h

export interface SessionBinding {
  routerKeyId: string;
  sessionId: string;
  groupId: string;
  providerId: string | null;
  currentModel: string;
  originalModel: string | null;
  lastActiveAt: string;
}

export interface SessionBindingCleanupHandle {
  stop: () => void;
}

interface SessionBindingRow {
  id: string;
  router_key_id: string;
  session_id: string;
  group_id: string;
  current_model: string;
  original_model: string | null;
  provider_id: string | null;
  last_active_at: string;
  created_at: string;
}

/**
 * 写入/刷新 session 绑定。
 * - 空 routerKeyId/sessionId 直接返回（无 session-id 不写绑定）
 * - INSERT 时 original_model = backendModel（首次绑定写入）
 * - ON CONFLICT 的 SET 不含 original_model 列（保留首次值，防回切）
 */
export function upsertSessionBinding(
  db: Database.Database,
  routerKeyId: string,
  sessionId: string,
  groupId: string,
  providerId: string,
  backendModel: string,
): void {
  if (!routerKeyId || !sessionId) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO session_model_states
       (id, router_key_id, session_id, group_id, current_model, original_model, provider_id, last_active_at, created_at)
     VALUES
       (@id, @router_key_id, @session_id, @group_id, @current_model, @original_model, @provider_id, @last_active_at, @created_at)
     ON CONFLICT(router_key_id, session_id, group_id) DO UPDATE SET
       current_model = excluded.current_model,
       provider_id = excluded.provider_id,
       last_active_at = excluded.last_active_at`,
  ).run({
    id: randomUUID(),
    router_key_id: routerKeyId,
    session_id: sessionId,
    group_id: groupId,
    current_model: backendModel,
    original_model: backendModel,
    provider_id: providerId,
    last_active_at: now,
    created_at: now,
  });
}

/**
 * 读取 session 绑定。
 * - 空 routerKeyId/sessionId 返回 null
 * - 命中但 last_active_at < now - BINDING_TTL_MS（48h 过期）→ 惰性 DELETE + 返回 null
 * - 命中且未过期 → 返回 SessionBinding（snake_case → camelCase 映射）
 */
export function getSessionBinding(
  db: Database.Database,
  routerKeyId: string,
  sessionId: string,
  groupId: string,
): SessionBinding | null {
  if (!routerKeyId || !sessionId) return null;
  const row = db
    .prepare(
      `SELECT * FROM session_model_states
     WHERE router_key_id = ? AND session_id = ? AND group_id = ?`,
    )
    .get(routerKeyId, sessionId, groupId) as SessionBindingRow | undefined;
  if (!row) return null;

  const cutoff = new Date(Date.now() - BINDING_TTL_MS).toISOString();
  if (row.last_active_at < cutoff) {
    db.prepare("DELETE FROM session_model_states WHERE id = ?").run(row.id);
    return null;
  }

  return {
    routerKeyId: row.router_key_id,
    sessionId: row.session_id,
    groupId: row.group_id,
    providerId: row.provider_id,
    currentModel: row.current_model,
    originalModel: row.original_model,
    lastActiveAt: row.last_active_at,
  };
}

/** 删除 last_active_at 早于 cutoff 的绑定，返回删除条数 */
export function deleteSessionBindingsBefore(
  db: Database.Database,
  cutoff: string,
): number {
  const result = db
    .prepare("DELETE FROM session_model_states WHERE last_active_at < ?")
    .run(cutoff);
  return result.changes;
}

/** 运行一次绑定清理（48h 过期），返回删除条数 */
export function runSessionBindingCleanup(db: Database.Database): number {
  const cutoff = new Date(Date.now() - BINDING_TTL_MS).toISOString();
  return deleteSessionBindingsBefore(db, cutoff);
}

/**
 * 启动定时清理（首跑 setTimeout(0) + 每小时 setInterval + 防重入锁），
 * 返回 stop handle（幂等，可多次调用）。照抄 log-cleaner.ts 模式。
 */
export function scheduleSessionBindingCleanup(
  db: Database.Database,
  log: { info: (msg: string) => void },
): SessionBindingCleanupHandle {
  let cleaning = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  const doCleanup = () => {
    if (cleaning) return;
    cleaning = true;
    try {
      const deleted = runSessionBindingCleanup(db);
      if (deleted > 0)
        log.info(`Session binding cleanup: deleted ${deleted} records`);
    } catch (e) {
      // DB 可能已关闭（测试清理、进程关闭等）
      log.info(
        `Session binding cleanup skipped: ${e instanceof Error ? e.message : JSON.stringify(e)}`,
      );
    } finally {
      cleaning = false;
    }
  };

  // 推迟到下一个事件循环 tick，避免阻塞服务器启动
  initialTimer = setTimeout(doCleanup, 0);
  intervalTimer = setInterval(doCleanup, CLEANUP_INTERVAL_MS);

  return {
    stop: () => {
      if (initialTimer) {
        clearTimeout(initialTimer);
        initialTimer = null;
      }
      if (intervalTimer) {
        clearInterval(intervalTimer);
        intervalTimer = null;
      }
    },
  };
}
