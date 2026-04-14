# Tasks 4-5：OpenAI / Anthropic 代理（SSE 流式 + 模型映射）

> TDD 流程：写测试 → 运行（红灯）→ 写实现 → 运行（绿灯）→ 提交

---

## Task 4: OpenAI Chat Completion 代理

### Files

| 操作 | 路径 |
|------|------|
| Create | `src/proxy/openai.ts` |
| Create | `tests/openai-proxy.test.ts` |
| Modify | `src/index.ts` - 注册 openai 路由插件 |

### Step 4.1: 写测试 tests/openai-proxy.test.ts

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { encrypt } from "../src/utils/crypto.js";
import { openaiProxy } from "../src/proxy/openai.js";

// 测试用 32 字节密钥（64 hex chars）
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// ---------- 辅助工具 ----------

// 启动一个 mock 后端 HTTP 服务器
function createMockBackend(
  port: number,
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(port, () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// 构建测试用 Fastify app，通过 options 注入依赖
function buildTestApp(
  mockDb: Database.Database
): FastifyInstance {
  const app = Fastify();

  app.register(openaiProxy, {
    db: mockDb,
    encryptionKey: TEST_ENCRYPTION_KEY,
    streamTimeoutMs: 5000,
  });

  return app;
}

// 向测试 app 发送请求
async function sendRequest(
  app: FastifyInstance,
  body: Record<string, unknown>
) {
  return app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { "content-type": "application/json" },
    payload: body,
  });
}

// ---------- mock 数据 ----------

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

// ---------- 测试 ----------

