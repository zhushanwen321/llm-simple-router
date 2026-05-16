import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";
import { API_CODE } from "../src/admin/api-response.js";

/**
 * TDD FAILING tests for T6: validateRule() extension for multimodal_fallback.
 *
 * These tests verify that validateRule() in src/admin/groups.ts validates
 * the new multimodal_fallback field in mapping group rules. All tests are
 * expected to FAIL because multimodal_fallback validation has not been implemented yet.
 */

const VALID_RULE_WITH_FALLBACK = (
  providerId: string,
  fallbackProviderId: string,
) =>
  JSON.stringify({
  targets: [
    { backend_model: "text-model", provider_id: providerId },
  ],
  multimodal_fallback: {
  backend_model: "vision-model",
  provider_id: fallbackProviderId,
  },
  });

const VALID_RULE_WITHOUT_FALLBACK = (providerId: string) =>
  JSON.stringify({
  targets: [
    { backend_model: "text-model", provider_id: providerId },
  ],
  });

describe("validateRule: multimodal_fallback validation (T6)", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;
  let activeProviderId: string;
  let inactiveProviderId: string;

  beforeEach(async () => {
  db = initDatabase(":memory:");
  seedSettings(db);
  const result = await buildApp({ config: makeConfig() as any, db });
  app = result.app;
  close = result.close;
  cookie = await login(app);

  // Create an active provider (default is_active = 1)
  const activeRes = await app.inject({
    method: "POST",
    url: "/admin/api/providers",
    headers: { cookie, "content-type": "application/json" },
  payload: {
  name: "Active-Provider",
  api_type: "openai",
  base_url: "https://api.active.com",
  api_key: "sk-active-key",
  models: ["text-model", "vision-model"],
  },
  });
  activeProviderId = activeRes.json().data.id;

  // Create an inactive provider
  const inactiveRes = await app.inject({
    method: "POST",
    url: "/admin/api/providers",
    headers: { cookie, "content-type": "application/json" },
  payload: {
  name: "Inactive-Provider",
  api_type: "openai",
  base_url: "https://api.inactive.com",
  api_key: "sk-inactive-key",
  models: ["text-model", "vision-model"],
  is_active: 0,
  },
  });
  inactiveProviderId = inactiveRes.json().data.id;
  });

  afterEach(async () => {
  await close();
  });

  // ------------------------------------------------------------------
  // Test 1: Valid multimodal_fallback passes validation
  // ------------------------------------------------------------------
  it("test_validateRule_valid_multimodal_fallback_passes", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
    client_model: "model-with-fallback",
    rule: VALID_RULE_WITH_FALLBACK(activeProviderId, activeProviderId),
    },
  });
  // Will fail: validateRule doesn't check multimodal_fallback yet,
  // so it passes but for the wrong reason (ignores multimodal_fallback).
  // After implementation: should return 201 (validation passes).
  expect(res.statusCode).toBe(201);
  });

  // ------------------------------------------------------------------
  // Test 2: multimodal_fallback with non-existent provider_id fails
  // ------------------------------------------------------------------
  it("test_validateRule_multimodal_fallback_nonexistent_provider_fails", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
    client_model: "model-bad-fallback-provider",
    rule: JSON.stringify({
      targets: [
      { backend_model: "text-model", provider_id: activeProviderId },
      ],
    multimodal_fallback: {
    backend_model: "vision-model",
    provider_id: "non-existent-provider-id",
    },
    }),
    },
  });
  // After implementation: should return 400 with error about provider not found
  expect(res.statusCode).toBe(400);
  const body = res.json();
  expect(body.code).toBe(API_CODE.BAD_REQUEST);
  expect(body.message).toContain("multimodal_fallback");
  expect(body.message).toContain("not found");
  });

  // ------------------------------------------------------------------
  // Test 3: multimodal_fallback with inactive provider fails
  // ------------------------------------------------------------------
  it("test_validateRule_multimodal_fallback_inactive_provider_fails", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
    client_model: "model-inactive-fallback",
    rule: JSON.stringify({
      targets: [
      { backend_model: "text-model", provider_id: activeProviderId },
      ],
    multimodal_fallback: {
    backend_model: "vision-model",
    provider_id: inactiveProviderId,
    },
    }),
    },
  });
  // After implementation: should return 400 with error about provider not active
  expect(res.statusCode).toBe(400);
  const body = res.json();
  expect(body.code).toBe(API_CODE.BAD_REQUEST);
  expect(body.message).toContain("multimodal_fallback");
  expect(body.message).toContain("not active");
  });

  // ------------------------------------------------------------------
  // Test 4: No multimodal_fallback passes (backward compatible)
  // ------------------------------------------------------------------
  it("test_validateRule_no_multimodal_fallback_passes_backward_compat", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
    client_model: "model-no-fallback",
    rule: VALID_RULE_WITHOUT_FALLBACK(activeProviderId),
    },
  });
  // This should always pass — no multimodal_fallback means no extra validation
  expect(res.statusCode).toBe(201);
  });

  // ------------------------------------------------------------------
  // Test 5: multimodal_fallback with missing backend_model fails
  // ------------------------------------------------------------------
  it("test_validateRule_multimodal_fallback_missing_backend_model_fails", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
    client_model: "model-fallback-no-model",
    rule: JSON.stringify({
      targets: [
      { backend_model: "text-model", provider_id: activeProviderId },
      ],
    multimodal_fallback: {
    provider_id: activeProviderId,
    // backend_model intentionally missing
    },
    }),
    },
  });
  // After implementation: should return 400
  expect(res.statusCode).toBe(400);
  const body = res.json();
  expect(body.code).toBe(API_CODE.BAD_REQUEST);
  expect(body.message).toContain("multimodal_fallback");
  });

  // ------------------------------------------------------------------
  // Test 6: multimodal_fallback with missing provider_id fails
  // ------------------------------------------------------------------
  it("test_validateRule_multimodal_fallback_missing_provider_id_fails", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
    client_model: "model-fallback-no-provider",
    rule: JSON.stringify({
      targets: [
      { backend_model: "text-model", provider_id: activeProviderId },
      ],
    multimodal_fallback: {
    backend_model: "vision-model",
    // provider_id intentionally missing
    },
    }),
    },
  });
  // After implementation: should return 400
  expect(res.statusCode).toBe(400);
  const body = res.json();
  expect(body.code).toBe(API_CODE.BAD_REQUEST);
  expect(body.message).toContain("multimodal_fallback");
  });

  // ------------------------------------------------------------------
  // Test 7: PUT update group with multimodal_fallback validates correctly
  // ------------------------------------------------------------------
  it("test_validateRule_put_update_validates_multimodal_fallback", async () => {
  // First create a group without multimodal_fallback
  const createRes = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
    client_model: "model-put-test",
    rule: VALID_RULE_WITHOUT_FALLBACK(activeProviderId),
    },
  });
  expect(createRes.statusCode).toBe(201);
  const id = createRes.json().data.id;

  // Update with invalid multimodal_fallback (non-existent provider)
  const updateRes = await app.inject({
    method: "PUT",
    url: `/admin/api/mapping-groups/${id}`,
    headers: { cookie, "content-type": "application/json" },
    payload: {
    rule: JSON.stringify({
      targets: [
      { backend_model: "text-model", provider_id: activeProviderId },
      ],
    multimodal_fallback: {
    backend_model: "vision-model",
    provider_id: "ghost-provider",
    },
    }),
    },
  });
  // After implementation: should return 400
  expect(updateRes.statusCode).toBe(400);
  const body = updateRes.json();
  expect(body.code).toBe(API_CODE.BAD_REQUEST);
  expect(body.message).toContain("multimodal_fallback");
  });

  // ------------------------------------------------------------------
  // Test 8: multimodal_fallback with empty object fails
  // ------------------------------------------------------------------
  it("test_validateRule_multimodal_fallback_empty_object_fails", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
    client_model: "model-empty-fallback",
    rule: JSON.stringify({
      targets: [
      { backend_model: "text-model", provider_id: activeProviderId },
      ],
    multimodal_fallback: {},
    }),
    },
  });
  // After implementation: should return 400
  expect(res.statusCode).toBe(400);
  const body = res.json();
  expect(body.code).toBe(API_CODE.BAD_REQUEST);
  expect(body.message).toContain("multimodal_fallback");
  });

  // ------------------------------------------------------------------
  // Test 9: multimodal_fallback with backend_model not in provider models fails
  // ------------------------------------------------------------------
  it("test_validateRule_multimodal_fallback_backend_model_not_in_provider_models_fails", async () => {
  const res = await app.inject({
  method: "POST",
  url: "/admin/api/mapping-groups",
  headers: { cookie, "content-type": "application/json" },
  payload: {
  client_model: "model-bad-backend",
  rule: JSON.stringify({
    targets: [
    { backend_model: "text-model", provider_id: activeProviderId },
    ],
  multimodal_fallback: {
  provider_id: activeProviderId,
  backend_model: "nonexistent-model",
  },
  }),
  },
  });
  expect(res.statusCode).toBe(400);
  const body = res.json();
  expect(body.code).toBe(API_CODE.BAD_REQUEST);
  expect(body.message).toContain("backend_model");
  });
});
