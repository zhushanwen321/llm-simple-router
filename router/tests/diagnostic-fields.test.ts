import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { Server } from "http";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { encrypt } from "../src/utils/crypto.js";
import { createProxyHandler } from "../src/proxy/handler/create-proxy-handler.js";
import { FormatRegistry } from "../src/proxy/format/registry.js";
import { openaiAdapter } from "../src/proxy/format/adapters/openai.js";
import { SemaphoreManager as ProviderSemaphoreManager } from "../src/core/concurrency/index.js";
import { RequestTracker } from "../src/core/monitor/index.js";
import { createMockBackend } from "./helpers/mock-backend.js";
import { TEST_ENCRYPTION_KEY } from "./helpers/test-setup.js";
import { ServiceContainer, SERVICE_KEYS } from "../src/core/container.js";
import { ProxyAgentFactory } from "../src/proxy/transport/proxy-agent.js";

// ---------- helpers ----------

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function getDeadPort(): Promise<{ port: number }> {
  const net = await import("net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      const port = addr.port;
      server.close(() => resolve({ port }));
    });
    server.on("error", reject);
  });
}

function buildTestApp(mockDb: Database.Database): FastifyInstance {
  const app = Fastify();
  const semaphoreManager = new ProviderSemaphoreManager();
  const tracker = new RequestTracker({ semaphoreManager });
  const container = new ServiceContainer();
  container.register("semaphoreManager", () => semaphoreManager);
  container.register("tracker", () => tracker);
  container.register("matcher", () => undefined);
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

function getDiagnosticRow(mockDb: Database.Database, logId: string) {
  return mockDb
    .prepare(
      "SELECT transport_kind, abort_reason, error_code, headers_sent, resilience_action, resilience_reason, mapping_reason, failover_trigger FROM request_logs WHERE id = ?",
    )
    .get(logId) as Record<string, unknown> | undefined;
}

function getAnyLogId(mockDb: Database.Database): string | null {
  const row = mockDb
    .prepare("SELECT id FROM request_logs LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  return (row?.id as string) ?? null;
}

// ---------- mock response data ----------

const OPENAI_NON_STREAM_RESPONSE = {
  id: "chatcmpl-test",
  object: "chat.completion",
  model: "gpt-4",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello!" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
};

const OPENAI_SSE_CHUNKS = [
  `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ delta: { content: "Hi" } }],
  })}\n\n`,
  `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ delta: { content: "!" } }],
  })}\n\n`,
  "data: [DONE]\n\n",
];

// ---------- tests ----------

describe("Diagnostic fields in request_logs", () => {
  let app: FastifyInstance;
  let mockDb: Database.Database;

  beforeEach(() => {
    mockDb = initDatabase(":memory:");
    setSetting(mockDb, "encryption_key", TEST_ENCRYPTION_KEY);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (mockDb) mockDb.close();
  });

  // TC1: Non-stream 200 → transport_kind = "success"
  it("should set transport_kind='success' for non-stream 200", async () => {
    const { port, close } = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
      });
    });

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });

    expect(response.statusCode).toBe(200);

    const logId = getAnyLogId(mockDb);
    expect(logId).not.toBeNull();
    const row = getDiagnosticRow(mockDb, logId!);
    expect(row).toBeDefined();
    expect(row!.transport_kind).toBe("success");

    await close();
  });

  // TC2: Stream 200 SSE → transport_kind = "stream_success"
  it("should set transport_kind='stream_success' for SSE stream 200", async () => {
    const { port, close } = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        for (const chunk of OPENAI_SSE_CHUNKS) {
          res.write(chunk);
        }
        res.end();
      });
    });

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);

    const logId = getAnyLogId(mockDb);
    expect(logId).not.toBeNull();
    const row = getDiagnosticRow(mockDb, logId!);
    expect(row).toBeDefined();
    expect(row!.transport_kind).toBe("stream_success");

    await close();
  });

  // TC3: Upstream 500 non-stream → transport_kind = "error"
  it("should set transport_kind='error' for upstream 500", async () => {
    const { port, close } = await createMockBackend((req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "Internal server error", type: "server_error" },
        }),
      );
    });

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });

    expect(response.statusCode).toBe(500);

    const logId = getAnyLogId(mockDb);
    expect(logId).not.toBeNull();
    const row = getDiagnosticRow(mockDb, logId!);
    expect(row).toBeDefined();
    expect(row!.transport_kind).toBe("error");

    await close();
  });

  // TC4: Upstream throw (ECONNREFUSED) → transport_kind = "throw"
  it("should set transport_kind='throw' for connection refused", async () => {
    const { port: deadPort } = await getDeadPort();
    insertMockBackend(mockDb, `http://127.0.0.1:${deadPort}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });

    expect(response.statusCode).toBe(502);

    const logId = getAnyLogId(mockDb);
    expect(logId).not.toBeNull();
    const row = getDiagnosticRow(mockDb, logId!);
    expect(row).toBeDefined();
    expect(row!.transport_kind).toBe("throw");
  });

  // TC5: Stream idle timeout → abort_reason = "idle_timeout"
  it(
    "should set abort_reason='idle_timeout' on stream idle timeout",
    async () => {
      const TIMEOUT_MS = 500;
      const firstChunk = `data: ${JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        choices: [{ delta: { content: "Hi" } }],
      })}\n\n`;

      const { port, close } = await createMockBackend((req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write(firstChunk);
          // 模拟上游卡住不发送数据
          setTimeout(() => {
            try {
              res.end();
            } catch {
              /* already closed */
            }
          }, 5000);
        });
      });

      const models = JSON.stringify([
        { id: "glm-5.1", stream_timeout_ms: TIMEOUT_MS },
      ]);
      insertMockBackend(mockDb, `http://127.0.0.1:${port}`, models);
      insertModelMapping(mockDb, "glm-5.1", "glm-5.1");

      app = buildTestApp(mockDb);
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        payload: {
          model: "glm-5.1",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        },
      });

      expect(response.body).toContain("stream_timeout");

      const logId = getAnyLogId(mockDb);
      expect(logId).not.toBeNull();
      const row = getDiagnosticRow(mockDb, logId!);
      expect(row).toBeDefined();
      expect(row!.abort_reason).toBe("idle_timeout");

      await close();
    },
    15_000,
  );

  // TC6: Normal success → abort_reason IS NULL
  it("should set abort_reason=NULL for normal success request", async () => {
    const { port, close } = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
      });
    });

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });

    expect(response.statusCode).toBe(200);

    const logId = getAnyLogId(mockDb);
    expect(logId).not.toBeNull();
    const row = getDiagnosticRow(mockDb, logId!);
    expect(row).toBeDefined();
    expect(row!.abort_reason).toBeNull();

    await close();
  });

  // TC7: Connection refused → error_code = "ECONNREFUSED" (or similar network error)
  it("should set error_code to network error code on connection refused", async () => {
    const { port: deadPort } = await getDeadPort();
    insertMockBackend(mockDb, `http://127.0.0.1:${deadPort}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });

    expect(response.statusCode).toBe(502);

    const logId = getAnyLogId(mockDb);
    expect(logId).not.toBeNull();
    const row = getDiagnosticRow(mockDb, logId!);
    expect(row).toBeDefined();
    // 连接被拒绝时应该有网络错误码
    expect(row!.error_code).toBeTruthy();
    expect(typeof row!.error_code).toBe("string");
  });

  // TC8: Normal success → error_code IS NULL
  it("should set error_code=NULL for normal success request", async () => {
    const { port, close } = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
      });
    });

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });

    expect(response.statusCode).toBe(200);

    const logId = getAnyLogId(mockDb);
    expect(logId).not.toBeNull();
    const row = getDiagnosticRow(mockDb, logId!);
    expect(row).toBeDefined();
    expect(row!.error_code).toBeNull();

    await close();
  });

  // TC9: mapping_reason is non-null for normal request
  it("should set mapping_reason to a non-null value for normal request", async () => {
    const { port, close } = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
      });
    });

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });

    expect(response.statusCode).toBe(200);

    const logId = getAnyLogId(mockDb);
    expect(logId).not.toBeNull();
    const row = getDiagnosticRow(mockDb, logId!);
    expect(row).toBeDefined();
    expect(row!.mapping_reason).toBeTruthy();
    // mapping_reason 应该是已知枚举值之一
    expect(row!.mapping_reason).toMatch(
      /^(direct_format|group_base_rule|fallback_provider|group_schedule)$/,
    );

    await close();
  });

  // TC10: Normal success without retry → resilience_action IS NULL
  it("should set resilience_action=NULL for normal success without retry", async () => {
    const { port, close } = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
      });
    });

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });

    expect(response.statusCode).toBe(200);

    const logId = getAnyLogId(mockDb);
    expect(logId).not.toBeNull();
    const row = getDiagnosticRow(mockDb, logId!);
    expect(row).toBeDefined();
    // 成功请求的 resilience 决策为 "done"（表示无重试/failover）
    expect(row!.resilience_action).toBe("done");
    // "done" 没有附带 reason
    expect(row!.resilience_reason).toBeNull();

    await close();
  });

  // TC11: Normal success → headers_sent IS NULL
  it("should set headers_sent=NULL for normal non-throw success", async () => {
    const { port, close } = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
      });
    });

    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "gpt-4", "gpt-4");

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });

    expect(response.statusCode).toBe(200);

    const logId = getAnyLogId(mockDb);
    expect(logId).not.toBeNull();
    const row = getDiagnosticRow(mockDb, logId!);
    expect(row).toBeDefined();
    expect(row!.headers_sent).toBeNull();

    await close();
  });
});