describe("OpenAI proxy", () => {
  let app: FastifyInstance;
  let mockDb: Database.Database;

  beforeEach(() => {
    mockDb = new Database(":memory:");
    initDatabase(mockDb);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (mockDb) mockDb.close();
  });

  // 1. 非流式请求透传
  it("should proxy non-stream request and return response", async () => {
    const backendServer = await createMockBackend(19001, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
      });
    });

    // 插入 mock 后端服务
    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-openai",
        "MockOpenAI",
        "openai",
        "http://127.0.0.1:19001",
        encryptedKey,
        1,
        now,
        now
      );

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.id).toBe("chatcmpl-test");
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("Hello!");

    await closeServer(backendServer);
  });

  // 2. SSE 流式透传
  it("should proxy SSE stream request and forward chunks", async () => {
    const backendServer = await createMockBackend(19002, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
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

    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-openai",
        "MockOpenAI",
        "openai",
        "http://127.0.0.1:19002",
        encryptedKey,
        1,
        now,
        now
      );

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
    const body = response.body;
    // 验证每个 SSE chunk 都被转发
    for (const chunk of OPENAI_SSE_CHUNKS) {
      expect(body).toContain(chunk.trim());
    }
    // 验证 [DONE] 结束标记
    expect(body).toContain("data: [DONE]");

    await closeServer(backendServer);
  });

  // 3. 模型映射替换
  it("should replace model name when mapping exists", async () => {
    let receivedBody: string = "";

    const backendServer = await createMockBackend(19003, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        receivedBody = body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
      });
    });

    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-openai",
        "MockOpenAI",
        "openai",
        "http://127.0.0.1:19003",
        encryptedKey,
        1,
        now,
        now
      );

    // 插入模型映射：gpt-4 → gpt-4-turbo
    mockDb
      .prepare(
        `INSERT INTO model_mappings (id, client_model, backend_model, backend_service_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("map-1", "gpt-4", "gpt-4-turbo", "svc-openai", 1, now);

    app = buildTestApp(mockDb);
    await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    // 验证转发到后端的 body 中 model 被替换为 gpt-4-turbo
    const parsed = JSON.parse(receivedBody);
    expect(parsed.model).toBe("gpt-4-turbo");

    await closeServer(backendServer);
  });

  // 4. 模型无映射透传
  it("should keep original model when no mapping exists", async () => {
    let receivedBody: string = "";

    const backendServer = await createMockBackend(19004, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        receivedBody = body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(OPENAI_NON_STREAM_RESPONSE));
      });
    });

    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-openai",
        "MockOpenAI",
        "openai",
        "http://127.0.0.1:19004",
        encryptedKey,
        1,
        now,
        now
      );

    // 不插入映射，model 应原样透传
    app = buildTestApp(mockDb);
    await sendRequest(app, {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    });

    const parsed = JSON.parse(receivedBody);
    expect(parsed.model).toBe("gpt-4o");

    await closeServer(backendServer);
  });

  // 5. 后端不可达 - 返回 502
  it("should return 502 when backend is unreachable", async () => {
    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    // 指向一个不存在的端口
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-openai",
        "MockOpenAI",
        "openai",
        "http://127.0.0.1:19999",
        encryptedKey,
        1,
        now,
        now
      );

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.statusCode).toBe(502);
    const json = response.json();
    expect(json.error).toBeDefined();
    expect(json.error.type).toBe("upstream_error");
  });

  // 6. 后端错误透传 - 429
  it("should proxy backend error status code and body", async () => {
    const backendServer = await createMockBackend(19006, (req, res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "Rate limit exceeded",
            type: "rate_limit_error",
            code: "rate_limit_exceeded",
          },
        })
      );
    });

    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-backend-key", TEST_ENCRYPTION_KEY);
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-openai",
        "MockOpenAI",
        "openai",
        "http://127.0.0.1:19006",
        encryptedKey,
        1,
        now,
        now
      );

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.statusCode).toBe(429);
    const json = response.json();
    expect(json.error.message).toBe("Rate limit exceeded");
    expect(json.error.type).toBe("rate_limit_error");

    await closeServer(backendServer);
  });

  // 7. 无后端服务 - 返回 404
  it("should return 404 when no active backend service found", async () => {
    // 不插入任何后端服务
    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "gpt-4",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.statusCode).toBe(404);
    const json = response.json();
    expect(json.error).toBeDefined();
    expect(json.error.type).toBe("invalid_request_error");
    expect(json.error.code).toBe("model_not_found");
  });
});
```

运行测试：

```bash
npx vitest run tests/openai-proxy.test.ts
```

预期：红灯，`src/proxy/openai.ts` 不存在。

### Step 4.2: 写实现 src/proxy/openai.ts

```typescript
import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { request as httpRequestParam, IncomingMessage } from "http";
import { PassThrough } from "stream";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import {
  getActiveBackendServices,
  getModelMapping,
  insertRequestLog,
  BackendService,
} from "../db/index.js";
import { decrypt } from "../utils/crypto.js";

// ---------- 类型声明 ----------

export interface OpenaiProxyOptions {
  db: Database.Database;
  encryptionKey: string;
  streamTimeoutMs: number;
}

// ---------- 错误响应工具 ----------

function openaiError(
  message: string,
  type: string,
  code: string,
  statusCode: number
) {
  return {
    statusCode,
    body: {
      error: { message, type, code },
    },
  };
}

// ---------- 非流式代理 ----------

function proxyNonStream(
  backend: BackendService,
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}/v1/chat/completions`);
    const payload = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = httpRequestParam(options, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 502,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });

    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

// ---------- 流式代理（SSE） ----------

