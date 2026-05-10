import { describe, it, expect, afterEach } from "vitest";
import { initDatabase } from "../src/db/index.js";
import Database from "better-sqlite3";

describe("SQLite PRAGMA performance settings", () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it("should set synchronous to NORMAL", () => {
    db = initDatabase(":memory:");
    const result = db.pragma("synchronous", { simple: true });
    expect(result).toBe(1); // NORMAL = 1
  });

  it("should set cache_size to -16000 (16MB)", () => {
    db = initDatabase(":memory:");
    const result = db.pragma("cache_size", { simple: true });
    expect(result).toBe(-16000);
  });

  it("should set busy_timeout to 5000ms", () => {
    db = initDatabase(":memory:");
    const result = db.pragma("busy_timeout", { simple: true });
    expect(result).toBe(5000);
  });

  it("should set temp_store to MEMORY (2)", () => {
    db = initDatabase(":memory:");
    const result = db.pragma("temp_store", { simple: true });
    expect(result).toBe(2); // MEMORY = 2
  });

  it("should set foreign_keys to ON", () => {
    db = initDatabase(":memory:");
    const result = db.pragma("foreign_keys", { simple: true });
    expect(result).toBe(1);
  });
});
