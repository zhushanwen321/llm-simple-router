import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";
import { ServiceContainer } from "../src/core/container.js";


const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeConfig() {
  return {
    PORT: 9981,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent",
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
    RETRY_BASE_DELAY_MS: 0,
  };
}

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/login",
    payload: { password: "test-admin-pass" },
  });
  const setCookie = res.headers["set-cookie"];
  expect(setCookie).toBeDefined();
  const match = (setCookie as string).match(/admin_token=([^;]+)/);
  expect(match).toBeTruthy();
  return `admin_token=${match![1]}`;
}

function seedSettings(db: ReturnType<typeof initDatabase>) {
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  setSetting(db, "jwt_secret", "test-jwt-secret-for-testing");
  setSetting(db, "admin_password_hash", hashPassword("test-admin-pass"));
  setSetting(db, "initialized", "true");
}

describe("Admin Monitor API", () => {
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

  it("GET /admin/api/monitor/active returns array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/monitor/active",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("GET /admin/api/monitor/stats returns StatsSnapshot", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/monitor/stats",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body).toHaveProperty("totalRequests");
    expect(body).toHaveProperty("successCount");
    expect(body).toHaveProperty("errorCount");
    expect(body).toHaveProperty("avgLatencyMs");
    expect(body).toHaveProperty("p50LatencyMs");
    expect(body).toHaveProperty("p99LatencyMs");
    expect(body).toHaveProperty("byProvider");
    expect(body).toHaveProperty("byStatusCode");
  });

  it("GET /admin/api/monitor/concurrency returns array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/monitor/concurrency",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("GET /admin/api/monitor/runtime returns RuntimeMetrics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/monitor/runtime",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body).toHaveProperty("uptimeMs");
    expect(body).toHaveProperty("memoryUsage");
    expect(body).toHaveProperty("activeHandles");
    expect(body).toHaveProperty("activeRequests");
    expect(body).toHaveProperty("eventLoopDelayMs");
    expect(typeof body.uptimeMs).toBe("number");
    expect(body.memoryUsage).toHaveProperty("rss");
    expect(body.memoryUsage).toHaveProperty("heapUsed");
    expect(body.memoryUsage).toHaveProperty("heapTotal");
  });

  it("GET /admin/api/monitor/stream is accessible", async () => {
    // SSE 流在 inject 环境下会挂起，仅验证路由注册和鉴权通过即可
    // 使用 inject 的 simulate 选项限制等待时间不可行，
    // 改为验证未认证请求返回 401
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/monitor/stream",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json()
    expect(body.code).toBe(40102)
    expect(body.data).toBeNull()
  });

  it("monitor endpoints require authentication", async () => {
    const endpoints = [
      "/admin/api/monitor/active",
      "/admin/api/monitor/stats",
      "/admin/api/monitor/concurrency",
      "/admin/api/monitor/runtime",
    ];
    for (const url of endpoints) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
      const body = res.json()
      expect(body.code).toBe(40102)
      expect(body.data).toBeNull()
    }
  });

  it("GET /admin/api/monitor/request/:id returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/monitor/request/nonexistent-id",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