function proxyStream(
  backend: BackendService,
  apiKey: string,
  body: Record<string, unknown>,
  reply: any,
  timeoutMs: number
): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}/v1/chat/completions`);
    const payload = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const upstreamReq = httpRequestParam(options, (upstreamRes: IncomingMessage) => {
      const statusCode = upstreamRes.statusCode || 502;

      // 后端返回非 200 时，收集错误体后一次性返回
      if (statusCode !== 200) {
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamRes.on("end", () => {
          resolve({ statusCode });
          reply.status(statusCode).send(Buffer.concat(chunks));
        });
        return;
      }

      // SSE 透传
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const passThrough = new PassThrough();
      passThrough.pipe(reply.raw);

      let idleTimer: NodeJS.Timeout | null = null;

      function resetIdleTimer() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          passThrough.end();
          reply.raw.end();
        }, timeoutMs);
      }

      resetIdleTimer();

      upstreamRes.on("data", (chunk: Buffer) => {
        resetIdleTimer();
        passThrough.write(chunk);
      });

      upstreamRes.on("end", () => {
        if (idleTimer) clearTimeout(idleTimer);
        passThrough.end();
        reply.raw.end();
        resolve({ statusCode });
      });

      upstreamRes.on("error", (err) => {
        if (idleTimer) clearTimeout(idleTimer);
        passThrough.destroy(err);
        reject(err);
      });
    });

    upstreamReq.on("error", (err) => reject(err));
    upstreamReq.write(payload);
    upstreamReq.end();
  });
}

// ---------- Fastify 插件 ----------

export const openaiProxy: FastifyPluginCallback<OpenaiProxyOptions> = (
  app,
  options,
  done
) => {
  const { db, encryptionKey, streamTimeoutMs } = options;

  app.post("/v1/chat/completions", async (request, reply) => {
    const startTime = Date.now();
    const logId = randomUUID();

    // 1. 查找后端服务
    const backends = getActiveBackendServices(db, "openai");
    if (backends.length === 0) {
      const err = openaiError(
        "No active OpenAI backend service found",
        "invalid_request_error",
        "model_not_found",
        404
      );
      return reply.status(err.statusCode).send(err.body);
    }
    const backend = backends[0];

    // 2. 提取请求 body 中的 model
    const body = request.body as Record<string, unknown>;
    const clientModel = (body.model as string) || "unknown";

    // 3. 模型映射
    const mapping = getModelMapping(db, clientModel);
    if (mapping) {
      body.model = mapping.backend_model;
    }

    // 4. 解密 API Key
    const apiKey = decrypt(backend.api_key, encryptionKey);

    const isStream = body.stream === true;

    try {
      if (isStream) {
        // 流式代理
        const result = await proxyStream(
          backend,
          apiKey,
          body,
          reply,
          streamTimeoutMs
        );

        // 记录日志
        insertRequestLog(db, {
          id: logId,
          api_type: "openai",
          model: clientModel,
          backend_service_id: backend.id,
          status_code: result.statusCode,
          latency_ms: Date.now() - startTime,
          is_stream: 1,
          error_message: null,
          created_at: new Date().toISOString(),
        });

        return reply;
      } else {
        // 非流式代理
        const result = await proxyNonStream(backend, apiKey, body);

        insertRequestLog(db, {
          id: logId,
          api_type: "openai",
          model: clientModel,
          backend_service_id: backend.id,
          status_code: result.statusCode,
          latency_ms: Date.now() - startTime,
          is_stream: 0,
          error_message: null,
          created_at: new Date().toISOString(),
        });

        return reply.status(result.statusCode).send(result.body);
      }
    } catch (err: any) {
      // 后端不可达等网络错误
      insertRequestLog(db, {
        id: logId,
        api_type: "openai",
        model: clientModel,
        backend_service_id: backend.id,
        status_code: 502,
        latency_ms: Date.now() - startTime,
        is_stream: isStream ? 1 : 0,
        error_message: err.message || "Upstream connection failed",
        created_at: new Date().toISOString(),
      });

      const errorResp = openaiError(
        "Failed to connect to upstream service",
        "upstream_error",
        "upstream_connection_failed",
        502
      );
      return reply.status(502).send(errorResp.body);
    }
  });

  done();
};
```

运行测试：

```bash
npx vitest run tests/openai-proxy.test.ts
```

预期：绿灯，7 个测试通过。

### Step 4.3: 修改 src/index.ts 注册 openai 路由

在 Task 1 创建的 `src/index.ts` 中，添加 openai 代理插件的注册。修改后的完整文件：

