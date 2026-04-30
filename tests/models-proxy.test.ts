import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { openaiProxy } from "../src/proxy/handler/openai.js";
import { encrypt } from "../src/utils/crypto.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { ServiceContainer, SERVICE_KEYS } from "../src/core/container.js";


const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// 启动 mock 后端 HTTP 服务器
function createMockBackend(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function insertProvider(
  db: Database.Database,
  port: number,
  overrides: Record<string, any> = {}
) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
  const defaults = {
    id: "svc-openai-1",
    name: "Mock OpenAI",
    api_type: "openai",
    base_url: `http://127.0.0.1:${port}`,
    api_key: encryptedKey,
    is_active: 1,
    created_at: now,
    updated_at: now,
  };
  const row = { ...defaults, ...overrides };
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.name,
    row.api_type,
    row.base_url,
    row.api_key,
    row.is_active,
    row.created_at,
    row.updated_at
  );
}

describe("GET /v1/models proxy", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) db.close();
  });

  it("should proxy GET /v1/models to backend and return JSON response", async () => {
    const { server: backendServer, port } = await createMockBackend(
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [
              {
                id: "gpt-4",
                object: "model",
                created: 1687882411,
                owned_by: "openai",
              },
              {
                id: "gpt-3.5-turbo",
                object: "model",
                created: 1677610602,
                owned_by: "openai",
              },
            ],
          })
        );
      }
    );

    insertProvider(db, port);

    app = Fastify();
    const container = new ServiceContainer();
    container.register("semaphoreManager", () => undefined);
    container.register("tracker", () => undefined);
    container.register("matcher", () => undefined);
    container.register("usageWindowTracker", () => undefined);
    container.register("sessionTracker", () => undefined);
    container.register("adaptiveController", () => undefined);
    container.register(SERVICE_KEYS.logFileWriter, () => null);
    app.register(openaiProxy, { db: db, container });

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("gpt-4");
    expect(body.data[1].id).toBe("gpt-3.5-turbo");

    await closeServer(backendServer);
  });

  it("should return 404 when no active openai backend exists", async () => {
    app = Fastify();
    const container = new ServiceContainer();
    container.register("semaphoreManager", () => undefined);
    container.register("tracker", () => undefined);
    container.register("matcher", () => undefined);
    container.register("usageWindowTracker", () => undefined);
    container.register("sessionTracker", () => undefined);
    container.register("adaptiveController", () => undefined);
    container.register(SERVICE_KEYS.logFileWriter, () => null);
    app.register(openaiProxy, { db: db, container });

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("No active OpenAI provider");
  });

  it("should return 502 when backend is unreachable", async () => {
    insertProvider(db, 1);

    app = Fastify();
    const container = new ServiceContainer();
    container.register("semaphoreManager", () => undefined);
    container.register("tracker", () => undefined);
    container.register("matcher", () => undefined);
    container.register("usageWindowTracker", () => undefined);
    container.register("sessionTracker", () => undefined);
    container.register("adaptiveController", () => undefined);
    container.register(SERVICE_KEYS.logFileWriter, () => null);
    app.register(openaiProxy, { db: db, container });

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
    });

    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.error).toBeDefined();
  });

  it("should not use inactive backend services", async () => {
    insertProvider(db, 9999, { is_active: 0 });

    app = Fastify();
    const container = new ServiceContainer();
    container.register("semaphoreManager", () => undefined);
    container.register("tracker", () => undefined);
    container.register("matcher", () => undefined);
    container.register("usageWindowTracker", () => undefined);
    container.register("sessionTracker", () => undefined);
    container.register("adaptiveController", () => undefined);
    container.register(SERVICE_KEYS.logFileWriter, () => null);
    app.register(openaiProxy, { db: db, container });

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
    });

    expect(response.statusCode).toBe(404);
  });
});
