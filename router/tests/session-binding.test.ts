import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../src/db/index.js";
import {
  upsertSessionBinding,
  getSessionBinding,
  runSessionBindingCleanup,
  scheduleSessionBindingCleanup,
} from "../src/db/session-states.js";

describe("SessionBinding", () => {
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    db = initDatabase(":memory:");
    // 预插 router_keys 以满足外键约束（session_model_states.router_key_id → router_keys.id）
    db.prepare(
      "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)",
    ).run("rk1", "test-key", "hash1", "prefix");
  });

  // TC1 upsert 首次绑定写 original_model
  it("upsert 首次绑定写入 original_model", () => {
    upsertSessionBinding(db, "rk1", "sess1", "grp1", "p1", "m1");
    const row = db.prepare(
      "SELECT original_model, current_model, provider_id, group_id, last_active_at FROM session_model_states WHERE router_key_id = ? AND session_id = ? AND group_id = ?",
    ).get("rk1", "sess1", "grp1") as {
      original_model: string;
      current_model: string;
      provider_id: string;
      group_id: string;
      last_active_at: string;
    };
    expect(row.original_model).toBe("m1");
    expect(row.current_model).toBe("m1");
    expect(row.provider_id).toBe("p1");
    expect(row.group_id).toBe("grp1");
    // last_active_at 接近 now（1 分钟内）
    expect(Date.now() - new Date(row.last_active_at).getTime()).toBeLessThan(60_000);
  });

  // TC2 upsert 重复绑定保留 original_model 覆盖 current_model
  it("upsert 重复绑定保留 original_model 覆盖 current_model", () => {
    upsertSessionBinding(db, "rk1", "sess1", "grp1", "p1", "m1");
    // 手动设置旧 last_active_at，验证第二次 upsert 会刷新
    const oldTime = new Date(Date.now() - 10_000).toISOString();
    db.prepare(
      "UPDATE session_model_states SET last_active_at = ? WHERE router_key_id = ? AND session_id = ? AND group_id = ?",
    ).run(oldTime, "rk1", "sess1", "grp1");

    upsertSessionBinding(db, "rk1", "sess1", "grp1", "p2", "m2");

    const count = (db.prepare("SELECT COUNT(*) as n FROM session_model_states").get() as { n: number }).n;
    expect(count).toBe(1);
    const row = db.prepare(
      "SELECT original_model, current_model, provider_id, last_active_at FROM session_model_states WHERE router_key_id = ? AND session_id = ? AND group_id = ?",
    ).get("rk1", "sess1", "grp1") as {
      original_model: string;
      current_model: string;
      provider_id: string;
      last_active_at: string;
    };
    expect(row.original_model).toBe("m1");
    expect(row.current_model).toBe("m2");
    expect(row.provider_id).toBe("p2");
    expect(new Date(row.last_active_at).getTime()).toBeGreaterThan(new Date(oldTime).getTime());
  });

  // TC3 getSessionBinding 命中返回绑定
  it("getSessionBinding 命中返回绑定", () => {
    upsertSessionBinding(db, "rk1", "sess1", "grp1", "p1", "m1");
    const binding = getSessionBinding(db, "rk1", "sess1", "grp1");
    expect(binding).not.toBeNull();
    expect(binding!.providerId).toBe("p1");
    expect(binding!.currentModel).toBe("m1");
    expect(binding!.groupId).toBe("grp1");
  });

  // TC4 getSessionBinding group 级隔离
  it("getSessionBinding group 级隔离", () => {
    upsertSessionBinding(db, "rk1", "sess1", "grp1", "p1", "m1");
    upsertSessionBinding(db, "rk1", "sess1", "grp2", "p2", "m2");
    expect(getSessionBinding(db, "rk1", "sess1", "grp1")!.currentModel).toBe("m1");
    expect(getSessionBinding(db, "rk1", "sess1", "grp2")!.currentModel).toBe("m2");
    const count = (db.prepare("SELECT COUNT(*) as n FROM session_model_states").get() as { n: number }).n;
    expect(count).toBe(2);
  });

  // TC5 getSessionBinding 未命中返回 null
  it("getSessionBinding 未命中返回 null", () => {
    expect(getSessionBinding(db, "nope", "nope", "nope")).toBeNull();
  });

  // TC6 getSessionBinding 空 routerKeyId/sessionId 返回 null
  it("getSessionBinding 空 routerKeyId/sessionId 返回 null", () => {
    expect(getSessionBinding(db, "", "sess1", "grp1")).toBeNull();
    expect(getSessionBinding(db, "rk1", "", "grp1")).toBeNull();
  });

  // TC7 getSessionBinding 过期记录惰性删除返回 null
  it("getSessionBinding 过期记录惰性删除返回 null", () => {
    upsertSessionBinding(db, "rk1", "sess1", "grp1", "p1", "m1");
    const expired = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    db.prepare(
      "UPDATE session_model_states SET last_active_at = ? WHERE router_key_id = ? AND session_id = ? AND group_id = ?",
    ).run(expired, "rk1", "sess1", "grp1");

    expect(getSessionBinding(db, "rk1", "sess1", "grp1")).toBeNull();

    const count = (db.prepare("SELECT COUNT(*) as n FROM session_model_states").get() as { n: number }).n;
    expect(count).toBe(0);
  });

  // TC8 upsertSessionBinding 空 routerKeyId/sessionId 直接返回
  it("upsertSessionBinding 空 routerKeyId/sessionId 直接返回", () => {
    expect(() => upsertSessionBinding(db, "", "sess1", "grp1", "p1", "m1")).not.toThrow();
    expect(() => upsertSessionBinding(db, "rk1", "", "grp1", "p1", "m1")).not.toThrow();
    const count = (db.prepare("SELECT COUNT(*) as n FROM session_model_states").get() as { n: number }).n;
    expect(count).toBe(0);
  });

  // TC9 runSessionBindingCleanup 删除全部过期行保留未过期
  it("runSessionBindingCleanup 删除全部过期行保留未过期", () => {
    const expired = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(); // 49h 过期
    const fresh = new Date().toISOString(); // now 未过期
    const boundary = new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString(); // 47h 边界未过期
    const insertSql = db.prepare(
      "INSERT INTO session_model_states (id, router_key_id, session_id, group_id, current_model, original_model, provider_id, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertSql.run("id1", "rk1", "sess-a", "grp1", "m", "m", "p", expired, expired);
    insertSql.run("id2", "rk1", "sess-b", "grp1", "m", "m", "p", fresh, fresh);
    insertSql.run("id3", "rk1", "sess-c", "grp1", "m", "m", "p", boundary, boundary);

    const deleted = runSessionBindingCleanup(db);
    expect(deleted).toBe(1);
    const count = (db.prepare("SELECT COUNT(*) as n FROM session_model_states").get() as { n: number }).n;
    expect(count).toBe(2);
  });

  // TC10 scheduleSessionBindingCleanup 返回 stop handle 不泄漏
  it("scheduleSessionBindingCleanup 返回 stop handle 不泄漏", () => {
    const handle = scheduleSessionBindingCleanup(db, { info: () => {} });
    handle.stop();
    // 幂等：多次 stop 不报错
    expect(() => handle.stop()).not.toThrow();
  });
});