```typescript
import Fastify from "fastify";
import { getConfig } from "./config.js";
import { authMiddleware } from "./middleware/auth.js";
import { openaiProxy } from "./proxy/openai.js";

async function main() {
  const config = getConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  // 注册认证中间件
  app.register(authMiddleware, { apiKey: config.ROUTER_API_KEY });

  // 注册路由
  app.get("/health", async () => {
    return { status: "ok" };
  });

  // TODO: Task 6 中注入 db、encryptionKey、streamTimeoutMs via options
  // 注册 OpenAI 代理路由
  app.register(openaiProxy, {
    db: /* Task 6 注入 */ null as any,
    encryptionKey: config.ENCRYPTION_KEY,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
  });

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`Server listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
```

注意：`src/index.ts` 的完整改造（注入 db、config 等）属于 Task 6 的范围。当前步骤仅确认 `openaiProxy` 能正确注册。

### Step 4.4: 运行全部测试确认无回归

```bash
npx vitest run
```

预期：全部绿灯（之前 25 + openai 7 = 32 个测试）。

### Step 4.5: 提交

```bash
git add src/proxy/openai.ts tests/openai-proxy.test.ts src/index.ts
git commit -m "feat: OpenAI chat completion proxy with SSE streaming and model mapping"
```

---

## Task 5: Anthropic Messages 代理

### Files

| 操作 | 路径 |
|------|------|
| Create | `src/proxy/anthropic.ts` |
| Create | `tests/anthropic-proxy.test.ts` |
| Modify | `src/index.ts` - 注册 anthropic 路由插件 |

### Step 5.1: 写测试 tests/anthropic-proxy.test.ts

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { encrypt } from "../src/utils/crypto.js";
import { anthropicProxy } from "../src/proxy/anthropic.js";

// 测试用 32 字节密钥（64 hex chars）
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// ---------- 辅助工具 ----------

function createMockBackend(
  port: number,
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(port, () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function buildTestApp(mockDb: Database.Database): FastifyInstance {
  const app = Fastify();

  app.register(anthropicProxy, {
    db: mockDb,
    encryptionKey: TEST_ENCRYPTION_KEY,
    streamTimeoutMs: 5000,
  });

  return app;
}

async function sendRequest(
  app: FastifyInstance,
  body: Record<string, unknown>
) {
  return app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { "content-type": "application/json" },
    payload: body,
  });
}

// ---------- mock 数据 ----------

const ANTHROPIC_NON_STREAM_RESPONSE = {
  id: "msg_test",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "Hello!" }],
  model: "claude-3-opus-20240229",
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 2 },
};

const ANTHROPIC_SSE_EVENTS = [
  { event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", content: [] } }) },
  { event: "content_block_start", data: JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) },
  { event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }) },
  { event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "!" } }) },
  { event: "content_block_stop", data: JSON.stringify({ type: "content_block_stop", index: 0 }) },
  { event: "message_stop", data: JSON.stringify({ type: "message_stop" }) },
];

function formatSSE(events: { event: string; data: string }[]): string {
  return events
    .map((e) => `event: ${e.event}\ndata: ${e.data}\n\n`)
    .join("");
}

// ---------- 测试 ----------

describe("Anthropic proxy", () => {
  let app: FastifyInstance;
  let mockDb: Database.Database;

  beforeEach(() => {
    mockDb = new Database(":memory:");
    initDatabase(mockDb);
  });

  afterEach(async () => {
    if (app) await app.close();
    if (mockDb) mockDb.close();
  });

  // 1. 非流式请求透传
  it("should proxy non-stream request and return response", async () => {
    const backendServer = await createMockBackend(19101, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(ANTHROPIC_NON_STREAM_RESPONSE));
      });
    });

    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-ant-backend-key", TEST_ENCRYPTION_KEY);
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-anthropic",
        "MockAnthropic",
        "anthropic",
        "http://127.0.0.1:19101",
        encryptedKey,
        1,
        now,
        now
      );

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "claude-3-opus-20240229",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.id).toBe("msg_test");
    expect(json.type).toBe("message");
    expect(json.content[0].text).toBe("Hello!");

    await closeServer(backendServer);
  });

  // 2. SSE 流式透传（Anthropic 格式带 event: 行）
  it("should proxy SSE stream request and forward Anthropic events", async () => {
    const sseBody = formatSSE(ANTHROPIC_SSE_EVENTS);

    const backendServer = await createMockBackend(19102, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(sseBody);
        res.end();
      });
    });

    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-ant-backend-key", TEST_ENCRYPTION_KEY);
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-anthropic",
        "MockAnthropic",
        "anthropic",
        "http://127.0.0.1:19102",
        encryptedKey,
        1,
        now,
        now
      );

    app = buildTestApp(mockDb);
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: {
        model: "claude-3-opus-20240229",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1024,
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const responseBody = response.body;

    // 验证每个 SSE event 都被转发
    for (const evt of ANTHROPIC_SSE_EVENTS) {
      expect(responseBody).toContain(`event: ${evt.event}`);
      expect(responseBody).toContain(`data: ${evt.data}`);
    }

    await closeServer(backendServer);
  });

  // 3. 模型映射替换
  it("should replace model name when mapping exists", async () => {
    let receivedBody: string = "";

    const backendServer = await createMockBackend(19103, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        receivedBody = body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(ANTHROPIC_NON_STREAM_RESPONSE));
      });
    });

    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-ant-backend-key", TEST_ENCRYPTION_KEY);
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-anthropic",
        "MockAnthropic",
        "anthropic",
        "http://127.0.0.1:19103",
        encryptedKey,
        1,
        now,
        now
      );

    // 映射：claude-3 → claude-3-opus-20240229
    mockDb
      .prepare(
        `INSERT INTO model_mappings (id, client_model, backend_model, backend_service_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("map-a1", "claude-3", "claude-3-opus-20240229", "svc-anthropic", 1, now);

    app = buildTestApp(mockDb);
    await sendRequest(app, {
      model: "claude-3",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    const parsed = JSON.parse(receivedBody);
    expect(parsed.model).toBe("claude-3-opus-20240229");

    await closeServer(backendServer);
  });

  // 4. 模型无映射透传
  it("should keep original model when no mapping exists", async () => {
    let receivedBody: string = "";

    const backendServer = await createMockBackend(19104, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        receivedBody = body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(ANTHROPIC_NON_STREAM_RESPONSE));
      });
    });

    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-ant-backend-key", TEST_ENCRYPTION_KEY);
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-anthropic",
        "MockAnthropic",
        "anthropic",
        "http://127.0.0.1:19104",
        encryptedKey,
        1,
        now,
        now
      );

    // 不插入映射
    app = buildTestApp(mockDb);
    await sendRequest(app, {
      model: "claude-3-sonnet-20240229",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    const parsed = JSON.parse(receivedBody);
    expect(parsed.model).toBe("claude-3-sonnet-20240229");

    await closeServer(backendServer);
  });

  // 5. 后端不可达 - 502
  it("should return 502 when backend is unreachable", async () => {
    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-ant-backend-key", TEST_ENCRYPTION_KEY);
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-anthropic",
        "MockAnthropic",
        "anthropic",
        "http://127.0.0.1:19999",
        encryptedKey,
        1,
        now,
        now
      );

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "claude-3-opus-20240229",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    expect(response.statusCode).toBe(502);
    const json = response.json();
    expect(json.error).toBeDefined();
    expect(json.error.type).toBe("upstream_error");
  });

  // 6. 后端错误透传 - Anthropic 错误格式
  it("should proxy backend error status code and body", async () => {
    const backendServer = await createMockBackend(19106, (req, res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "rate_limit_error",
            message: "This request would exceed the rate limit.",
          },
        })
      );
    });

    const now = new Date().toISOString();
    const encryptedKey = encrypt("sk-ant-backend-key", TEST_ENCRYPTION_KEY);
    mockDb
      .prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "svc-anthropic",
        "MockAnthropic",
        "anthropic",
        "http://127.0.0.1:19106",
        encryptedKey,
        1,
        now,
        now
      );

    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "claude-3-opus-20240229",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    expect(response.statusCode).toBe(429);
    const json = response.json();
    expect(json.type).toBe("error");
    expect(json.error.type).toBe("rate_limit_error");
    expect(json.error.message).toContain("rate limit");

    await closeServer(backendServer);
  });

  // 7. 无后端服务 - 404
  it("should return 404 when no active backend service found", async () => {
    // 不插入任何后端服务
    app = buildTestApp(mockDb);
    const response = await sendRequest(app, {
      model: "claude-3-opus-20240229",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1024,
    });

    expect(response.statusCode).toBe(404);
    const json = response.json();
    expect(json.type).toBe("error");
    expect(json.error.type).toBe("invalid_request_error");
  });
});
```

运行测试：

```bash
npx vitest run tests/anthropic-proxy.test.ts
```

预期：红灯，`src/proxy/anthropic.ts` 不存在。

### Step 5.2: 写实现 src/proxy/anthropic.ts

```typescript
import { FastifyInstance, FastifyPluginCallback } from "fastify";
import { request as httpRequestParam, IncomingMessage } from "http";
import { PassThrough } from "stream";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import {
  getActiveBackendServices,
  getModelMapping,
  insertRequestLog,
  BackendService,
} from "../db/index.js";
import { decrypt } from "../utils/crypto.js";

