# Tasks 6-8：/v1/models 代理 + 请求日志、集成测试、Docker 构建

> TDD 流程：写测试 → 运行（红灯）→ 写实现 → 运行（绿灯）→ 提交

---

## Task 6: /v1/models 代理 + 请求日志

### Files

| 操作 | 路径 |
|------|------|
| Modify | `src/proxy/openai.ts` |
| Modify | `src/proxy/anthropic.ts` |
| Create | `tests/models-proxy.test.ts` |
| Create | `tests/logging.test.ts` |

### 前置条件

Task 4-5 完成后，`src/proxy/openai.ts` 和 `src/proxy/anthropic.ts` 已存在，包含：
- OpenAI: POST /v1/chat/completions 代理（含 SSE + 模型映射）
- Anthropic: POST /v1/messages 代理（含 SSE + 模型映射）
- 两者都使用 `getActiveBackendServices(db, apiType)` 查找后端
- 两者都使用 `getModelMapping(db, model)` 做模型映射
- 两者都使用 `decrypt(encryptedKey, encryptionKey)` 解密后端 API Key

`src/db/index.ts` 中已导出 `insertRequestLog(db, log)` 函数。

### Step 6.1: 写测试 tests/models-proxy.test.ts

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { openaiProxy } from "../src/proxy/openai.js";

const API_KEY = "sk-test-router";
const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// 模拟后端服务器
let mockServer: Fastify.FastifyInstance;
let mockPort: number;

async function startMockServer() {
  mockServer = Fastify();

  mockServer.get("/v1/models", async () => {
    return {
      object: "list",
      data: [
        { id: "gpt-4", object: "model", created: 1687882411, owned_by: "openai" },
        { id: "gpt-3.5-turbo", object: "model", created: 1677610602, owned_by: "openai" },
      ],
    };
  });

  mockPort = await mockServer.listen({ port: 0, host: "127.0.0.1" });
  // 从地址中提取端口号
  const addr = mockServer.addresses()[0];
  mockPort = (addr as any).port;
}

