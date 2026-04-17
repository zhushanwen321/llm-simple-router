import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeConfig() {
  return {
    PORT: 9981,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent",
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
    RETRY_MAX_ATTEMPTS: 0,
    RETRY_BASE_DELAY_MS: 0,
  };
}

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/login",
    payload: { password: "test-admin-pass" },
  });
  const match = (res.headers["set-cookie"] as string).match(/admin_token=([^;]+)/);
  return `admin_token=${match![1]}`;
}

function seedSettings(db: ReturnType<typeof initDatabase>) {
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  setSetting(db, "jwt_secret", "test-jwt-secret-for-testing");
  setSetting(db, "admin_password_hash", hashPassword("test-admin-pass"));
  setSetting(db, "initialized", "true");
}

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
        name: "Test Provider",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-test-abc123xyz",
      },
    });
    providerId = res.json().id;
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
    expect(res.json()).toEqual([]);
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
    expect(res.json().id).toBeDefined();
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
    expect(res.json().length).toBe(1);
    expect(res.json()[0].client_model).toBe("gpt-4");
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
    const id = createRes.json().id;

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
    const groups = getRes.json();
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
    const id = createRes.json().id;

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
    expect(getRes.json()).toEqual([]);
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
  });

  it("unauthenticated access returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/mapping-groups",
    });
    expect(res.statusCode).toBe(401);
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
  });
});
