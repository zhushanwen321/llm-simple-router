import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { Server } from "http";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { encrypt } from "../src/utils/crypto.js";
import { createRetryRule } from "../src/db/retry-rules.js";
import { createProxyHandler } from "../src/proxy/handler/create-proxy-handler.js";
import { FormatRegistry } from "../src/proxy/format/registry.js";
import { openaiAdapter } from "../src/proxy/format/adapters/openai.js";
import { SemaphoreManager as ProviderSemaphoreManager } from "../src/core/concurrency/index.js";
import { RequestTracker } from "../src/core/monitor/index.js";
import { RetryRuleMatcher } from "../src/proxy/orchestration/retry-rules.js";
import { createMockBackend } from "./helpers/mock-backend.js";
import { TEST_ENCRYPTION_KEY } from "./helpers/test-setup.js";
import { ServiceContainer, SERVICE_KEYS } from "../src/core/container.js";
import { ProxyAgentFactory } from "../src/proxy/transport/proxy-agent.js";

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function buildTestApp(mockDb: Database.Database, matcher: RetryRuleMatcher): FastifyInstance {
  const app = Fastify();
  const semaphoreManager = new ProviderSemaphoreManager();
  const tracker = new RequestTracker({ semaphoreManager });
  const container = new ServiceContainer();
  container.register("semaphoreManager", () => semaphoreManager);
  container.register("tracker", () => tracker);
  container.register("matcher", () => matcher);
  container.register("usageWindowTracker", () => undefined);
  container.register("sessionTracker", () => undefined);
  container.register("adaptiveController", () => undefined);
  container.register(SERVICE_KEYS.logFileWriter, () => null);
  container.register(SERVICE_KEYS.pluginRegistry, () => undefined);
  container.register(SERVICE_KEYS.proxyAgentFactory, () => new ProxyAgentFactory());

  const formatRegistry = new FormatRegistry();
  formatRegistry.registerAdapter(openaiAdapter);
  container.register(SERVICE_KEYS.formatRegistry, () => formatRegistry);

  app.register(
    createProxyHandler({
      apiType: "openai",
      paths: ["/v1/chat/completions", "/chat/completions"],
    }),
    { db: mockDb, container },
  );

  return app;
}

function insertMockBackend(
  mockDb: Database.Database,
  baseUrl: string,
  models: string = "[]",
): void {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
  mockDb
    .prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, models, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "svc-openai",
      "MockOpenAI",
      "openai",
      baseUrl,
      encryptedKey,
      1,
      models,
      now,
      now,
    );
}

function insertModelMapping(
  mockDb: Database.Database,
  clientModel: string,
  backendModel: string,
): void {
  const now = new Date().toISOString();
  mockDb
    .prepare(
      `INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run("map-1", clientModel, backendModel, "svc-openai", 1, now);
  mockDb
    .prepare(
      `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "mg-1",
      clientModel,
      JSON.stringify({
        targets: [{ backend_model: backendModel, provider_id: "svc-openai" }],
      }),
      1,
      now,
    );
}

const ERROR_429_BODY = JSON.stringify({
  error: { type: "rate_limit_error", message: "You have reached your usage limit" },
});

const SUCCESS_BODY = JSON.stringify({
  id: "chatcmpl-test",
  object: "chat.completion",
  model: "gpt-4",
  choices: [{ index: 0, message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
});

describe("TC-3-01: Provider-bound rule prevents cross-provider retry", () => {
  let app: FastifyInstance;
  let mockDb: Database.Database;
  let matcher: RetryRuleMatcher;

  beforeEach(() => {
    mockDb = initDatabase(":memory:");
    setSetting(mockDb, "encryption_key", TEST_ENCRYPTION_KEY);
    matcher = new RetryRuleMatcher();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (mockDb) mockDb.close();
  });

  it("bound rule max_retries=0 → no retry, client gets 429", async () => {
    // 创建 provider 绑定规则 max_retries=0（不重试）
    createRetryRule(mockDb, {
      name: "kimi-429-no-retry",
      status_code: 429,
      body_pattern: "rate_limit",
      provider_id: "svc-openai",
      max_retries: 0,
    });
    matcher.load(mockDb);

    // Mock 上游始终返回 429
    const { server, port } = await createMockBackend((req, res) => {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(ERROR_429_BODY);
    });

    try {
      insertMockBackend(mockDb, `http://127.0.0.1:${port}`, '["gpt-4"]');
      insertModelMapping(mockDb, "gpt-4", "gpt-4");
      app = buildTestApp(mockDb, matcher);

      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer sk-backend-key",
        },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      });

      // 应该直接返回 429，没有重试
      expect(res.statusCode).toBe(429);
    } finally {
      await closeServer(server);
    }
  });
});

describe("TC-5-01: upstream_error_logs written on final failure", () => {
  let app: FastifyInstance;
  let mockDb: Database.Database;
  let matcher: RetryRuleMatcher;

  beforeEach(() => {
    mockDb = initDatabase(":memory:");
    setSetting(mockDb, "encryption_key", TEST_ENCRYPTION_KEY);
    matcher = new RetryRuleMatcher();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (mockDb) mockDb.close();
  });

  it("最终失败请求写入 upstream_error_logs", async () => {
    // 创建通用规则 max_retries=1（允许重试一次）
    createRetryRule(mockDb, {
      name: "retry-500",
      status_code: 500,
      body_pattern: "error",
      max_retries: 1,
      retry_delay_ms: 10,
    });
    matcher.load(mockDb);

    // Mock 上游始终返回 500
    let callCount = 0;
    const { server, port } = await createMockBackend((req, res) => {
      callCount++;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "server_error", message: "Internal error" } }));
    });

    try {
      insertMockBackend(mockDb, `http://127.0.0.1:${port}`, '["gpt-4"]');
      insertModelMapping(mockDb, "gpt-4", "gpt-4");
      app = buildTestApp(mockDb, matcher);

      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer sk-backend-key",
        },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      });

      // 请求应该失败
      expect(res.statusCode).toBeGreaterThanOrEqual(400);

      // 验证 upstream_error_logs 有记录
      const rows = mockDb
        .prepare("SELECT * FROM upstream_error_logs")
        .all() as Array<Record<string, unknown>>;

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const log = rows[0];
      expect(log.provider_id).toBe("svc-openai");
      expect(log.status_code).toBe(500);
      expect(log.error_type).toBe("server_error");
      expect(log.error_message).toBe("Internal error");
    } finally {
      await closeServer(server);
    }
  });
});
