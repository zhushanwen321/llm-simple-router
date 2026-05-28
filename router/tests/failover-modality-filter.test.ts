/**
 * Modality 过滤 + 空列表提前报错集成测试
 *
 * 验证 computeModalityRedirectTargets 返回空列表时，
 * failover-loop 正确返回 HTTP 400 + unsupported_modality 错误。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type FastifyInstance } from "fastify";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";
import { encrypt } from "../src/utils/crypto.js";
import { DEFAULT_LOOP_PREVENTION_CONFIG } from "../src/core/loop-prevention/index.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const API_KEY = "sk-modality-filter-test";

function makeTestConfig() {
  return {
    PORT: 9981,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent",
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
    RETRY_BASE_DELAY_MS: 0,
    LOOP_PREVENTION: { ...DEFAULT_LOOP_PREVENTION_CONFIG, enabled: false },
  };
}

function createMockBackend(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
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

function safeClose(server: Server): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    try { server.close(() => resolve()); } catch { resolve(); }
  });
}

describe("Modality filter — empty list early error", () => {
  let db: Database.Database;
  let app: FastifyInstance | undefined;
  let closeFn: (() => Promise<void>) | undefined;
  let serversToClean: Server[] = [];

  function trackServer(s: Server) {
    serversToClean.push(s);
    return s;
  }

  beforeEach(() => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
    setSetting(db, "jwt_secret", "test-jwt-secret-modality");
    setSetting(db, "admin_password_hash", hashPassword("admin123"));
    setSetting(db, "initialized", "true");

    app = undefined;
    closeFn = undefined;
    serversToClean = [];
  });

  afterEach(async () => {
    if (closeFn) await closeFn();
    for (const s of serversToClean) {
      await safeClose(s);
    }
    if (db && db.open) db.close();
  });

  const AUTH_HEADER = { authorization: `Bearer ${API_KEY}` };

  function insertRouterKey() {
    const apiKeyHash = createHash("sha256").update(API_KEY).digest("hex");
    db.prepare(
      "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)",
    ).run("test-key-id", "Test Key", apiKeyHash, API_KEY.slice(0, 8));
  }

  function insertProvider(
    id: string, name: string, baseUrl: string, apiType: string,
    models: string,
  ) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(id, name, apiType, baseUrl, encrypt("sk-backend-key", TEST_ENCRYPTION_KEY), models, now, now);
  }

  function insertMappingGroup(
    clientModel: string,
    targets: Array<{ backend_model: string; provider_id: string }>,
    multimodalFallback?: { backend_model: string; provider_id: string },
  ) {
    const now = new Date().toISOString();
    const id = `mg-${clientModel}`;

    for (const t of targets) {
      db.prepare(
        `INSERT OR IGNORE INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(`mm-${t.provider_id}-${t.backend_model}`, clientModel, t.backend_model, t.provider_id, 1, now);
    }

    const rule: Record<string, unknown> = { targets };
    if (multimodalFallback) {
      rule.multimodal_fallback = multimodalFallback;
    }

    db.prepare(
      `INSERT INTO mapping_groups (id, client_model, rule, is_active, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, clientModel, JSON.stringify(rule), 1, now);
  }

  // ----------------------------------------------------------
  // AC-4: 空列表 → HTTP 400 + unsupported_modality (OpenAI)
  // ----------------------------------------------------------
  it("AC-4: returns HTTP 400 with unsupported_modality code (OpenAI apiType)", async () => {
    // 配置 1 个 text-only provider，无 fallback
    const { server, port } = await createMockBackend((_req, res) => {
      // 不应被调用
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "should-not-reach" }));
    });
    trackServer(server);

    insertRouterKey();
    insertProvider(
      "text-provider", "TextOnly", `http://127.0.0.1:${port}`, "openai",
      JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
    );
    insertMappingGroup("gpt-5", [
      { provider_id: "text-provider", backend_model: "text-model" },
    ]);
    // 无 multimodal_fallback

    const config = makeTestConfig();
    const built = await buildApp({ config, db });
    app = built.app;
    closeFn = built.close;

    // 发送含图片的请求
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: {
        model: "gpt-5",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "描述这张图片" },
            { type: "image_url", image_url: { url: "https://example.com/img.png" } },
          ],
        }],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("unsupported_modality");

    await safeClose(server);
  });

  // ----------------------------------------------------------
  // AC-5: 空列表 → HTTP 400 + unsupported_modality (Anthropic)
  // ----------------------------------------------------------
  it("AC-5: returns HTTP 400 with unsupported_modality code (Anthropic apiType)", async () => {
    const { server, port } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "should-not-reach" }));
    });
    trackServer(server);

    insertRouterKey();
    insertProvider(
      "anthropic-text-provider", "AnthropicTextOnly",
      `http://127.0.0.1:${port}`, "anthropic",
      JSON.stringify([{ name: "text-model", capabilities: ["text"] }]),
    );
    insertMappingGroup("claude-5", [
      { provider_id: "anthropic-text-provider", backend_model: "text-model" },
    ]);

    const config = makeTestConfig();
    const built = await buildApp({ config, db });
    app = built.app;
    closeFn = built.close;

    // Anthropic 格式含图片的请求
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        ...AUTH_HEADER,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      payload: {
        model: "claude-5",
        max_tokens: 100,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "描述这张图片" },
            { type: "image", source: { type: "url", url: "https://example.com/img.png" } },
          ],
        }],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("unsupported_modality");

    await safeClose(server);
  });

  // ----------------------------------------------------------
  // 正常请求不被影响：支持 image 的 target 正常代理
  // ----------------------------------------------------------
  it("normal image request routed to image-capable target without error", async () => {
    const openaiSuccess = {
      id: "chatcmpl-1",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "描述图片内容" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: "vision-model",
    };

    const { server, port } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(openaiSuccess));
    });
    trackServer(server);

    insertRouterKey();
    insertProvider(
      "vision-provider", "VisionProvider", `http://127.0.0.1:${port}`, "openai",
      JSON.stringify([{ name: "vision-model", capabilities: ["text", "image"] }]),
    );
    insertMappingGroup("gpt-5", [
      { provider_id: "vision-provider", backend_model: "vision-model" },
    ]);

    const config = makeTestConfig();
    const built = await buildApp({ config, db });
    app = built.app;
    closeFn = built.close;

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: {
        model: "gpt-5",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "描述这张图片" },
            { type: "image_url", image_url: { url: "https://example.com/img.png" } },
          ],
        }],
      },
    });

    // 不应返回 400，应正常代理
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe("chatcmpl-1");

    await safeClose(server);
  });
});
