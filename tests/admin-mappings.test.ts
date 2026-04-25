import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";

describe("Mapping CRUD", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;
  let providerId: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);

    // 创建一个 provider 供映射使用
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "Test-Provider",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-abc123xyz",
      },
    });
    providerId = res.json().data.id;
  });

  afterEach(async () => {
    await close();
  });

  it("GET mappings returns empty list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/mappings",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("POST creates mapping", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        provider_id: providerId,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBeDefined();
  });

  it("GET returns mappings", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        provider_id: providerId,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/mappings",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBe(1);
    expect(res.json().data[0].client_model).toBe("gpt-4");
  });

  it("PUT updates mapping", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        provider_id: providerId,
      },
    });
    const id = createRes.json().data.id;

    await app.inject({
      method: "PUT",
      url: `/admin/api/mappings/${id}`,
      headers: { cookie, "content-type": "application/json" },
      payload: { backend_model: "gpt-4o" },
    });

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/mappings",
      headers: { cookie },
    });
    expect(getRes.json().data[0].backend_model).toBe("gpt-4o");
  });

  it("DELETE removes mapping", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        provider_id: providerId,
      },
    });
    const id = createRes.json().data.id;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/admin/api/mappings/${id}`,
      headers: { cookie },
    });
    expect(delRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/mappings",
      headers: { cookie },
    });
    expect(getRes.json().data).toEqual([]);
  });

  it("POST duplicate client_model returns 409", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        provider_id: providerId,
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4",
        provider_id: providerId,
      },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json()
    expect(body.code).toBe(40901)
    expect(body.data).toBeNull()
  });

  it("POST with non-existent provider_id returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mappings",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        backend_model: "gpt-4-turbo",
        provider_id: "non-existent",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40401)
    expect(body.data).toBeNull()
  });

  it("unauthenticated access returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/mappings",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json()
    expect(body.code).toBe(40102)
    expect(body.data).toBeNull()
  });
});