// ---------- 类型声明 ----------

export interface AnthropicProxyOptions {
  db: Database.Database;
  encryptionKey: string;
  streamTimeoutMs: number;
}

// ---------- 错误响应工具（Anthropic 格式） ----------

function anthropicError(
  message: string,
  type: string,
  statusCode: number
) {
  return {
    statusCode,
    body: {
      type: "error",
      error: { type, message },
    },
  };
}

// ---------- 非流式代理 ----------

function proxyNonStream(
  backend: BackendService,
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}/v1/messages`);
    const payload = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = httpRequestParam(options, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 502,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });

    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

// ---------- 流式代理（SSE） ----------

function proxyStream(
  backend: BackendService,
  apiKey: string,
  body: Record<string, unknown>,
  reply: any,
  timeoutMs: number
): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}/v1/messages`);
    const payload = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const upstreamReq = httpRequestParam(options, (upstreamRes: IncomingMessage) => {
      const statusCode = upstreamRes.statusCode || 502;

      // 后端返回非 200 时，收集错误体
      if (statusCode !== 200) {
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamRes.on("end", () => {
          resolve({ statusCode });
          reply.status(statusCode).send(Buffer.concat(chunks));
        });
        return;
      }

      // SSE 透传
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const passThrough = new PassThrough();
      passThrough.pipe(reply.raw);

      let idleTimer: NodeJS.Timeout | null = null;

      function resetIdleTimer() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          passThrough.end();
          reply.raw.end();
        }, timeoutMs);
      }

      resetIdleTimer();

      upstreamRes.on("data", (chunk: Buffer) => {
        resetIdleTimer();
        passThrough.write(chunk);
      });

      upstreamRes.on("end", () => {
        if (idleTimer) clearTimeout(idleTimer);
        passThrough.end();
        reply.raw.end();
        resolve({ statusCode });
      });

      upstreamRes.on("error", (err) => {
        if (idleTimer) clearTimeout(idleTimer);
        passThrough.destroy(err);
        reject(err);
      });
    });

    upstreamReq.on("error", (err) => reject(err));
    upstreamReq.write(payload);
    upstreamReq.end();
  });
}

