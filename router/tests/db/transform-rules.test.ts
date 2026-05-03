import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../src/db/index.js";
import { getTransformRule, upsertTransformRule, deleteTransformRule, getAllActiveRules } from "../../src/db/transform-rules.js";

describe("transform rules CRUD", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = initDatabase(":memory:");
    // Insert a provider for FK constraint
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("p1", "Test", "openai", "http://localhost:1234", "key", 1, new Date().toISOString(), new Date().toISOString());
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("p2", "Test2", "openai", "http://localhost:1234", "key", 1, new Date().toISOString(), new Date().toISOString());
  });

  it("upsert and get", () => {
    upsertTransformRule(db, "p1", { inject_headers: { "x-custom": "v1" }, is_active: 1 });
    const rule = getTransformRule(db, "p1");
    expect(rule).not.toBeNull();
    expect(rule!.inject_headers).toEqual({ "x-custom": "v1" });
  });

  it("update existing rule", () => {
    upsertTransformRule(db, "p1", { inject_headers: { "x-old": "v0" }, is_active: 1 });
    upsertTransformRule(db, "p1", { inject_headers: { "x-new": "v1" }, is_active: 1 });
    const rule = getTransformRule(db, "p1");
    expect(rule!.inject_headers).toEqual({ "x-new": "v1" });
  });

  it("delete rule", () => {
    upsertTransformRule(db, "p1", { drop_fields: ["logprobs"], is_active: 1 });
    deleteTransformRule(db, "p1");
    expect(getTransformRule(db, "p1")).toBeNull();
  });

  it("getAllActiveRules returns only active", () => {
    upsertTransformRule(db, "p1", { is_active: 1 });
    upsertTransformRule(db, "p2", { is_active: 0 });
    const rules = getAllActiveRules(db);
    expect(rules).toHaveLength(1);
    expect(rules[0].provider_id).toBe("p1");
  });

  it("handles null JSON fields", () => {
    upsertTransformRule(db, "p1", { is_active: 1 });
    const rule = getTransformRule(db, "p1");
    expect(rule!.inject_headers).toBeNull();
    expect(rule!.request_defaults).toBeNull();
    expect(rule!.drop_fields).toBeNull();
    expect(rule!.field_overrides).toBeNull();
  });
});
