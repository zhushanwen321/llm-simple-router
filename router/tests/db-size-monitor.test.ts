import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { insertRequestLog } from "../src/db/logs.js";
import {
  collectDbSizeInfo,
  runSizeBasedCleanup,
  scheduleDbSizeMonitor,
} from "../src/db/db-size-monitor.js";

describe("DbSizeMonitor", () => {
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", "a".repeat(64));
  });

  afterEach(() => {
    db.close();
  });

  function seedLog(id: string, bodySize: number, createdAt?: string) {
    const body = "x".repeat(bodySize);
    insertRequestLog(db, {
      id,
      api_type: "openai",
      model: "test-model",
      provider_id: null,
      status_code: 200,
      latency_ms: 100,
      is_stream: 0,
      error_message: null,
      created_at: createdAt ?? new Date().toISOString(),
      client_request: body,
      upstream_request: null,
      upstream_response: null,
    });
  }

  describe("collectDbSizeInfo", () => {
    it("returns zero log size for empty database", () => {
      const info = collectDbSizeInfo(db, ":memory:");
      expect(info.logTableBytes).toBe(0);
      expect(info.logCount).toBe(0);
      expect(info.totalBytes).toBe(0);
    });

    it("estimates log table size with records", () => {
      seedLog("log-1", 1000);
      seedLog("log-2", 2000);
      const info = collectDbSizeInfo(db, ":memory:");
      expect(info.logCount).toBe(2);
      expect(info.logTableBytes).toBeGreaterThanOrEqual(3000);
    });
  });

  describe("runSizeBasedCleanup", () => {
    it("does nothing when under threshold", () => {
      seedLog("log-1", 100);
      const deleted = runSizeBasedCleanup(db, ":memory:", {
        dbMaxSizeMb: 1024,
        logTableMaxSizeMb: 800,
      });
      expect(deleted).toBe(0);
    });

    it("deletes oldest logs when over threshold", () => {
      for (let i = 0; i < 5; i++) {
        const ts = new Date(Date.now() - (5 - i) * 60000).toISOString();
        seedLog(`log-${i}`, 500, ts);
      }
      const deleted = runSizeBasedCleanup(db, ":memory:", {
        dbMaxSizeMb: 1024,
        logTableMaxSizeMb: 0,
      });
      expect(deleted).toBeGreaterThan(0);
    });
  });

  describe("scheduleDbSizeMonitor", () => {
    it("returns a handle with stop function", () => {
      const handle = scheduleDbSizeMonitor(db, ":memory:", {
        intervalMs: 60000,
        log: { info: vi.fn() },
      });
      expect(handle.stop).toBeTypeOf("function");
      handle.stop();
    });
  });
});
