---
verdict: pass
---

# AI Retry Rule Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-powered retry rule generation from request log detail dialog, allowing admins to analyze error responses and create retry rules with one click.

**Architecture:** Backend adds a lightweight LLM client (`llm-client.ts`) that calls provider upstream APIs directly (not through self-proxy). A new POST endpoint `/admin/api/retry-rules/ai-generate` extracts response context from a log entry, sends it to a configured LLM for analysis, and returns a validated retry rule suggestion. Frontend adds a "Generate Retry Rule" button in the log detail dialog, config UI in ProxyEnhancement page, and a preview/edit dialog for the AI-generated rule.

**Tech Stack:** TypeScript (Fastify + better-sqlite3), Vue 3 + shadcn-vue, native `http`/`https` for LLM calls

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `src/utils/llm-client.ts` | create | BG1 | 轻量 LLM HTTP 客户端，调用 OpenAI 兼容 chat completions |
| `src/admin/retry-rules.ts` | modify | BG1 | 新增 POST `/admin/api/retry-rules/ai-generate` 端点 |
| `src/admin/proxy-enhancement.ts` | modify | BG1 | GET/PUT 扩展，包含 `ai_retry_config` 配置 |
| `tests/unit/llm-client.test.ts` | create | BG1 | LLM 客户端单元测试 |
| `tests/integration/ai-retry-rule.test.ts` | create | BG1 | AI 生成端点集成测试 |
| `frontend/src/api/client.ts` | modify | FG1 | 新增 AI 生成 API 函数 + 类型 |
| `frontend/src/views/ProxyEnhancement.vue` | modify | FG1 | 新增 AI 配置卡片 |
| `frontend/src/components/request-detail/UnifiedRequestDialog.vue` | modify | FG1 | 新增"生成重试规则"按钮 + 配置提示 Dialog |
| `frontend/src/components/request-detail/AiRulePreviewDialog.vue` | create | FG1 | AI 规则预览/编辑 Dialog |
| `frontend/src/i18n/locales/zh-CN/proxyEnhancement.json` | modify | FG1 | AI 配置卡片翻译 key |
| `frontend/src/i18n/locales/en/proxyEnhancement.json` | modify | FG1 | AI 配置卡片翻译 key |
| `frontend/src/i18n/locales/zh-CN/logs.json` | modify | FG1 | 生成按钮、预览 Dialog 翻译 key |
| `frontend/src/i18n/locales/en/logs.json` | modify | FG1 | 生成按钮、预览 Dialog 翻译 key |
| `frontend/src/i18n/locales/zh-CN/requestDetail.json` | modify | FG1 | 请求详情页翻译 key（如有） |
| `frontend/src/i18n/locales/en/requestDetail.json` | modify | FG1 | 请求详情页翻译 key（如有） |

---

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | LLM Client Utility | backend | — | BG1 |
| 2 | AI Generate Endpoint + Config Extension | backend | 1 | BG1 |
| 3 | Frontend API Client + Config UI | frontend | — | FG1 |
| 4 | Frontend Generate Button + Rule Preview Dialog | frontend | 3 | FG1 |

---

## Execution Groups

### BG1: Backend — LLM Client + API

**Description:** 后端核心功能：LLM 调用工具、AI 生成端点、配置扩展。Task 1 提供 LLM 基础设施，Task 2 基于它构建业务逻辑。

**Tasks:** Task 1, Task 2

**Files (预估):** 5 个文件（2 create + 3 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | `llm-simple-router/glm-5.1`（executor）、`llm-simple-router/glm-5-turbo`（tdd-coder） |
| 注入上下文 | Task 1-2 描述、spec FR1-FR3 + FR5、CLAUDE.md 编码规范 |
| 读取文件 | `src/admin/retry-rules.ts`, `src/admin/proxy-enhancement.ts`, `src/db/settings.ts`, `src/db/retry-rules.ts`, `src/db/logs.ts`, `src/db/providers.ts`, `src/utils/crypto.ts`, `src/core/container.ts`, `src/proxy/handler/proxy-handler-utils.ts`（确认 stream_text_content 序列化格式） |
| 修改/创建文件 | `src/utils/llm-client.ts`(create), `src/admin/retry-rules.ts`(modify), `src/admin/proxy-enhancement.ts`(modify), `tests/unit/llm-client.test.ts`(create), `tests/integration/ai-retry-rule.test.ts`(create) |

**Execution Flow (BG1 内部):** 串行派遣。

  Task 1:
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写失败测试
    2. general-purpose (read xyz-harness-backend-dev) → 写实现代码
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

  Task 2 (depends on Task 1):
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写失败测试
    2. general-purpose (read xyz-harness-backend-dev) → 写实现代码
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

**Dependencies:** 无

---

### FG1: Frontend — Config + Trigger + Preview

**Description:** 前端全部功能：配置 UI、API 客户端、触发按钮、规则预览 Dialog。Task 3 搭建 API 层和配置页，Task 4 构建核心交互（触发 + 预览）。

**Tasks:** Task 3, Task 4

**Files (预估):** 10 个文件（1 create + 9 modify，含 6 个 i18n JSON 文件）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose |
| Model | `llm-simple-router/glm-5-turbo` |
| 注入上下文 | Task 3-4 描述、spec FR1 + FR4 + FR6、CLAUDE.md 前端规范（shadcn-vue、编辑-保存模式）、demo.html 设计参考 |
| 读取文件 | `frontend/src/api/client.ts`, `frontend/src/views/ProxyEnhancement.vue`, `frontend/src/views/RetryRules.vue`, `frontend/src/components/request-detail/UnifiedRequestDialog.vue`, `frontend/src/components/mappings/CascadingModelSelect.vue`, `frontend/src/components/mappings/cascading-types.ts`, `frontend/src/types/mapping.ts`, `frontend/src/views/ModelMappings.vue`（参考 ProviderGroup 构造模式）, `frontend/src/i18n/locales/zh-CN/proxyEnhancement.json`, `frontend/src/i18n/locales/zh-CN/logs.json` |
| 修改/创建文件 | `frontend/src/api/client.ts`(modify), `frontend/src/views/ProxyEnhancement.vue`(modify), `frontend/src/components/request-detail/UnifiedRequestDialog.vue`(modify), `frontend/src/components/request-detail/AiRulePreviewDialog.vue`(create), i18n JSON 文件(6 modify) |

**Execution Flow (FG1 内部):** 串行派遣。

  Task 3:
    1. general-purpose (read xyz-harness-frontend-dev) → 骨架→功能→美化
    2. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

  Task 4 (depends on Task 3):
    1. general-purpose (read xyz-harness-frontend-dev) → 骨架→功能→美化
    2. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

**Dependencies:** 无（前端可以与后端并行开发，API 契约已定义在 spec 中）

---

## Dependency Graph & Wave Schedule

```
BG1 (Task 1: LLM Client) ──→ BG1 (Task 2: Endpoint + Config)

FG1 (Task 3: API + Config UI) ──→ FG1 (Task 4: Button + Dialog)
```

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1(Task1), FG1(Task3) | 并行：后端 LLM 基础 + 前端 API/配置 |
| Wave 2 | BG1(Task2), FG1(Task4) | 并行：后端端点 + 前端交互 |

---

## Detailed Tasks

### Task 1: LLM Client Utility

**Type:** backend

**Files:**
- Create: `src/utils/llm-client.ts`
- Test: `tests/unit/llm-client.test.ts`

