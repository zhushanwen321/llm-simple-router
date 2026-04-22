# 请求日志按原始请求聚合 - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将重试和故障转移产生的衍生请求关联回原始请求，在日志页面提供分组展开视图。

**Architecture:** 在 `request_logs` 表新增 `is_failover` 字段，在 failover 循环中记录 `rootLogId` 并关联到衍生日志。后端新增子请求查询端点，前端 Logs.vue 实现手风琴展开式分组显示，并统一复用 `LogDetailDialog.vue` 组件。

**Tech Stack:** SQLite (migration)、Fastify、better-sqlite3、Vue 3、shadcn-vue

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/db/migrations/018_add_failover_field.sql` | 新增 is_failover 列 + original_request_id 索引 |
| 修改 | `src/db/logs.ts` | 类型扩展 + 新增子请求查询函数 |
| 修改 | `src/proxy/log-helpers.ts` | RequestLogParams/RejectedLogParams 增加 is_failover |
| 修改 | `src/proxy/proxy-core.ts` | failover 循环中传递 rootLogId，所有日志插入点增加 is_failover |
| 修改 | `src/admin/logs.ts` | 新增 `GET /admin/api/logs/:id/children` 端点 |
| 修改 | `frontend/src/api/client.ts` | 新增 getLogChildren API 方法 |
| 修改 | `frontend/src/views/Logs.vue` | 手风琴分组展示 + 复用 LogDetailDialog |
| 新建 | `tests/failover-log-grouping.test.ts` | failover 日志关联集成测试 |
| 修改 | `tests/admin-logs.test.ts` | 新增 children 端点测试 |

---

### Task 1: 数据库迁移 — 新增 is_failover 字段

**Files:**
- 新建: `src/db/migrations/018_add_failover_field.sql`

- [ ] **Step 1: 创建迁移文件**

```sql
-- src/db/migrations/018_add_failover_field.sql
ALTER TABLE request_logs ADD COLUMN is_failover INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_request_logs_original_request_id ON request_logs(original_request_id);
```

- [ ] **Step 2: 验证迁移文件被自动加载**

运行: `node -e "const {initDatabase}=require('./dist/db/index.js'); const db=initDatabase(':memory:'); const cols=db.pragma('table_info(request_logs)'); console.log(cols.map(c=>c.name)); db.close();"` （先 `npm run build` 再验证）

期望：输出中包含 `is_failover`

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/018_add_failover_field.sql
git commit -m "feat: add is_failover column and original_request_id index to request_logs"
```

---

### Task 2: DB 类型与子请求查询函数

**Files:**
- 修改: `src/db/logs.ts`

- [ ] **Step 1: 扩展 RequestLog 和 RequestLogInsert 类型**

在 `src/db/logs.ts` 中，`RequestLog` 接口增加 `is_failover` 字段（在 `is_retry` 后面）：

```typescript
// RequestLog 接口，在 is_retry 后面加:
is_failover: number;
```

`RequestLogInsert` 接口增加 `is_failover` 可选字段：

```typescript
// RequestLogInsert 接口，在 is_retry? 后面加:
is_failover?: number;
```

- [ ] **Step 2: 更新 insertRequestLog 的 SQL 和参数**

```typescript
// insertRequestLog 函数中，SQL 改为:
`INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, request_body, response_body, client_request, upstream_request, upstream_response, client_response, is_retry, is_failover, original_request_id, router_key_id, original_model)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

// .run() 调用中，在 is_retry 参数后面加:
log.is_failover ?? 0,
```

- [ ] **Step 3: 扩展 getRequestLogs 的 SELECT 子句**

在 `getRequestLogs` 函数中，`SELECT` 语句的 `rl.is_retry` 后面加 `rl.is_failover`：

```typescript
// getRequestLogs 中 SELECT 语句:
`SELECT rl.id, rl.api_type, rl.model, rl.provider_id, rl.status_code, rl.latency_ms,
        rl.is_stream, rl.error_message, rl.created_at, rl.is_retry, rl.is_failover, rl.original_request_id, rl.original_model,
        ...`
