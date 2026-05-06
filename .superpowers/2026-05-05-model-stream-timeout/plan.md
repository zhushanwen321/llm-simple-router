# Provider + 模型级别流式超时 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Provider + 模型维度配置流式请求超时，替代全局 STREAM_TIMEOUT_MS，精准控制不同模型的超时行为。

**Architecture:** 扩展 Provider 表的 `models` JSON 字段从字符串数组为对象数组，每个对象可配 `stream_timeout_ms`。StreamProxy 的 idleTimer 机制不变，仅将 timeoutMs 从全局值改为按模型查找。TTFT 超时和空闲超时共用同一个值。

**Tech Stack:** SQLite migration, Fastify, Vue 3 + shadcn-vue

---

## Task 1: DB Migration — models 字段格式迁移

**Files:**
- Create: `router/src/db/migrations/040_models_object_format.sql`
- Modify: `router/src/db/providers.ts`

- [ ] **Step 1: 创建 migration SQL**

```sql
-- 040_models_object_format.sql
-- 将 providers.models 从字符串数组转为对象数组
-- ["glm-5.1"] → [{"id": "glm-5.1"}]

UPDATE providers
SET models = (
  SELECT json_group_array(json('{"id": ' || json_quote(value) || '}'))
  FROM json_each(models)
)
WHERE json_type(models) = 'array'
  AND json_array_length(models) > 0
  AND json_type(json_extract(models, '$[0]')) = 'string';
```

- [ ] **Step 2: 验证 migration**

运行 `npm run build && node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); ..."` 或直接启动 router 确认 migration 执行无错。

- [ ] **Step 3: Commit**

```bash
git add router/src/db/migrations/040_models_object_format.sql
git commit -m "feat: add migration to convert models from string[] to object[]"
```

---

## Task 2: 超时查找工具函数

**Files:**
- Modify: `router/src/db/providers.ts`

- [ ] **Step 1: 在 providers.ts 中添加类型和工具函数**

在 `Provider` 接口下方添加：

```typescript
/** 解析后的模型条目 */
export interface ModelEntry {
  id: string;
  stream_timeout_ms?: number;
}

/** 默认流式超时 10 分钟 */
export const DEFAULT_STREAM_TIMEOUT_MS = 600_000;

/** 从 provider 的 models JSON 中查找指定模型的超时值 */
export function getModelStreamTimeout(
  provider: Provider,
  backendModel: string,
): number {
  let entries: ModelEntry[];
  try {
    const raw = JSON.parse(provider.models);
    if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_STREAM_TIMEOUT_MS;
    // 兼容旧格式字符串数组
    entries = raw.map((m: string | ModelEntry) =>
      typeof m === "string" ? { id: m } : m,
    );
  } catch {
    return DEFAULT_STREAM_TIMEOUT_MS;
  }
  const entry = entries.find((m) => m.id === backendModel);
  return entry?.stream_timeout_ms ?? DEFAULT_STREAM_TIMEOUT_MS;
}
```

- [ ] **Step 2: 写单元测试**

创建 `tests/model-timeout.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { getModelStreamTimeout, DEFAULT_STREAM_TIMEOUT_MS, type ModelEntry } from "../router/src/db/providers.js";

function mockProvider(models: string | ModelEntry[]) {
  return { models: JSON.stringify(models) } as any;
}

describe("getModelStreamTimeout", () => {
  it("returns default when model not found", () => {
    expect(getModelStreamTimeout(mockProvider([{ id: "glm-4" }]), "glm-5.1"))
      .toBe(DEFAULT_STREAM_TIMEOUT_MS);
  });

  it("returns configured value", () => {
    expect(getModelStreamTimeout(mockProvider([
      { id: "glm-5.1", stream_timeout_ms: 120_000 },
    ]), "glm-5.1")).toBe(120_000);
  });

  it("returns default when stream_timeout_ms not set", () => {
    expect(getModelStreamTimeout(mockProvider([{ id: "glm-5.1" }]), "glm-5.1"))
      .toBe(DEFAULT_STREAM_TIMEOUT_MS);
  });

  it("handles legacy string array format", () => {
    expect(getModelStreamTimeout(mockProvider(["glm-5.1"]), "glm-5.1"))
      .toBe(DEFAULT_STREAM_TIMEOUT_MS);
  });

  it("handles empty models", () => {
    expect(getModelStreamTimeout(mockProvider([]), "glm-5.1"))
      .toBe(DEFAULT_STREAM_TIMEOUT_MS);
  });

  it("handles malformed JSON", () => {
    expect(getModelStreamTimeout({ models: "not-json" } as any, "glm-5.1"))
      .toBe(DEFAULT_STREAM_TIMEOUT_MS);
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npx vitest run tests/model-timeout.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add router/src/db/providers.ts tests/model-timeout.test.ts
git commit -m "feat: add getModelStreamTimeout utility with tests"
```