// ---------- Fastify 插件 ----------

export const anthropicProxy: FastifyPluginCallback<AnthropicProxyOptions> = (
  app,
  options,
  done
) => {
  const { db, encryptionKey, streamTimeoutMs } = options;

  app.post("/v1/messages", async (request, reply) => {
    const startTime = Date.now();
    const logId = randomUUID();

    // 1. 查找后端服务
    const backends = getActiveBackendServices(db, "anthropic");
    if (backends.length === 0) {
      const err = anthropicError(
        "No active Anthropic backend service found",
        "invalid_request_error",
        404
      );
      return reply.status(err.statusCode).send(err.body);
    }
    const backend = backends[0];

    // 2. 提取请求 body 中的 model
    const body = request.body as Record<string, unknown>;
    const clientModel = (body.model as string) || "unknown";

    // 3. 模型映射
    const mapping = getModelMapping(db, clientModel);
    if (mapping) {
      body.model = mapping.backend_model;
    }

    // 4. 解密 API Key
    const apiKey = decrypt(backend.api_key, encryptionKey);

    const isStream = body.stream === true;

    try {
      if (isStream) {
        // 流式代理
        const result = await proxyStream(
          backend,
          apiKey,
          body,
          reply,
          streamTimeoutMs
        );

        insertRequestLog(db, {
          id: logId,
          api_type: "anthropic",
          model: clientModel,
          backend_service_id: backend.id,
          status_code: result.statusCode,
          latency_ms: Date.now() - startTime,
          is_stream: 1,
          error_message: null,
          created_at: new Date().toISOString(),
        });

        return reply;
      } else {
        // 非流式代理
        const result = await proxyNonStream(backend, apiKey, body);

        insertRequestLog(db, {
          id: logId,
          api_type: "anthropic",
          model: clientModel,
          backend_service_id: backend.id,
          status_code: result.statusCode,
          latency_ms: Date.now() - startTime,
          is_stream: 0,
          error_message: null,
          created_at: new Date().toISOString(),
        });

        return reply.status(result.statusCode).send(result.body);
      }
    } catch (err: any) {
      insertRequestLog(db, {
        id: logId,
        api_type: "anthropic",
        model: clientModel,
        backend_service_id: backend.id,
        status_code: 502,
        latency_ms: Date.now() - startTime,
        is_stream: isStream ? 1 : 0,
        error_message: err.message || "Upstream connection failed",
        created_at: new Date().toISOString(),
      });

      const errorResp = anthropicError(
        "Failed to connect to upstream service",
        "upstream_error",
        502
      );
      return reply.status(502).send(errorResp.body);
    }
  });

  done();
};
```

运行测试：

```bash
npx vitest run tests/anthropic-proxy.test.ts
```

预期：绿灯，7 个测试通过。

### Step 5.3: 修改 src/index.ts 注册 anthropic 路由

在 Step 4.3 修改的基础上，添加 anthropic 代理插件。修改后的完整文件：

```typescript
import Fastify from "fastify";
import { getConfig } from "./config.js";
import { authMiddleware } from "./middleware/auth.js";
import { openaiProxy } from "./proxy/openai.js";
import { anthropicProxy } from "./proxy/anthropic.js";