**参考文件（先读取再编码）:**
- `src/proxy/transport/http.ts` — `callNonStream` 的 HTTP 请求模式（`http.request` 用法、超时处理、错误处理）
- `src/utils/crypto.ts` — `decrypt` 函数签名

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/llm-client.test.ts`。

测试用例：

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";
import { callLLM } from "../../src/utils/llm-client";

// 辅助：创建 mock OpenAI 兼容服务器
function createMockLLMServer(handler: (body: Record<string, unknown>, res: ServerResponse) => void): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (chunk: string) => { data += chunk; });
    req.on("end", () => {
      handler(JSON.parse(data), res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("callLLM", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const result = await createMockLLMServer((body, res) => {
      // 验证请求格式
      if (body.model === "success-model") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: '{"name":"test rule","status_code":503}' } }],
        }));
      } else if (body.model === "error-model") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Internal error" } }));
      } else if (body.model === "timeout-model") {
        // 不响应，触发超时
        return;
      } else if (body.model === "malformed-model") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("not json");
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: "default response" } }],
        }));
      }
    });
    server = result.server;
    port = result.port;
  });

  afterAll(() => { server.close(); });

  it("should send correct request format", async () => {
    const result = await callLLM({
      baseUrl: `http://127.0.0.1:${port}`,
      upstreamPath: "/v1/chat/completions",
      apiKey: "test-key",
      model: "success-model",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
      timeoutMs: 5000,
    });
    expect(result.content).toContain("test rule");
  });

  it("should throw on upstream HTTP error", async () => {
    await expect(callLLM({
      baseUrl: `http://127.0.0.1:${port}`,
      upstreamPath: "/v1/chat/completions",
      apiKey: "test-key",
      model: "error-model",
      messages: [{ role: "user", content: "test" }],
      timeoutMs: 5000,
    })).rejects.toThrow(/LLM API error.*500/);
  });

  it("should throw on timeout", async () => {
    await expect(callLLM({
      baseUrl: `http://127.0.0.1:${port}`,
      upstreamPath: "/v1/chat/completions",
      apiKey: "test-key",
      model: "timeout-model",
      messages: [{ role: "user", content: "test" }],
      timeoutMs: 500,
    })).rejects.toThrow(/timeout/);
  });

  it("should throw on malformed response", async () => {
    await expect(callLLM({
      baseUrl: `http://127.0.0.1:${port}`,
      upstreamPath: "/v1/chat/completions",
      apiKey: "test-key",
      model: "malformed-model",
      messages: [{ role: "user", content: "test" }],
      timeoutMs: 5000,
    })).rejects.toThrow(/parse LLM response/);
  });

  it("should use default upstreamPath when null", async () => {
    const result = await callLLM({
      baseUrl: `http://127.0.0.1:${port}`,
      upstreamPath: null,
      apiKey: "test-key",
      model: "default",
      messages: [{ role: "user", content: "test" }],
      timeoutMs: 5000,
    });
    expect(result.content).toBe("default response");
  });

  it("should respect maxTokens option", async () => {
    // 验证请求中包含 max_tokens 字段
    let receivedBody: Record<string, unknown> = {};
    const verifyServer = await createMockLLMServer((body, res) => {
      receivedBody = body;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }));
    });
    const addr = verifyServer.server.address();
    const vPort = typeof addr === "object" && addr ? addr.port : 0;
    await callLLM({
      baseUrl: `http://127.0.0.1:${vPort}`,
      upstreamPath: "/v1/chat/completions",
      apiKey: "test-key",
      model: "test",
      messages: [{ role: "user", content: "test" }],
      maxTokens: 1024,
      timeoutMs: 5000,
    });
    expect(receivedBody.max_tokens).toBe(1024);
    expect(receivedBody.stream).toBe(false);
    verifyServer.server.close();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/unit/llm-client.test.ts`
Expected: FAIL — `llm-client` 模块不存在

- [ ] **Step 3: 实现最小代码**

创建 `src/utils/llm-client.ts`：

```typescript
import * as http from "http";
import * as https from "https";
import { URL } from "url";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallLLMOptions {
  baseUrl: string;
  upstreamPath: string | null;
  apiKey: string;
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  timeoutMs?: number;
}