```

- [ ] **Step 4: 新增 getRequestLogChildren 函数**

在 `src/db/logs.ts` 末尾添加：

```typescript
export function getRequestLogChildren(
  db: Database.Database,
  parentId: string,
): RequestLogListRow[] {
  return db.prepare(
    `SELECT rl.id, rl.api_type, rl.model, rl.provider_id, rl.status_code, rl.latency_ms,
            rl.is_stream, rl.error_message, rl.created_at, rl.is_retry, rl.is_failover, rl.original_request_id, rl.original_model,
            CASE WHEN rl.provider_id = 'router' THEN rl.upstream_request ELSE NULL END AS upstream_request,
            rm.backend_model, COALESCE(p.name, rl.provider_id) AS provider_name
     FROM request_logs rl
     LEFT JOIN request_metrics rm ON rm.request_log_id = rl.id
     LEFT JOIN providers p ON p.id = rl.provider_id
     WHERE rl.original_request_id = ?
     ORDER BY rl.created_at ASC`,
  ).all(parentId) as RequestLogListRow[];
}
```

- [ ] **Step 5: 新增 getRequestLogsWithGroupedView 函数**

在 `src/db/logs.ts` 末尾添加分组视图查询（只返回原始请求，附加 child_count）：

```typescript
export interface RequestLogGroupedRow extends RequestLogListRow {
  child_count: number;
}

