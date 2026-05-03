import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";

describe("Admin Auth", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
  });

  afterEach(async () => {
    await close();
  });

  it("login with correct password returns cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      payload: { password: "test-admin-pass" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ success: true });
    expect(res.headers["set-cookie"]).toContain("admin_token");
  });

  it("login with wrong password returns 401 with WRONG_PASSWORD code", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      payload: { password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json()
    expect(body.code).toBe(40101)
    expect(body.message).toContain('password')
    expect(body.data).toBeNull()
  });

  it("unauthenticated CRUD returns 401 with TOKEN_INVALID code", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json()
    expect(body.code).toBe(40102)
    expect(body.data).toBeNull()
  });

  it("logout clears cookie", async () => {
    const cookie = await login(app);
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/logout",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("Provider CRUD", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("GET services returns empty list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("POST creates service successfully", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test-OpenAI",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-abc123xyz",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBeDefined();
  });

  it("GET returns services with decrypted api_key", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test-OpenAI",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-abc123xyz",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const services = res.json().data;
    expect(services.length).toBe(1);
    expect(services[0].api_key).toBe("sk-test-abc123xyz");
    expect(services[0].api_key_preview).toBeUndefined();
  });

  it("PUT updates service", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test-OpenAI",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-key123",
      },
    });
    const id = createRes.json().data.id;

    const updateRes = await app.inject({
      method: "PUT",
      url: `/admin/api/providers/${id}`,
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "Updated-Name" },
    });
    expect(updateRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    expect(getRes.json().data[0].name).toBe("Updated-Name");
  });

  it("DELETE removes service", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test-OpenAI",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-key456",
      },
    });
    const id = createRes.json().data.id;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/admin/api/providers/${id}`,
      headers: { cookie },
    });
    expect(delRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    expect(getRes.json().data).toEqual([]);
  });

  it("POST with missing required field returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "NoKey" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40001)
    expect(body.data).toBeNull()
  });

  it("POST rejects provider name with spaces", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Invalid Name",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40002)
    expect(body.message).toContain("英文大小写字母");
    expect(body.data).toBeNull()
  });

  it("POST creates provider with max_concurrency", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test-Concurrent",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-abc123xyz",
        max_concurrency: 5,
      },
    });
    expect(res.statusCode).toBe(201);

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    const providers = getRes.json().data;
    expect(providers[0].max_concurrency).toBe(5);
  });

  it("PUT updates max_concurrency", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test-Concurrent",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-key789",
      },
    });
    const id = createRes.json().data.id;

    await app.inject({
      method: "PUT",
      url: `/admin/api/providers/${id}`,
      headers: { cookie, "content-type": "application/json" },
      payload: { max_concurrency: 3 },
    });

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    expect(getRes.json().data[0].max_concurrency).toBe(3);
  });
});