export interface CallLLMResult {
  content: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 2048;

export function callLLM(options: CallLLMOptions): Promise<CallLLMResult> {
  const path = options.upstreamPath || "/v1/chat/completions";
  const url = new URL(path, options.baseUrl);
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;

  const body = JSON.stringify({
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream: false,
  });

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<CallLLMResult>((resolve, reject) => {
    const req = transport.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => {
        if (res.statusCode !== undefined && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`LLM API error: ${res.statusCode} ${data.substring(0, 200)}`));
          return;
        }
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ message?: { content?: string } }> };
          const content = parsed.choices?.[0]?.message?.content;
          if (typeof content !== "string") {
            reject(new Error(`Unexpected LLM response format: ${data.substring(0, 200)}`));
            return;
          }
          resolve({ content });
        } catch {
          reject(new Error(`Failed to parse LLM response: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on("error", (err: Error) => { reject(err); });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`LLM request timeout after ${timeoutMs}ms`));
    });
    req.write(body);
    req.end();
  });
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/unit/llm-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/llm-client.ts tests/unit/llm-client.test.ts
git commit -m "feat: add lightweight LLM client utility for AI retry rule generation"
```

---

### Task 2: AI Generate Endpoint + Config Extension

**Type:** backend

**Files:**
- Modify: `src/admin/retry-rules.ts`
- Modify: `src/admin/proxy-enhancement.ts`
- Create: `tests/integration/ai-retry-rule.test.ts`

**参考文件（先读取再编码）:**
- `src/admin/retry-rules.ts` — 现有端点注册模式、`validateBodyPattern`、`CreateRetryRuleSchema`、HTTP 状态码常量
export 方式
- `src/admin/proxy-enhancement.ts` — GET/PUT 处理模式、TypeBox schema
- `src/db/settings.ts` — `getSetting`/`setSetting` 函数
- `src/db/retry-rules.ts` — `RetryRule` 接口、`getActiveRetryRules`、`createRetryRule`
- `src/db/logs.ts` — `getRequestLogById` 函数、`RequestLog` 接口（`upstream_response`、`stream_text_content` 字段）
- `src/db/providers.ts` — `getProviderById` 函数、`Provider` 接口（`api_key` 加密字段、`base_url`、`upstream_path`）
- `src/utils/crypto.ts` — `decrypt` 函数
- `src/utils/llm-client.ts` — `callLLM` 函数（Task 1 产出）
- `src/proxy/handler/proxy-handler-utils.ts`（可选）— `serializeBlocksForStorage` 确认 stream_text_content 序列化格式

- [ ] **Step 1: 写失败测试**

创建 `tests/integration/ai-retry-rule.test.ts`。

测试框架模式：参考现有集成测试（如 `tests/auth.test.ts`、`tests/admin-retry-rules.test.ts`），使用 `buildApp({ config, db })` + `app.inject()` 模拟 HTTP 请求，内存数据库 `initDatabase(":memory:")`。

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";
import { buildApp } from "../../src/index";
import { initDatabase, type Database } from "src/db";
import { createProvider } from "../../src/db/providers";
import { createRetryRule } from "../../src/db/retry-rules";
import { insertRequestLog } from "../../src/db/logs";
import { setSetting } from "../../src/db/settings";

// Mock LLM 服务器
let mockServer: Server;
let mockPort: number;
let mockHandler: (body: Record<string, unknown>, res: ServerResponse) => void;

function setupMockServer(): Promise<void> {
  mockServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => {
      mockHandler(JSON.parse(data), res);
    });
  });
  return new Promise((resolve) => {
    mockServer.listen(0, () => {
      const addr = mockServer.address();
      mockPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
}

// 辅助：插入一个 provider 和测试日志
async function insertTestProvider(db: Database, port: number) {
  createProvider(db, {
    id: "test-provider",
    name: "Test Provider",
    api_type: "openai",
    base_url: `http://127.0.0.1:${port}`,
    upstream_path: "/v1/chat/completions",
    api_key: "encrypted:key",  // 注意：需要加密存储，具体格式参考 crypto.ts
    models: "[]",
    is_active: 1,
    max_concurrency: 10,
    queue_timeout_ms: 30000,
    max_queue_size: 100,
    adaptive_enabled: 0,
    proxy_type: null,
    proxy_url: null,
    proxy_username: null,
    proxy_password: null,
  });
}

function insertTestLog(db: Database, overrides: Record<string, unknown> = {}) {
  return insertRequestLog(db, {
    id: "test-log-1",
    api_type: "openai",
    model: "test-model",
    provider_id: "test-provider",
    status_code: 503,
    client_status_code: 503,
    is_stream: 0,
    is_retry: 0,
    is_failover: 0,
    error_message: "The server is temporarily overloaded.",
    upstream_response: '{"error":{"message":"The server is temporarily overloaded.","type":"server_error","code":"overloaded"}}',
    latency_ms: 32,
    created_at: new Date().toISOString(),
    ...overrides,
  });
}

describe("POST /admin/api/retry-rules/ai-generate", () => {
  let db: Database.Database;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await setupMockServer();
  });

  afterAll(() => {
    mockServer.close();
  });

  beforeEach(async () => {
    db = initDatabase(":memory:");
    // 插入测试 provider、日志、AI 配置
    // 具体实现参考现有集成测试的 setup 模式
  });

  // --- 测试用例 ---

  it("should return success=false when AI config not set", async () => {
    // 不设置 ai_retry_config
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      payload: { log_id: "test-log-1" },
    });
    expect(res.statusCode).toBe(200); // 所有业务错误统一 200 + { success: false }
    expect(res.json()).toMatchObject({ success: false, error: expect.stringContaining("配置") });
  });

  it("should return success=false when log not found", async () => {
    setSetting(db, "ai_retry_config", JSON.stringify({ provider_id: "test-provider", model: "test-model" }));
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      payload: { log_id: "nonexistent" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: false, error: expect.stringContaining("存在") });
  });

  it("should reject 2xx response without error features", async () => {
    setSetting(db, "ai_retry_config", JSON.stringify({ provider_id: "test-provider", model: "test-model" }));
    insertTestLog(db, { id: "log-ok", status_code: 200, error_message: null, upstream_response: '{"choices":[{"message":{"content":"Hello"}}]}' });
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      payload: { log_id: "log-ok" },
    });
    expect(res.json()).toMatchObject({ success: false, error: expect.stringContaining("正常") });
  });

  it("should generate rule from error response", async () => {
    mockHandler = (_body, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: '{"summary":"检测到 503 server_error (overloaded)","name":"Test Provider 503 过载重试","status_code":503,"body_pattern":"overloaded|server_error","retry_strategy":"exponential","retry_delay_ms":2000,"max_retries":5,"max_delay_ms":60000}',
          },
        }],
      }));
    };
    setSetting(db, "ai_retry_config", JSON.stringify({ provider_id: "test-provider", model: "test-model" }));
    insertTestLog(db);

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      payload: { log_id: "test-log-1" },
    });
    expect(res.json()).toMatchObject({
      success: true,
      summary: expect.stringContaining("503"),
      rule: {
        name: "Test Provider 503 过载重试",
        status_code: 503,
        body_pattern: "overloaded|server_error",
        retry_strategy: "exponential",
        retry_delay_ms: 2000,
        max_retries: 5,
        max_delay_ms: 60000,
      },
    });
  });

  it("should handle AI exit (no rule generated)", async () => {
    mockHandler = (_body, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          message: { content: '{"error":"无法从此响应中提取重试规则：响应正常"}' },
        }],
      }));
    };
    setSetting(db, "ai_retry_config", JSON.stringify({ provider_id: "test-provider", model: "test-model" }));
    insertTestLog(db, { id: "log-ai-exit", status_code: 400, upstream_response: "normal response" });

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      payload: { log_id: "log-ai-exit" },
    });
    expect(res.json()).toMatchObject({ success: false, error: expect.stringContaining("无法") });
  });

  it("should validate AI response fields", async () => {
    mockHandler = (_body, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      // 缺少 summary 和 name
      res.end(JSON.stringify({
        choices: [{
          message: { content: '{"status_code":503,"body_pattern":"test","retry_strategy":"fixed","retry_delay_ms":1000,"max_retries":3,"max_delay_ms":30000}' },
        }],
      }));
    };
    setSetting(db, "ai_retry_config", JSON.stringify({ provider_id: "test-provider", model: "test-model" }));
    insertTestLog(db, { id: "log-bad-ai" });

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      payload: { log_id: "log-bad-ai" },
    });
    expect(res.json()).toMatchObject({ success: false, error: expect.stringContaining("校验") });
  });

  it("should validate body_pattern regex", async () => {
    mockHandler = (_body, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          message: { content: '{"summary":"test","name":"bad regex","status_code":503,"body_pattern":"[invalid","retry_strategy":"fixed","retry_delay_ms":1000,"max_retries":3,"max_delay_ms":30000}' },
        }],
      }));
    };
    setSetting(db, "ai_retry_config", JSON.stringify({ provider_id: "test-provider", model: "test-model" }));
    insertTestLog(db, { id: "log-bad-regex" });

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      payload: { log_id: "log-bad-regex" },
    });
    expect(res.json()).toMatchObject({ success: false, error: expect.stringContaining("正则") });
  });

  it("should use stream_text_content fallback for streaming logs", async () => {
    mockHandler = (_body, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          message: { content: '{"summary":"stream error","name":"Stream 503","status_code":503,"body_pattern":"overloaded","retry_strategy":"exponential","retry_delay_ms":2000,"max_retries":3,"max_delay_ms":30000}' },
        }],
      }));
    };
    setSetting(db, "ai_retry_config", JSON.stringify({ provider_id: "test-provider", model: "test-model" }));
    // upstream_response 为 null，stream_text_content 有值
    insertTestLog(db, {
      id: "log-stream",
      upstream_response: null,
      stream_text_content: "The server is temporarily overloaded. Please retry.",
      is_stream: 1,
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      payload: { log_id: "log-stream" },
    });
    expect(res.json()).toMatchObject({ success: true, rule: { name: "Stream 503" } });
  });

  it("should include existing rules in prompt", async () => {
    let capturedBody: Record<string, unknown> = {};
    mockHandler = (body, res) => {
      capturedBody = body;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          message: { content: '{"summary":"test","name":"New Rule","status_code":429,"body_pattern":"rate_limit","retry_strategy":"fixed","retry_delay_ms":5000,"max_retries":3,"max_delay_ms":60000}' },
        }],
      }));
    };
    createRetryRule(db, {
      name: "Existing Rule",
      status_code: 503,
      body_pattern: "overloaded",
      retry_strategy: "exponential",
      retry_delay_ms: 2000,
      max_retries: 5,
      max_delay_ms: 60000,
      is_active: 1,
    });
    setSetting(db, "ai_retry_config", JSON.stringify({ provider_id: "test-provider", model: "test-model" }));
    insertTestLog(db, { id: "log-with-rules", status_code: 429, upstream_response: '{"error":{"message":"rate limit","type":"rate_limit"}}' });

    await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      payload: { log_id: "log-with-rules" },
    });

    // 验证 system prompt 包含现有规则
    const messages = capturedBody.messages as Array<{ role: string; content: string }>;
    const systemMsg = messages.find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("Existing Rule");
  });

  it("should return error when provider not found", async () => {
    setSetting(db, "ai_retry_config", JSON.stringify({ provider_id: "nonexistent-provider", model: "test-model" }));
    insertTestLog(db);

    const res = await app.inject({
      method: "POST",
      url: "/admin/api/retry-rules/ai-generate",
      payload: { log_id: "test-log-1" },
    });
    expect(res.json()).toMatchObject({ success: false, error: expect.stringContaining("Provider") });
  });
});
```

**注意：** 具体的 `insertTestProvider`、`insertTestLog`、mock LLM 服务器配置需要参考现有测试文件（如 `tests/admin-retry-rules.test.ts`）中的 setup 模式。特别是：
- Provider 的 `api_key` 字段需要加密存储：先 `setSetting(db, "encryption_key", "test-encryption-key-32byte!!")`，再用 `encrypt("test-api-key", "test-encryption-key-32byte!!")` 生成加密值作为 api_key
- `buildApp` 需要 admin auth token（参考现有测试的认证 setup）
- `insertRequestLog` 的参数签名参考 `src/db/logs.ts`
- 测试中统一使用 HTTP 200 + `{ success, error }` 格式验证，不检查非 200 状态码

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/integration/ai-retry-rule.test.ts`
Expected: FAIL — 端点不存在