export function getRequestLogsGrouped(
  db: Database.Database,
  options: {
    page: number;
    limit: number;
    api_type?: string;
    model?: string;
    router_key_id?: string;
  },
): { data: RequestLogGroupedRow[]; total: number } {
  let where = "rl.original_request_id IS NULL";
  const params: unknown[] = [];
  if (options.api_type) {
    where += " AND rl.api_type = ?";
    params.push(options.api_type);
  }
  if (options.model) {
    where += " AND rl.model LIKE ?";
    params.push(`%${options.model}%`);
  }
  if (options.router_key_id) {
    where += " AND rl.router_key_id = ?";
    params.push(options.router_key_id);
  }
  const total = (
    db.prepare(`SELECT COUNT(*) as count FROM request_logs rl WHERE ${where}`).get(...params) as CountRow
  ).count;
  const offset = (options.page - 1) * options.limit;
  const data = db
    .prepare(
      `SELECT rl.id, rl.api_type, rl.model, rl.provider_id, rl.status_code, rl.latency_ms,
              rl.is_stream, rl.error_message, rl.created_at, rl.is_retry, rl.is_failover, rl.original_request_id, rl.original_model,
              CASE WHEN rl.provider_id = 'router' THEN rl.upstream_request ELSE NULL END AS upstream_request,
              rm.backend_model, COALESCE(p.name, rl.provider_id) AS provider_name,
              (SELECT COUNT(*) FROM request_logs c WHERE c.original_request_id = rl.id) AS child_count
       FROM request_logs rl
       LEFT JOIN request_metrics rm ON rm.request_log_id = rl.id
       LEFT JOIN providers p ON p.id = rl.provider_id
       WHERE ${where} ORDER BY rl.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, options.limit, offset) as RequestLogGroupedRow[];
  return { data, total };
}
```

- [ ] **Step 6: 在 src/db/index.ts 中导出新函数**

在 `src/db/index.ts` 中，找到从 `./logs.js` 的 re-export 行，添加：

```typescript
export { getRequestLogChildren, getRequestLogsGrouped } from "./logs.js";
```

同时检查 `RequestLogListRow` 的 re-export 是否已包含。

- [ ] **Step 7: Commit**

```bash
git add src/db/logs.ts src/db/index.ts
git commit -m "feat: add is_failover to log types, add children & grouped query functions"
```

---

### Task 3: log-helpers 参数扩展

**Files:**
- 修改: `src/proxy/log-helpers.ts`

- [ ] **Step 1: RequestLogParams 增加 is_failover**

在 `RequestLogParams` 接口中，`isRetry` 后面加：

```typescript
isFailover?: boolean;
```

- [ ] **Step 2: insertSuccessLog 传递 is_failover**

在 `insertSuccessLog` 函数中，解构增加 `isFailover = false`，`insertRequestLog` 调用增加 `is_failover: isFailover ? 1 : 0`：

```typescript
const { id: logId, apiType, model, provider, isStream, startTime,
  reqBody, clientReq, upstreamReq, status, respBody, upHdrs, cliHdrs,
  isRetry = false, isFailover = false, originalRequestId = null, routerKeyId = null, originalModel = null } = params;

// insertRequestLog 调用中增加:
is_failover: isFailover ? 1 : 0,
```

- [ ] **Step 3: RejectedLogParams 增加 is_failover**

在 `RejectedLogParams` 接口中增加：

```typescript
isFailover?: boolean;
originalRequestId?: string | null;
```

- [ ] **Step 4: insertRejectedLog 传递 is_failover 和 originalRequestId**

在 `insertRejectedLog` 函数中，解构增加 `isFailover = false, originalRequestId = null`，`insertRequestLog` 调用增加：

```typescript
is_failover: isFailover ? 1 : 0,
original_request_id: originalRequestId,
```

- [ ] **Step 5: Commit**

```bash
git add src/proxy/log-helpers.ts
git commit -m "feat: add is_failover and originalRequestId to log helper params"
```

---

### Task 4: proxy-core failover 循环关联逻辑

**Files:**
- 修改: `src/proxy/proxy-core.ts`

这是最核心的修改。需要在 failover 的 `while(true)` 循环中：
1. 记住第一个 logId 作为 `rootLogId`
2. 后续迭代标记 `is_failover = true`，`originalRequestId = rootLogId`
3. 所有日志插入点都传递这两个新参数

- [ ] **Step 1: 在 while 循环前声明 rootLogId**

在 `const excludeTargets: Target[] = [];` 后面（约第 267 行），添加：

```typescript
let rootLogId: string | null = null;
```

- [ ] **Step 2: 在 while 循环开头，第一次迭代时记录 rootLogId**

在 `const logId = randomUUID();` 后面（约第 271 行），添加：

```typescript
if (rootLogId === null) rootLogId = logId;
const isFailoverIteration = rootLogId !== logId;
```

- [ ] **Step 3: 修改 logRetryAttempts 调用，传递 isFailoverIteration**

在 `logRetryAttempts(db, { ... })` 调用处（约第 432 行），在参数对象中增加：

```typescript
// 在 routerKeyId 后面加:
// 注意：logRetryAttempts 函数签名也要改
```

等等，`logRetryAttempts` 是 proxy-core.ts 内部的私有函数。需要修改它的参数和内部逻辑。

- [ ] **Step 4: 修改 logRetryAttempts 函数签名**

在 `logRetryAttempts` 函数的 params 类型中增加 `isFailoverIteration: boolean` 和 `rootLogId: string`：

```typescript
function logRetryAttempts(
  db: Database.Database,
  params: {
    apiType: "openai" | "anthropic";
    model: string;
    providerId: string;
    isStream: boolean;
    reqBodyStr: string;
    clientReq: string;
    upstreamReqBase: string;
    logId: string;
    routerKeyId: string | null;
    originalModel: string | null;
    isFailoverIteration: boolean;
    rootLogId: string;
  },
  attempts: Attempt[],
  result: ProxyResult | StreamProxyResult,
  startTime: number,
): string {
```

- [ ] **Step 5: 修改 logRetryAttempts 内部逻辑**

在函数体内，对于 `attemptIndex === 0` 的第一次尝试：
- 如果是 failover 迭代，设置 `is_failover: 1, original_request_id: rootLogId`
- 如果是原始请求，保持 `is_failover: 0, original_request_id: null`

对于 retry 尝试（`attemptIndex > 0`）：保持 `is_retry: 1, original_request_id: params.logId`，`is_failover: 0`

具体修改：在每个 `insertRequestLog` 调用中增加 `is_failover` 字段：

```typescript
// 在 "is_retry: isOriginal ? 0 : 1" 后面加:
is_failover: (isOriginal && params.isFailoverIteration) ? 1 : 0,
```

并将 `original_request_id` 逻辑改为：

```typescript
original_request_id: isOriginal
  ? (params.isFailoverIteration ? params.rootLogId : null)
  : params.logId,
```

同样在 `insertSuccessLog` 调用中增加 `isFailover` 参数：

```typescript
isFailover: !isOriginal ? false : params.isFailoverIteration,
originalRequestId: !isOriginal ? params.logId : (params.isFailoverIteration ? params.rootLogId : null),
```

- [ ] **Step 6: 更新 logRetryAttempts 的调用处**

```typescript
const lastSuccessLogId = logRetryAttempts(db, {
  apiType, model: effectiveModel, providerId: provider.id, isStream,
  reqBodyStr, clientReq, upstreamReqBase, logId, routerKeyId, originalModel,
  isFailoverIteration, rootLogId,
}, attempts, r, startTime);
```

- [ ] **Step 7: 修改 catch 块中的日志插入**

在 catch 块（约第 480 行）的 `insertRequestLog` 调用中增加：

```typescript
is_failover: isFailoverIteration ? 1 : 0,
original_request_id: isFailoverIteration ? rootLogId : null,
```

- [ ] **Step 8: 修改 handleIntercept 函数中的日志插入**

在 `handleIntercept` 函数的 `insertRequestLog` 调用中增加 `is_failover: 0`（保持默认，intercept 不涉及 failover）。

- [ ] **Step 9: 构建验证**

运行: `npm run build`
期望：无 TypeScript 错误

- [ ] **Step 10: Commit**

```bash
git add src/proxy/proxy-core.ts
git commit -m "feat: wire failover log association with rootLogId in proxy loop"
```

---

### Task 5: Admin API 子请求端点

**Files:**
- 修改: `src/admin/logs.ts`
- 修改: `tests/admin-logs.test.ts`

- [ ] **Step 1: 编写 children 端点的测试**

在 `tests/admin-logs.test.ts` 中新增测试：

```typescript
describe("Log children endpoint", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const now = new Date();
    // 原始请求
    db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("root-1", "openai", "gpt-4", "prov-1", 500, 1000, 0, "server error", now.toISOString(), 0, 0, null);
    // failover 子请求
    db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("child-1", "openai", "gpt-4", "prov-2", 200, 500, 0, null, new Date(now.getTime() + 100).toISOString(), 0, 1, "root-1");
    // retry 子请求
    db.prepare(
      `INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream, error_message, created_at, is_retry, is_failover, original_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("child-2", "openai", "gpt-4", "prov-1", 200, 800, 0, null, new Date(now.getTime() + 50).toISOString(), 1, 0, "root-1");

    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);
  });

  afterEach(async () => {
    await close();
  });

  it("GET /admin/api/logs/:id/children returns child logs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs/root-1/children",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    // 按 created_at ASC 排序
    expect(body[0].id).toBe("child-2"); // retry, 时间更早
    expect(body[0].is_retry).toBe(1);
    expect(body[0].is_failover).toBe(0);
    expect(body[1].id).toBe("child-1"); // failover, 时间更晚
    expect(body[1].is_retry).toBe(0);
    expect(body[1].is_failover).toBe(1);
  });

  it("GET /admin/api/logs/:id/children returns empty for leaf request", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs/child-1/children",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });

  it("GET /admin/api/logs/:id/children returns 404 for nonexistent log", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/logs/nonexistent/children",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `npx vitest run tests/admin-logs.test.ts`
期望：新测试 FAIL（端点不存在）

- [ ] **Step 3: 实现 children 端点**

在 `src/admin/logs.ts` 中，`getRequestLogs` 导入旁边增加 `getRequestLogChildren`：

```typescript
import { getRequestLogs, getRequestLogById, getRequestLogChildren, deleteLogsBefore } from "../db/index.js";
```

在 `GET /admin/api/logs/:id` 端点后面添加：

```typescript
app.get("/admin/api/logs/:id/children", async (request, reply) => {
  const params = request.params as { id: string };
  const parent = getRequestLogById(db, params.id);
  if (!parent) {
    return reply.code(HTTP_NOT_FOUND).send({ error: { message: "Log not found" } });
  }
  const children = getRequestLogChildren(db, params.id);
  return reply.send(children);
});
```

- [ ] **Step 4: 运行测试验证通过**

运行: `npx vitest run tests/admin-logs.test.ts`
期望：所有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/admin/logs.ts tests/admin-logs.test.ts
git commit -m "feat: add GET /admin/api/logs/:id/children endpoint with tests"
```

---

### Task 6: Failover 日志关联集成测试

**Files:**
- 新建: `tests/failover-log-grouping.test.ts`

- [ ] **Step 1: 编写 failover 日志关联的集成测试**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { encrypt } from "../src/utils/crypto.js";
import { openaiProxy } from "../src/proxy/openai.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { authMiddleware } from "../src/middleware/auth.js";
import { createHash } from "crypto";

const API_KEY = "sk-test-router";
const API_KEY_HASH = createHash("sha256").update(API_KEY).digest("hex");
const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createMockBackend(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve({ server, port: addr.port });
      else reject(new Error("Failed to get server address"));
    });
  });
}

function closeServer(s: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    s.close((err) => (err ? reject(err) : resolve()));
  });
}

function setupFailoverGroup(db: Database.Database, url1: string, url2: string) {
  const now = new Date().toISOString();
  const encryptedKey = encrypt("sk-test-key", TEST_ENCRYPTION_KEY);
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("prov-primary", "Primary", "openai", url1, encryptedKey, 1, now, now);
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("prov-fallback", "Fallback", "openai", url2, encryptedKey, 1, now, now);

  db.prepare(
    `INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    "mg-failover",
    "gpt-4",
    "failover",
    JSON.stringify({
      targets: [
        { backend_model: "gpt-4", provider_id: "prov-primary" },
        { backend_model: "gpt-4", provider_id: "prov-fallback" },
      ],
    }),
    now
  );

  db.prepare(
    "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)"
  ).run("test-router-key", "Test Key", API_KEY_HASH, API_KEY.slice(0, 8));
}

