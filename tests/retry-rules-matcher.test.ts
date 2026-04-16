import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { RetryRuleMatcher } from "../src/proxy/retry-rules.js";

describe("RetryRuleMatcher", () => {
  let db: Database.Database;
  let matcher: RetryRuleMatcher;

  beforeEach(() => {
    db = initDatabase(":memory:");
    db.prepare("DELETE FROM retry_rules").run();
    matcher = new RetryRuleMatcher();
  });

  it("returns false when no rules loaded", () => {
    expect(matcher.test(400, "error")).toBe(false);
  });

  it("returns false when status code does not match any rule", () => {
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r1", "rule1", 400, "error", 1, new Date().toISOString());
    matcher.load(db);
    expect(matcher.test(500, "some other body")).toBe(false);
  });

  it("returns false when status code matches but pattern does not", () => {
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r1", "rule1", 400, "请稍后重试", 1, new Date().toISOString());
    matcher.load(db);
    expect(matcher.test(400, "not matching")).toBe(false);
  });

  it("returns true when status code and pattern both match", () => {
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r1", "rule1", 400, "请稍后重试", 1, new Date().toISOString());
    matcher.load(db);
    expect(matcher.test(400, "网络错误，请稍后重试")).toBe(true);
  });

  it("returns true when any of multiple rules for same status code matches", () => {
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r1", "rule1", 400, "patternA", 1, new Date().toISOString());
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r2", "rule2", 400, "patternB", 1, new Date().toISOString());
    matcher.load(db);
    expect(matcher.test(400, "has patternB in body")).toBe(true);
    expect(matcher.test(400, "has patternA in body")).toBe(true);
    expect(matcher.test(400, "no match")).toBe(false);
  });

  it("refreshes cache after reload", () => {
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r1", "rule1", 400, "old", 1, new Date().toISOString());
    matcher.load(db);
    expect(matcher.test(400, "old pattern")).toBe(true);

    db.prepare("DELETE FROM retry_rules").run();
    db.prepare(
      "INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("r2", "rule2", 500, "new", 1, new Date().toISOString());
    matcher.load(db);

    expect(matcher.test(400, "old pattern")).toBe(false);
    expect(matcher.test(500, "new pattern")).toBe(true);
  });
});