- [ ] **Step 3: 扩展 proxy-enhancement.ts 配置端点**

修改 `src/admin/proxy-enhancement.ts`：

**GET 响应扩展：** 在现有 GET handler 返回的对象中增加 `ai_retry_config` 字段，从 settings 表读取 `ai_retry_config` key。

```typescript
// GET handler 中，在返回 config 对象之前添加：
const aiRetryConfigStr = getSetting(db, "ai_retry_config");
const aiRetryConfig = aiRetryConfigStr ? JSON.parse(aiRetryConfigStr) : null;
// 添加到返回对象中：
// return { ...existingConfig, ai_retry_config: aiRetryConfig };
```

**PUT schema 扩展：** 在 `UpdateProxyEnhancementSchema` 中增加可选的 `ai_retry_config` 字段：

```typescript
// 在 schema 中增加：
ai_retry_config: Type.Optional(Type.Union([
  Type.Null(),
  Type.Object({
    provider_id: Type.String({ minLength: 1 }),
    model: Type.String({ minLength: 1 }),
  }),
])),
```

**PUT handler 扩展：** `ai_retry_config` 使用 `Type.Optional()`，所以现有前端调用（不带 `ai_retry_config` 字段）不受影响。handler 中需要先将 `ai_retry_config` 从 body 中解构出来，再将其余字段写入 `proxy_enhancement` JSON：

```typescript
// PUT handler 中：
const { ai_retry_config, ...enhancementFields } = body as Static<typeof UpdateProxyEnhancementSchema>;

// 写入 proxy_enhancement（只含原有字段，不含 ai_retry_config）
const config = {
  tool_call_loop_enabled: enhancementFields.tool_call_loop_enabled,
  stream_loop_enabled: enhancementFields.stream_loop_enabled,
  tool_round_limit_enabled: enhancementFields.tool_round_limit_enabled,
  tool_error_logging_enabled: enhancementFields.tool_error_logging_enabled,
};
setSetting(db, "proxy_enhancement", JSON.stringify(config));
clearEnhancementConfigCache();

// 独立处理 ai_retry_config（写入独立 settings key）
if (ai_retry_config !== undefined) {
  setSetting(db, "ai_retry_config", ai_retry_config ? JSON.stringify(ai_retry_config) : "");
}
```

- [ ] **Step 4: 实现 AI 生成端点**

修改 `src/admin/retry-rules.ts`，在现有路由之后新增 POST 端点。

新增导入：

```typescript
import { callLLM } from "../utils/llm-client";
import { getActiveRetryRules } from "../db/retry-rules";
import { getRequestLogById } from "../db/logs";
import { getProviderById } from "../db/providers";
import { getSetting } from "../db/settings";
import { decrypt } from "../utils/crypto";
```

新增常量：

```typescript
const MAX_RESPONSE_CHARS = 4000;
```

新增辅助函数（在端点注册之前）：

```typescript
/** 从日志中提取响应文本，优先 upstream_response，回退 stream_text_content */
function extractResponseText(log: { upstream_response: string | null; stream_text_content: string | null }): string {
  const raw = log.upstream_response || log.stream_text_content || "";
  return raw.length > MAX_RESPONSE_CHARS ? raw.substring(0, MAX_RESPONSE_CHARS) : raw;
}

/** 检查响应体是否包含错误特征 */
function hasErrorFeatures(responseText: string): boolean {
  const lower = responseText.toLowerCase();
  return lower.includes('"error"') ||
    lower.includes('"error_code"') ||
    lower.includes('"error_message"') ||
    lower.includes('"error_type"');
}

/** 解析 AI 返回的 JSON，支持 markdown code block 包裹 */
function parseAIContent(content: string): Record<string, unknown> | null {
  // 尝试提取 markdown code block 中的 JSON
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : content.trim();
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 校验 AI 生成的规则字段 */
function validateAIRule(rule: Record<string, unknown>): { valid: boolean; error?: string; result?: { name: string; status_code: number; body_pattern: string; retry_strategy: string; retry_delay_ms: number; max_retries: number; max_delay_ms: number; summary: string } } {
  // summary 校验
  const summary = rule.summary;
  if (typeof summary !== "string" || summary.trim() === "") {
    return { valid: false, error: "AI 返回缺少 summary 字段" };
  }
  // name 校验
  const name = rule.name;
  if (typeof name !== "string" || name.trim() === "") {
    return { valid: false, error: "AI 返回缺少 name 字段" };
  }
  // status_code 校验
  const statusCode = rule.status_code;
  if (typeof statusCode !== "number" || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    return { valid: false, error: "AI 返回 status_code 无效（需为 100-599 整数）" };
  }
  // body_pattern 校验（合法正则）
  const bodyPattern = rule.body_pattern;
  if (typeof bodyPattern !== "string") {
    return { valid: false, error: "AI 返回缺少 body_pattern 字段" };
  }
  try {
    new RegExp(bodyPattern);
  } catch {
    return { valid: false, error: "AI 返回的 body_pattern 不是合法正则" };
  }
  // retry_strategy 校验
  const strategy = rule.retry_strategy;
  if (strategy !== "fixed" && strategy !== "exponential") {
    return { valid: false, error: "AI 返回 retry_strategy 无效（需为 fixed 或 exponential）" };
  }
  // retry_delay_ms 校验
  const delayMs = rule.retry_delay_ms;
  if (typeof delayMs !== "number" || !Number.isInteger(delayMs) || delayMs <= 0) {
    return { valid: false, error: "AI 返回 retry_delay_ms 无效" };
  }
  // max_retries 校验
  const maxRetries = rule.max_retries;
  if (typeof maxRetries !== "number" || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 100) {
    return { valid: false, error: "AI 返回 max_retries 无效（需为 0-100 整数）" };
  }
  // max_delay_ms 校验
  const maxDelayMs = rule.max_delay_ms;
  if (typeof maxDelayMs !== "number" || !Number.isInteger(maxDelayMs) || maxDelayMs <= 0) {
    return { valid: false, error: "AI 返回 max_delay_ms 无效" };
  }
  return {
    valid: true,
    result: {
      summary,
      name,
      status_code: statusCode,
      body_pattern: bodyPattern,
      retry_strategy: strategy as "fixed" | "exponential",
      retry_delay_ms: delayMs,
      max_retries: maxRetries,
      max_delay_ms: maxDelayMs,
    },
  };
}

/** 构造 system prompt */
function buildSystemPrompt(existingRules: Array<{ name: string; status_code: number; body_pattern: string }>): string {
  const rulesList = existingRules.length > 0
    ? existingRules.map((r) => `- ${r.name}: status=${r.status_code}, pattern=${r.body_pattern}`).join("\n")
    : "（无现有规则）";

  return `你是一个 API 重试规则专家。根据用户提供的 HTTP 错误响应信息，生成一条合适的重试规则。

## 响应分析指南