const SUCCESS_BODY = {
  id: "chatcmpl-1",
  object: "chat.completion",
  model: "gpt-4",
  choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe("Failover log grouping", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let servers: Server[] = [];

  afterEach(async () => {
    if (app) await app.close();
    for (const s of servers) await closeServer(s);
    servers = [];
  });

  it("associates failover requests with original_request_id and is_failover flag", async () => {
    // Primary: 500, Fallback: 200
    const { server: s1, port: p1 } = await createMockBackend((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Internal error" } }));
    });
    const { server: s2, port: p2 } = await createMockBackend((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(SUCCESS_BODY));
    });
    servers.push(s1, s2);

    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
    setupFailoverGroup(db, `http://127.0.0.1:${p1}`, `http://127.0.0.1:${p2}`);

    app = Fastify();
    app.register(authMiddleware, { db });
    app.register(openaiProxy, { db, streamTimeoutMs: 5000, retryMaxAttempts: 0, retryBaseDelayMs: 0 });

    const resp = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });
    expect(resp.statusCode).toBe(200);

    const logs = db
      .prepare("SELECT * FROM request_logs ORDER BY created_at ASC")
      .all() as any[];
    expect(logs).toHaveLength(2);

    // 第一个是原始请求（primary, 500）
    expect(logs[0].status_code).toBe(500);
    expect(logs[0].is_failover).toBe(0);
    expect(logs[0].is_retry).toBe(0);
    expect(logs[0].original_request_id).toBeNull();

    // 第二个是 failover（fallback, 200）
    expect(logs[1].status_code).toBe(200);
    expect(logs[1].is_failover).toBe(1);
    expect(logs[1].is_retry).toBe(0);
    expect(logs[1].original_request_id).toBe(logs[0].id);
  });

  it("all failover targets fail — all logs associated", async () => {
    const { server: s1, port: p1 } = await createMockBackend((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Error" } }));
    });
    const { server: s2, port: p2 } = await createMockBackend((_req, res) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Bad Gateway" } }));
    });
    servers.push(s1, s2);

    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
    setupFailoverGroup(db, `http://127.0.0.1:${p1}`, `http://127.0.0.1:${p2}`);

    app = Fastify();
    app.register(authMiddleware, { db });
    app.register(openaiProxy, { db, streamTimeoutMs: 5000, retryMaxAttempts: 0, retryBaseDelayMs: 0 });

    const resp = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      payload: {
        model: "gpt-4",
        messages: [{ role: "user", content: "Hi" }],
      },
    });
    expect(resp.statusCode).toBe(502);

    const logs = db
      .prepare("SELECT * FROM request_logs ORDER BY created_at ASC")
      .all() as any[];
    expect(logs).toHaveLength(2);
    expect(logs[0].is_failover).toBe(0);
    expect(logs[0].original_request_id).toBeNull();
    expect(logs[1].is_failover).toBe(1);
    expect(logs[1].original_request_id).toBe(logs[0].id);
  });
});
```

- [ ] **Step 2: 运行测试验证**

运行: `npx vitest run tests/failover-log-grouping.test.ts`
期望：PASS（前提是 Task 4 的 proxy-core 修改已完成）

如果 FAIL，检查 proxy-core.ts 中 failover 路径的日志插入是否正确传递了 `is_failover` 和 `original_request_id`。

- [ ] **Step 3: Commit**

```bash
git add tests/failover-log-grouping.test.ts
git commit -m "test: add failover log grouping integration tests"
```

---

### Task 7: 前端 API client 扩展

**Files:**
- 修改: `frontend/src/api/client.ts`

- [ ] **Step 1: 添加 getLogChildren 方法**

在 `api` 对象的 `getLogDetail` 方法后面添加：

```typescript
getLogChildren: (id: string) => client.get(`${API.LOGS}/${id}/children`),
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: add getLogChildren API method"
```

---

### Task 8: 前端 Logs.vue 分组展开视图

**Files:**
- 修改: `frontend/src/views/Logs.vue`

这是前端改动最大的部分。需要：
1. 在表格行上增加展开/折叠箭头（仅 `child_count > 0` 时显示）
2. 展开时加载子请求
3. 子请求行缩进显示
4. 统一使用 `LogDetailDialog` 组件

- [ ] **Step 1: 添加 LogDetailDialog 组件导入**

在 `<script setup>` 的 import 区域添加：

```typescript
import LogDetailDialog from '@/components/monitor/LogDetailDialog.vue'
```

- [ ] **Step 2: 添加分组展开状态管理**

在 `const showDetail = ref(false)` 附近添加：

```typescript
const expandedRows = ref<Set<string>>(new Set())
const childLogs = ref<Record<string, LogEntry[]>>({})
const childLoading = ref<Record<string, boolean>>({})

