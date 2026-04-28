import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { insertWindow } from "../src/db/usage-windows.js";
import { resolveTimeRange, getMonday } from "../src/utils/time-range.js";
import { toSqliteDatetime, parseSqliteDatetime } from "../src/utils/datetime.js";

describe("resolveTimeRange", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
  });

  function setupDb(): Database.Database {
    db = initDatabase(":memory:");
    return db;
  }

  it("weekly 返回本周一 00:00 到周日 23:59:59", () => {
    const { startTime, endTime } = resolveTimeRange("weekly", setupDb());
    const start = parseSqliteDatetime(startTime);
    const end = parseSqliteDatetime(endTime);
    expect(start.getDay()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(end.getDay()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  it("monthly 返回本月1日 00:00 到月末 23:59:59", () => {
    const { startTime, endTime } = resolveTimeRange("monthly", setupDb());
    const start = parseSqliteDatetime(startTime);
    const end = parseSqliteDatetime(endTime);
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  it("window 无窗口数据时回退到 5h 区间", () => {
    const { startTime, endTime } = resolveTimeRange("window", setupDb());
    const start = parseSqliteDatetime(startTime);
    const end = parseSqliteDatetime(endTime);
    // eslint-disable-next-line no-magic-numbers
    const diffMs = end.getTime() - start.getTime();
    // eslint-disable-next-line no-magic-numbers
    expect(diffMs).toBe(5 * 3600 * 1000);
  });

  it("window 有窗口数据时返回最新窗口", () => {
    const database = setupDb();
    const now = new Date();
    // eslint-disable-next-line no-magic-numbers
    const winStart = new Date(now.getTime() - 3600_000);
    // eslint-disable-next-line no-magic-numbers
    const winEnd = new Date(now.getTime() + 4 * 3600_000);
    insertWindow(database, {
      id: "test-1",
      router_key_id: null,
      start_time: toSqliteDatetime(winStart),
      end_time: toSqliteDatetime(winEnd),
    });

    const result = resolveTimeRange("window", database);
    expect(result.startTime).toBe(toSqliteDatetime(winStart));
    expect(result.endTime).toBe(toSqliteDatetime(winEnd));
  });
});

describe("getMonday", () => {
  it("2026-04-25 (周六) 的周一应为 2026-04-20", () => {
    const sat = new Date(Date.UTC(2026, 3, 25, 12, 0, 0));
    const mon = getMonday(sat);
    expect(mon.getFullYear()).toBe(2026);
    expect(mon.getMonth()).toBe(3);
    expect(mon.getDate()).toBe(20);
  });

  it("2026-04-26 (周日) 的周一应为 2026-04-20", () => {
    const sun = new Date(Date.UTC(2026, 3, 26, 12, 0, 0));
    const mon = getMonday(sun);
    expect(mon.getDate()).toBe(20);
  });

  it("2026-04-20 (周一) 的周一应是自己", () => {
    const mon = new Date(Date.UTC(2026, 3, 20, 12, 0, 0));
    const result = getMonday(mon);
    expect(result.getDate()).toBe(20);
  });
});