### 1. 识别错误标识
从响应中找出能唯一标识此类错误的文本片段。优先级：
- 错误码字段：error.code、error.type、code、type 等（如 "overloaded"、"rate_limit_exceeded"、"insufficient_quota"）
- 错误消息中的固定短语：error.message、message、detail 等字段中不随请求变化的固定文本部分（如 "temporarily overloaded"、"context_length_exceeded"）
- 避免提取：动态内容（请求 ID、时间戳、具体 token 数值、文件路径等随请求变化的值）

### 2. 构造 body_pattern 正则
- 使用 | 组合多个错误标识，覆盖同一类错误的不同表述（如 overloaded|server_error）
- 使用 \\b 词边界提升精确度（如 \\bcontext_length_exceeded\\b）
- 不要使用 .* 或 .+ 等过于宽泛的匹配
- 不要硬编码动态值（如具体的数字、UUID、时间戳）
- 目标：能匹配同一类错误的所有实例，但不误匹配其他类型的错误

### 3. 策略选择
- 429 (rate limit)：建议 fixed 策略，delay 5000-30000ms（遵循 Retry-After），max_retries 3-5
- 500/502/503 (服务端错误)：建议 exponential 策略，delay 1000-3000ms，max_retries 3-5
- 400 类客户端错误：一般不应重试，除非是已知的可重试错误（如 "context_length_exceeded" 可触发降级重试）

### 4. 命名规范
格式："{Provider名或通用名} {状态码} {错误类型简述} 重试"
示例："DeepSeek 503 过载重试"、"OpenAI 429 限流重试"

## 现有规则列表（避免生成重复或冲突的规则）：
${rulesList}

如果提供的响应内容不足以生成有意义的重试规则（例如成功响应、无错误特征），请返回：
{"error":"无法从此响应中提取重试规则：{原因}"}

否则，你必须返回规则 JSON，不要返回任何其他内容：
{"summary":"一句话说明检测到什么错误以及推荐策略的原因","name":"...","status_code":...,"body_pattern":"...","retry_strategy":"fixed|exponential","retry_delay_ms":...,"max_retries":...,"max_delay_ms":...}`;
}

/** 构造 user prompt */
function buildUserPrompt(log: { provider_id: string | null; model: string | null; status_code: number | null; error_message: string | null }, responseText: string): string {
  return `Provider: ${log.provider_id ?? "unknown"}
Model: ${log.model ?? "unknown"}
Status Code: ${log.status_code ?? "N/A"}
Error Message: ${log.error_message ?? "N/A"}
Response Body:
${responseText}`;
}
```

新增端点（在 `adminRetryRuleRoutes` 函数内，现有路由注册之后）：

```typescript
app.post("/admin/api/retry-rules/ai-generate", async (request, reply) => {
  const { log_id } = request.body as { log_id: string };

  // 1. 校验 AI 配置
  const configStr = getSetting(db, "ai_retry_config");
  if (!configStr) {
    return reply.send({ success: false, error: "AI 重试规则生成未配置。请前往代理增强设置配置 AI 模型。" });
  }
  let aiConfig: { provider_id: string; model: string };
  try {
    aiConfig = JSON.parse(configStr) as { provider_id: string; model: string };
  } catch {
    return reply.send({ success: false, error: "AI 配置格式错误" });
  }
  if (!aiConfig.provider_id || !aiConfig.model) {
    return reply.send({ success: false, error: "AI 配置不完整，请选择 Provider 和 Model" });
  }

  // 2. 获取日志
  const log = getRequestLogById(db, log_id);
  if (!log) {
    return reply.send({ success: false, error: "日志不存在" });
  }

  // 3. 提取响应文本
  const responseText = extractResponseText(log);

  // 4. 前置检查：2xx + 无 error_message + 响应体无错误特征 → 拒绝
  const is2xx = log.status_code !== null && log.status_code >= 200 && log.status_code < 300;
  if (is2xx && !log.error_message && !hasErrorFeatures(responseText)) {
    return reply.send({ success: false, error: "该请求响应正常，无需生成重试规则" });
  }

  // 5. 获取 Provider
  const provider = getProviderById(db, aiConfig.provider_id);
  if (!provider) {
    return reply.send({ success: false, error: "配置的 Provider 不存在" });
  }

  // 6. 获取加密密钥并解密 API key
  // 项目通用模式：settings 表 key="encryption_key"（参考 providers.ts、failover-loop.ts 中的 decrypt 调用）
  const encryptionKey = getSetting(db, "encryption_key");
  if (!encryptionKey) {
    return reply.send({ success: false, error: "系统加密密钥未初始化" });
  }
  let apiKey: string;
  try {
    apiKey = decrypt(provider.api_key, encryptionKey);
  } catch {
    return reply.send({ success: false, error: "Provider API Key 解密失败" });
  }

  // 7. 获取现有规则并构造 prompt
  const existingRules = getActiveRetryRules(db);
  const systemPrompt = buildSystemPrompt(existingRules);
  const userPrompt = buildUserPrompt(log, responseText);

  // 8. 调用 LLM
  let llmResult: { content: string };
  try {
    llmResult = await callLLM({
      baseUrl: provider.base_url,
      upstreamPath: provider.upstream_path,
      apiKey,
      model: aiConfig.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 2048,
      timeoutMs: 30_000,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return reply.send({ success: false, error: `AI 调用失败：${msg}` });
  }

  // 9. 解析 AI 返回
  const parsed = parseAIContent(llmResult.content);
  if (!parsed) {
    return reply.send({ success: false, error: "AI 返回内容无法解析为 JSON，请重试" });
  }

  // 10. 检查 AI 退出（判断无法生成规则）
  if (typeof parsed.error === "string") {
    return reply.send({ success: false, error: parsed.error });
  }

  // 11. 校验规则字段
  const validation = validateAIRule(parsed);
  if (!validation.valid || !validation.result) {
    return reply.send({ success: false, error: `AI 返回规则校验失败：${validation.error}` });
  }

  return reply.send({
    success: true,
    rule: {
      name: validation.result.name,
      status_code: validation.result.status_code,
      body_pattern: validation.result.body_pattern,
      retry_strategy: validation.result.retry_strategy,
      retry_delay_ms: validation.result.retry_delay_ms,
      max_retries: validation.result.max_retries,
      max_delay_ms: validation.result.max_delay_ms,
    },
    summary: validation.result.summary,
  });
});
```

**关键实现注意事项：**

1. **加密密钥获取：** `getSetting(db, "encryption_key")` 是项目通用模式（参考 `providers.ts:179`、`failover-loop.ts:184`）。settings 表 key 名确认为 `"encryption_key"`（setup.ts 中初始化）。无需额外注入，直接在 handler 中通过 db 调用即可。

2. **错误响应格式统一：** AI 生成端点所有业务逻辑错误均返回 HTTP 200 + `{ success: false, error: "..." }` 格式。前端只需检查 `result.success` 布尔值。非 200 状态码仅由 Fastify 框架（如 401 未认证）或系统级错误返回。这确保前端错误处理逻辑统一。

3. **stream_text_content 格式：** `stream_text_content` 不是 SSE 原始格式，而是经过 `serializeBlocksForStorage()` 序列化后的标准 API 响应格式（JSON 字符串，如 `{ choices: [{ message: { content: "text" } }] }`）。`extractResponseText` 直接使用全文即可，因为序列化已过滤了非文本内容（thinking blocks、tool_use 等），仅保留 text 部分。

4. **函数行数限制：** 端点 handler 约 60 行，各辅助函数各 15-30 行。总体 `retry-rules.ts` 从 110 行增长到约 280 行，在 300 行限制内。

5. **TypeBox schema：** 端点请求体可以简单校验 `{ log_id: string }`，或使用内联 TypeBox schema。

- [ ] **Step 5: 运行测试验证通过**

Run: `npx vitest run tests/integration/ai-retry-rule.test.ts`
Expected: PASS

- [ ] **Step 6: 运行后端全量测试**

Run: `npm test`
Expected: 全部通过（包括现有测试不受影响）

