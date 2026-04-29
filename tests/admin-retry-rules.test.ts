import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { RetryRuleMatcher } from "../src/proxy/orchestration/retry-rules.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";

describe("Retry Rule CRUD", () => {
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

  it("GET retry-rules returns seeded rules", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/retry-rules",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const rules = res.json().data;
    expect(rules.length).toBe(0);
  });

  it("POST creates retry rule", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "rate-limit",
        status_code: 429,
        body_pattern: "rate limit",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBeDefined();
  });

  it("GET returns retry rules including created one", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "rate-limit",
        status_code: 429,
        body_pattern: "rate limit",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/retry-rules",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const rules = res.json().data;
    expect(rules.some((r: any) => r.name === "rate-limit")).toBe(true);
  });

  it("PUT updates retry rule", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "rate-limit",
        status_code: 429,
        body_pattern: "rate limit",
      },
    });
    const id = createRes.json().data.id;

    await app.inject({
      method: "PUT",
      url: `/admin/api/retry-rules/${id}`,
      headers: { cookie, "content-type": "application/json" },
      payload: { body_pattern: "too many requests" },
    });

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/retry-rules",
      headers: { cookie },
    });
    const rules = getRes.json().data;
    expect(rules[0].body_pattern).toBe("too many requests");
  });

  it("DELETE removes retry rule", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "rate-limit",
        status_code: 429,
        body_pattern: "rate limit",
      },
    });
    const id = createRes.json().data.id;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/admin/api/retry-rules/${id}`,
      headers: { cookie },
    });
    expect(delRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/retry-rules",
      headers: { cookie },
    });
    const rules = getRes.json().data;
    expect(rules.some((r: any) => r.name === "rate-limit")).toBe(false);
  });

  it("POST invalid regex returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "bad",
        status_code: 400,
        body_pattern: "[invalid",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40003)
    expect(body.data).toBeNull()
  });

  it("PUT invalid regex returns 400", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "ok",
        status_code: 400,
        body_pattern: "error",
      },
    });
    const id = createRes.json().data.id;

    const res = await app.inject({
      method: "PUT",
      url: `/admin/api/retry-rules/${id}`,
      headers: { cookie, "content-type": "application/json" },
      payload: { body_pattern: "[bad" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json()
    expect(body.code).toBe(40003)
    expect(body.data).toBeNull()
  });

  it("matcher refreshes after create", async () => {
    const matcher = new RetryRuleMatcher();
    matcher.load(db);
    expect(matcher.test(400, "please retry")).toBe(false);

    await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "retry",
        status_code: 400,
        body_pattern: "please retry",
      },
    });

    matcher.load(db);
    expect(matcher.test(400, "please retry")).toBe(true);
  });

  it("unauthenticated access returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/retry-rules",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json()
    expect(body.code).toBe(40102)
    expect(body.data).toBeNull()
  });
});
