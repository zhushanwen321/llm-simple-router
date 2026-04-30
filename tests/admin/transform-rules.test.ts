import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { buildApp } from "../../src/index.js";
import { initDatabase } from "../../src/db/index.js";
import { encrypt } from "../../src/utils/crypto.js";
import { seedSettings, login, makeConfig, TEST_ENCRYPTION_KEY } from "../helpers/test-setup.js";

describe("Transform Rules Admin API", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    // Insert provider for FK
    const encrypted = encrypt("sk-key", TEST_ENCRYPTION_KEY);
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("prov-1", "Test", "openai", "http://localhost:1234", encrypted, 1, new Date().toISOString(), new Date().toISOString());
    const result = await buildApp({ config: makeConfig() as never, db });
    app = result.app;
    cookie = await login(app);
  });
  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("GET returns null for non-existent rule", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/api/transform-rules/prov-1", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeNull();
  });

  it("PUT creates and updates rule", async () => {
    const putRes = await app.inject({
      method: "PUT", url: "/admin/api/transform-rules/prov-1",
      headers: { cookie, "content-type": "application/json" },
      payload: { drop_fields: ["logprobs"], is_active: 1 },
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await app.inject({ method: "GET", url: "/admin/api/transform-rules/prov-1", headers: { cookie } });
    expect(getRes.json().data.drop_fields).toEqual(["logprobs"]);

    // Update
    await app.inject({
      method: "PUT", url: "/admin/api/transform-rules/prov-1",
      headers: { cookie, "content-type": "application/json" },
      payload: { drop_fields: ["temperature"], is_active: 1 },
    });
    const getRes2 = await app.inject({ method: "GET", url: "/admin/api/transform-rules/prov-1", headers: { cookie } });
    expect(getRes2.json().data.drop_fields).toEqual(["temperature"]);
  });

  it("DELETE removes rule", async () => {
    await app.inject({
      method: "PUT", url: "/admin/api/transform-rules/prov-1",
      headers: { cookie, "content-type": "application/json" },
      payload: { drop_fields: ["logprobs"], is_active: 1 },
    });
    const delRes = await app.inject({ method: "DELETE", url: "/admin/api/transform-rules/prov-1", headers: { cookie } });
    expect(delRes.statusCode).toBe(200);
    const getRes = await app.inject({ method: "GET", url: "/admin/api/transform-rules/prov-1", headers: { cookie } });
    expect(getRes.json().data).toBeNull();
  });

  it("unauthenticated request returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/api/transform-rules/prov-1" });
    expect(res.statusCode).toBe(401);
  });

  it("POST reload returns success response", async () => {
    const res = await app.inject({ method: "POST", url: "/admin/api/transform-rules/reload", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.code).toBe(0);
    expect(json.data.loadedPlugins).toEqual([]);
    expect(json.data.rulesCount).toBe(0);
  });
});