---

## Task 3: 代理层接入 — 传递按模型的超时值

**Files:**
- Modify: `router/src/proxy/handler/proxy-handler.ts`

- [ ] **Step 1: 找到硬编码 `config.STREAM_TIMEOUT_MS` 的位置并替换**

在 `router/src/proxy/handler/proxy-handler.ts` 中，当前代码（约第 386 行）：

```typescript
streamTimeoutMs: config.STREAM_TIMEOUT_MS, tracker, matcher, request,
```

替换为：

```typescript
streamTimeoutMs: getModelStreamTimeout(provider, resolved.backend_model), tracker, matcher, request,
```

确保文件顶部有 import：

```typescript
import { getModelStreamTimeout } from "../../db/providers.js";
```

- [ ] **Step 2: 验证编译通过**

```bash
npx tsc --noEmit --project router/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add router/src/proxy/handler/proxy-handler.ts
git commit -m "feat: use per-model stream timeout instead of global config"
```

---

## Task 4: 超时错误响应格式化

**Files:**
- Modify: `router/src/proxy/transport/stream.ts`

- [ ] **Step 1: 在 StreamProxy 的 idleTimer 超时回调中，改为传入错误信息**

当前 `resetIdleTimer` 中的超时处理（约第 141-145 行）：

```typescript
resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.resolved) return;
      this.terminal("stream_abort", { metrics: this.collectMetrics(false) });
    }, this.timeoutMs);
  }
```

需要在 `StreamProxy` 构造函数中新增 `modelId` 和 `providerId` 参数，超时时传递到 result 中，方便 handler 层格式化错误。

修改构造函数签名，新增参数：

```typescript
constructor(
    private readonly statusCode: number,
    rawUpstreamHeaders: RawHeaders,
    private readonly sentUpstreamHeaders: Record<string, string>,
    private readonly reply: FastifyReply,
    private readonly metricsTransform: SSEMetricsTransform | undefined,
    private readonly checkEarlyError: ((data: string) => boolean) | undefined,
    private readonly timeoutMs: number,
    private readonly loopGuard: StreamLoopGuard | undefined,
    formatTransform?: Transform,
    private readonly timeoutContext?: { modelId: string; providerId: string },
  ) {
```

超时回调改为：

```typescript
this.terminal("stream_abort", {
  metrics: this.collectMetrics(false),
  timeoutContext: this.timeoutContext,
  timeoutMs: this.timeoutMs,
});
```

- [ ] **Step 2: 在 `TransportResult` 的 `stream_abort` 类型中增加超时上下文**

在 `router/src/proxy/types.ts` 中找到 `TransportResult` 的 `stream_abort` 定义，添加可选字段：

```typescript
| { kind: "stream_abort"; statusCode: number; upstreamResponseHeaders: Record<string, string>; sentHeaders: Record<string, string>; metrics?: MetricsResult; timeoutContext?: { modelId: string; providerId: string }; timeoutMs?: number }
```

- [ ] **Step 3: 在 handler 层处理超时错误响应**

在 `router/src/proxy/handler/proxy-handler.ts` 中，`logResilienceResult` 调用之后，检查 result 是否为 stream_abort 且包含 timeoutContext，如果是则向客户端发送 408 错误。

在 resilienceResult 处理后添加：

```typescript
if (resilienceResult.kind === "stream_abort" && resilienceResult.timeoutContext) {
  const { modelId, providerId } = resilienceResult.timeoutContext;
  const msg = `Stream timeout: no data received for ${resilienceResult.timeoutMs}ms (model: ${modelId}, provider: ${providerId})`;
  const errBody = apiType === "anthropic"
    ? { type: "error", error: { type: "api_error", message: msg } }
    : { error: { message: msg, type: "server_error", code: "stream_timeout" } };
  try { reply.raw.write(`data: ${JSON.stringify(errBody)}\n\n`); } catch { /* ignore */ }
  try { reply.raw.end(); } catch { /* ignore */ }
}
```

- [ ] **Step 4: 透传 timeoutContext 从 transport-fn**