- [ ] **Step 7: 运行后端 lint**

Run: `npm run lint`
Expected: 零警告零错误

- [ ] **Step 8: 运行后端构建**

Run: `npm run build`
Expected: 编译成功

- [ ] **Step 9: Commit**

```bash
git add src/admin/retry-rules.ts src/admin/proxy-enhancement.ts tests/integration/ai-retry-rule.test.ts
git commit -m "feat: add AI retry rule generation endpoint and config extension"
```

---

### Task 3: Frontend API Client + Config UI

**Type:** frontend

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/views/ProxyEnhancement.vue`

**参考文件（先读取再编码）:**
- `frontend/src/api/client.ts` — 现有 API 函数模式、`request<T>()` 封装、`RetryRulePayload` 接口
- `frontend/src/views/ProxyEnhancement.vue` — 编辑-保存模式、`loadConfig`/`handleSave`、`api.getProxyEnhancement`/`api.updateProxyEnhancement`
- `frontend/src/components/mappings/CascadingModelSelect.vue` — props/emits、`ProviderGroup`/`SelectedValue` 类型、`compact` prop
- `frontend/src/views/RetryRules.vue` — 创建规则 Dialog 的表单字段和验证逻辑（参考字段列表）

- [ ] **Step 1: 扩展 API Client**

修改 `frontend/src/api/client.ts`：

新增类型定义（在现有 `RetryRulePayload` 附近）：

```typescript
export interface AiRetryConfig {
  provider_id: string;
  model: string;
}

export interface AiRetryGenerateResult {
  success: boolean;
  error?: string;
  rule?: {
    name: string;
    status_code: number;
    body_pattern: string;
    retry_strategy: "fixed" | "exponential";
    retry_delay_ms: number;
    max_retries: number;
    max_delay_ms: number;
  };
  summary?: string;
}
```

扩展 `getProxyEnhancement` 返回类型（如果使用 TypeScript 泛型，确保返回类型包含 `ai_retry_config`）。

在 `api` 对象中新增函数：

```typescript
aiRetryGenerate: (logId: string) =>
  request<AiRetryGenerateResult>("post", "/retry-rules/ai-generate", { log_id: logId }),
```

注意：URL 路径相对于 `/admin/api`，参考现有 `retry-rules` 路由的路径模式。

- [ ] **Step 2: 扩展 ProxyEnhancement.vue**

在 `ProxyEnhancement.vue` 中新增 AI 配置卡片。

**模板部分：** 在现有最后一个配置卡片之后（Token 预估卡片之后）、底部保存按钮之前，新增卡片：

```vue
<!-- AI 重试规则生成配置 -->
<Card>
  <CardHeader>
    <CardTitle class="flex items-center gap-2">
      <Sparkles class="h-4 w-4" />
      {{ t('proxyEnhancement.aiRetryRuleGen') }}
    </CardTitle>
  </CardHeader>
  <CardContent>
    <p class="text-sm text-muted-foreground mb-4">
      {{ t('proxyEnhancement.aiRetryRuleGenDesc') }}
    </p>
    <CascadingModelSelect
      :providers="providerGroups"
      :model-value="aiRetryConfig"
      :placeholder="t('proxyEnhancement.selectAiModel')"
      @update:model-value="onAiConfigChange"
    />
  </CardContent>
</Card>
```

**新增导入：**
- `Sparkles` from `lucide-vue-next`
- `CascadingModelSelect` from `@/components/mappings/CascadingModelSelect.vue`
- `api.getProviders` (现有 API 函数，用于加载 provider 列表)
- `ProviderGroup` 类型从 `@/components/mappings/cascading-types` 导入
- `ModelInfo` 类型从 `@/types/mapping` 导入（或内联类型推断）

**Script 部分：**

新增 ref：

```typescript
const aiRetryConfig = ref<AiRetryConfig | null>(null);
const providerGroups = ref<ProviderGroup[]>([]);
```

新增 `loadProviders` 函数（在 `onMounted` 中调用）：

```typescript
const DEFAULT_CONTEXT_WINDOW = 128000;

async function loadProviders() {
  try {
    const providers = await api.getProviders();
    // ProviderGroup 类型: { provider: { id, name }, models: ModelOption[] }
    // 参考 ModelMappings.vue 中的实现模式
    // api.getProviders() 返回的 p.models 已经是解析后的 ModelInfo[]（非 JSON 字符串）
    providerGroups.value = providers
      .filter((p) => p.is_active)
      .map((p) => ({
        provider: { id: p.id, name: p.name },
        models: (p.models ?? []).map((m) => ({
          name: m.name,
          contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
          streamTimeoutMs: m.stream_timeout_ms ?? null,
        })),
      }));
  } catch (e: unknown) {
    console.error('proxyEnhancement.loadProviders:', e);
    /* 非关键功能，加载失败不影响主流程 */
  }
}
```

扩展 `loadConfig`：

```typescript
// 在 loadConfig 中，加载 proxy-enhancement 配置后，读取 ai_retry_config
const enhancementData = await api.getProxyEnhancement();
// ...existing assignments...
aiRetryConfig.value = enhancementData.ai_retry_config ?? null;
```

新增 `onAiConfigChange` handler：

```typescript
function onAiConfigChange(value: { provider_id: string; model: string } | null) {
  aiRetryConfig.value = value;
}
```

扩展 `handleSave`：在现有 `Promise.all` 中增加 AI 配置保存：

```typescript
// 在 handleSave 的保存列表中增加：
// api.updateProxyEnhancement 调用的 payload 中增加 ai_retry_config
api.updateProxyEnhancement({
  ...existingFields,
  ai_retry_config: aiRetryConfig.value,
}),
```

在 `onMounted` 中增加 `loadProviders()` 调用。

- [ ] **Step 3: 添加国际化 key**

确保 `t('proxyEnhancement.aiRetryRuleGen')`、`t('proxyEnhancement.aiRetryRuleGenDesc')`、`t('proxyEnhancement.selectAiModel')` 的翻译 key 存在。如果项目使用 i18n JSON 文件，添加对应 key。如果项目不使用 i18n 但在代码中有 `t()` 调用，检查翻译文件的位置和格式。

- [ ] **Step 4: 运行前端类型检查**

Run: `cd frontend && npx vue-tsc -b --noEmit`
Expected: 零错误

- [ ] **Step 5: 运行前端 lint**

Run: `cd frontend && npx eslint . --max-warnings=0`
Expected: 零警告零错误

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/views/ProxyEnhancement.vue
git commit -m "feat: add AI retry config UI in proxy enhancement page"
```

---

### Task 4: Frontend Generate Button + Rule Preview Dialog

**Type:** frontend

**Files:**
- Create: `frontend/src/components/request-detail/AiRulePreviewDialog.vue`
- Modify: `frontend/src/components/request-detail/UnifiedRequestDialog.vue`

**参考文件（先读取再编码）:**
- `frontend/src/components/request-detail/UnifiedRequestDialog.vue` — 完整结构、左右面板布局、props 定义、`overview` computed
- `frontend/src/views/RetryRules.vue` — 创建规则 Dialog 的表单字段（name, status_code, body_pattern, retry_strategy, retry_delay_ms, max_retries, max_delay_ms, is_active）、验证逻辑 `validate()`
- `frontend/src/api/client.ts` — `api.createRetryRule()`、`api.aiRetryGenerate()` 函数（Task 3 产出）
- `.xyz-harness/2026-05-20-ai-retry-rule/demo.html` — 场景 2-4 的 UI 设计参考

- [ ] **Step 1: 创建 AiRulePreviewDialog 组件**

创建 `frontend/src/components/request-detail/AiRulePreviewDialog.vue`（约 200 行）。

此组件复用 `RetryRules.vue` 创建规则 Dialog 的表单结构，但增加了 AI 摘要和独立的保存逻辑。

