// TDD test for BI-M3 — getRequestLogsGrouped N+1 改为 CTE
// 预期 FAIL until implementation
//
// 当前实现：getRequestLogsGrouped 对每行执行子查询 (SELECT COUNT(*) FROM request_logs c WHERE c.original_request_id = rl.id)
// 优化目标：使用 CTE (Common Table Expression) 或 LEFT JOIN + GROUP BY 消除 N+1 查询
// 本测试验证：
// 1. child_count 正确计算
// 2. 分页（LIMIT + OFFSET）正确
// 3. WHERE 条件过滤正确
// 4. 大量数据下查询效率

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../src/db/index.js";
import { setSetting } from "../../src/db/settings.js";
import { getRequestLogsGrouped } from "../../src/db/logs.js";

describe("BI-M3: getRequestLogsGrouped CTE optimization", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "initialized", "true");
  });

  afterEach(() => {
    db.close();
  });

  it("返回正确的 child_count — 1 条父请求 + 3 条子请求", () => {
    const now = new Date();
    const stmt = db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // 父请求
    stmt.run("parent-1", "openai", "gpt-4", "prov-1", 200, 100, 0, null, now.toISOString(), 0, 0, null);

    // 3 条子请求
    stmt.run("child-1", "openai", "gpt-4", "prov-1", 200, 80, 0, null, new Date(now.getTime() + 100).toISOString(), 1, 0, "parent-1");
    stmt.run("child-2", "openai", "gpt-4", "prov-2", 200, 60, 0, null, new Date(now.getTime() + 200).toISOString(), 0, 1, "parent-1");
    stmt.run("child-3", "openai", "gpt-4", "prov-2", 200, 40, 0, null, new Date(now.getTime() + 300).toISOString(), 0, 1, "parent-1");

    const result = getRequestLogsGrouped(db, { page: 1, limit: 10 });

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("parent-1");
    expect(result.data[0].child_count).toBe(3);
  });

  it("child_count 为 0 — 无子请求的根请求", () => {
    const now = new Date();
    db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("parent-only", "openai", "gpt-4", "prov-1", 200, 100, 0, null, now.toISOString(), 0, 0, null);

    const result = getRequestLogsGrouped(db, { page: 1, limit: 10 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].child_count).toBe(0);
  });

  it("分页正确 — 第 2 页无数据", () => {
    const now = new Date();
    const stmt = db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // 插入 3 条根请求
    for (let i = 0; i < 3; i++) {
      stmt.run(`root-${i}`, "openai", "gpt-4", "prov-1", 200, 100, 0, null, new Date(now.getTime() + i * 1000).toISOString(), 0, 0, null);
    }

    // 第 1 页：limit=2，返回 2 条
    const page1 = getRequestLogsGrouped(db, { page: 1, limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(3);

    // 第 2 页：limit=2，返回 1 条
    const page2 = getRequestLogsGrouped(db, { page: 2, limit: 2 });
    expect(page2.data).toHaveLength(1);

    // 第 3 页：无数据
    const page3 = getRequestLogsGrouped(db, { page: 3, limit: 2 });
    expect(page3.data).toHaveLength(0);
  });

  it("WHERE 条件过滤正确 — api_type 过滤", () => {
    const now = new Date();
    const stmt = db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    stmt.run("openai-root", "openai", "gpt-4", "prov-1", 200, 100, 0, null, now.toISOString(), 0, 0, null);
    stmt.run("anthropic-root", "anthropic", "claude-3", "prov-2", 200, 100, 0, null, now.toISOString(), 0, 0, null);

    // 只查 openai
    const result = getRequestLogsGrouped(db, { page: 1, limit: 10, api_type: "openai" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("openai-root");
  });

  it("子请求不应出现在 grouped 结果中", () => {
    const now = new Date();
    const stmt = db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    stmt.run("parent-a", "openai", "gpt-4", "prov-1", 500, 1000, 0, "error", now.toISOString(), 0, 0, null);
    stmt.run("child-a1", "openai", "gpt-4", "prov-1", 200, 800, 0, null, new Date(now.getTime() + 100).toISOString(), 1, 0, "parent-a");
    stmt.run("child-a2", "openai", "gpt-4", "prov-2", 200, 500, 0, null, new Date(now.getTime() + 200).toISOString(), 0, 1, "parent-a");

    const result = getRequestLogsGrouped(db, { page: 1, limit: 10 });
    const ids = result.data.map((r) => r.id);

    expect(ids).toContain("parent-a");
    expect(ids).not.toContain("child-a1");
    expect(ids).not.toContain("child-a2");
  });

  it("大量数据的性能 — 100 条根请求 + 随机子请求", () => {
    const now = new Date();
    const stmt = db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // 插入 100 条根请求
    for (let i = 0; i < 100; i++) {
      stmt.run(
        `root-${i.toString().padStart(3, "0")}`, "openai", "gpt-4", "prov-1",
        i % 5 === 0 ? 500 : 200, 100 + i, i % 2, null,
        new Date(now.getTime() + i * 100).toISOString(), 0, 0, null,
      );
    }

    // 每隔 3 条根请求，添加 2 条子请求
    for (let i = 0; i < 100; i += 3) {
      const parentId = `root-${i.toString().padStart(3, "0")}`;
      stmt.run(
        `child-${i}-1`, "openai", "gpt-4", "prov-1", 200, 80, 0, null,
        new Date(now.getTime() + i * 100 + 50).toISOString(), 1, 0, parentId,
      );
      stmt.run(
        `child-${i}-2`, "openai", "gpt-4", "prov-2", 200, 60, 0, null,
        new Date(now.getTime() + i * 100 + 80).toISOString(), 0, 1, parentId,
      );
    }

    // 测量查询时间
    const start = performance.now();
    const result = getRequestLogsGrouped(db, { page: 1, limit: 50 });
    const elapsed = performance.now() - start;

    expect(result.data).toHaveLength(50);
    expect(result.total).toBe(100);

    // 验证有子请求的根请求 child_count 正确
    const withChildren = result.data.filter((r) => (r.child_count ?? 0) > 0);
    expect(withChildren.length).toBeGreaterThan(0);
    for (const row of withChildren) {
      expect(row.child_count).toBe(2);
    }

    // 性能断言：CTE 优化后应在合理时间内完成
    // 100 条数据不应超过 100ms（保守估计）
    expect(elapsed).toBeLessThan(100);
  });

  it("provider_id 过滤正确", () => {
    const now = new Date();
    const stmt = db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    stmt.run("prov1-root", "openai", "gpt-4", "prov-1", 200, 100, 0, null, now.toISOString(), 0, 0, null);
    stmt.run("prov2-root", "openai", "gpt-4", "prov-2", 200, 200, 0, null, now.toISOString(), 0, 0, null);

    const result = getRequestLogsGrouped(db, { page: 1, limit: 10, provider_id: "prov-1" });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe("prov1-root");
  });
});
