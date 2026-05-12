import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { insertRequestLog, initLogBuffer, stopLogBuffer } from "../src/db/logs.js";
import { insertMetrics, setLogBuffer, clearLogBuffer } from "../src/db/metrics.js";
import { LogWriteBuffer } from "../src/db/log-write-buffer.js";
import { rawInsertRequestLog } from "../src/db/logs.js";
import { rawInsertMetrics } from "../src/db/metrics.js";
import { randomUUID } from "crypto";

function makeLog(overrides?: Partial<Parameters<typeof insertRequestLog>[1]>): Parameters<typeof insertRequestLog>[1] {
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

/** request_metrics.request_log_id 有外键约束，需要先插入对应的 request_log */
function makeMetrics(overrides?: Partial<Parameters<typeof insertMetrics>[1]>): Parameters<typeof insertMetrics>[1] {
  return {
    request_log_id: randomUUID(),
    provider_id: "test-provider",
    backend_model: "gpt-4",
    api_type: "openai",
    ...overrides,
  };
}

/** 先插入 request_log 行，再插入 metrics。返回 log id 和 metrics id */
describe("LogWriteBuffer", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    // 确保清理模块级缓冲状态
    stopLogBuffer();
    clearLogBuffer();
    db.close();
  });

  it("缓冲 accumulate + flush 正确写入 DB", () => {
    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 100,
    });

    const log1 = makeLog();
    const log2 = makeLog();
    buffer.pushLog(log1);
    buffer.pushLog(log2);

    expect(buffer.pendingCount).toBe(2);

    const beforeFlush = db.prepare("SELECT COUNT(*) as c FROM request_logs").get() as { c: number };
    expect(beforeFlush.c).toBe(0);

    buffer.flush();

    const afterFlush = db.prepare("SELECT COUNT(*) as c FROM request_logs").get() as { c: number };
    expect(afterFlush.c).toBe(2);

    buffer.stop();
  });

  it("定时 flush 在 interval 后自动写入", () => {
    vi.useFakeTimers();

    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 100,
      maxBufferSize: 100,
    });

    buffer.pushLog(makeLog());
    buffer.pushLog(makeLog());
    expect(buffer.pendingCount).toBe(2);

    vi.advanceTimersByTime(100);

    expect(buffer.pendingCount).toBe(0);
    const rows = db.prepare("SELECT COUNT(*) as c FROM request_logs").get() as { c: number };
    expect(rows.c).toBe(2);

    buffer.stop();
    vi.useRealTimers();
  });

  it("阈值 flush：达到 maxBufferSize 时立即写入", () => {
    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 3,
    });

    buffer.pushLog(makeLog());
    buffer.pushLog(makeLog());
    expect(buffer.pendingCount).toBe(2);

    buffer.pushLog(makeLog());
    expect(buffer.pendingCount).toBe(0);

    const rows = db.prepare("SELECT COUNT(*) as c FROM request_logs").get() as { c: number };
    expect(rows.c).toBe(3);

    buffer.stop();
  });

  it("stop() 时 flush 剩余数据（log + metrics 混合）", () => {
    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 100,
    });

    // 1. 先通过缓冲 push log，flush 确保写入 DB
    const log = makeLog();
    buffer.pushLog(log);
    buffer.flush();

    // 2. push metrics（引用已入库的 log.id 满足外键约束）
    buffer.pushMetrics(makeMetrics({ request_log_id: log.id }));
    expect(buffer.pendingCount).toBe(1);

    // 3. stop() 时 flush metrics
    buffer.stop();

    const metricsRows = db.prepare("SELECT COUNT(*) as c FROM request_metrics").get() as { c: number };
    expect(metricsRows.c).toBe(1);
    expect(buffer.pendingCount).toBe(0);
  });

  it("metrics 预生成 UUID，返回给调用方", () => {
    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 100,
    });

    setLogBuffer(buffer);

    // 先插入 log（同步，不经过缓冲），确保外键约束满足
    const log = makeLog();
    rawInsertRequestLog(db, log);

    const metricsId = insertMetrics(db, makeMetrics({ request_log_id: log.id }));

    expect(metricsId).toBeTruthy();
    expect(metricsId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // 数据还在缓冲中，DB 里还没有
    const beforeFlush = db.prepare("SELECT COUNT(*) as c FROM request_metrics WHERE id = ?").get(metricsId) as { c: number };
    expect(beforeFlush.c).toBe(0);

    // flush 后数据可见
    buffer.flush();

    const afterFlush = db.prepare("SELECT id FROM request_metrics WHERE id = ?").get(metricsId) as { id: string } | undefined;
    expect(afterFlush?.id).toBe(metricsId);

    buffer.stop();
  });

  it("stop 后的 push 走同步写入", () => {
    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 100,
    });

    buffer.stop();

    // 先写 log 再写 metrics（满足外键约束）
    const log = makeLog();
    buffer.pushLog(log);
    buffer.pushMetrics(makeMetrics({ request_log_id: log.id }));

    const logRows = db.prepare("SELECT COUNT(*) as c FROM request_logs").get() as { c: number };
    const metricsRows = db.prepare("SELECT COUNT(*) as c FROM request_metrics").get() as { c: number };
    expect(logRows.c).toBe(1);
    expect(metricsRows.c).toBe(1);
  });

  it("事务语义：flush 中部分失败整体回滚", () => {
    const buffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics, {
      flushIntervalMs: 60_000,
      maxBufferSize: 100,
    });

    const dupId = randomUUID();
    buffer.pushLog(makeLog({ id: dupId }));
    buffer.pushLog(makeLog({ id: randomUUID() }));
    // 重复 ID 触发唯一约束冲突
    buffer.pushLog(makeLog({ id: dupId }));

    expect(() => buffer.flush()).toThrow();

    // 事务回滚，所有条目都不在 DB 中
    const rows = db.prepare("SELECT COUNT(*) as c FROM request_logs").get() as { c: number };
    expect(rows.c).toBe(0);

    buffer.stop();
  });
});

describe("insertRequestLog / insertMetrics 无缓冲路径", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  afterEach(() => {
    stopLogBuffer();
    clearLogBuffer();
    db.close();
  });

  it("不初始化缓冲时 insertRequestLog 走同步路径", () => {
    const log = makeLog();
    insertRequestLog(db, log);

    const row = db.prepare("SELECT id, api_type, model FROM request_logs WHERE id = ?").get(log.id) as { id: string; api_type: string; model: string | null };
    expect(row.id).toBe(log.id);
    expect(row.api_type).toBe("openai");
    expect(row.model).toBe("gpt-4");
  });

  it("不初始化缓冲时 insertMetrics 走同步路径", () => {
    // 确保 metrics 模块级缓冲为 null
    stopLogBuffer();

    // 先插入 log 满足外键约束
    const log = makeLog();
    insertRequestLog(db, log);

    const m = makeMetrics({ request_log_id: log.id });
    const id = insertMetrics(db, m);

    const row = db.prepare("SELECT id, provider_id, backend_model FROM request_metrics WHERE id = ?").get(id) as { id: string; provider_id: string; backend_model: string } | undefined;
    expect(row?.id).toBe(id);
    expect(row?.provider_id).toBe("test-provider");
    expect(row?.backend_model).toBe("gpt-4");
  });
});
