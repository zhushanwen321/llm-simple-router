// TDD test for BP-M4 — allowed_models 预解析
// 预期 FAIL until implementation
//
// 当前实现：auth 中间件将 allowed_models 原始字符串挂到 request.routerKey 上
// 后续 failover 循环中每次迭代都 JSON.parse(allowedModels) 进行过滤
// 优化目标：auth 中间件在解析 router key 时预解析 allowed_models 为 string[]
// 后续直接使用数组，不再重复 JSON.parse
// 本测试验证：
// 1. 认证成功后 request.routerKey.allowed_models 应为数组类型或 null
// 2. allowed_models JSON 字符串被正确解析为 string[]
// 3. 无 allowed_models 时为 null

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createHash } from "crypto";
import { initDatabase } from "../../src/db/index.js";
import { setSetting } from "../../src/db/settings.js";
import { authMiddleware } from "../../src/middleware/auth.js";
import { encrypt } from "../../src/utils/crypto.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const TEST_KEY = "sk-router-test-key-allowed-models";
const TEST_KEY_HASH = createHash("sha256").update(TEST_KEY).digest("hex");

function buildTestAppWithAllowedModels(allowedModels: string | null) {
  const db = initDatabase(":memory:");
  setSetting(db, "initialized", "true");
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);

  db.prepare(
    "INSERT INTO router_keys (id, name, key_hash, key_prefix, allowed_models) VALUES (?, ?, ?, ?, ?)"
  ).run("test-id", "Test Key", TEST_KEY_HASH, TEST_KEY.slice(0, 8), allowedModels);

  const capturedRouterKey: { value: unknown } = { value: null };

  const app = Fastify();
  app.register(authMiddleware, { db });

  app.post("/v1/chat/completions", async (request) => {
    // 捕获 routerKey 以便在测试中断言
    capturedRouterKey.value = request.routerKey
      ? { ...request.routerKey }
      : null;
    return { result: "proxied", routerKey: request.routerKey };
  });

  return { app, db, capturedRouterKey };
}

describe("BP-M4: allowed_models pre-parsing in auth middleware", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let capturedRouterKey: { value: unknown };

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("allowed_models JSON 字符串应被预解析为数组", async () => {
    const allowedModels = JSON.stringify(["gpt-4", "claude-3"]);
    const setup = buildTestAppWithAllowedModels(allowedModels);
    app = setup.app;
    db = setup.db;
    capturedRouterKey = setup.capturedRouterKey;

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "content-type": "application/json",
      },
      payload: { model: "gpt-4", messages: [] },
    });

    expect(response.statusCode).toBe(200);

    // 优化目标：auth 中间件应将 allowed_models 从字符串预解析为数组
    const routerKey = capturedRouterKey.value as {
      id: string;
      name: string;
      allowed_models: unknown;
    } | null;

    expect(routerKey).not.toBeNull();
    expect(routerKey!.id).toBe("test-id");

    // 当前实现：allowed_models 是 JSON 字符串
    // 优化后：allowed_models 应该是 string[] 数组或 null
    // 这个断言在实现前会 FAIL，因为当前是字符串
    expect(Array.isArray(routerKey!.allowed_models)).toBe(true);
    expect(routerKey!.allowed_models).toEqual(["gpt-4", "claude-3"]);
  });

  it("allowed_models 为 null 时不解析", async () => {
    const setup = buildTestAppWithAllowedModels(null);
    app = setup.app;
    db = setup.db;
    capturedRouterKey = setup.capturedRouterKey;

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "content-type": "application/json",
      },
      payload: { model: "gpt-4", messages: [] },
    });

    expect(response.statusCode).toBe(200);

    const routerKey = capturedRouterKey.value as {
      id: string;
      name: string;
      allowed_models: unknown;
    } | null;

    expect(routerKey).not.toBeNull();
    expect(routerKey!.allowed_models).toBeNull();
  });

  it("allowed_models 空数组字符串应解析为空数组", async () => {
    const allowedModels = JSON.stringify([]);
    const setup = buildTestAppWithAllowedModels(allowedModels);
    app = setup.app;
    db = setup.db;
    capturedRouterKey = setup.capturedRouterKey;

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "content-type": "application/json",
      },
      payload: { model: "gpt-4", messages: [] },
    });

    expect(response.statusCode).toBe(200);

    const routerKey = capturedRouterKey.value as {
      id: string;
      name: string;
      allowed_models: unknown;
    } | null;

    expect(routerKey).not.toBeNull();
    // 空数组也应该被正确解析
    expect(Array.isArray(routerKey!.allowed_models)).toBe(true);
    expect(routerKey!.allowed_models).toEqual([]);
  });

  it("allowed_models 包含特殊字符的模型名应正确解析", async () => {
    const allowedModels = JSON.stringify([
      "gpt-4-0314",
      "claude-3-opus@20240229",
      "models/gemini-pro",
    ]);
    const setup = buildTestAppWithAllowedModels(allowedModels);
    app = setup.app;
    db = setup.db;
    capturedRouterKey = setup.capturedRouterKey;

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "content-type": "application/json",
      },
      payload: { model: "gpt-4", messages: [] },
    });

    expect(response.statusCode).toBe(200);

    const routerKey = capturedRouterKey.value as {
      id: string;
      name: string;
      allowed_models: unknown;
    } | null;

    expect(routerKey).not.toBeNull();
    expect(routerKey!.allowed_models).toEqual([
      "gpt-4-0314",
      "claude-3-opus@20240229",
      "models/gemini-pro",
    ]);
  });
});
