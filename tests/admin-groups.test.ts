import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";

describe("Mapping Group CRUD", () => {
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

  it("GET groups returns empty list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/mapping-groups",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("POST creates group", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        strategy: "scheduled",
        rule: JSON.stringify({
          default: { backend_model: "gpt-4-turbo", provider_id: providerId },
          windows: [],
        }),
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBeDefined();
  });

  it("GET returns groups", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        strategy: "scheduled",
        rule: JSON.stringify({
          default: { backend_model: "gpt-4-turbo", provider_id: providerId },
          windows: [],
        }),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/mapping-groups",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBe(1);
    expect(res.json().data[0].client_model).toBe("gpt-4");
  });

  it("PUT updates group rule", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        strategy: "scheduled",
        rule: JSON.stringify({
          default: { backend_model: "gpt-4-turbo", provider_id: providerId },
          windows: [],
        }),
      },
    });
    const id = createRes.json().data.id;

    await app.inject({
      method: "PUT",
      url: `/admin/api/mapping-groups/${id}`,
      headers: { cookie, "content-type": "application/json" },
      payload: {
        rule: JSON.stringify({
          default: { backend_model: "gpt-4o", provider_id: providerId },
          windows: [],
        }),
      },
    });

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/mapping-groups",
      headers: { cookie },
    });
    const groups = getRes.json().data;
    expect(groups[0].rule).toContain("gpt-4o");
  });

  it("DELETE removes group", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        strategy: "scheduled",
        rule: JSON.stringify({
          default: { backend_model: "gpt-4-turbo", provider_id: providerId },
          windows: [],
        }),
      },
    });
    const id = createRes.json().data.id;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/admin/api/mapping-groups/${id}`,
      headers: { cookie },
    });
    expect(delRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/mapping-groups",
      headers: { cookie },
    });
    expect(getRes.json().data).toEqual([]);
  });

  it("POST invalid JSON rule returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        strategy: "scheduled",
        rule: "not-json",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40001)
    expect(body.data).toBeNull()
  });

  it("POST missing default returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        strategy: "scheduled",
        rule: JSON.stringify({ windows: [] }),
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40001)
    expect(body.data).toBeNull()
  });

  it("POST with non-existent provider_id returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        strategy: "scheduled",
        rule: JSON.stringify({
          default: { backend_model: "gpt-4-turbo", provider_id: "non-existent" },
          windows: [],
        }),
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40001)
    expect(body.data).toBeNull()
  });

  it("POST duplicate client_model returns 409", async () => {
    const payload = {
      client_model: "gpt-4",
      strategy: "scheduled",
      rule: JSON.stringify({
        default: { backend_model: "gpt-4-turbo", provider_id: providerId },
        windows: [],
      }),
    };
    await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload,
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload,
    });
    expect(res.statusCode).toBe(409);
    const body = res.json()
    expect(body.code).toBe(40901)
    expect(body.data).toBeNull()
  });

  it("unauthenticated access returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/mapping-groups",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json()
    expect(body.code).toBe(40102)
    expect(body.data).toBeNull()
  });

  it("POST creates round-robin group", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4-rr",
        strategy: "round-robin",
        rule: JSON.stringify({
          targets: [
            { backend_model: "gpt-4-turbo", provider_id: providerId },
            { backend_model: "gpt-4o", provider_id: providerId },
          ],
        }),
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST creates random group", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4-rand",
        strategy: "random",
        rule: JSON.stringify({
          targets: [
            { backend_model: "gpt-4-turbo", provider_id: providerId },
          ],
        }),
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST creates failover group", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4-fo",
        strategy: "failover",
        rule: JSON.stringify({
          targets: [
            { backend_model: "gpt-4-turbo", provider_id: providerId },
            { backend_model: "gpt-4o", provider_id: providerId },
          ],
        }),
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST failover with single target returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4-fo2",
        strategy: "failover",
        rule: JSON.stringify({
          targets: [
            { backend_model: "gpt-4-turbo", provider_id: providerId },
          ],
        }),
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40001)
    expect(body.data).toBeNull()
  });

  it("POST round-robin with empty targets returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4-rr2",
        strategy: "round-robin",
        rule: JSON.stringify({ targets: [] }),
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40001)
    expect(body.data).toBeNull()
  });

  it("POST with unknown strategy returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4-unk",
        strategy: "unknown-strategy",
        rule: JSON.stringify({ targets: [] }),
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40001)
    expect(body.data).toBeNull()
  });
});