```vue
<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sparkles, CheckCircle2 } from "lucide-vue-next";
import { api, getApiMessage } from "@/api/client";
import type { AiRetryGenerateResult } from "@/api/client";

interface AiRule {
  name: string;
  status_code: number;
  body_pattern: string;
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
}

const props = defineProps<{
  open: boolean;
  rule: AiRule | null;
  summary: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  "saved": [];
}>();

const { t } = useI18n();

// 表单 ref
const form = ref({
  name: "",
  status_code: 503,
  body_pattern: "",
  retry_strategy: "exponential" as "fixed" | "exponential",
  retry_delay_ms: 2000,
  max_retries: 3,
  max_delay_ms: 60000,
  is_active: true,
});
const errors = ref<Record<string, string>>({});
const saving = ref(false);

// 当 rule 变化时预填表单
watch(() => props.rule, (newRule) => {
  if (newRule) {
    form.value = {
      name: newRule.name,
      status_code: newRule.status_code,
      body_pattern: newRule.body_pattern,
      retry_strategy: newRule.retry_strategy,
      retry_delay_ms: newRule.retry_delay_ms,
      max_retries: newRule.max_retries,
      max_delay_ms: newRule.max_delay_ms,
      is_active: true,
    };
    errors.value = {};
  }
}, { immediate: true });

function validate(): boolean {
  errors.value = {};
  if (!form.value.name.trim()) errors.value.name = "名称不能为空";
  if (form.value.status_code < 100 || form.value.status_code > 599) errors.value.status_code = "状态码需为 100-599";
  try {
    new RegExp(form.value.body_pattern);
  } catch {
    errors.value.body_pattern = "正则表达式不合法";
  }
  if (!form.value.body_pattern.trim()) errors.value.body_pattern = "匹配模式不能为空";
  if (form.value.retry_delay_ms < 100) errors.value.retry_delay_ms = "延迟不能小于 100ms";
  if (form.value.max_retries < 0 || form.value.max_retries > 100) errors.value.max_retries = "重试次数需为 0-100";
  if (form.value.max_delay_ms < 100) errors.value.max_delay_ms = "最大延迟不能小于 100ms";
  return Object.keys(errors.value).length === 0;
}

async function handleSave() {
  if (!validate()) return;
  saving.value = true;
  try {
    await api.createRetryRule({
      name: form.value.name,
      status_code: form.value.status_code,
      body_pattern: form.value.body_pattern,
      retry_strategy: form.value.retry_strategy,
      retry_delay_ms: form.value.retry_delay_ms,
      max_retries: form.value.max_retries,
      max_delay_ms: form.value.max_delay_ms,
      is_active: form.value.is_active ? 1 : 0,
    });
    toast.success(t('retryRules.createSuccess'));
    emit("update:open", false);
    emit("saved");
  } catch (e: unknown) {
    console.error('AiRulePreviewDialog.handleSave:', e);
    toast.error(getApiMessage(e, t('common.saveFailed')));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Sparkles class="h-4 w-4" />
          {{ t('logs.aiGeneratedRule') }}
          <Badge variant="secondary" class="text-xs">{{ t('logs.aiGenerated') }}</Badge>
        </DialogTitle>
      </DialogHeader>

      <!-- AI 分析摘要 -->
      <div v-if="summary" class="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-sm text-muted-foreground">
        <div class="mb-1 flex items-center gap-1 font-medium text-green-500">
          <CheckCircle2 class="h-3.5 w-3.5" />
          {{ t('logs.aiAnalysisComplete') }}
        </div>
        {{ summary }}
      </div>

      <div class="space-y-3">
        <!-- name -->
        <div>
          <Label>{{ t('retryRules.name') }}</Label>
          <Input v-model="form.name" class="mt-1" @input="delete errors.name" />
          <p v-if="errors.name" class="mt-1 text-xs text-destructive">{{ errors.name }}</p>
        </div>

        <!-- status_code + retry_strategy -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>{{ t('retryRules.statusCode') }}</Label>
            <Input v-model.number="form.status_code" type="number" class="mt-1" @input="delete errors.status_code" />
            <p v-if="errors.status_code" class="mt-1 text-xs text-destructive">{{ errors.status_code }}</p>
          </div>
          <div>
            <Label>{{ t('retryRules.strategy') }}</Label>
            <Select v-model="form.retry_strategy">
              <SelectTrigger class="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed</SelectItem>
                <SelectItem value="exponential">Exponential</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <!-- body_pattern -->
        <div>
          <Label>{{ t('retryRules.bodyPattern') }}</Label>
          <Textarea v-model="form.body_pattern" class="mt-1 font-mono text-sm" rows="2" @input="delete errors.body_pattern" />
          <p v-if="errors.body_pattern" class="mt-1 text-xs text-destructive">{{ errors.body_pattern }}</p>
          <p v-else class="mt-1 text-xs text-muted-foreground">{{ t('retryRules.bodyPatternHint') }}</p>
        </div>

        <!-- retry_delay_ms + max_retries -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>{{ t('retryRules.delayMs') }}</Label>
            <Input v-model.number="form.retry_delay_ms" type="number" class="mt-1" @input="delete errors.retry_delay_ms" />
            <p v-if="errors.retry_delay_ms" class="mt-1 text-xs text-destructive">{{ errors.retry_delay_ms }}</p>
          </div>
          <div>
            <Label>{{ t('retryRules.maxRetries') }}</Label>
            <Input v-model.number="form.max_retries" type="number" class="mt-1" @input="delete errors.max_retries" />
            <p v-if="errors.max_retries" class="mt-1 text-xs text-destructive">{{ errors.max_retries }}</p>
          </div>
        </div>

        <!-- max_delay_ms -->
        <div>
          <Label>{{ t('retryRules.maxDelayMs') }}</Label>
          <Input v-model.number="form.max_delay_ms" type="number" class="mt-1" @input="delete errors.max_delay_ms" />
          <p v-if="errors.max_delay_ms" class="mt-1 text-xs text-destructive">{{ errors.max_delay_ms }}</p>
        </div>

        <!-- is_active -->
        <div class="flex items-center justify-between">
          <Label>{{ t('retryRules.active') }}</Label>
          <Switch :checked="form.is_active" @update:checked="form.is_active = $event" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">{{ t('common.cancel') }}</Button>
        <Button :disabled="saving" @click="handleSave">
          {{ saving ? t('common.saving') : t('logs.saveRule') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

**注意：**
- 翻译 key（如 `t('logs.aiGeneratedRule')`）需要在 i18n 文件中添加
- `api.createRetryRule` 的 payload 格式需要与 `client.ts` 中的 `RetryRulePayload` 匹配
- 表单验证逻辑直接参考 `RetryRules.vue` 的 `validate()` 函数

- [ ] **Step 2: 修改 UnifiedRequestDialog.vue**

在 `UnifiedRequestDialog.vue` 中新增"生成重试规则"按钮和相关 Dialog。

**模板修改：** 在左侧 `RequestOverviewPanel` 之后（或在其底部 slot 中），添加按钮：

```vue
<!-- 在左侧面板区域，RequestOverviewPanel 之后添加 -->
<div class="mt-4 border-t pt-4">
  <Button
    variant="default"
    size="sm"
    class="w-full gap-1.5"
    :disabled="generating"
    @click="handleGenerateRule"
  >
    <Sparkles class="h-3.5 w-3.5" />
    {{ generating ? t('logs.analyzing') : t('logs.generateRetryRule') }}
  </Button>
