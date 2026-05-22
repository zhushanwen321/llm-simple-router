import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";

describe("Retry Rule provider_id + body_matchers (TC-4-01, TC-4-02)", () => {
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

  it("TC-4-01: 创建规则带 provider_id 和 body_matchers", async () => {
    const bodyMatchers = JSON.stringify([
      { path: "error.type", operator: "equals", value: "rate_limit_error" },
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "kimi-429-no-retry",
        status_code: 429,
        body_pattern: "rate_limit",
        provider_id: "provider-kimi",
        body_matchers: bodyMatchers,
      },
    });
    expect(res.statusCode).toBe(201);
    const ruleId = res.json().data.id;

    // GET 验证返回包含新字段
    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/retry-rules",
      headers: { cookie },
    });
    expect(getRes.statusCode).toBe(200);
    const rules = getRes.json().data;
    const created = rules.find((r: { id: string }) => r.id === ruleId);
    expect(created).toBeDefined();
    expect(created.provider_id).toBe("provider-kimi");
    expect(created.body_matchers).toBe(bodyMatchers);
  });

  it("TC-4-02: 更新规则 provider_id 为 null", async () => {
    // 先创建带 provider_id 的规则
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "bound-rule",
        status_code: 429,
        body_pattern: "rate_limit",
        provider_id: "provider-kimi",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const ruleId = createRes.json().data.id;

    // PUT 更新 provider_id 为 null
    const updateRes = await app.inject({
      method: "PUT",
      url: `/admin/api/retry-rules/${ruleId}`,
      headers: { cookie, "content-type": "application/json" },
      payload: { provider_id: null },
    });
    expect(updateRes.statusCode).toBe(200);

    // GET 验证 provider_id 为 null
    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/retry-rules",
      headers: { cookie },
    });
    const rules = getRes.json().data;
    const updated = rules.find((r: { id: string }) => r.id === ruleId);
    expect(updated).toBeDefined();
    expect(updated.provider_id).toBeNull();
  });

  it("TC-4-01b: body_matchers 校验拒绝无效 JSON", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "bad-matchers",
        status_code: 429,
        body_pattern: "test",
        body_matchers: "not-valid-json{",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("TC-4-01c: body_matchers 校验拒绝非数组", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "bad-matchers",
        status_code: 429,
        body_pattern: "test",
        body_matchers: '{"path":"error","operator":"equals","value":"x"}',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("TC-4-01d: body_matchers 校验拒绝缺少 path", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "bad-matchers",
        status_code: 429,
        body_pattern: "test",
        body_matchers: '[{"operator":"equals","value":"x"}]',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("TC-4-01e: body_matchers 校验拒绝无效 operator", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "bad-matchers",
        status_code: 429,
        body_pattern: "test",
        body_matchers: '[{"path":"error.type","operator":"regex","value":"x"}]',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
