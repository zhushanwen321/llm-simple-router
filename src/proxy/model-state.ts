import type Database from "better-sqlite3";
import {
  upsertSessionState,
  getSessionState,
  deleteSessionState,
  insertSessionHistory,
} from "../db/session-states.js";

// 会话记忆在 24 小时后过期（滑动窗口）
const HOUR_MS = 3600_000;
const TTL_HOURS = 24;
const TTL_MS = TTL_HOURS * HOUR_MS;

interface StateEntry {
  model: string;
  updatedAt: number;
}

export class ModelStateManager {
  private store = new Map<string, StateEntry>();
  private db: Database.Database | null = null;

  /** 单例注入 DB 实例，启动时调用一次 */
  init(db: Database.Database): void {
    this.db = db;
  }

  /** 构造内存 Map 的 key：有 sessionId 时用复合键 */
  buildKey(routerKeyId: string | null, sessionId?: string): string {
    if (sessionId) {
      return `${routerKeyId ?? "null"}:${sessionId}`;
    }
    return String(routerKeyId);
  }

  /**
   * 写入模型状态。
   * - 始终写内存
   * - 有 sessionId 时双写 DB（事务：upsert + history）
   * - model="default" 时删除记忆
   */
  set(
    routerKeyId: string | null,
    model: string,
    sessionId?: string,
    originalModel?: string,
    triggerType?: string,
  ): void {
    const key = this.buildKey(routerKeyId, sessionId);

    if (model === "default") {
      this.store.delete(key);
      if (sessionId && routerKeyId && this.db) {
        this.db.transaction(() => {
          deleteSessionState(this.db!, routerKeyId, sessionId);
          insertSessionHistory(this.db!, {
            router_key_id: routerKeyId,
            session_id: sessionId,
            old_model: null,
            new_model: "default",
            trigger_type: triggerType ?? "command",
          });
        })();
      }
      return;
    }

    this.store.set(key, { model, updatedAt: Date.now() });

    if (sessionId && routerKeyId && this.db) {
      this.db.transaction(() => {
        upsertSessionState(this.db!, {
          router_key_id: routerKeyId,
          session_id: sessionId,
          current_model: model,
          original_model: originalModel ?? null,
        });
        insertSessionHistory(this.db!, {
          router_key_id: routerKeyId,
          session_id: sessionId,
          old_model: null,
          new_model: model,
          trigger_type: triggerType ?? "command",
        });
      })();
    }
  }

  /**
   * 读取模型状态。
   * - 先查内存，命中且未过期直接返回
   * - 未命中且有 sessionId 时查 DB 并回填内存
   */
  get(routerKeyId: string | null, sessionId?: string): string | null {
    const key = this.buildKey(routerKeyId, sessionId);
    const entry = this.store.get(key);

    // 内存命中
    if (entry) {
      if (Date.now() - entry.updatedAt > TTL_MS) {
        this.store.delete(key);
        return null;
      }
      return entry.model;
    }

    // 内存未命中，尝试从 DB 回填
    if (sessionId && routerKeyId && this.db) {
      const row = getSessionState(this.db, routerKeyId, sessionId);
      if (row) {
        this.store.set(key, { model: row.current_model, updatedAt: Date.now() });
        return row.current_model;
      }
    }

    return null;
  }

  /**
   * 删除模型状态。
   * - 同时清除内存和 DB
   */
  delete(routerKeyId: string, sessionId: string): void {
    const key = this.buildKey(routerKeyId, sessionId);
    this.store.delete(key);

    if (this.db) {
      this.db.transaction(() => {
        deleteSessionState(this.db!, routerKeyId, sessionId);
        insertSessionHistory(this.db!, {
          router_key_id: routerKeyId,
          session_id: sessionId,
          old_model: null,
          new_model: "default",
          trigger_type: "manual_clear",
        });
      })();
    }
  }
}

// singleton
export const modelState = new ModelStateManager();
