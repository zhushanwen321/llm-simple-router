/**
 * Tests for log filtering API: client_model and backend_model parameters.
 *
 * Verifies that the GET /admin/api/logs endpoint supports filtering by
 * client_model (maps to rl.model) and backend_model (maps to rm.backend_model),
 * including combined filtering and backward compatibility with the existing model parameter.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { buildApp } from "../../src/index.js";
import { initDatabase } from "../../src/db/index.js";
import { encrypt } from "../../src/utils/crypto.js";
import { seedSettings, login, makeConfig, TEST_ENCRYPTION_KEY } from "../helpers/test-setup.js";

function insertLogWithMetrics(
  db: Database.Database,
  logId: string,
  model: string,
  backendModel: string,
  providerId: string,
  metricsId: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, client_status_code, latency_ms,
      is_stream, error_message, created_at, is_retry, is_failover)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(logId, "openai", model, providerId, 200, 200, 100, 0, null, now, 0, 0);

  db.prepare(
    `INSERT INTO request_metrics (id, request_log_id, provider_id, backend_model, api_type,
      input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(metricsId, logId, providerId, backendModel, "openai", 100, 50, now);
}

describe("Admin API: log filtering by client_model and backend_model", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);

    const encrypted = encrypt("sk-key", TEST_ENCRYPTION_KEY);
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "prov-1", "TestProvider", "openai", "http://localhost:1234", encrypted,
      JSON.stringify([{ id: "gpt-4o", name: "gpt-4o" }, { id: "claude-3-opus", name: "claude-3-opus" }]),
      1, new Date().toISOString(), new Date().toISOString(),
    );

    // Insert test data: three logs with different models
    insertLogWithMetrics(db, "log-1", "gpt-4o", "gpt-4o-2024-08-06", "prov-1", "metrics-1");
    insertLogWithMetrics(db, "log-2", "claude-3-opus", "claude-3-opus-20240229", "prov-1", "metrics-2");
    insertLogWithMetrics(db, "log-3", "gpt-4o-mini", "gpt-4o-mini-2024-07-18", "prov-1", "metrics-3");

    const result = await buildApp({ config: makeConfig() as never, db });
    app = result.app;
    cookie = await login(app);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  // ----------------------------------------------------------------
  // Test 1: client_model filter matches rl.model with LIKE
  // ----------------------------------------------------------------
  it("test_client_model_filter_returns_matching_logs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?client_model=gpt-4o",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    // Should match log-1 (gpt-4o) and log-3 (gpt-4o-mini) but NOT log-2 (claude-3-opus)
    expect(body.total).toBe(2);
    const models = body.data.map((r: { model: string }) => r.model);
    expect(models).toContain("gpt-4o");
    expect(models).toContain("gpt-4o-mini");
    expect(models).not.toContain("claude-3-opus");
  });

  // ----------------------------------------------------------------
  // Test 2: client_model exact match returns single log
  // ----------------------------------------------------------------
  it("test_client_model_exact_match_returns_single_log", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?client_model=claude-3-opus",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.total).toBe(1);
    expect(body.data[0].model).toBe("claude-3-opus");
  });

  // ----------------------------------------------------------------
  // Test 3: backend_model filter matches rm.backend_model
  // ----------------------------------------------------------------
  it("test_backend_model_filter_returns_matching_logs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?backend_model=gpt-4o-2024-08-06",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.total).toBe(1);
    expect(body.data[0].backend_model).toBe("gpt-4o-2024-08-06");
  });

  // ----------------------------------------------------------------
  // Test 4: backend_model LIKE partial match
  // ----------------------------------------------------------------
  it("test_backend_model_partial_match_returns_multiple_logs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?backend_model=gpt-4o",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    // Should match log-1 (gpt-4o-2024-08-06) and log-3 (gpt-4o-mini-2024-07-18)
    expect(body.total).toBe(2);
  });

  // ----------------------------------------------------------------
  // Test 5: combined client_model + backend_model filter
  // ----------------------------------------------------------------
  it("test_combined_filters_return_intersection", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?client_model=gpt-4o&backend_model=gpt-4o-2024-08-06",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    // Only log-1 matches both: model=gpt-4o AND backend_model=gpt-4o-2024-08-06
    expect(body.total).toBe(1);
    expect(body.data[0].model).toBe("gpt-4o");
    expect(body.data[0].backend_model).toBe("gpt-4o-2024-08-06");
  });

  // ----------------------------------------------------------------
  // Test 6: combined filter returns empty when no intersection
  // ----------------------------------------------------------------
  it("test_combined_filters_no_match_returns_empty", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?client_model=claude&backend_model=gpt-4o",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });

  // ----------------------------------------------------------------
  // Test 7: backward compatibility - original model param still works
  // ----------------------------------------------------------------
  it("test_original_model_param_still_works", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?model=gpt-4o",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    // Original model param matches LIKE on rl.model, same as client_model
    expect(body.total).toBe(2);
    const models = body.data.map((r: { model: string }) => r.model);
    expect(models).toContain("gpt-4o");
    expect(models).toContain("gpt-4o-mini");
  });

  // ----------------------------------------------------------------
  // Test 8: no filter returns all logs
  // ----------------------------------------------------------------
  it("test_no_filter_returns_all_logs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.total).toBe(3);
  });

  // ----------------------------------------------------------------
  // Test 9: grouped view respects client_model filter
  // ----------------------------------------------------------------
  it("test_grouped_view_respects_client_model_filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?view=grouped&client_model=gpt-4o",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.total).toBe(2);
  });

  // ----------------------------------------------------------------
  // Test 10: grouped view respects backend_model filter
  // ----------------------------------------------------------------
  it("test_grouped_view_respects_backend_model_filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?view=grouped&backend_model=claude",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.total).toBe(1);
    expect(body.data[0].backend_model).toBe("claude-3-opus-20240229");
  });

  // ----------------------------------------------------------------
  // Test 11: non-matching filter returns empty
  // ----------------------------------------------------------------
  it("test_non_matching_filter_returns_empty", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs?client_model=nonexistent-model",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });
});