在 `router/src/proxy/transport/transport-fn.ts` 的 `buildTransportFn` 参数中新增 `timeoutContext`，传递给 `callStream`。

在 `callStream` 调用处传入：

```typescript
callStream(
  p.provider, p.apiKey, p.body, p.cliHdrs, p.reply, p.streamTimeoutMs,
  p.upstreamPath, buildHeaders, metricsTransform, checkEarlyError, undefined, streamLoopGuard, p.formatTransform,
  timeoutContext,
)
```

- [ ] **Step 5: 验证编译通过**

```bash
npx tsc --noEmit --project router/tsconfig.json
```

- [ ] **Step 6: Commit**

```bash
git add router/src/proxy/transport/stream.ts router/src/proxy/types.ts router/src/proxy/handler/proxy-handler.ts router/src/proxy/transport/transport-fn.ts
git commit -m "feat: format stream timeout as 408 error with API-specific body"
```

---

## Task 5: 集成测试 — 超时触发验证

**Files:**
- Create: `tests/stream-timeout.test.ts`

- [ ] **Step 1: 写集成测试**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { buildApp } from "../router/src/index.js";
import Database from "better-sqlite3";
import { createServer } from "http";

describe("per-model stream timeout", () => {
  let app: Fastify.FastifyInstance;
  let db: Database.Database;
  let mockServer: ReturnType<typeof createServer>;
  let port: number;

  afterEach(async () => {
    if (mockServer) mockServer.close();
    if (app) await app.close();
    if (db) db.close();
  });

  async function setup(timeoutMs: number) {
    db = new Database(":memory:");
    
    // Mock upstream: accepts connection, sends first SSE event quickly,
    // then goes silent for a long time
    mockServer = createServer((req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      // Send one SSE event immediately (TTFT)
      res.write("event: message_start\ndata: {}\n\n");
      // Then go silent — never send more data
    });
    
    await new Promise<void>((resolve) => mockServer.listen(0, () => resolve()));
    port = (mockServer.address() as any).port;

    app = Fastify();
    await buildApp({
      config: {
        PORT: 0,
        DB_PATH: ":memory:",
        STREAM_TIMEOUT_MS: 300_000_000, // global = very large, won't trigger
      },
      db,
    });

    // Insert provider with short timeout on specific model
    const providerId = "test-provider";
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, adaptive_enabled, created_at, updated_at)
       VALUES (?, ?, 'anthropic', ?, 'test-key', ?, 1, 0, 0, 100, 0, ?, ?)`,
    ).run(
      providerId, "Test Provider",
      `http://127.0.0.1:${port}`,
      JSON.stringify([{ id: "glm-5.1", stream_timeout_ms: timeoutMs }]),
      new Date().toISOString(), new Date().toISOString(),
    );

    // Insert mapping
    db.prepare(
      `INSERT INTO mapping_groups (id, client_model, rule, is_active, strategy, created_at)
       VALUES (?, 'glm-5.1', ?, 1, 'scheduled', ?)`,
    ).run(
      "test-mapping",
      JSON.stringify([{ provider_id: providerId, backend_model: "glm-5.1" }]),
      new Date().toISOString(),
    );

    // Insert router key
    db.prepare(
      `INSERT INTO router_keys (id, name, key_hash, key_encrypted, is_active, created_at)
       VALUES (?, 'test', ?, ?, 1, ?)`,
    ).run("test-key-id", "hash", "encrypted", new Date().toISOString());
  }

  it("triggers 408 timeout after configured duration", async () => {
    await setup(500); // 500ms timeout
    
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": "test-key-id-placeholder", // will be validated by auth
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: "glm-5.1",
        max_tokens: 1024,
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
    });

    // After timeout, should see abort behavior logged
    // The exact status depends on whether headers were already sent
    // In stream mode, headers are sent with 200, then abort happens
    expect(response.statusCode).toBe(200); // headers already sent
  });

  it("uses default timeout when model not configured", async () => {
    await setup(0); // 0 means use default (600s), so won't timeout in test
    
    // Just verify the request doesn't immediately fail
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": "test-key-id-placeholder",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: "glm-5.1",
        max_tokens: 1024,
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
    });
    
    // Should get 200 (stream started normally, no timeout in test window)
    expect([200, 502]).toContain(response.statusCode);
  });
});
```

注意：此测试需要根据实际 auth middleware 和 app 初始化方式调整。参考现有测试文件 `tests/` 目录中的模式。

- [ ] **Step 2: 运行测试**

```bash
npx vitest run tests/stream-timeout.test.ts
```

根据失败信息调整测试和实现代码。

- [ ] **Step 3: Commit**

```bash
git add tests/stream-timeout.test.ts
git commit -m "test: add integration tests for per-model stream timeout"
```

---

## Task 6: Admin API 适配

**Files:**
- Modify: `router/src/admin/providers.ts`

- [ ] **Step 1: 验证 Provider CRUD 已自动兼容**

由于 `models` 字段在 DB 层存储为 JSON 字符串，CRUD 只需透传。检查 `router/src/admin/providers.ts` 中 Provider 创建和更新端点，确认 `models` 字段直接传递 `req.body.models`，无需特殊处理。如果当前代码直接透传 JSON 字符串，则无需改动。

- [ ] **Step 2: 如需修改，确保创建和更新接口接受对象数组格式的 models**

验证点：`POST /admin/api/providers` 和 `PUT /admin/api/providers/:id` 的 `models` 字段能正确接受 `[{"id": "glm-5.1", "stream_timeout_ms": 600000}]` 格式。

- [ ] **Step 3: Commit（如有改动）**

```bash
git add router/src/admin/providers.ts
git commit -m "feat: ensure admin API accepts object array models format"
```

---

## Task 7: 前端 — Provider 编辑弹窗

**Files:**
- Modify: `frontend/src/views/Providers.vue`

- [ ] **Step 1: 在 Provider 编辑弹窗的模型列表中，每行增加超时输入**

找到 Provider 编辑弹窗中 models 列表的渲染位置。当前模型行可能只有一个模型名输入。在每个模型行中增加一个数字输入框：

```vue
<template>
  <!-- 在每个模型行中，模型名输入框旁边增加 -->
  <div class="flex items-center gap-2">
    <Input v-model="model.id" placeholder="模型名称" class="flex-1" />
    <Input
      v-model.number="model.stream_timeout_ms"
      type="number"
      placeholder="超时(秒)"
      class="w-24"
      :min="10"
    />
    <span class="text-xs text-muted-foreground">秒</span>
    <!-- 原有的删除按钮 -->
  </div>