describe("GET /v1/models proxy", () => {
  let app: Fastify.FastifyInstance;
  let db: Database.Database;

  beforeEach(async () => {
    await startMockServer();

    db = new Database(":memory:");
    initDatabase(db);

    app = Fastify();
    await app.register(openaiProxy, { db, encryptionKey: ENCRYPTION_KEY });
  });

  afterEach(async () => {
    await app.close();
    await mockServer.close();
    db.close();
  });

  function insertBackendService(overrides: Record<string, any> = {}) {
    const now = new Date().toISOString();
    const defaults = {
      id: "svc-openai-1",
      name: "Mock OpenAI",
      api_type: "openai",
      base_url: `http://127.0.0.1:${mockPort}`,
      api_key: "sk-backend-key",
      is_active: 1,
      created_at: now,
      updated_at: now,
    };
    const row = { ...defaults, ...overrides };
    db.prepare(
      `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(row.id, row.name, row.api_type, row.base_url, row.api_key, row.is_active, row.created_at, row.updated_at);
  }

  it("should proxy GET /v1/models to backend and return JSON response", async () => {
    insertBackendService();

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("gpt-4");
    expect(body.data[1].id).toBe("gpt-3.5-turbo");
  });

  it("should return 404 when no active openai backend exists", async () => {
    // 不插入任何后端服务
    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("No active OpenAI backend");
  });

  it("should return 502 when backend is unreachable", async () => {
    // 插入一个指向不可达地址的后端
    insertBackendService({ base_url: "http://127.0.0.1:1" });

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    expect(response.statusCode).toBe(502);
    const body = response.json();
    expect(body.error).toBeDefined();
  });

  it("should not use inactive backend services", async () => {
    insertBackendService({ is_active: 0 });

    const response = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${API_KEY}` },
    });

    expect(response.statusCode).toBe(404);
  });
});
```

运行测试：

```bash
npx vitest run tests/models-proxy.test.ts
```

预期：红灯，GET /v1/models 路由尚不存在。

### Step 6.2: 在 src/proxy/openai.ts 中添加 GET /v1/models 路由

> 注意：以下代码需要整合到 Task 4 完成的 `openaiProxy` 插件中。这里给出需要**新增**的路由处理器代码，假定 openaiProxy 是一个 Fastify 插件函数。

在 `src/proxy/openai.ts` 的 openaiProxy 插件中，新增以下路由：

```typescript
// GET /v1/models - 透传到 OpenAI 后端的模型列表
app.get("/v1/models", async (request, reply) => {
  const backends = getActiveBackendServices(db, "openai");
  if (backends.length === 0) {
    return reply.status(404).send({
      error: {
        message: "No active OpenAI backend service configured",
        type: "invalid_request_error",
        code: "no_backend",
      },
    });
  }

  const backend = backends[0];
  const apiKey = decrypt(backend.api_key, encryptionKey);

  try {
    const upstreamUrl = `${backend.base_url}/v1/models`;
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    const body = await upstreamResponse.json();
    return reply.status(upstreamResponse.status).send(body);
  } catch (err: any) {
    request.log.error({ err }, "Failed to reach OpenAI backend for /v1/models");
    return reply.status(502).send({
      error: {
        message: "Failed to reach backend service",
        type: "server_error",
        code: "upstream_error",
      },
    });
  }
});
```

运行测试：

```bash
npx vitest run tests/models-proxy.test.ts
```

预期：绿灯，4 个测试通过。

### Step 6.3: 写测试 tests/logging.test.ts

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { openaiProxy } from "../src/proxy/openai.js";
import { anthropicProxy } from "../src/proxy/anthropic.js";
import { authMiddleware } from "../src/middleware/auth.js";

const API_KEY = "sk-test-router";
const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createApp() {
  const db = new Database(":memory:");
  initDatabase(db);

  const app = Fastify();
  app.register(authMiddleware, { apiKey: API_KEY });
  app.register(openaiProxy, { db, encryptionKey: ENCRYPTION_KEY });
  app.register(anthropicProxy, { db, encryptionKey: ENCRYPTION_KEY });

  return { app, db };
}

function insertOpenAIBackend(db: Database.Database, port: number) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("svc-o1", "Mock OpenAI", "openai", `http://127.0.0.1:${port}`, "sk-backend", 1, now, now);
}

function insertAnthropicBackend(db: Database.Database, port: number) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("svc-a1", "Mock Anthropic", "anthropic", `http://127.0.0.1:${port}`, "sk-backend", 1, now, now);
}

function getRequestLogs(db: Database.Database) {
  return db.prepare("SELECT * FROM request_logs ORDER BY created_at").all() as any[];
}

