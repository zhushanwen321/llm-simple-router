/**
 * Admin API CRUD tests for mapping groups with multimodal_fallback field.
 *
 * These tests verify the full CRUD lifecycle (Create/Read/Update/Delete/List)
 * for mapping groups containing the multimodal_fallback configuration.
 * Unlike admin-groups-validation.test.ts which focuses on validateRule(),
 * this file focuses on the HTTP API contract and DB persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { buildApp } from "../../src/index.js";
import { initDatabase } from "../../src/db/index.js";
import { encrypt } from "../../src/utils/crypto.js";
import { seedSettings, login, makeConfig, TEST_ENCRYPTION_KEY } from "../helpers/test-setup.js";

describe("Admin API: mapping groups CRUD with multimodal_fallback", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let cookie: string;
  let providerId: string;

  beforeEach(async () => {
  db = initDatabase(":memory:");
  seedSettings(db);
  // Insert provider for FK validation
  const encrypted = encrypt("sk-key", TEST_ENCRYPTION_KEY);
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "prov-1", "TestProvider", "openai", "http://localhost:1234", encrypted,
    JSON.stringify([{ id: "text-model", name: "text-model" }, { id: "vision-model", name: "vision-model" }]),
    1, new Date().toISOString(), new Date().toISOString(),
  );
  providerId = "prov-1";
  const result = await buildApp({ config: makeConfig() as never, db });
  app = result.app;
  cookie = await login(app);
  });

  afterEach(async () => {
  await app.close();
  db.close();
  });

  /** Helper: rule JSON with multimodal_fallback */
  function ruleWithFallback(providerPid: string, fallbackPid: string) {
  return JSON.stringify({
    targets: [{ backend_model: "text-model", provider_id: providerPid }],
    multimodal_fallback: { provider_id: fallbackPid, backend_model: "vision-model" },
  });
  }

  /** Helper: rule JSON without multimodal_fallback */
  function ruleWithoutFallback(providerPid: string) {
  return JSON.stringify({
    targets: [{ backend_model: "text-model", provider_id: providerPid }],
  });
  }

  /** Helper: create a group via API and return its id */
  async function createGroup(clientModel: string, rule: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: { client_model: clientModel, rule },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id;
  }

  // ----------------------------------------------------------------
  // Test 1: Create group with multimodal_fallback
  // ----------------------------------------------------------------
  it("test_create_group_with_multimodal_fallback_persists_to_db", async () => {
  const id = await createGroup("gpt-5", ruleWithFallback(providerId, providerId));

  // Verify DB has multimodal_fallback in rule JSON
  const row = db.prepare("SELECT rule FROM mapping_groups WHERE id = ?").get(id) as { rule: string };
  expect(row).toBeDefined();
  const parsed = JSON.parse(row.rule);
  expect(parsed.multimodal_fallback).toEqual({
    provider_id: providerId,
    backend_model: "vision-model",
  });
  });

  // ----------------------------------------------------------------
  // Test 2: Read group with multimodal_fallback
  // ----------------------------------------------------------------
  it("test_read_group_returns_multimodal_fallback_in_rule", async () => {
  const id = await createGroup("claude-5", ruleWithFallback(providerId, providerId));

  // List all groups and find the created one
  const getRes = await app.inject({
    method: "GET",
    url: `/admin/api/mapping-groups`,
    headers: { cookie },
  });
  expect(getRes.statusCode).toBe(200);
  const groups = getRes.json().data as Array<{ id: string; rule: string }>;
  const found = groups.find(g => g.id === id);
  expect(found).toBeDefined();
  const rule = JSON.parse(found!.rule);
  expect(rule.multimodal_fallback).toEqual({
    provider_id: providerId,
    backend_model: "vision-model",
  });
  });

  // ----------------------------------------------------------------
  // Test 3: Update group multimodal_fallback
  // ----------------------------------------------------------------
  it("test_update_group_multimodal_fallback_persists_new_value", async () => {
  // Create without fallback
  const id = await createGroup("glm-5.1", ruleWithoutFallback(providerId));

  // Update to add multimodal_fallback
  const updateRes = await app.inject({
    method: "PUT",
    url: `/admin/api/mapping-groups/${id}`,
    headers: { cookie, "content-type": "application/json" },
    payload: {
    rule: ruleWithFallback(providerId, providerId),
    },
  });
  expect(updateRes.statusCode).toBe(200);

  // Verify DB updated
  const row = db.prepare("SELECT rule FROM mapping_groups WHERE id = ?").get(id) as { rule: string } | undefined;
  expect(row).toBeDefined();
  const parsed = JSON.parse(row!.rule);
  expect(parsed.multimodal_fallback).toEqual({
    provider_id: providerId,
    backend_model: "vision-model",
  });
  });

  // ----------------------------------------------------------------
  // Test 4: Delete group with multimodal_fallback
  // ----------------------------------------------------------------
  it("test_delete_group_with_multimodal_fallback_removes_from_db", async () => {
  const id = await createGroup("qwen-3", ruleWithFallback(providerId, providerId));

  // Delete
  const delRes = await app.inject({
    method: "DELETE",
    url: `/admin/api/mapping-groups/${id}`,
    headers: { cookie },
  });
  expect(delRes.statusCode).toBe(200);

  // Verify DB row removed
  const row = db.prepare("SELECT id FROM mapping_groups WHERE id = ?").get(id);
  expect(row).toBeUndefined();
  });

  // ----------------------------------------------------------------
  // Test 5: List groups includes multimodal_fallback data
  // ----------------------------------------------------------------
  it("test_list_groups_includes_multimodal_fallback_in_response", async () => {
  // Create two groups: one with fallback, one without
  await createGroup("model-a", ruleWithFallback(providerId, providerId));
  await createGroup("model-b", ruleWithoutFallback(providerId));

  // List all
  const listRes = await app.inject({
    method: "GET",
    url: "/admin/api/mapping-groups",
    headers: { cookie },
  });
  expect(listRes.statusCode).toBe(200);
  const groups = listRes.json().data as Array<{ client_model: string; rule: string }>;
  expect(groups.length).toBeGreaterThanOrEqual(2);

  // Find model-a (with fallback)
  const groupA = groups.find(g => g.client_model === "model-a");
  expect(groupA).toBeDefined();
  const ruleA = JSON.parse(groupA!.rule);
  expect(ruleA.multimodal_fallback).toBeDefined();
  expect(ruleA.multimodal_fallback.provider_id).toBe(providerId);

  // Find model-b (without fallback)
  const groupB = groups.find(g => g.client_model === "model-b");
  expect(groupB).toBeDefined();
  const ruleB = JSON.parse(groupB!.rule);
  expect(ruleB.multimodal_fallback).toBeUndefined();
  });
});
