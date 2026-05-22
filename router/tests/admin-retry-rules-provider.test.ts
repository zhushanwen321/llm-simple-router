import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";
import { RetryRuleMatcher } from "../src/proxy/orchestration/retry-rules.js";

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

  // ---------- AC6: Provider 列数据（前端表格依赖）----------

  it("AC6: 多条规则 mixed provider_id — API 正确返回 provider_id 列数据", async () => {
    // 创建 3 条规则：全局、provider-a、provider-b
    await app.inject({
      method: "POST", url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "global-rule", status_code: 429, body_pattern: "rate_limit", provider_id: null },
    });
    await app.inject({
      method: "POST", url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "provider-a-rule", status_code: 429, body_pattern: "rate_limit", provider_id: "provider-a" },
    });
    await app.inject({
      method: "POST", url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "provider-b-rule", status_code: 500, body_pattern: "error", provider_id: "provider-b" },
    });

    const getRes = await app.inject({
      method: "GET", url: "/admin/api/retry-rules", headers: { cookie },
    });
    expect(getRes.statusCode).toBe(200);
    const rules = getRes.json().data as Array<Record<string, unknown>>;

    const globalRule = rules.find((r) => r.name === "global-rule");
    expect(globalRule).toBeDefined();
    expect(globalRule!.provider_id).toBeNull();  // 前端据此显示 "通用" Badge

    const paRule = rules.find((r) => r.name === "provider-a-rule");
    expect(paRule).toBeDefined();
    expect(paRule!.provider_id).toBe("provider-a");

    const pbRule = rules.find((r) => r.name === "provider-b-rule");
    expect(pbRule).toBeDefined();
    expect(pbRule!.provider_id).toBe("provider-b");
  });

  // ---------- AC7: JSON 字段匹配编辑器数据验证 ----------

  it("AC7: body_matchers 多条件 round-trip", async () => {
    const bodyMatchers = JSON.stringify([
      { path: "error.type", operator: "equals", value: "rate_limit_error" },
      { path: "error.message", operator: "contains", value: "usage" },
      { path: "error.code", operator: "exists" },
    ]);
    const createRes = await app.inject({
      method: "POST", url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "json-match-rule", status_code: 429, body_pattern: "test", body_matchers: bodyMatchers },
    });
    expect(createRes.statusCode).toBe(201);
    const ruleId = createRes.json().data.id;

    const getRes = await app.inject({
      method: "GET", url: "/admin/api/retry-rules", headers: { cookie },
    });
    const rule = getRes.json().data.find((r: { id: string }) => r.id === ruleId);
    expect(rule.body_matchers).toBe(bodyMatchers);
    // 前端可以 JSON.parse 后渲染三行编辑器
    const parsed = JSON.parse(rule.body_matchers);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].operator).toBe("equals");
    expect(parsed[1].operator).toBe("contains");
    expect(parsed[2].operator).toBe("exists");
  });

  it("AC7: body_matchers=null 表示正则模式（前端 tab 切换）", async () => {
    const createRes = await app.inject({
      method: "POST", url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "regex-rule", status_code: 429, body_pattern: "rate_limit", body_matchers: null },
    });
    expect(createRes.statusCode).toBe(201);
    const ruleId = createRes.json().data.id;

    const getRes = await app.inject({
      method: "GET", url: "/admin/api/retry-rules", headers: { cookie },
    });
    const rule = getRes.json().data.find((r: { id: string }) => r.id === ruleId);
    expect(rule.body_matchers).toBeNull();  // 前端切换到正则 Tab
    expect(rule.body_pattern).toBe("rate_limit");
  });
});

// ---------- AC1: created_at DESC 排序 ----------

describe("AC1: created_at DESC ordering", () => {
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

  it("多条 provider 绑定规则按 created_at DESC 排序优先", async () => {
    // 直接插入两条 provider 绑定规则，不同 created_at 时间
    const oldTime = "2025-01-01T00:00:00.000Z";
    const newTime = "2025-06-01T00:00:00.000Z";

    // 旧规则：body_pattern=old_pattern
    db.prepare(`INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, retry_strategy, retry_delay_ms, max_retries, max_delay_ms, provider_id, body_matchers, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "rule-old", "old-rule", 429, "old_pattern", 1, "fixed", 100, 2, 5000, "provider-a", null, oldTime
    );

    // 新规则：body_matchers 指定精确匹配
    const newMatchers = JSON.stringify([{ path: "error.type", operator: "equals", value: "rate_limit_error" }]);
    db.prepare(`INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, retry_strategy, retry_delay_ms, max_retries, max_delay_ms, provider_id, body_matchers, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "rule-new", "new-rule", 429, ".*", 1, "fixed", 100, 3, 5000, "provider-a", newMatchers, newTime
    );

    const matcher = new RetryRuleMatcher();
    matcher.load(db);

    // body 匹配新规则（body_matchers matches）→ 返回新规则
    const matchNew = matcher.match(429, JSON.stringify({ error: { type: "rate_limit_error" } }), "provider-a");
    expect(matchNew).not.toBeNull();
    expect(matchNew!.name).toBe("new-rule");

    // body 不匹配新规则（body_matchers 不匹配）→ fallback 到旧规则
    const matchOld = matcher.match(429, JSON.stringify({ error: "old_pattern" }), "provider-a");
    expect(matchOld).not.toBeNull();
    expect(matchOld!.name).toBe("old-rule");
  });
});

// ---------- AC8: 向后兼容 ----------

describe("AC8: backward compatibility", () => {
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

  it("不传新字段创建规则时 provider_id 和 body_matchers 为 null", async () => {
    const res = await app.inject({
      method: "POST", url: "/admin/api/retry-rules",
      headers: { cookie, "content-type": "application/json" },
      payload: { name: "legacy-rule", status_code: 500, body_pattern: "error", retry_strategy: "fixed", retry_delay_ms: 1000, max_retries: 3 },
    });
    expect(res.statusCode).toBe(201);
    const ruleId = res.json().data.id;

    const getRes = await app.inject({
      method: "GET", url: "/admin/api/retry-rules", headers: { cookie },
    });
    const rule = getRes.json().data.find((r: { id: string }) => r.id === ruleId);
    expect(rule.provider_id).toBeNull();
    expect(rule.body_matchers).toBeNull();
  });
});
