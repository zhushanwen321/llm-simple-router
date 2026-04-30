import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";
import { ServiceContainer } from "../src/core/container.js";


const VALID_RULE = (providerId: string) => JSON.stringify({
  targets: [{ backend_model: "gpt-4-turbo", provider_id: providerId }],
});

const MULTI_TARGET_RULE = (providerId: string) => JSON.stringify({
  targets: [
    { backend_model: "gpt-4-turbo", provider_id: providerId },
    { backend_model: "gpt-4o", provider_id: providerId },
  ],
});

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
        rule: VALID_RULE(providerId),
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
        rule: VALID_RULE(providerId),
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
        rule: VALID_RULE(providerId),
      },
    });
    const id = createRes.json().data.id;

    await app.inject({
      method: "PUT",
      url: `/admin/api/mapping-groups/${id}`,
      headers: { cookie, "content-type": "application/json" },
      payload: {
        rule: JSON.stringify({
          targets: [{ backend_model: "gpt-4o", provider_id: providerId }],
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
        rule: VALID_RULE(providerId),
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
        rule: "not-json",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
  });

  it("POST missing targets returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        rule: JSON.stringify({}),
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
  });

  it("POST empty targets returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        rule: JSON.stringify({ targets: [] }),
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
  });

  it("POST with non-existent provider_id returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        rule: JSON.stringify({
          targets: [{ backend_model: "gpt-4-turbo", provider_id: "non-existent" }],
        }),
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
  });

  it("POST duplicate client_model returns 409", async () => {
    const payload = {
      client_model: "gpt-4",
      rule: VALID_RULE(providerId),
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
    const body = res.json();
    expect(body.code).toBe(40901);
    expect(body.data).toBeNull();
  });

  it("unauthenticated access returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/mapping-groups",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe(40102);
    expect(body.data).toBeNull();
  });

  it("POST creates multi-target group (failover)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4-fo",
        rule: MULTI_TARGET_RULE(providerId),
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST target missing backend_model returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4-err",
        rule: JSON.stringify({
          targets: [{ provider_id: providerId }],
        }),
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(40001);
    expect(body.data).toBeNull();
  });

  it("Toggle enables/disables group", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: "gpt-4",
        rule: VALID_RULE(providerId),
      },
    });
    const id = createRes.json().data.id;

    const toggleRes = await app.inject({
      method: "POST",
      url: `/admin/api/mapping-groups/${id}/toggle`,
      headers: { cookie },
    });
    expect(toggleRes.statusCode).toBe(200);
    expect(toggleRes.json().data.is_active).toBe(0);

    const toggleBack = await app.inject({
      method: "POST",
      url: `/admin/api/mapping-groups/${id}/toggle`,
      headers: { cookie },
    });
    expect(toggleBack.json().data.is_active).toBe(1);
  });

  it("DELETE non-existent group returns 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/api/mapping-groups/non-existent",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