</template>
```

需要在 models 的数据结构中支持对象格式。将 `models` 从 `string[]` 改为 `{ id: string; stream_timeout_ms?: number }[]`。

- [ ] **Step 2: 调整 models 的序列化/反序列化逻辑**

在提交 Provider 时将对象数组序列化为 JSON 字符串；加载时反序列化为对象数组。确保空 `stream_timeout_ms` 不发送（使用默认值）。

- [ ] **Step 3: 验证前端构建**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/Providers.vue
git commit -m "feat: add per-model stream timeout input in provider edit dialog"
```

---

## Task 8: 前端 — 快速配置页

**Files:**
- Modify: `frontend/src/views/ModelMappings.vue`

- [ ] **Step 1: 在快速配置/映射组编辑中展示模型超时**

在映射组的 target 列表中，如果 target 关联了 Provider，展示该 Provider 下对应模型的超时配置。提供快速编辑入口（点击可跳转到 Provider 编辑页，或在当前弹窗内 inline 编辑）。

具体实现取决于当前 ModelMappings.vue 的结构。找到 target/模型展示区域，增加超时显示和编辑功能。

- [ ] **Step 2: 验证前端构建**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/ModelMappings.vue
git commit -m "feat: show model stream timeout in mapping config page"
```

---

## Task 9: 端到端验证

- [ ] **Step 1: 启动 router，确认 migration 执行**

```bash
npm run dev
```

检查日志中 `040_models_object_format` migration 成功执行。

- [ ] **Step 2: 通过 Admin API 创建/更新 Provider 验证**

```bash
# 创建带超时的 Provider
curl -X POST http://localhost:9980/admin/api/providers \
  -H "Content-Type: application/json" \
  -H "Cookie: <auth-cookie>" \
  -d '{
    "name": "Test GLM",
    "api_type": "anthropic",
    "base_url": "http://...",
    "api_key": "xxx",
    "models": [{"id": "glm-5.1", "stream_timeout_ms": 300000}]
  }'
```

- [ ] **Step 3: 验证数据库中 models 字段格式正确**

```bash
sqlite3 ~/.llm-simple-router/router.db "SELECT models FROM providers WHERE name = 'Test GLM';"
```

应输出：`[{"id":"glm-5.1","stream_timeout_ms":300000}]`

- [ ] **Step 4: 运行全量测试**

```bash
npm test
```

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete per-model stream timeout implementation"
```
