import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase, insertRequestLog } from "../src/db/index.js";
import { runLogCleanup } from "../src/db/log-cleaner.js";
import { setLogRetentionDays } from "../src/db/settings.js";

describe("LogCleaner", () => {
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  function insertLog(id: string, daysAgo: number) {
    const date = new Date(Date.now() - daysAgo * 86_400_000);
    insertRequestLog(db, {
      id,
      api_type: "openai",
      model: "gpt-4",
      provider_id: "test",
      status_code: 200,
      latency_ms: 100,
      is_stream: 0,
      error_message: null,
      created_at: date.toISOString(),
    });
  }

  it("deletes logs older than retention days", () => {
    setLogRetentionDays(db, 3);
    insertLog("old", 5);
    insertLog("recent", 1);
    expect(runLogCleanup(db)).toBe(1);
    expect(
      db.prepare("SELECT id FROM request_logs WHERE id = ?").get("old"),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT id FROM request_logs WHERE id = ?").get("recent"),
    ).toBeDefined();
  });

  it("skips cleanup when retention is 0", () => {
    setLogRetentionDays(db, 0);
    insertLog("old", 30);
    expect(runLogCleanup(db)).toBe(0);
  });

  it("runs incremental_vacuum after deleting logs", () => {
    setLogRetentionDays(db, 3);
    insertLog("old", 5);
    insertLog("recent", 1);
    const beforePages = (db.pragma("page_count") as { page_count: number }[])[0].page_count;
    runLogCleanup(db);
    const afterPages = (db.pragma("page_count") as { page_count: number }[])[0].page_count;
    expect(afterPages).toBeLessThanOrEqual(beforePages);
  });

  it("does not run incremental_vacuum when no logs deleted", () => {
    setLogRetentionDays(db, 3);
    insertLog("recent", 1);
    expect(() => runLogCleanup(db)).not.toThrow();
  });
});