</div>
```

**新增导入：**

```typescript
import { Sparkles } from "lucide-vue-next";
import { api, getApiMessage } from "@/api/client";
import type { AiRetryGenerateResult } from "@/api/client";
import AiRulePreviewDialog from "./AiRulePreviewDialog.vue";
```

**新增 ref：**

```typescript
const generating = ref(false);
const configPromptOpen = ref(false);
const previewOpen = ref(false);
const generatedRule = ref<{
  name: string;
  status_code: number;
  body_pattern: string;
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
} | null>(null);
const ruleSummary = ref("");
```

**新增 handler 函数：**

```typescript
async function handleGenerateRule() {
  const logId = props.logEntry?.id || props.request?.id;
  if (!logId) return;

  generating.value = true;
  try {
    const result = await api.aiRetryGenerate(logId);

    if (!result.success) {
      // 判断是否为配置缺失错误
      if (result.error?.includes("配置") || result.error?.includes("config")) {
        configPromptOpen.value = true;
      } else {
        toast.error(result.error ?? t('logs.generateFailed'));
      }
      return;
    }

    // 成功：打开预览 Dialog
    generatedRule.value = result.rule ?? null;
    ruleSummary.value = result.summary ?? "";
    previewOpen.value = true;
  } catch (e: unknown) {
    console.error('UnifiedRequestDialog.handleGenerateRule:', e);
    toast.error(getApiMessage(e, t('logs.generateFailed')));
  } finally {
    generating.value = false;
  }
}

function openConfigPage() {
  window.open('/admin/proxy-enhancement', '_blank');
  configPromptOpen.value = false;
}
```

**模板中添加 Dialog 组件（在 template 末尾）：**

```vue
<!-- 配置提示 Dialog -->
<Dialog :open="configPromptOpen" @update:open="configPromptOpen = $event">
  <DialogContent class="max-w-md">
    <DialogHeader>
      <DialogTitle>{{ t('logs.needAiConfig') }}</DialogTitle>
    </DialogHeader>
    <p class="text-sm text-muted-foreground">
      {{ t('logs.needAiConfigDesc') }}
    </p>
    <div class="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 text-sm text-muted-foreground">
      {{ t('logs.configPath') }}
    </div>
    <DialogFooter>
      <Button variant="outline" @click="configPromptOpen = false">{{ t('common.cancel') }}</Button>
      <Button @click="openConfigPage">{{ t('logs.goToConfig') }}</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

<!-- AI 规则预览 Dialog -->
<AiRulePreviewDialog
  :open="previewOpen"
  :rule="generatedRule"
  :summary="ruleSummary"
  @update:open="previewOpen = $event"
  @saved="previewOpen = false"
/>
```

**关键注意事项：**
1. `props.logEntry?.id` 或 `props.request?.id` — 取决于 dialog 是从日志列表还是实时监控打开。需要读取 `UnifiedRequestDialog.vue` 的 props 定义确认可用数据。
2. Button 组件使用 shadcn-vue 的 `Button`，不用原生 `<button>`。
3. Dialog 组件使用 shadcn-vue 的 `Dialog`。
4. 错误消息中检测"配置"关键字来区分配置缺失错误和其他错误——这个逻辑需要在实际实现中测试后端返回的具体错误消息文本。

- [ ] **Step 3: 添加国际化翻译 key**

检查项目的 i18n 文件结构，添加新增的翻译 key：

```
logs.generateRetryRule: "生成重试规则"
logs.analyzing: "分析中..."
logs.generateFailed: "AI 分析失败"
logs.needAiConfig: "需要配置 AI 模型"
logs.needAiConfigDesc: "使用 AI 生成重试规则前，需要先在代理增强设置中配置 AI 模型。"
logs.configPath: "配置路径：代理增强 → AI 重试规则生成 → 选择 Provider / Model"
logs.goToConfig: "前往配置"
logs.aiGeneratedRule: "AI 生成的重试规则"
logs.aiGenerated: "AI 生成"
logs.aiAnalysisComplete: "AI 分析完成"
logs.saveRule: "保存规则"
proxyEnhancement.aiRetryRuleGen: "AI 重试规则生成"
proxyEnhancement.aiRetryRuleGenDesc: "配置用于自动分析请求响应并生成重试规则的 AI 模型。模型通过已配置的 Provider 直接调用。"
proxyEnhancement.selectAiModel: "选择 Provider / Model..."
```

- [ ] **Step 4: 运行前端类型检查**

Run: `cd frontend && npx vue-tsc -b --noEmit`
Expected: 零错误

- [ ] **Step 5: 运行前端 lint**

Run: `cd frontend && npx eslint . --max-warnings=0`
Expected: 零警告零错误

- [ ] **Step 6: 前端构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/request-detail/AiRulePreviewDialog.vue frontend/src/components/request-detail/UnifiedRequestDialog.vue frontend/src/api/client.ts
git commit -m "feat: add AI retry rule generation button and preview dialog in log detail"
```

---

## Self-Review

### 1. Spec Coverage

| Spec 需求 | 对应 Task | 状态 |
|-----------|----------|------|
| FR1: AI 模型配置（ProxyEnhancement + CascadingModelSelect） | Task 3 | 覆盖 |
| FR1: settings 表 ai_retry_config 存储 | Task 2 (proxy-enhancement 扩展) | 覆盖 |
| FR2: LLM 客户端 (llm-client.ts) | Task 1 | 覆盖 |
| FR3: POST ai-generate 端点 | Task 2 | 覆盖 |
| FR3: 前置检查 2xx + 无错误 | Task 2 (hasErrorFeatures) | 覆盖 |
| FR3: stream_text_content 回退 | Task 2 (extractResponseText) | 覆盖 |
| FR3: 现有规则注入 prompt | Task 2 (buildSystemPrompt) | 覆盖 |
| FR3: AI 退出路径 | Task 2 (parseAIContent + error 检查) | 覆盖 |
| FR3: 字段校验（含 summary） | Task 2 (validateAIRule) | 覆盖 |
| FR3: body_pattern 正则校验 | Task 2 (validateAIRule) | 覆盖 |
| FR3: markdown code block 解析 | Task 2 (parseAIContent) | 覆盖 |
| FR4: 生成按钮（sparkle 图标 + loading） | Task 4 | 覆盖 |
| FR4: 配置缺失 → 提示 Dialog + window.open | Task 4 | 覆盖 |
| FR4: 成功 → 预览 Dialog | Task 4 | 覆盖 |
| FR4: 失败 → toast.error | Task 4 | 覆盖 |
| FR5: System prompt（含规则列表） | Task 2 (buildSystemPrompt) | 覆盖 |
| FR5: User prompt 模板 | Task 2 (buildUserPrompt) | 覆盖 |
| FR6: 规则预览 Dialog（AI 摘要 + 表单 + 保存） | Task 4 (AiRulePreviewDialog) | 覆盖 |
| FR6: 保存 → POST /admin/api/retry-rules → 刷新缓存 | Task 4 (复用现有 createRetryRule API) | 覆盖 |
| AC1: 配置持久化 | Task 2 + 3 | 覆盖 |
| AC2: 日志详情触发 | Task 4 | 覆盖 |
| AC3: AI 生成规则 | Task 2 | 覆盖 |
| AC4: 规则预览保存 + 缓存刷新 | Task 4 | 覆盖 |
| AC5: 质量门禁 | 各 Task 内 lint/test/build 步骤 | 覆盖 |

### 2. Placeholder Scan

已检查所有代码块，无 TBD/TODO/implement later 等占位符。

### 3. Type Consistency

- `AiRetryGenerateResult` 在 `client.ts`（Task 3）和 `AiRulePreviewDialog.vue`（Task 4）中使用一致的类型
- `CallLLMOptions`/`CallLLMResult` 在 `llm-client.ts`（Task 1）和 `retry-rules.ts`（Task 2）中使用一致的接口
- `AiRetryConfig` 的 `{ provider_id: string; model: string }` 格式在后端（settings JSON）和前端（CascadingModelSelect emit）保持一致
- `RetryRulePayload` 字段名（retry_strategy, retry_delay_ms 等）与 DB 列名和 API schema 一致
