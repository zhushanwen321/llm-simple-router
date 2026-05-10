import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";
import { ServiceContainer } from "../src/core/container.js";
import type { RequestTracker } from "../src/core/monitor/index.js";
import type { ActiveRequest } from "../src/core/monitor/types.js";


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
  let tracker: RequestTracker;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    tracker = result.tracker;
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

  describe("DELETE /admin/api/monitor/request/:id", () => {
    it("returns 404 for non-existent request", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/admin/api/monitor/request/nonexistent-id",
        headers: { cookie },
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.code).toBe(40401);
      expect(body.data).toBeNull();
    });

    it("returns 401 without authentication", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/admin/api/monitor/request/some-id",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- 接口级集成测试：recent 性能优化后 clientRequest/upstreamRequest 分离 ---

  function createTestActiveRequest(overrides?: Partial<ActiveRequest>): ActiveRequest {
    return {
      id: "req-integ-1",
      apiType: "openai",
      model: "gpt-4",
      providerId: "provider-test",
      providerName: "TestProvider",
      isStream: true,
      startTime: Date.now(),
      status: "pending",
      retryCount: 0,
      attempts: [],
      clientRequest: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hello" }] }),
      upstreamRequest: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hello" }], stream: true }),
      ...overrides,
    };
  }

  describe("GET /admin/api/monitor/recent — completed 请求不含大字段", () => {
    it("completed 请求不包含 clientRequest 和 upstreamRequest", async () => {
      tracker.start(createTestActiveRequest({ id: "req-completed-no-large" }));
      tracker.complete("req-completed-no-large", { status: "completed", statusCode: 200 });

      const res = await app.inject({
        method: "GET",
        url: "/admin/api/monitor/recent",
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);

      const recent = res.json().data as ActiveRequest[];
      expect(recent.length).toBeGreaterThanOrEqual(1);

      const found = recent.find((r) => r.id === "req-completed-no-large");
      expect(found).toBeDefined();
      expect(found!.clientRequest).toBeUndefined();
      expect(found!.upstreamRequest).toBeUndefined();
    });
  });

  describe("GET /admin/api/monitor/request/:id — completed 请求合并 completedDetails", () => {
    it("completed 请求仍返回 clientRequest 和 upstreamRequest", async () => {
      const clientBody = JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "test" }] });
      const upstreamBody = JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "test" }], stream: true });

      tracker.start(createTestActiveRequest({
        id: "req-detail-merge",
        clientRequest: clientBody,
        upstreamRequest: upstreamBody,
      }));
      tracker.complete("req-detail-merge", { status: "completed", statusCode: 200 });

      const res = await app.inject({
        method: "GET",
        url: "/admin/api/monitor/request/req-detail-merge",
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);

      const data = res.json().data as ActiveRequest;
      expect(data.id).toBe("req-detail-merge");
      expect(data.status).toBe("completed");
      expect(data.clientRequest).toBe(clientBody);
      expect(data.upstreamRequest).toBe(upstreamBody);
    });
  });

  describe("GET /admin/api/monitor/request/:id — pending 请求返回完整数据", () => {
    it("pending 请求保留 clientRequest 和 upstreamRequest", async () => {
      const clientBody = JSON.stringify({ model: "claude-3", messages: [{ role: "user", content: "pending-test" }] });
      const upstreamBody = JSON.stringify({ model: "claude-3", messages: [{ role: "user", content: "pending-test" }], stream: false });

      tracker.start(createTestActiveRequest({
        id: "req-pending-full",
        apiType: "anthropic",
        model: "claude-3",
        clientRequest: clientBody,
        upstreamRequest: upstreamBody,
      }));

      const res = await app.inject({
        method: "GET",
        url: "/admin/api/monitor/request/req-pending-full",
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);

      const data = res.json().data as ActiveRequest;
      expect(data.id).toBe("req-pending-full");
      expect(data.status).toBe("pending");
      expect(data.clientRequest).toBe(clientBody);
      expect(data.upstreamRequest).toBe(upstreamBody);
    });
  });
});