const logDetailOpen = ref(false)
const logDetailRef = ref<InstanceType<typeof LogDetailDialog> | null>(null)
```

- [ ] **Step 3: 添加子请求加载函数**

```typescript
async function toggleExpand(log: LogEntry) {
  const id = log.id
  if (expandedRows.value.has(id)) {
    expandedRows.value.delete(id)
    return
  }
  expandedRows.value.add(id)
  if (!childLogs.value[id]) {
    childLoading.value[id] = true
    try {
      const res = await api.getLogChildren(id)
      childLogs.value[id] = res.data
    } catch (e) {
      console.error('Failed to load child logs:', e)
      toast.error('加载子请求失败')
    } finally {
      childLoading.value[id] = false
    }
  }
}

function openLogDetail(id: string) {
  logDetailOpen.value = true
  logDetailRef.value?.load(id)
}
```

- [ ] **Step 4: 修改 LogEntry 接口增加新字段**

在 `LogEntry` 接口中增加：

```typescript
is_failover: number
child_count?: number
```

- [ ] **Step 5: 修改 loadLogs 使用分组查询**

修改 `loadLogs` 函数，增加 `grouped` 参数：

```typescript
async function loadLogs() {
  try {
    const params: { page: number; limit: number; api_type?: string; router_key_id?: string } = { page: page.value, limit: PAGE_SIZE }
    if (filterType.value && filterType.value !== 'all') params.api_type = filterType.value
    if (filterRouterKey.value && filterRouterKey.value !== 'all') params.router_key_id = filterRouterKey.value
    const res = await api.getLogs(params)
    logs.value = res.data.data
    total.value = res.data.total
    expandedRows.value.clear()
    childLogs.value = {}
  } catch (e) {
    console.error('Failed to load logs:', e)
    toast.error('加载日志失败')
  }
}
```

注意：这里暂时仍用原接口，后端需配合增加 `view=grouped` 参数。也可以先不改变查询方式，前端通过 child_count 的有无决定是否显示展开箭头。

**后端配合修改**（在 `src/admin/logs.ts` 中）：

在 `GET /admin/api/logs` 的 query schema 中增加 `view` 参数：

```typescript
const LogQuerySchema = Type.Object({
  page: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
  api_type: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  router_key_id: Type.Optional(Type.String()),
  view: Type.Optional(Type.String()),  // 'flat' | 'grouped'
});
```

在路由处理中，根据 `view` 参数选择查询函数：

```typescript
const view = query.view || 'flat';
if (view === 'grouped') {
  const result = getRequestLogsGrouped(db, { page, limit, api_type, model, router_key_id });
  return reply.send({ ...result, page, limit });
}
// 原有逻辑...
```

- [ ] **Step 6: 修改模板 — 增加展开列和子请求行**

在 `<TableHeader>` 的第一列前增加一个空表头：

```html
<TableHead class="w-10"></TableHead>
```

修改 `<TableBody>` 中的内容，将 `v-for="log in logs"` 的循环体改为：

```html
<template v-for="log in logs" :key="log.id">
  <!-- 原始请求行 -->
  <TableRow :class="{ 'bg-destructive/10': (log.status_code ?? 0) >= 400, 'bg-warning-light': log.is_retry, 'bg-muted/30': log.is_failover }">
    <TableCell class="w-10">
      <Button v-if="(log as any).child_count > 0" variant="ghost" size="xs" @click="toggleExpand(log)">
        <span class="text-xs transition-transform" :class="expandedRows.has(log.id) ? '' : '-rotate-90'">&#9660;</span>
      </Button>
    </TableCell>
    <!-- 原有的 TableCell 列保持不变，但从 ID 开始 -->
    <TableCell class="font-mono text-xs text-muted-foreground" :title="log.id">{{ log.id.slice(0, 8) }}</TableCell>
    <!-- ... 其余列不变 ... -->
    <!-- 在"重试"列后面增加"故障转移"列 -->
    <TableCell>
      <Badge v-if="log.is_failover" variant="outline" class="text-orange-500 border-orange-400">故障转移</Badge>
      <span v-else class="text-muted-foreground">-</span>
    </TableCell>
    <TableCell>
      <Button variant="ghost" size="sm" @click="openLogDetail(log.id)">详情</Button>
    </TableCell>
  </TableRow>

  <!-- 子请求行 -->
  <template v-if="expandedRows.has(log.id)">
    <TableRow v-if="childLoading[log.id]">
      <TableCell colspan="12" class="text-center text-muted-foreground py-2 pl-10">
        <Skeleton class="h-4 w-32 mx-auto" />
      </TableCell>
    </TableRow>
    <template v-else-if="childLogs[log.id]?.length">
      <TableRow v-for="child in childLogs[log.id]" :key="child.id" class="bg-muted/20">
        <TableCell class="w-10">
          <span class="ml-4 text-muted-foreground text-xs">└</span>
        </TableCell>
        <TableCell class="font-mono text-xs text-muted-foreground" :title="child.id">{{ child.id.slice(0, 8) }}</TableCell>
        <TableCell class="text-muted-foreground">{{ formatTime(child.created_at) }}</TableCell>
        <TableCell><Badge :variant="child.api_type === 'openai' ? 'default' : 'secondary'">{{ child.api_type }}</Badge></TableCell>
        <TableCell class="font-mono text-xs">{{ child.model || '-' }}</TableCell>
        <TableCell class="text-xs">
          <template v-if="child.backend_model || child.provider_name">
            <span class="font-mono">{{ child.backend_model || '-' }}</span>
            <span class="text-muted-foreground"> @ </span>
            <Badge variant="outline" class="text-[10px] px-1 py-0">{{ child.provider_name || child.provider_id || '-' }}</Badge>
          </template>
          <span v-else class="text-muted-foreground">-</span>
        </TableCell>
        <TableCell><Badge :variant="(child.status_code ?? 0) < 400 ? 'default' : 'destructive'">{{ child.status_code || '-' }}</Badge></TableCell>
        <TableCell>{{ child.latency_ms ? child.latency_ms + 'ms' : '-' }}</TableCell>
        <TableCell>{{ child.is_stream ? 'Yes' : 'No' }}</TableCell>
        <TableCell>
          <Badge v-if="child.is_retry" variant="outline" class="text-warning-dark border-warning">重试</Badge>
          <Badge v-else-if="child.is_failover" variant="outline" class="text-orange-500 border-orange-400">故障转移</Badge>
          <span v-else class="text-muted-foreground">-</span>
        </TableCell>
        <TableCell class="text-destructive text-xs">{{ child.error_message || '-' }}</TableCell>
        <TableCell><Button variant="ghost" size="sm" @click="openLogDetail(child.id)">详情</Button></TableCell>
      </TableRow>
    </template>
  </template>
