import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { resolveMapping } from "../src/proxy/routing/mapping-resolver.js";
import { initDatabase } from "../src/db/index.js";

describe("resolveMapping", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  // --- 基本解析 ---

  it("returns null when client_model does not exist", () => {
    const result = resolveMapping(db, "unknown-model", { now: new Date() });
    expect(result).toBeNull();
  });

  it("resolves base targets from mapping group rule", () => {
    const rule = JSON.stringify({
      targets: [
        { backend_model: "gpt-4o", provider_id: "p1" },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", rule, 1, new Date().toISOString());

    const result = resolveMapping(db, "my-model", { now: new Date() });
    expect(result?.target).toEqual({ backend_model: "gpt-4o", provider_id: "p1" });
  });

  it("resolves first target when multiple targets exist", () => {
    const rule = JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "p1" },
        { backend_model: "claude-3", provider_id: "p2" },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", rule, 1, new Date().toISOString());

    const result = resolveMapping(db, "my-model", { now: new Date() });
    expect(result?.target).toEqual({ backend_model: "gpt-4", provider_id: "p1" });
  });

  it("returns null when rule JSON is invalid", () => {
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "bad-model", "not-json", 1, new Date().toISOString());

    const result = resolveMapping(db, "bad-model", { now: new Date() });
    expect(result).toBeNull();
  });

  it("returns null when rule has empty targets", () => {
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "empty-model", "{}", 1, new Date().toISOString());

    const result = resolveMapping(db, "empty-model", { now: new Date() });
    expect(result).toBeNull();
  });

  // --- excludeTargets 过滤 ---

  it("skips excluded targets and returns next one", () => {
    const rule = JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "p1" },
        { backend_model: "claude-3", provider_id: "p2" },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", rule, 1, new Date().toISOString());

    const result = resolveMapping(db, "my-model", {
      now: new Date(),
      excludeTargets: [{ backend_model: "gpt-4", provider_id: "p1" }],
    });
    expect(result?.target).toEqual({ backend_model: "claude-3", provider_id: "p2" });
  });

  it("returns null when all targets are excluded", () => {
    const rule = JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "p1" },
      ],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", rule, 1, new Date().toISOString());

    const result = resolveMapping(db, "my-model", {
      now: new Date(),
      excludeTargets: [{ backend_model: "gpt-4", provider_id: "p1" }],
    });
    expect(result).toBeNull();
  });

  // --- schedule 匹配 ---

  it("uses schedule targets when schedule matches current time", () => {
    const rule = JSON.stringify({
      targets: [{ backend_model: "gpt-4o", provider_id: "p1" }],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", rule, 1, new Date().toISOString());

    // 插入一条匹配 9~18 点的 schedule
    const scheduleRule = JSON.stringify({
      targets: [{ backend_model: "gpt-4", provider_id: "p2" }],
    });
    db.prepare(
      `INSERT INTO schedules (id, mapping_group_id, name, enabled, week, start_hour, end_hour, mapping_rule, concurrency_rule, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("s1", "g1", "daytime", 1, "[0,1,2,3,4,5,6]", 9, 18, scheduleRule, null, 0, new Date().toISOString(), new Date().toISOString());

    // 10 点应该匹配 schedule
    const now = new Date("2024-01-01T10:00:00");
    const result = resolveMapping(db, "my-model", { now });
    expect(result?.target).toEqual({ backend_model: "gpt-4", provider_id: "p2" });
  });

  it("falls back to base targets when no schedule matches", () => {
    const rule = JSON.stringify({
      targets: [{ backend_model: "gpt-4o", provider_id: "p1" }],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", rule, 1, new Date().toISOString());

    // schedule 只匹配 2~4 点
    const scheduleRule = JSON.stringify({
      targets: [{ backend_model: "gpt-4", provider_id: "p2" }],
    });
    db.prepare(
      `INSERT INTO schedules (id, mapping_group_id, name, enabled, week, start_hour, end_hour, mapping_rule, concurrency_rule, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("s1", "g1", "night", 1, "[0,1,2,3,4,5,6]", 2, 4, scheduleRule, null, 0, new Date().toISOString(), new Date().toISOString());

    // 10 点不匹配 schedule，应返回 base targets
    const now = new Date("2024-01-01T10:00:00");
    const result = resolveMapping(db, "my-model", { now });
    expect(result?.target).toEqual({ backend_model: "gpt-4o", provider_id: "p1" });
  });

  it("returns concurrency_override from matching schedule", () => {
    const rule = JSON.stringify({
      targets: [{ backend_model: "gpt-4o", provider_id: "p1" }],
    });
    db.prepare("INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("g1", "my-model", rule, 1, new Date().toISOString());

    const scheduleRule = JSON.stringify({
      targets: [{ backend_model: "gpt-4", provider_id: "p2" }],
    });
    const concurrencyRule = JSON.stringify({ max_concurrency: 5 });
    db.prepare(
      `INSERT INTO schedules (id, mapping_group_id, name, enabled, week, start_hour, end_hour, mapping_rule, concurrency_rule, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("s1", "g1", "daytime", 1, "[0,1,2,3,4,5,6]", 9, 18, scheduleRule, concurrencyRule, 0, new Date().toISOString(), new Date().toISOString());

    const now = new Date("2024-01-01T10:00:00");
    const result = resolveMapping(db, "my-model", { now });
    expect(result?.target).toEqual({ backend_model: "gpt-4", provider_id: "p2" });
    expect(result?.concurrency_override).toEqual({ max_concurrency: 5 });
  });

  // --- provider_name/backend_model slash 格式 ---

  it("resolves slash format client_model (provider_name/backend_model)", () => {
    db.prepare(
      "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("p1", "my-provider", "openai", "https://api.example.com", "sk-test", JSON.stringify(["gpt-4o", "gpt-4"]), 1, new Date().toISOString(), new Date().toISOString());

    const result = resolveMapping(db, "my-provider/gpt-4o", { now: new Date() });
    expect(result?.target).toEqual({ backend_model: "gpt-4o", provider_id: "p1" });
  });

  // --- fallback: 直接查 provider models ---

  it("fallback: resolves from provider models when no mapping group exists", () => {
    db.prepare(
      "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("p1", "provider1", "openai", "https://api.example.com", "sk-test", JSON.stringify(["gpt-4o", "target-model"]), 1, new Date().toISOString(), new Date().toISOString());

    const result = resolveMapping(db, "target-model", { now: new Date() });
    expect(result?.target).toEqual({ backend_model: "target-model", provider_id: "p1" });
  });

  it("fallback: skips provider with invalid models JSON and tries next", () => {
    db.prepare(
      "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("bad-p", "bad-provider", "openai", "https://bad.example.com", "sk-bad", "not-json", 1, new Date().toISOString(), new Date().toISOString());
    db.prepare(
      "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("good-p", "good-provider", "openai", "https://good.example.com", "sk-good", JSON.stringify(["gpt-4o", "target-model"]), 1, new Date().toISOString(), new Date().toISOString());

    const result = resolveMapping(db, "target-model", { now: new Date() });
    expect(result?.target).toEqual({ backend_model: "target-model", provider_id: "good-p" });
  });
});
