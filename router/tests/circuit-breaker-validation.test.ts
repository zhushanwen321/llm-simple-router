import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { makeConfig, seedSettings, login } from "./helpers/test-setup.js";
import { validateCircuitBreaker } from "../src/admin/utils.js";
import { API_CODE } from "../src/admin/api-response.js";
import type { Config } from "../src/config/index.js";

/**
 * circuit_breaker 配置校验测试（设计文档 §7.2 配置校验扩展）。
 * 覆盖 validateCircuitBreaker 纯函数（TC1-7）与两条接入路径
 * （validateRule / validateMappingRule，TC8-9）。
 */

/** 合法的 circuit_breaker 配置（覆盖全部字段） */
function makeValidCb(): Record<string, unknown> {
  return {
    enabled: true,
    window_sec: 60,
    failure_rate: 0.9,
    min_samples: 10,
    cooldown_sec: 300,
    status_codes: [429, 500],
  };
}

/** 不配置 circuit_breaker 的普通 target */
function plainTarget(name = "m1"): Record<string, unknown> {
  return { backend_model: name, provider_id: "p1" };
}

// ============================================================
// 单元测试：validateCircuitBreaker 纯函数
// ============================================================
describe("validateCircuitBreaker (unit)", () => {
  it("TC1: 2 targets with valid circuit_breaker passes", () => {
    const targets = [
      { circuit_breaker: makeValidCb() },
      plainTarget("m2"),
    ];
    expect(validateCircuitBreaker(targets)).toBeUndefined();
  });

  it("TC2: single target with circuit_breaker rejected (chain constraint)", () => {
    const targets = [{ circuit_breaker: makeValidCb() }];
    const err = validateCircuitBreaker(targets);
    expect(err).toContain("at least 2 targets");
  });

  it("TC3: failure_rate out of range rejected", () => {
    // failure_rate = 2 (> 1)
    const overOne = [
      { circuit_breaker: { ...makeValidCb(), failure_rate: 2 } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(overOne)).toContain("failure_rate");

    // failure_rate = 0 (not > 0)
    const zero = [
      { circuit_breaker: { ...makeValidCb(), failure_rate: 0 } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(zero)).toContain("failure_rate");

    // failure_rate = -0.1 (negative)
    const neg = [
      { circuit_breaker: { ...makeValidCb(), failure_rate: -0.1 } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(neg)).toContain("failure_rate");
  });

  it("TC4: invalid numeric values rejected", () => {
    // window_sec = 0 (< 1)
    const windowErr = [
      { circuit_breaker: { ...makeValidCb(), window_sec: 0 } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(windowErr)).toContain("window_sec");

    // min_samples = 0.5 (non-integer)
    const minErr = [
      { circuit_breaker: { ...makeValidCb(), min_samples: 0.5 } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(minErr)).toContain("min_samples");

    // cooldown_sec = -1 (< 1)
    const cdErr = [
      { circuit_breaker: { ...makeValidCb(), cooldown_sec: -1 } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(cdErr)).toContain("cooldown_sec");
  });

  it("TC5: status_codes invalid rejected, undefined allowed", () => {
    // [429, 600] — 600 out of range
    const overRange = [
      { circuit_breaker: { ...makeValidCb(), status_codes: [429, 600] } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(overRange)).toContain("status_codes");

    // [429.5] — non-integer
    const fraction = [
      { circuit_breaker: { ...makeValidCb(), status_codes: [429.5] } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(fraction)).toContain("status_codes");

    // "429" — not an array (string)
    const notArray = [
      { circuit_breaker: { ...makeValidCb(), status_codes: "429" } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(notArray)).toContain("status_codes");

    // status_codes undefined → legal (passes)
    const noCodes = [
      { circuit_breaker: { ...makeValidCb(), status_codes: undefined } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(noCodes)).toBeUndefined();

    // status_codes [] (empty array) → rejected (语义未定义，必须显式 omit 字段表示“全部计入”)
    const emptyCodes = [
      { circuit_breaker: { ...makeValidCb(), status_codes: [] } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(emptyCodes)).toContain("at least one status code");
  });

  it("TC6: enabled must be boolean", () => {
    // enabled = "true" (string)
    const strEnabled = [
      { circuit_breaker: { ...makeValidCb(), enabled: "true" } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(strEnabled)).toContain("enabled");

    // enabled = 1 (number, not boolean)
    const numEnabled = [
      { circuit_breaker: { ...makeValidCb(), enabled: 1 } },
      plainTarget(),
    ];
    expect(validateCircuitBreaker(numEnabled)).toContain("enabled");
  });

  it("TC7: targets without circuit_breaker pass (backward compat)", () => {
    const targets = [
      { backend_model: "m1", provider_id: "p1" },
      { backend_model: "m2", provider_id: "p2" },
    ];
    expect(validateCircuitBreaker(targets)).toBeUndefined();
  });
});

// ============================================================
// 集成测试：validateRule 路径（POST /admin/api/mapping-groups）
// ============================================================
describe("validateRule integration (groups)", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;
  let providerId: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as unknown as Config, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "CB-Test-Provider",
        api_type: "openai",
        base_url: "https://api.test.com",
        api_key: "sk-test-key",
        models: ["m1", "m2"],
      },
    });
    providerId = res.json().data.id;
  });

  afterEach(async () => {
    await close();
  });

  it("TC8: rule with invalid circuit_breaker.failure_rate returns 400", async () => {
    const rule = JSON.stringify({
      targets: [
        {
          backend_model: "m1",
          provider_id: providerId,
          circuit_breaker: { ...makeValidCb(), failure_rate: 2 },
        },
        { backend_model: "m2", provider_id: providerId },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: { client_model: "cb-invalid-group", rule },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(API_CODE.BAD_REQUEST);
    expect(body.message).toContain("failure_rate");
  });
});

// ============================================================
// 集成测试：validateMappingRule 路径（POST /admin/api/schedules）
// ============================================================
describe("validateMappingRule integration (schedules)", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;
  let providerId: string;
  let groupId: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as unknown as Config, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);

    const providerRes = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "CB-Schedule-Provider",
        api_type: "openai",
        base_url: "https://api.test.com",
        api_key: "sk-test-key",
        models: ["m1", "m2"],
      },
    });
    providerId = providerRes.json().data.id;

    // 创建一个合法的 base group（单 target，无 CB，不触发链约束）
    const groupRes = await app.inject({
      method: "POST",
      url: "/admin/api/mapping-groups",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        client_model: `cb-schedule-group-${Date.now()}`,
        rule: JSON.stringify({
          targets: [{ backend_model: "m1", provider_id: providerId }],
        }),
      },
    });
    expect(groupRes.statusCode).toBe(201);
    groupId = groupRes.json().data.id;
  });

  afterEach(async () => {
    await close();
  });

  it("TC9: mapping_rule with invalid circuit_breaker.min_samples returns 400", async () => {
    const mappingRule = JSON.stringify({
      targets: [
        {
          backend_model: "m1",
          provider_id: providerId,
          circuit_breaker: { ...makeValidCb(), min_samples: 0 },
        },
        { backend_model: "m2", provider_id: providerId },
      ],
    });
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/schedules",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        mapping_group_id: groupId,
        name: "CB Test Schedule",
        week: "[1,2,3,4,5]",
        start_hour: 9,
        end_hour: 18,
        mapping_rule: mappingRule,
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe(API_CODE.BAD_REQUEST);
    expect(body.message).toContain("min_samples");
  });
});