async function main() {
  const config = getConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  // 注册认证中间件
  app.register(authMiddleware, { apiKey: config.ROUTER_API_KEY });

  // 注册路由
  app.get("/health", async () => {
    return { status: "ok" };
  });

  // TODO: Task 6 中注入 db、encryptionKey、streamTimeoutMs via options
  app.register(openaiProxy, {
    db: /* Task 6 注入 */ null as any,
    encryptionKey: config.ENCRYPTION_KEY,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
  });
  app.register(anthropicProxy, {
    db: /* Task 6 注入 */ null as any,
    encryptionKey: config.ENCRYPTION_KEY,
    streamTimeoutMs: config.STREAM_TIMEOUT_MS,
  });

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`Server listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
```

### Step 5.4: 运行全部测试确认无回归

```bash
npx vitest run
```

预期：全部绿灯（之前 32 + anthropic 7 = 39 个测试）。

### Step 5.5: 提交

```bash
git add src/proxy/anthropic.ts tests/anthropic-proxy.test.ts src/index.ts
git commit -m "feat: Anthropic messages proxy with SSE streaming and model mapping"
```

---

## Task 4-5 要点说明

### 两个代理的核心差异

| 维度 | OpenAI 代理 | Anthropic 代理 |
|------|-------------|----------------|
| 路由 | `POST /v1/chat/completions` | `POST /v1/messages` |
| 后端类型 | `getActiveBackendServices(db, 'openai')` | `getActiveBackendServices(db, 'anthropic')` |
| 认证头 | `Authorization: Bearer ${key}` | `x-api-key: ${key}` + `anthropic-version: 2023-06-01` |
| SSE 结束标记 | 后端自行发 `data: [DONE]\n\n`，代理仅透传 | 无 `[DONE]`，后端用 `event: message_stop` 结束 |
| 错误格式 | `{ error: { message, type, code } }` | `{ type: "error", error: { type, message } }` |
| 日志 api_type | `"openai"` | `"anthropic"` |

### 流式代理的共同设计

两者共用相同的流式代理模式：

1. 使用 Node.js `http.request` 建立到后端的长连接
2. 通过 `PassThrough` stream 将后端 chunk 逐个 pipe 到 `reply.raw`
3. 设置空闲超时（`STREAM_TIMEOUT_MS`），超时后主动关闭连接
4. 后端返回非 200 时退化为一次性响应模式

### Task 6 后续工作

- 将 `db`、`encryptionKey`、`streamTimeoutMs` 通过插件 options 传入（不再使用 `app.decorate`）
- 实现 `/v1/models` 代理
- 完善日志记录（记录请求体大小、token 数等）
