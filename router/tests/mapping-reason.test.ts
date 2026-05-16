import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { resolveMapping } from "../src/proxy/routing/mapping-resolver.js";
import { initDatabase } from "../src/db/index.js";

describe("resolveMapping mappingReason", () => {
  let db: Database.Database;

  beforeEach(() => {
  db = initDatabase(":memory:");
  });

  // --- direct_format: provider_name/backend_model 格式 ---

  it("returns mappingReason=direct_format for slash format client_model", () => {
  db.prepare(
    "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "p1", "my-provider", "openai", "https://api.example.com", "sk-test",
    JSON.stringify(["gpt-4o", "gpt-4"]),
    1, new Date().toISOString(), new Date().toISOString(),
  );

  const result = resolveMapping(db, "my-provider/gpt-4o", { now: new Date() });

  expect(result).not.toBeNull();
  expect(result!.mappingReason).toBe("direct_format");
  });

  // --- group_base_rule: 映射组基础规则（无 schedule 或 schedule 未命中）---

  it("returns mappingReason=group_base_rule when mapping group has no schedules", () => {
  const rule = JSON.stringify({
    targets: [{ backend_model: "gpt-4o", provider_id: "p1" }],
  });
  db.prepare(
    "INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run("g1", "my-model", rule, 1, new Date().toISOString());

  const result = resolveMapping(db, "my-model", { now: new Date() });

  expect(result).not.toBeNull();
  expect(result!.mappingReason).toBe("group_base_rule");
  });

  it("returns mappingReason=group_base_rule when no schedule matches current time", () => {
  const rule = JSON.stringify({
    targets: [{ backend_model: "gpt-4o", provider_id: "p1" }],
  });
  db.prepare(
    "INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run("g1", "my-model", rule, 1, new Date().toISOString());

  // schedule 只匹配 2~4 点
  const scheduleRule = JSON.stringify({
    targets: [{ backend_model: "gpt-4", provider_id: "p2" }],
  });
  db.prepare(
    `INSERT INTO schedules (id, mapping_group_id, name, enabled, week, start_hour, end_hour, mapping_rule, concurrency_rule, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "s1", "g1", "night", 1, "[0,1,2,3,4,5,6]", 2, 4,
    scheduleRule, null, 0,
    new Date().toISOString(), new Date().toISOString(),
  );

  // 10 点不匹配 schedule，应走 base rule
  const now = new Date("2024-01-01T10:00:00");
  const result = resolveMapping(db, "my-model", { now });

  expect(result).not.toBeNull();
  expect(result!.mappingReason).toBe("group_base_rule");
  });

  // --- group_schedule: 映射组分时段规则命中 ---

  it("returns mappingReason=group_schedule when schedule matches current time", () => {
  const rule = JSON.stringify({
    targets: [{ backend_model: "gpt-4o", provider_id: "p1" }],
  });
  db.prepare(
    "INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run("g1", "my-model", rule, 1, new Date().toISOString());

  // 全天时间窗口，避免时间依赖
  const scheduleRule = JSON.stringify({
    targets: [{ backend_model: "gpt-4", provider_id: "p2" }],
  });
  db.prepare(
    `INSERT INTO schedules (id, mapping_group_id, name, enabled, week, start_hour, end_hour, mapping_rule, concurrency_rule, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "s1", "g1", "allday", 1, "[0,1,2,3,4,5,6]", 0, 24,
    scheduleRule, null, 0,
    new Date().toISOString(), new Date().toISOString(),
  );

  const result = resolveMapping(db, "my-model", { now: new Date("2024-06-15T14:30:00") });

  expect(result).not.toBeNull();
  expect(result!.mappingReason).toBe("group_schedule");
  });

  // --- schedule disabled (enabled=0) → 应走 base rule ---

  it("returns mappingReason=group_base_rule when schedule is disabled", () => {
  const rule = JSON.stringify({
    targets: [{ backend_model: "gpt-4o", provider_id: "p1" }],
  });
  db.prepare(
    "INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run("g1", "my-model", rule, 1, new Date().toISOString());

  // schedule 覆盖全天但 enabled=0，不参与匹配
  const scheduleRule = JSON.stringify({
    targets: [{ backend_model: "gpt-4", provider_id: "p2" }],
  });
  db.prepare(
    `INSERT INTO schedules (id, mapping_group_id, name, enabled, week, start_hour, end_hour, mapping_rule, concurrency_rule, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "s1", "g1", "disabled-schedule", 0, "[0,1,2,3,4,5,6]", 0, 24,
    scheduleRule, null, 0,
    new Date().toISOString(), new Date().toISOString(),
  );

  const result = resolveMapping(db, "my-model", { now: new Date("2024-06-15T14:30:00") });

  expect(result).not.toBeNull();
  expect(result!.mappingReason).toBe("group_base_rule");
  });

  // --- fallback_provider: 无映射组，回退 provider 匹配 ---

  it("returns mappingReason=fallback_provider when no mapping group but provider has model", () => {
  db.prepare(
    "INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "p1", "provider1", "openai", "https://api.example.com", "sk-test",
    JSON.stringify(["gpt-4o", "target-model"]),
    1, new Date().toISOString(), new Date().toISOString(),
  );

  // target-model 无 mapping_group，应走 fallback provider 匹配
  const result = resolveMapping(db, "target-model", { now: new Date() });

  expect(result).not.toBeNull();
  expect(result!.mappingReason).toBe("fallback_provider");
  });
});
