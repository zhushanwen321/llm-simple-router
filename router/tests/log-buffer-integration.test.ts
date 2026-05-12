/**
 * 测试 insertRequestLog / insertMetrics 通过模块级缓冲路径的集成。
 *
 * 现有 log-write-buffer.test.ts 覆盖了 LogWriteBuffer 类本身和无缓冲路径，
 * 但 insertRequestLog 的缓冲路径（initLogBuffer 设置后走 buffer.pushLog）未被覆盖。
 * 本文件填补这个间隙。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { initDatabase } from "../src/db/index.js";
import {
  insertRequestLog,
  initLogBuffer,
  stopLogBuffer,
} from "../src/db/logs.js";
import {
  insertMetrics,
  setLogBuffer,
  clearLogBuffer,
} from "../src/db/metrics.js";
import { LogWriteBuffer } from "../src/db/log-write-buffer.js";
import { rawInsertRequestLog } from "../src/db/logs.js";
import { rawInsertMetrics } from "../src/db/metrics.js";

function makeLog(
  overrides?: Partial<Parameters<typeof insertRequestLog>[1]>,
): Parameters<typeof insertRequestLog>[1] {
  return {
    id: randomUUID(),
    api_type: "openai",
    model: "gpt-4",
    provider_id: "test-provider",
    status_code: 200,
    latency_ms: 100,
    is_stream: 0,
    error_message: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeMetrics(
  overrides?: Partial<Parameters<typeof insertMetrics>[1]>,
): Parameters<typeof insertMetrics>[1] {
  return {
    request_log_id: randomUUID(),
    provider_id: "test-provider",
    backend_model: "gpt-4",
    api_type: "openai",
    ...overrides,
  };
}

describe("insertRequestLog buffered path via initLogBuffer", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    stopLogBuffer();
    clearLogBuffer();
    db.close();
  });

  it("initLogBuffer 后 insertRequestLog 不直接写入 DB，flush 后可见", () => {
    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 100,
    });
    initLogBuffer(buffer);
    setLogBuffer(buffer);

    const log = makeLog();
    insertRequestLog(db, log);

    // 缓冲中，DB 里还没有
    const beforeFlush = db
      .prepare("SELECT COUNT(*) as c FROM request_logs WHERE id = ?")
      .get(log.id) as { c: number };
    expect(beforeFlush.c).toBe(0);

    // 缓冲有待写条目
    expect(buffer.pendingCount).toBe(1);

    // flush 后可见
    buffer.flush();

    const afterFlush = db
      .prepare("SELECT id, api_type, model FROM request_logs WHERE id = ?")
      .get(log.id) as { id: string; api_type: string; model: string | null } | undefined;
    expect(afterFlush?.id).toBe(log.id);
    expect(afterFlush?.api_type).toBe("openai");
    expect(afterFlush?.model).toBe("gpt-4");

    buffer.stop();
  });

  it("initLogBuffer 后 insertRequestLog + insertMetrics 混合缓冲", () => {
    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 100,
    });
    initLogBuffer(buffer);
    setLogBuffer(buffer);

    // 两条 log
    const log1 = makeLog();
    const log2 = makeLog({ id: randomUUID(), status_code: 502 });
    insertRequestLog(db, log1);
    insertRequestLog(db, log2);

    // 一条 metrics（外键关联 log1）
    const metricsId = insertMetrics(
      db,
      makeMetrics({ request_log_id: log1.id }),
    );

    expect(buffer.pendingCount).toBe(3);

    // flush 前都不可见
    const logCount = db
      .prepare("SELECT COUNT(*) as c FROM request_logs")
      .get() as { c: number };
    const metricsCount = db
      .prepare("SELECT COUNT(*) as c FROM request_metrics")
      .get() as { c: number };
    expect(logCount.c).toBe(0);
    expect(metricsCount.c).toBe(0);

    buffer.flush();

    // flush 后全部可见
    const logs = db
      .prepare("SELECT id, status_code FROM request_logs")
      .all() as { id: string; status_code: number }[];
    expect(logs).toHaveLength(2);
    const statusCodes = logs.map((l) => l.status_code).sort();
    expect(statusCodes).toEqual([200, 502]);

    const metrics = db
      .prepare("SELECT id, request_log_id FROM request_metrics")
      .all() as { id: string; request_log_id: string }[];
    expect(metrics).toHaveLength(1);
    expect(metrics[0].id).toBe(metricsId);
    expect(metrics[0].request_log_id).toBe(log1.id);

    buffer.stop();
  });

  it("stopLogBuffer + clearLogBuffer 后恢复同步写入路径", () => {
    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 100,
    });
    initLogBuffer(buffer);
    setLogBuffer(buffer);

    // 缓冲路径写入
    const log1 = makeLog();
    insertRequestLog(db, log1);
    expect(buffer.pendingCount).toBe(1);

    // 停止缓冲 → 同步 flush
    stopLogBuffer();
    clearLogBuffer();

    // log1 已 flush 到 DB
    const row1 = db
      .prepare("SELECT id FROM request_logs WHERE id = ?")
      .get(log1.id) as { id: string } | undefined;
    expect(row1?.id).toBe(log1.id);

    // 新写入走同步路径
    const log2 = makeLog();
    insertRequestLog(db, log2);

    const row2 = db
      .prepare("SELECT id FROM request_logs WHERE id = ?")
      .get(log2.id) as { id: string } | undefined;
    expect(row2?.id).toBe(log2.id);
  });

  it("缓冲未 flush 时 metrics 返回的 ID 在 DB 中不存在，flush 后可查", () => {
    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 100,
    });
    initLogBuffer(buffer);
    setLogBuffer(buffer);

    const log = makeLog();
    insertRequestLog(db, log);
    const metricsId = insertMetrics(
      db,
      makeMetrics({ request_log_id: log.id }),
    );

    // ID 已生成但未入库
    expect(metricsId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const beforeFlush = db
      .prepare("SELECT id FROM request_metrics WHERE id = ?")
      .get(metricsId);
    expect(beforeFlush).toBeUndefined();

    buffer.flush();

    const afterFlush = db
      .prepare("SELECT id FROM request_metrics WHERE id = ?")
      .get(metricsId) as { id: string } | undefined;
    expect(afterFlush?.id).toBe(metricsId);

    buffer.stop();
  });

  it("达到 maxBufferSize 阈值时自动 flush（log + metrics 混合）", () => {
    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 3,
    });
    initLogBuffer(buffer);
    setLogBuffer(buffer);

    // push 2 条 log → 未达阈值
    const log1 = makeLog();
    const log2 = makeLog({ id: randomUUID() });
    insertRequestLog(db, log1);
    insertRequestLog(db, log2);
    expect(buffer.pendingCount).toBe(2);

    // 第 3 条（metrics）触发自动 flush
    const log3 = makeLog({ id: randomUUID() });
    insertRequestLog(db, log3);
    expect(buffer.pendingCount).toBe(0);

    // 3 条 log 都已入库
    const count = db
      .prepare("SELECT COUNT(*) as c FROM request_logs")
      .get() as { c: number };
    expect(count.c).toBe(3);

    buffer.stop();
  });

  it("多次 initLogBuffer 后以最后一次为准", () => {
    const buffer1 = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 100,
    });
    const buffer2 = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 100,
    });

    // 先设置 buffer1，再覆盖为 buffer2
    initLogBuffer(buffer1);
    initLogBuffer(buffer2);
    setLogBuffer(buffer2);

    const log = makeLog();
    insertRequestLog(db, log);

    // buffer1 不应该有数据
    expect(buffer1.pendingCount).toBe(0);
    // buffer2 应该有数据
    expect(buffer2.pendingCount).toBe(1);

    buffer2.flush();

    const row = db
      .prepare("SELECT id FROM request_logs WHERE id = ?")
      .get(log.id) as { id: string } | undefined;
    expect(row?.id).toBe(log.id);

    buffer1.stop();
    buffer2.stop();
  });
});