describe("Request logging", () => {
  let mockServer: Fastify.FastifyInstance;
  let mockPort: number;

  beforeEach(async () => {
    // 启动模拟后端
    mockServer = Fastify();

    mockServer.post("/v1/chat/completions", async (req) => {
      const body = req.body as any;
      if (body.stream) {
        return mockServer.reply.status(200)
          .header("Content-Type", "text/event-stream")
          .send("data: {\"id\":\"chatcmpl-1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\ndata: [DONE]\n\n");
      }
      return {
        id: "chatcmpl-1",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "Hello" } }],
        model: body.model,
      };
    });

    mockServer.post("/v1/messages", async (req) => {
      const body = req.body as any;
      if (body.stream) {
        return mockServer.reply.status(200)
          .header("Content-Type", "text/event-stream")
          .send("event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg-1\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
      }
      return {
        id: "msg-1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello from Claude" }],
        model: body.model,
      };
    });

    await mockServer.listen({ port: 0, host: "127.0.0.1" });
    const addr = mockServer.addresses()[0];
    mockPort = (addr as any).port;
  });

  afterEach(async () => {
    await mockServer.close();
  });

  it("should log successful OpenAI non-stream request to DB", async () => {
    const { app, db } = createApp();
    try {
      insertOpenAIBackend(db, mockPort);

      await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json",
        },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      });

      const logs = getRequestLogs(db);
      expect(logs.length).toBe(1);
      expect(logs[0].api_type).toBe("openai");
      expect(logs[0].model).toBe("gpt-4");
      expect(logs[0].backend_service_id).toBe("svc-o1");
      expect(logs[0].status_code).toBe(200);
      expect(logs[0].latency_ms).toBeGreaterThanOrEqual(0);
      expect(logs[0].is_stream).toBe(0);
      expect(logs[0].error_message).toBeNull();
    } finally {
      await app.close();
      db.close();
    }
  });

  it("should log failed request (backend error) to DB", async () => {
    const { app, db } = createApp();
    try {
      // 指向不可达的后端
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run("svc-bad", "Bad Backend", "openai", "http://127.0.0.1:1", "sk-key", 1, now, now);

      await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json",
        },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      });

      const logs = getRequestLogs(db);
      expect(logs.length).toBe(1);
      expect(logs[0].status_code).toBe(502);
      expect(logs[0].error_message).toBeTruthy();
    } finally {
      await app.close();
      db.close();
    }
  });

  it("should mark stream requests with is_stream=1", async () => {
    const { app, db } = createApp();
    try {
      insertOpenAIBackend(db, mockPort);

      await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json",
        },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        },
      });

      const logs = getRequestLogs(db);
      expect(logs.length).toBe(1);
      expect(logs[0].is_stream).toBe(1);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("should record correct latency_ms", async () => {
    const { app, db } = createApp();
    try {
      insertOpenAIBackend(db, mockPort);

      await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json",
        },
        payload: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hi" }],
        },
      });

      const logs = getRequestLogs(db);
      expect(logs[0].latency_ms).toBeGreaterThanOrEqual(0);
      // latency 应该是合理的值（小于 10 秒）
      expect(logs[0].latency_ms).toBeLessThan(10000);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("should log Anthropic requests with correct api_type", async () => {
    const { app, db } = createApp();
    try {
      insertAnthropicBackend(db, mockPort);

      await app.inject({
        method: "POST",
        url: "/v1/messages",
        headers: {
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        payload: {
          model: "claude-3-sonnet",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 100,
        },
      });

      const logs = getRequestLogs(db);
      expect(logs.length).toBe(1);
      expect(logs[0].api_type).toBe("anthropic");
      expect(logs[0].model).toBe("claude-3-sonnet");
    } finally {
      await app.close();
      db.close();
    }
  });
});
```

运行测试：

```bash
npx vitest run tests/logging.test.ts
```

预期：红灯，日志记录逻辑尚未实现。

### Step 6.4: 验证日志记录功能

Task 4-5 的 `openaiProxy` 和 `anthropicProxy` 实现中已包含 `insertRequestLog` 日志记录逻辑（在 POST /v1/chat/completions 和 POST /v1/messages 的 try/finally 块中）。Step 6.2 新增的 GET /v1/models 路由也需要包含相同的日志记录模式。

本步骤无需修改 `src/proxy/openai.ts` 或 `src/proxy/anthropic.ts`，只需运行 logging 测试来验证日志功能正常工作：

```bash
npx vitest run tests/logging.test.ts
```

预期：绿灯，5 个测试通过。

如果测试失败，需要回到 Task 4-5 的代理模块中检查 `insertRequestLog` 调用是否正确集成到了 try/finally 块中。

### Step 6.5: 运行全部测试确认无回归

```bash
npx vitest run
```

预期：全部绿灯。

### Step 6.6: 提交

```bash
git add src/proxy/openai.ts src/proxy/anthropic.ts tests/models-proxy.test.ts tests/logging.test.ts
git commit -m "feat: /v1/models proxy and async request logging for all proxy routes"
```

---

## Task 7: 集成测试

### Files

| 操作 | 路径 |
|------|------|
| Modify | `src/index.ts` |
| Create | `tests/integration.test.ts` |

### Step 7.1: 重构 src/index.ts，提取 buildApp()

将 `src/index.ts` 中的 Fastify 应用创建逻辑提取为可导出的 `buildApp()` 函数。这样测试代码可以直接调用 `buildApp()` 创建应用实例并注入测试配置，而不需要启动真实的 HTTP 服务器。

```typescript
import Fastify, { FastifyInstance } from "fastify";
import { getConfig, Config } from "./config.js";
import { initDatabase } from "./db/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { openaiProxy } from "./proxy/openai.js";
import { anthropicProxy } from "./proxy/anthropic.js";
import Database from "better-sqlite3";