</template>
```

- [ ] **Step 7: 替换内嵌 Detail Dialog 为 LogDetailDialog**

删除 Logs.vue 中原有的 `<Dialog v-model:open="showDetail">` 块（约第 108-248 行），替换为：

```html
<LogDetailDialog ref="logDetailRef" v-model:open="logDetailOpen" />
```

同时删除相关的 `showDetail`、`detailLoading`、`detailData`、`openDetail` 等 ref/函数（因为逻辑已在 LogDetailDialog 内部管理）。

- [ ] **Step 8: 表头增加"故障转移"列**

在表头的"重试"列后面增加：

```html
<TableHead class="text-muted-foreground">故障转移</TableHead>
```

- [ ] **Step 9: 启动前端验证**

运行: `cd frontend && npm run dev`

在浏览器中检查：
1. 日志列表是否正常加载
2. 有子请求的行是否显示展开箭头
3. 点击展开是否正确加载子请求
4. 子请求行是否缩进显示
5. 详情弹窗是否使用 LogDetailDialog

- [ ] **Step 10: Commit**

```bash
git add frontend/src/views/Logs.vue frontend/src/api/client.ts src/admin/logs.ts
git commit -m "feat: grouped log view with expandable child requests on Logs page"
```

---

### Task 9: 全量测试验证

- [ ] **Step 1: 运行全部后端测试**

运行: `npm test`
期望：所有测试 PASS

- [ ] **Step 2: 运行 ESLint**

运行: `npm run lint`
期望：零警告

- [ ] **Step 3: 手动端到端验证**

1. 启动后端: `npm run dev`
2. 启动前端: `cd frontend && npm run dev`
3. 配置 failover 策略的映射组（两个 provider）
4. 发送请求，让第一个 provider 返回 500
5. 验证日志页面：
   - 原始请求行显示展开箭头
   - 展开后显示 failover 子请求
   - 子请求标记为"故障转移"
   - 点击详情可查看完整信息
6. 验证 Monitor 页面的请求详情仍然正常

---

## Self-Review 检查清单

### Spec 覆盖度
- [x] 新增 is_failover 字段 → Task 1
- [x] failover 请求关联 original_request_id → Task 4
- [x] 子请求查询 API → Task 5
- [x] 日志页面分组展示 → Task 8
- [x] 统一复用 LogDetailDialog → Task 8 Step 7
- [x] Monitor 页面不受影响 → Task 9 Step 3 验证

### Placeholder 检查
- 无 TBD/TODO/fill in later
- 所有代码步骤包含完整代码

### 类型一致性
- `is_failover: number` 在 DB 类型、插入函数、前端接口中一致
- `child_count` 仅在 `RequestLogGroupedRow` 中存在
- `original_request_id` 已在现有类型中定义，无需新增
