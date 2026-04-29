import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { buildApp } from "../../src/index.js";
import { encrypt } from "../../src/utils/crypto.js";
import { initDatabase } from "../../src/db/index.js";
import { setSetting } from "../../src/db/settings.js";
import { hashPassword } from "../../src/utils/password.js";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const API_KEY = "sk-loop-prevention-test";

function createMockBackend(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve({ server, port: addr.port });
      else reject(new Error("Failed to get server address"));
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

const LOOP_INPUT = { path: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
const VARYING_INPUTS = [
  { path: "/different/path/1" },
  { path: "/different/path/2" },
  { path: "/different/path/3" },
  { path: "/different/path/4" },
  { path: "/different/path/5" },
];

describe("Loop prevention integration", () => {
  let mockOpenAI: { server: Server; port: number };
  let db: Database.Database;
  let app: FastifyInstance;
  let close: () => Promise<void>;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
    setSetting(db, "jwt_secret", "test-jwt-secret");
    setSetting(db, "admin_password_hash", hashPassword("admin123"));
    setSetting(db, "initialized", "true");
    setSetting(db, "proxy_enhancement", JSON.stringify({
      claude_code_enabled: false,
      tool_call_loop_enabled: true,
      stream_loop_enabled: false,
    }));

    mockOpenAI = await createMockBackend((req, res) => {
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const result = await buildApp({ db });
    app = result.app;
    close = result.close;

    const apiKeyHash = createHash("sha256").update(API_KEY).digest("hex");
    db.prepare("INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)")
      .run("rk-loop-test", "Loop Test Key", apiKeyHash, API_KEY.slice(0, 8));

    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-backend", TEST_ENCRYPTION_KEY);
    db.prepare("INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("svc-loop-test", "Mock Loop", "openai", `http://127.0.0.1:${mockOpenAI.port}`, encryptedKey, 1, now, now);
    db.prepare("INSERT INTO model_mappings (id, client_model, backend_model, provider_id, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("map-loop", "gpt-loop-test", "gpt-4", "svc-loop-test", 1, now);
    db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("mg-loop", "gpt-loop-test", "scheduled", JSON.stringify({ default: { backend_model: "gpt-4", provider_id: "svc-loop-test" } }), now);
  });

  afterEach(async () => {
    await close();
    await closeServer(mockOpenAI.server);
  });

  const authHeader: Record<string, string> = { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" };

  function toolUseBody(toolName: string, input: Record<string, unknown>, callId = "call_1") {
    return {
      model: "gpt-loop-test",
      stream: false,
      messages: [
        { role: "user", content: "do something" },
        { role: "assistant", content: [{ type: "tool_use", id: callId, name: toolName, input }] },
      ],
    };
  }

  it("passes through requests without session header", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/chat/completions",
      headers: authHeader,
      payload: toolUseBody("read_file", LOOP_INPUT),
    });
    expect(res.statusCode).toBe(200);
  });

  it("passes through initial tool calls below detection threshold", async () => {
    const headers = { ...authHeader, "x-claude-code-session-id": "sess-init" };
    // 前 2 个同工具调用：未达 minConsecutiveCount=3，直接通过
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: "POST", url: "/v1/chat/completions", headers,
        payload: toolUseBody("read_file", LOOP_INPUT, `call_init_${i}`),
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it("injects break prompt on first detection (tier 1) and continues", async () => {
    const headers = { ...authHeader, "x-claude-code-session-id": "sess-tier1" };
    // 3 次同工具调用 -> 第 3 次触发 N-gram detection
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST", url: "/v1/chat/completions", headers,
        payload: toolUseBody("read_file", LOOP_INPUT, `call_t1_${i}`),
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it("returns 422 on subsequent detection (tier 2)", async () => {
    const headers = { ...authHeader, "x-claude-code-session-id": "sess-tier2" };
    // 3 次 -> 第 3 次触发 loopCount=1 (tier 1, 注入 break prompt, 仍转发)
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: "POST", url: "/v1/chat/completions", headers, payload: toolUseBody("read_file", LOOP_INPUT, `call_t2_${i}`) });
    }
    // 第 4 次 -> loopCount=2 (tier 2, 422)
    const res = await app.inject({ method: "POST", url: "/v1/chat/completions", headers, payload: toolUseBody("read_file", LOOP_INPUT, "call_t2_3") });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error?.type).toBe("tool_call_loop_detected");
  });

  it("does not detect loop with varying tool inputs", async () => {
    const headers = { ...authHeader, "x-claude-code-session-id": "sess-noloop" };
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST", url: "/v1/chat/completions", headers,
        payload: toolUseBody("read_file", VARYING_INPUTS[i], `call_vary_${i}`),
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it("detects loop with same tool name and repetitive input", async () => {
    const headers = { ...authHeader, "x-claude-code-session-id": "sess-same" };
    // 3 次重复输入（不同 ID）-> 触发 detection
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: "POST", url: "/v1/chat/completions", headers, payload: toolUseBody("read_file", LOOP_INPUT, `call_same_${i}`) });
    }
    // 第 4 次 -> 再次触发，但这次传入不同输入不影响 detector（它看所有 history）
    const res = await app.inject({ method: "POST", url: "/v1/chat/completions", headers, payload: toolUseBody("read_file", VARYING_INPUTS[0], "call_same_4") });
    // 仍因 history 中的重复记录而触发，循环升级
    expect(res.statusCode).toBe(422);
  });

  it("does not false-positive when history reuses same tool_use ID (model switch)", async () => {
    const headers = { ...authHeader, "x-claude-code-session-id": "sess-dedup" };
    // 同一 tool_use ID 反复出现在请求历史中（模型切换、重试场景）
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST", url: "/v1/chat/completions", headers,
        payload: toolUseBody("read_file", LOOP_INPUT, "call_dedup_fixed"),
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
