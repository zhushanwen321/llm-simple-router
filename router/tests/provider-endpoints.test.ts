import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance, Server } from "fastify";
import http from "http";
import Database from "better-sqlite3";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { encrypt } from "../src/utils/crypto.js";
import { parseEndpoints } from "../src/db/providers.js";
import { makeConfig, seedSettings, login, TEST_ENCRYPTION_KEY } from "./helpers/test-setup.js";

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function createMockBackend(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      resolve({ server, port: addr.port });
    });
    server.on("error", reject);
  });
}

describe("Provider Endpoints CRUD", () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    const db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as never, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("POST with endpoints array creates provider successfully", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "MultiProvider",
        endpoints: [
          {
            api_type: "openai",
            base_url: "https://api.openai.com",
            api_key: "sk-openai-key",
          },
          {
            api_type: "anthropic",
            base_url: "https://api.anthropic.com",
            upstream_path: "/v1/messages",
            api_key: "sk-ant-key",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.id).toBeDefined();
  });

  it("POST rejects duplicate api_type in endpoints", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "DupProvider",
        endpoints: [
          {
            api_type: "openai",
            base_url: "https://api.openai.com",
            api_key: "sk-key1",
          },
          {
            api_type: "openai",
            base_url: "https://api2.openai.com",
            api_key: "sk-key2",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("重复的 api_type");
  });

  it("POST rejects empty endpoints array (schema validation)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "EmptyEndpoints",
        endpoints: [],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST backward compat: old fields auto-assemble endpoints", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "LegacyProvider",
        api_type: "openai",
        base_url: "https://api.openai.com",
        api_key: "sk-legacy-key",
      },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().data.id;

    // 验证 GET 返回自动组装的 endpoints
    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    const providers = getRes.json().data;
    const created = providers.find((p: { id: string }) => p.id === id);
    expect(created).toBeDefined();
    expect(created.endpoints).toHaveLength(1);
    expect(created.endpoints[0].api_type).toBe("openai");
    expect(created.endpoints[0].base_url).toBe("https://api.openai.com");
    // api_key 为 null (回退到 provider.api_key)，GET 返回空字符串
    expect(created.endpoints[0].api_key).toBe("");
  });

  it("PUT updates endpoints successfully", async () => {
    // 先创建
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "UpdateProvider",
        endpoints: [
          {
            api_type: "openai",
            base_url: "https://api.openai.com",
            api_key: "sk-old-key",
          },
        ],
      },
    });
    const id = createRes.json().data.id;

    // 更新 endpoints
    const updateRes = await app.inject({
      method: "PUT",
      url: `/admin/api/providers/${id}`,
      headers: { cookie, "content-type": "application/json" },
      payload: {
        endpoints: [
          {
            api_type: "openai",
            base_url: "https://api.openai.com",
            api_key: "sk-new-key",
          },
          {
            api_type: "anthropic",
            base_url: "https://api.anthropic.com",
            api_key: "sk-ant-new-key",
          },
        ],
      },
    });
    expect(updateRes.statusCode).toBe(200);

    // 验证 GET 返回更新后的 endpoints
    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    const provider = getRes.json().data.find((p: { id: string }) => p.id === id);
    expect(provider.endpoints).toHaveLength(2);
    expect(provider.endpoints[0].api_key).toBe("sk-new-key");
    expect(provider.endpoints[1].api_key).toBe("sk-ant-new-key");
    expect(provider.endpoints[1].api_type).toBe("anthropic");
  });

  it("GET returns decrypted endpoints array", async () => {
    await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "DecryptProvider",
        endpoints: [
          {
            api_type: "openai",
            base_url: "https://api.openai.com",
            api_key: "sk-test-decrypt-key",
          },
          {
            api_type: "openai-responses",
            base_url: "https://api.openai.com",
            upstream_path: null,
            api_key: null,
          },
        ],
      },
    });

    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/providers",
      headers: { cookie },
    });
    expect(getRes.statusCode).toBe(200);
    const provider = getRes.json().data.find(
      (p: { name: string }) => p.name === "DecryptProvider",
    );
    expect(provider.endpoints).toHaveLength(2);

    // 第一个 endpoint: api_key 解密后明文
    expect(provider.endpoints[0].api_type).toBe("openai");
    expect(provider.endpoints[0].api_key).toBe("sk-test-decrypt-key");
    expect(provider.endpoints[0].base_url).toBe("https://api.openai.com");

    // 第二个 endpoint: api_key null → 返回空字符串
    expect(provider.endpoints[1].api_type).toBe("openai-responses");
    expect(provider.endpoints[1].api_key).toBe("");

    // 同步的旧字段
    expect(provider.api_type).toBe("openai");
    expect(provider.api_key).toBe("sk-test-decrypt-key");
  });
});

describe("Provider Endpoints — Proxy routing", () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;
  let cookie: string;
  let db: ReturnType<typeof initDatabase>;
  let mockServer: Server;
  let mockPort: number;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as never, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);

    // 启动 mock 后端
    const backend = await createMockBackend((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          model: "gpt-4",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hello from endpoint!" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      );
    });
    mockServer = backend.server;
    mockPort = backend.port;
  });

  afterEach(async () => {
    await closeServer(mockServer);
    await close();
  });

  it("routes to provider created with endpoints (legacy path)", async () => {
    // 创建带 endpoints 的 provider
    const createRes = await app.inject({
      method: "POST",
      url: "/admin/api/providers",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        name: "ProxyProvider",
        endpoints: [
          {
            api_type: "openai",
            base_url: `http://127.0.0.1:${mockPort}`,
            api_key: "sk-proxy-test-key",
          },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const providerId = createRes.json().data.id;

    // 直接插入 mapping group（与现有 proxy 测试模式一致）
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "mg-proxy-test",
      "gpt-4",
      JSON.stringify({ targets: [{ backend_model: "gpt-4", provider_id: providerId }] }),
      1,
      now,
    );

    // 直接插入 router_key
    const rawKey = "sk-test-router-key-for-proxy";
    const { hashPassword: hp } = await import("../src/utils/password.js");
    const { createHash } = await import("crypto");
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const encryptedKey = encrypt(rawKey, TEST_ENCRYPTION_KEY);
    db.prepare(
      `INSERT INTO router_keys (id, name, key_hash, key_prefix, key_encrypted, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("rk-proxy-test", "test-proxy-key", keyHash, rawKey.slice(0, 8), encryptedKey, 1, now);

    // 通过代理发送请求（非流式）
    const proxyRes = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${rawKey}`,
      },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
      },
    });
    expect(proxyRes.statusCode).toBe(200);
    const body = proxyRes.json();
    expect(body.choices[0].message.content).toBe("Hello from endpoint!");
  });
});