export interface AppOptions {
  config: Config;
  db?: Database.Database;
}

export async function buildApp(options?: Partial<AppOptions>): Promise<{
  app: FastifyInstance;
  db: Database.Database;
  close: () => Promise<void>;
}> {
  const config = options?.config ?? getConfig();

  // 允许外部传入已初始化的 DB（测试用），否则自行创建
  const db = options?.db ?? new Database(config.DB_PATH);
  initDatabase(db);

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  // 注册中间件和路由
  app.register(authMiddleware, { apiKey: config.ROUTER_API_KEY });
  app.register(openaiProxy, { db, encryptionKey: config.ENCRYPTION_KEY });
  app.register(anthropicProxy, { db, encryptionKey: config.ENCRYPTION_KEY });

  // /health 端点不需要认证（auth 中间件已跳过）
  app.get("/health", async () => {
    return { status: "ok" };
  });

  return {
    app,
    db,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

async function main() {
  const { app } = await buildApp();
  const config = getConfig();

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`Server listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// 直接运行时启动服务器，被 import 时不启动
const isMainModule = process.argv[1]?.endsWith("index.js");
if (isMainModule) {
  main();
}
```

> 注意：`src/index.ts` 原有逻辑需要按上述方式重构。如果 Task 1 中创建的 `src/index.ts` 与上述结构有差异，以 Task 7 的版本为准进行替换。

**补充说明：initDatabase 目录自动创建**

`config.ts` 默认 `DB_PATH` 为 `./data/router.db`，但 `./data/` 目录不会自动创建。需要在 `src/db/index.ts` 的 `initDatabase` 函数开头添加目录创建逻辑（针对非 `:memory:` 数据库）：

```typescript
import { mkdirSync, dirname } from "fs";

export function initDatabase(db: Database.Database, dbPath?: string): void {
  // 确保数据库文件所在目录存在（仅对文件数据库生效）
  if (dbPath && dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  // ... 后续 migrations 逻辑不变 ...
}
```

同时在 `buildApp` 中调用 `initDatabase` 时传入 `dbPath`：

```typescript
const db = options?.db ?? new Database(config.DB_PATH);
initDatabase(db, options?.db ? undefined : config.DB_PATH);
```

这样当 `buildApp` 自行创建文件数据库时，目录会自动创建；外部传入的测试用内存数据库则跳过目录创建。

验证重构后服务器仍可正常启动：

```bash
ROUTER_API_KEY=sk-test ADMIN_PASSWORD=pw ENCRYPTION_KEY=$(printf 'a%.0s' {1..64}) npx tsx src/index.ts &
sleep 2
curl http://localhost:3000/health
# 预期: {"status":"ok"}
kill %1
```

### Step 7.2: 写测试 tests/integration.test.ts

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { buildApp } from "../src/index.js";
import { getConfig, resetConfig } from "../src/config.js";

const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeTestConfig(overrides: Record<string, any> = {}) {
  return {
    ROUTER_API_KEY: "sk-integration-test",
    ADMIN_PASSWORD: "admin123",
    ENCRYPTION_KEY,
    PORT: 3000,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent",
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
    ...overrides,
  };
}

// 创建模拟后端服务器
async function createMockBackend(handlers: {
  chatCompletions?: (body: any) => any;
  messages?: (body: any) => any;
  models?: () => any;
}) {
  const server = Fastify();

  if (handlers.chatCompletions) {
    server.post("/v1/chat/completions", async (req) => {
      return handlers.chatCompletions!(req.body as any);
    });
  }

  if (handlers.messages) {
    server.post("/v1/messages", async (req) => {
      return handlers.messages!(req.body as any);
    });
  }

  if (handlers.models) {
    server.get("/v1/models", async () => {
      return handlers.models!();
    });
  }

  await server.listen({ port: 0, host: "127.0.0.1" });
  const addr = server.addresses()[0];
  const port = (addr as any).port;
  return { server, port };
}

describe("Integration tests", () => {
  let mockOpenAI: { server: Fastify.FastifyInstance; port: number };
  let mockAnthropic: { server: Fastify.FastifyInstance; port: number };
  let db: Database.Database;
  let app: Fastify.FastifyInstance;
  let close: () => Promise<void>;

  beforeEach(async () => {
    // 设置配置
    resetConfig();
    process.env.ROUTER_API_KEY = "sk-integration-test";
    process.env.ADMIN_PASSWORD = "admin123";
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
    process.env.LOG_LEVEL = "silent";

    // 创建内存数据库
    db = new Database(":memory:");

    // 启动模拟后端
    mockOpenAI = await createMockBackend({
      chatCompletions: (body) => {
        if (body.stream) {
          return {
            statusCode: 200,
            headers: { "Content-Type": "text/event-stream" },
            body: "data: {\"id\":\"chatcmpl-1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: {\"id\":\"chatcmpl-1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\ndata: [DONE]\n\n",
          };
        }
        return {
          id: "chatcmpl-1",
          object: "chat.completion",
          choices: [
            { index: 0, message: { role: "assistant", content: "Hello! How can I help?" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: body.model,
        };
      },
      models: () => ({
        object: "list",
        data: [
          { id: "gpt-4", object: "model", created: 1687882411, owned_by: "openai" },
          { id: "gpt-3.5-turbo", object: "model", created: 1677610602, owned_by: "openai" },
        ],
      }),
    });

    mockAnthropic = await createMockBackend({
      messages: (body) => {
        if (body.stream) {
          return {
            statusCode: 200,
            headers: { "Content-Type": "text/event-stream" },
            body: "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg-1\",\"role\":\"assistant\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
          };
        }
        return {
          id: "msg-1",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Hello from Claude" }],
          model: body.model,
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    });

    const config = makeTestConfig();
    const result = await buildApp({ config, db });
    app = result.app;
    close = result.close;

    // 插入后端服务配置
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("svc-openai", "Mock OpenAI", "openai", `http://127.0.0.1:${mockOpenAI.port}`, "sk-backend-key", 1, now, now);

    db.prepare(
      `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("svc-anthropic", "Mock Anthropic", "anthropic", `http://127.0.0.1:${mockAnthropic.port}`, "sk-backend-key", 1, now, now);
  });

  afterEach(async () => {
    await close();
    await mockOpenAI.server.close();
    await mockAnthropic.server.close();
    // 清理环境变量
    delete process.env.ROUTER_API_KEY;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.LOG_LEVEL;
  });

  const AUTH_HEADER = { authorization: "Bearer sk-integration-test" };

  it("should complete full OpenAI non-stream flow", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe("chatcmpl-1");
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("Hello! How can I help?");

    // 验证日志记录
    const logs = db.prepare("SELECT * FROM request_logs").all() as any[];
    expect(logs.length).toBe(1);
    expect(logs[0].api_type).toBe("openai");
    expect(logs[0].model).toBe("gpt-4");
    expect(logs[0].status_code).toBe(200);
    expect(logs[0].is_stream).toBe(0);
  });

  it("should complete full OpenAI stream flow", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.body;
    // 验证 SSE 格式
    expect(body).toContain("data:");
    expect(body).toContain("[DONE]");

    // 验证日志记录
    const logs = db.prepare("SELECT * FROM request_logs").all() as any[];
    expect(logs.length).toBe(1);
    expect(logs[0].is_stream).toBe(1);
  });

  it("should complete full Anthropic non-stream flow", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        ...AUTH_HEADER,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      payload: {
        model: "claude-3-sonnet",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 100,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.type).toBe("message");
    expect(body.content[0].text).toBe("Hello from Claude");

    // 验证日志
    const logs = db.prepare("SELECT * FROM request_logs").all() as any[];
    expect(logs.length).toBe(1);
    expect(logs[0].api_type).toBe("anthropic");
  });

  it("should apply model mapping in integration", async () => {
    // 配置映射：客户端用 gpt-4，后端收到 gpt-4-turbo
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO model_mappings (id, client_model, backend_model, backend_service_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("map-1", "gpt-4", "gpt-4-turbo", "svc-openai", 1, now);

    // 创建一个验证后端收到的 model 的 mock
    let receivedModel: string | null = null;
    await mockOpenAI.server.close();
    mockOpenAI = await createMockBackend({
      chatCompletions: (body) => {
        receivedModel = body.model;
        return {
          id: "chatcmpl-1",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          model: body.model,
        };
      },
    });

    // 更新后端服务地址
    db.prepare(
      `UPDATE backend_services SET base_url = ? WHERE id = ?`
    ).run(`http://127.0.0.1:${mockOpenAI.port}`, "svc-openai");

    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { ...AUTH_HEADER, "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
      },
    });

    // 后端收到的应该是映射后的模型名
    expect(receivedModel).toBe("gpt-4-turbo");
  });

  it("should reject request without Authorization with 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("should reject request with wrong Authorization with 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer wrong-key",
        "content-type": "application/json",
      },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.code).toBe("invalid_api_key");
  });

  it("should serve /health without authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
```

运行测试：

```bash
npx vitest run tests/integration.test.ts
```

预期：红灯（如果 buildApp 尚未重构完成或代理模块的 stream 行为与 mock 不匹配）。

### Step 7.3: 调试并确保集成测试通过

根据实际代理模块的 stream 实现方式，可能需要调整 mock 服务器的流式响应行为。关键点：

1. **SSE 流式测试**：如果代理模块使用 `PassThrough` stream 做 SSE pipe，mock 服务器需要正确返回 `text/event-stream` 格式。`app.inject()` 对 stream 的处理可能与真实 HTTP 请求不同，必要时改用真实 HTTP 端口测试。

2. **buildApp() 的 DB 处理**：确保 `buildApp()` 接受外部传入的 `db` 实例时不自行关闭它，由调用者负责关闭。

3. **模型映射集成**：如果 Task 4-5 中的模型映射逻辑与 `request.body` 直接修改的方式不同，需要调整测试中的 `receivedModel` 验证方式。

运行测试直到全部通过：

```bash
npx vitest run tests/integration.test.ts
```

预期：绿灯，7 个测试通过。

### Step 7.4: 运行全部测试确认无回归

```bash
npx vitest run
```

预期：全部绿灯。

### Step 7.5: 提交

```bash
git add src/index.ts tests/integration.test.ts
git commit -m "feat: extract buildApp for testability, add end-to-end integration tests"
```

---

## Task 8: Docker 构建配置

### Files

| 操作 | 路径 |
|------|------|
| Create | `Dockerfile` |
| Create | `docker-compose.yml` |
| Modify | `package.json` |

### Step 8.1: 确认 TypeScript 编译通过

在创建 Dockerfile 之前，确保 TypeScript 编译配置正确。

```bash
npx tsc --noEmit
```

预期：无错误输出。

如果有错误，先修复再继续。

### Step 8.2: 创建 Dockerfile

```dockerfile
# 阶段1：构建
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json .
COPY src/ src/
RUN npm run build

# 阶段2：运行时
FROM node:20-alpine

WORKDIR /app

# 时区设置
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata

# 安装编译工具（better-sqlite3 native addon 需要）
RUN apk add --no-cache python3 make g++

# 只安装生产依赖
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 清理编译工具
RUN apk del python3 make g++

# 复制编译产物
COPY --from=builder /app/dist dist/

# migrations SQL 文件在运行时需要（initDatabase 读取文件系统）
# 编译后 __dirname 是 dist/db，MIGRATIONS_DIR = join(__dirname, "migrations") = dist/db/migrations
COPY --from=builder /app/src/db/migrations/ dist/db/migrations/

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

> `src/db/index.ts` 中 `MIGRATIONS_DIR` 使用 `join(__dirname, "migrations")`，TypeScript 编译后 `__dirname` 为 `dist/db`，因此 migrations SQL 文件需要放在 `dist/db/migrations/` 目录下。`COPY --from=builder` 从构建阶段复制源码中的 `.sql` 文件到正确的运行时路径。

### Step 8.3: 验证构建

```bash
npm run build
```

预期：编译成功，生成 `dist/` 目录。

构建 Docker 镜像：

```bash
docker build -t llm-simple-router .
```

预期：构建成功（包含 better-sqlite3 native addon 编译和 migrations 文件复制）。

### Step 8.4: 创建 docker-compose.yml

```yaml
version: "3.8"

services:
  router:
    build: .
    ports:
      - "${PORT:-3000}:3000"
    environment:
      - ROUTER_API_KEY=${ROUTER_API_KEY}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - TZ=Asia/Shanghai
    volumes:
      - router-data:/app/data
    env_file:
      - .env
    restart: unless-stopped

volumes:
  router-data:
```

### Step 8.5: 创建 .env.example

```env
# 必需配置
ROUTER_API_KEY=sk-router-change-me
ADMIN_PASSWORD=admin123
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# 可选配置
PORT=3000
DB_PATH=./data/router.db
LOG_LEVEL=info
TZ=Asia/Shanghai
STREAM_TIMEOUT_MS=30000
```

### Step 8.6: 修改 package.json scripts

确保 `package.json` 中的 scripts 包含以下内容：

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "docker:build": "docker build -t llm-simple-router .",
    "docker:run": "docker compose up -d"
  }
}
```

### Step 8.7: 端到端验证

```bash
# 1. TypeScript 编译
npm run build
# 预期：无错误

# 2. 全部测试通过
npm run test
# 预期：全部绿灯

# 3. Docker 镜像构建
npm run docker:build
# 预期：Successfully tagged llm-simple-router:latest

# 4. 创建 .env 文件
cat > .env << 'EOF'
ROUTER_API_KEY=sk-docker-test
ADMIN_PASSWORD=admin123
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
EOF

# 5. 启动容器
npm run docker:run
# 预期：容器启动成功

# 6. 验证健康检查
sleep 3
curl http://localhost:3000/health
# 预期输出: {"status":"ok"}

# 7. 清理
docker compose down
rm .env
```

### Step 8.8: 验证缺少环境变量时容器退出

```bash
# 不创建 .env 文件，直接启动
docker compose up -d
sleep 2
docker compose ps
# 预期：容器状态为 Exited 或 Restarting

# 清理
docker compose down
```

### Step 8.9: 提交

```bash
git add Dockerfile docker-compose.yml .env.example package.json
git commit -m "feat: Docker multi-stage build and docker-compose configuration"
```

---

## 验收检查清单

| 检查项 | 命令 | 预期 |
|--------|------|------|
| 全部测试通过 | `npx vitest run` | 所有测试绿灯 |
| TypeScript 编译 | `npx tsc --noEmit` | 无错误 |
| Docker 镜像构建 | `docker build -t llm-simple-router .` | 构建成功 |
| 容器启动 + 健康检查 | `docker compose up -d` + `curl /health` | `{"status":"ok"}` |
| 缺少环境变量时退出 | 不设置 .env 启动 | 容器退出 |
