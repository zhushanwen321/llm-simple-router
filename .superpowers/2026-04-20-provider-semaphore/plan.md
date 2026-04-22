# Provider Semaphore 限流功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 router 代理层实现 per-provider 的 semaphore 并发控制，请求超过限制时排队等待而非直接拒绝，对客户端透明。

**Architecture:** 新建 `src/proxy/semaphore.ts` 作为核心限流模块，通过 `ProviderSemaphoreManager` 单例管理每个 provider 的并发状态。在 `handleProxyPost` 中使用 try/finally 模式集成 acquire/release，确保 failover 切换时正确释放。Admin API 和前端增加并发配置和状态展示。

**Tech Stack:** TypeScript, better-sqlite3 (migration), Fastify, Vue 3 + shadcn-vue (Switch)

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/db/migrations/017_add_provider_concurrency.sql` | 新建 | providers 表增加 3 个并发控制字段 |
| `src/proxy/semaphore.ts` | 新建 | Semaphore Manager 核心模块，~120 行 |
| `src/db/providers.ts` | 修改 | Provider 类型/CRUD 增加并发字段 |
| `src/proxy/proxy-core.ts` | 修改 | handleProxyPost 集成 acquire/release |
| `src/proxy/openai.ts` | 修改 | openaiErrors 增加并发错误格式 + Options 传递 semaphoreManager |
| `src/proxy/anthropic.ts` | 修改 | anthropicErrors 增加并发错误格式 + Options 传递 semaphoreManager |
| `src/admin/providers.ts` | 修改 | Admin API 增加并发字段 CRUD + 状态查询 |
| `src/index.ts` | 修改 | 启动时从 DB 初始化 semaphore 配置 |
| `frontend/src/api/client.ts` | 修改 | ProviderPayload 类型增加字段 |
| `frontend/src/views/Providers.vue` | 修改 | 表格和表单增加并发控制 |
| `tests/semaphore.test.ts` | 新建 | Semaphore Manager 单元测试 |
| `tests/admin-providers.test.ts` | 修改 | 增加并发配置相关测试 |

---

### Task 1: 数据库迁移

**Files:**
- Create: `src/db/migrations/017_add_provider_concurrency.sql`

- [ ] **Step 1: 创建迁移文件**

```sql
-- src/db/migrations/017_add_provider_concurrency.sql
ALTER TABLE providers ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN queue_timeout_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN max_queue_size INTEGER NOT NULL DEFAULT 100;
```

- [ ] **Step 2: 验证迁移在测试中生效**

Run: `npx vitest run tests/db.test.ts --reporter=verbose`
Expected: 全部通过，migration 017 自动应用

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/017_add_provider_concurrency.sql
git commit -m "feat(semaphore): add concurrency columns to providers table"
```

---

### Task 2: Provider 数据层更新

**Files:**
- Modify: `src/db/providers.ts` (Provider 类型 + PROVIDER_FIELDS + createProvider + updateProvider)

- [ ] **Step 1: 更新 Provider 接口**

在 `src/db/providers.ts` 的 `Provider` 接口中增加三个字段：

```typescript
export interface Provider {
  // ... existing fields ...
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
}
```

- [ ] **Step 2: 更新 PROVIDER_FIELDS 白名单**

```typescript
const PROVIDER_FIELDS = new Set([
  "name", "api_type", "base_url", "api_key", "api_key_preview", "models", "is_active",
  "max_concurrency", "queue_timeout_ms", "max_queue_size",
]);
```

- [ ] **Step 3: 更新 createProvider**

在 `createProvider` 函数中增加新字段的插入：

```typescript
export function createProvider(
  db: Database.Database,
  provider: {
    // ... existing fields ...
    max_concurrency?: number;
    queue_timeout_ms?: number;
    max_queue_size?: number;
  },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, api_key_preview, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, provider.name, provider.api_type, provider.base_url,
    provider.api_key, provider.api_key_preview ?? null,
    provider.models ?? "[]",
    provider.is_active ?? 1,
    provider.max_concurrency ?? 0,
    provider.queue_timeout_ms ?? 0,
    provider.max_queue_size ?? 100,
    now, now,
  );
  return id;
}
```

- [ ] **Step 4: 更新 updateProvider 的 Pick 类型**

```typescript
export function updateProvider(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<Provider, "name" | "api_type" | "base_url" | "api_key" | "api_key_preview" | "is_active" | "max_concurrency" | "queue_timeout_ms" | "max_queue_size">>,
): void {
  buildUpdateQuery(db, "providers", id, fields, PROVIDER_FIELDS, { updatedAt: true });
}
```

- [ ] **Step 5: 运行现有测试验证无回归**

Run: `npx vitest run tests/admin-providers.test.ts --reporter=verbose`
Expected: 全部通过

- [ ] **Step 6: Commit**

```bash
git add src/db/providers.ts
git commit -m "feat(semaphore): update Provider type and CRUD for concurrency fields"
```

---

### Task 3: Semaphore Manager 核心模块

**Files:**
- Create: `src/proxy/semaphore.ts`
- Create: `tests/semaphore.test.ts`

- [ ] **Step 1: 编写 Semaphore Manager 单元测试（TDD）**

创建 `tests/semaphore.test.ts`，覆盖以下场景：

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { ProviderSemaphoreManager, SemaphoreQueueFullError, SemaphoreTimeoutError } from "../src/proxy/semaphore.js";

describe("ProviderSemaphoreManager", () => {
  let mgr: ProviderSemaphoreManager;

  beforeEach(() => { mgr = new ProviderSemaphoreManager(); });

  // 1. maxConcurrency=0 时 acquire 立即返回
  it("acquire returns immediately when maxConcurrency=0", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 0, queueTimeoutMs: 0, maxQueueSize: 100 });
    await mgr.acquire("p1");
    const status = mgr.getStatus("p1");
    expect(status.active).toBe(0); // 不计数
    expect(status.queued).toBe(0);
  });

  // 2. 未配置的 provider 默认不限流
  it("acquire for unconfigured provider returns immediately", async () => {
    await mgr.acquire("unknown");
    expect(mgr.getStatus("unknown")).toEqual({ active: 0, queued: 0 });
  });

  // 3. 并发限制内正常 acquire/release
  it("acquire and release within limit", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 2, queueTimeoutMs: 0, maxQueueSize: 100 });
    await mgr.acquire("p1");
    expect(mgr.getStatus("p1").active).toBe(1);
    mgr.release("p1");
    expect(mgr.getStatus("p1").active).toBe(0);
  });

  // 4. 超过并发限制时排队等待
  it("queues when at capacity and wakes on release", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 100 });
    await mgr.acquire("p1"); // 占用唯一槽位

    let resolved = false;
    const p = mgr.acquire("p1").then(() => { resolved = true; });
    expect(mgr.getStatus("p1").queued).toBe(1);
    expect(resolved).toBe(false);

    mgr.release("p1"); // 唤醒排队者
    await p;
    expect(resolved).toBe(true);
    expect(mgr.getStatus("p1").active).toBe(1); // 出1进1
  });

  // 5. 队列满时抛 SemaphoreQueueFullError
  it("throws SemaphoreQueueFullError when queue is full", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 1 });
    await mgr.acquire("p1"); // 占用
    mgr.acquire("p1"); // 排队（不 await，占满队列）

    await expect(mgr.acquire("p1")).rejects.toThrow(SemaphoreQueueFullError);
  });

  // 6. 排队超时抛 SemaphoreTimeoutError
  it("throws SemaphoreTimeoutError on queue timeout", async () => {
    vi.useFakeTimers();
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 1000, maxQueueSize: 100 });
    await mgr.acquire("p1"); // 占用

    const p = mgr.acquire("p1");
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toThrow(SemaphoreTimeoutError);
    vi.useRealTimers();
  });

  // 7. AbortSignal 中断时从队列移除
  it("removes from queue on abort signal", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 100 });
    await mgr.acquire("p1"); // 占用

    const ac = new AbortController();
    const p = mgr.acquire("p1", ac.signal);
    expect(mgr.getStatus("p1").queued).toBe(1);

    ac.abort();
    await expect(p).rejects.toThrow();
    expect(mgr.getStatus("p1").queued).toBe(0);
  });

  // 8. release 不存在的 provider 静默返回
  it("release unknown provider is no-op", () => {
    expect(() => mgr.release("nonexistent")).not.toThrow();
  });

  // 9. updateConfig 调高 maxConcurrency 时唤醒排队者
  it("updateConfig wakes queued when increasing maxConcurrency", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 100 });
    await mgr.acquire("p1"); // 占用

    const p = mgr.acquire("p1"); // 排队
    expect(mgr.getStatus("p1").queued).toBe(1);

    mgr.updateConfig("p1", { maxConcurrency: 3, queueTimeoutMs: 0, maxQueueSize: 100 });
    await p;
    expect(mgr.getStatus("p1").active).toBe(2);
    expect(mgr.getStatus("p1").queued).toBe(0);
  });

  // 10. remove 拒绝所有等待者
  it("remove rejects all queued entries", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 100 });
    await mgr.acquire("p1"); // 占用

    const p = mgr.acquire("p1"); // 排队
    mgr.remove("p1");
    await expect(p).rejects.toThrow("Provider removed");
    expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/semaphore.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 Semaphore Manager**

创建 `src/proxy/semaphore.ts`，实现 `ProviderSemaphoreManager` 类和错误类型：

```typescript
export class SemaphoreQueueFullError extends Error {
  constructor(public readonly providerId: string) {
    super(`Provider '${providerId}' concurrency queue is full`);
    this.name = "SemaphoreQueueFullError";
  }
}

export class SemaphoreTimeoutError extends Error {
  constructor(public readonly providerId: string, public readonly timeoutMs: number) {
    super(`Provider '${providerId}' concurrency wait timeout (${timeoutMs}ms)`);
    this.name = "SemaphoreTimeoutError";
  }
}
```

实现要点（参考 spec 中的伪代码）：
- `getOrCreate` 默认创建 `maxConcurrency: 0` 的条目
- `acquire` 实现即时/排队两条路径，支持 AbortSignal 和超时
- `release` 有排队者时 FIFO 唤醒（不递减 current），无排队者时 current--
- `updateConfig` 先更新 config，再唤醒可容纳的排队者
- `remove` reject 队列中所有等待者，清理 timer，移除 entry

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/semaphore.test.ts --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/semaphore.ts tests/semaphore.test.ts
git commit -m "feat(semaphore): implement ProviderSemaphoreManager with tests"
```

---

### Task 4: ProxyErrorFormatter 扩展

**Files:**
- Modify: `src/proxy/proxy-core.ts` (ProxyErrorFormatter 接口)
- Modify: `src/proxy/openai.ts` (openaiErrors 实现)
- Modify: `src/proxy/anthropic.ts` (anthropicErrors 实现)

- [ ] **Step 1: 扩展 ProxyErrorFormatter 接口**

在 `src/proxy/proxy-core.ts` 的 `ProxyErrorFormatter` 接口中增加两个方法：

```typescript
export interface ProxyErrorFormatter {
  // ... existing methods ...
  concurrencyQueueFull(providerId: string): ProxyErrorResponse;
  concurrencyTimeout(providerId: string, timeoutMs: number): ProxyErrorResponse;
}
```

- [ ] **Step 2: 在 openai.ts 中实现**

```typescript
// 在 openaiErrors 对象中增加：
concurrencyQueueFull: (providerId) => ({
  statusCode: 503,
  body: { error: { message: `Provider '${providerId}' concurrency queue is full`, type: "server_error", code: "concurrency_queue_full" } },
}),
concurrencyTimeout: (providerId, timeoutMs) => ({
  statusCode: 504,
  body: { error: { message: `Provider '${providerId}' concurrency wait timeout (${timeoutMs}ms)`, type: "server_error", code: "concurrency_timeout" } },
}),
```

- [ ] **Step 3: 在 anthropic.ts 中实现**

```typescript
// 在 anthropicErrors 对象中增加：
concurrencyQueueFull: (providerId) => ({
  statusCode: 503,
  body: { type: "error", error: { type: "api_error", message: `Provider '${providerId}' concurrency queue is full` } },
}),
concurrencyTimeout: (providerId, timeoutMs) => ({
  statusCode: 504,
  body: { type: "error", error: { type: "api_error", message: `Provider '${providerId}' concurrency wait timeout (${timeoutMs}ms)` } },
}),
```

- [ ] **Step 4: 运行编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/proxy/proxy-core.ts src/proxy/openai.ts src/proxy/anthropic.ts
git commit -m "feat(semaphore): add concurrency error formatters to ProxyErrorFormatter"
```

---

### Task 5: handleProxyPost 集成 Semaphore

**Files:**
- Modify: `src/proxy/proxy-core.ts` (handleProxyPost 函数)

这是最关键的任务。semaphore 集成必须确保每条退出路径都释放。

- [ ] **Step 1: 修改 ProxyHandlerDeps 接口，注入 semaphoreManager**

```typescript
import { ProviderSemaphoreManager } from "./semaphore.js";

export interface ProxyHandlerDeps {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  semaphoreManager?: ProviderSemaphoreManager;
}
```

- [ ] **Step 2: 在 handleProxyPost 的 while 循环中集成 acquire/release**

在 `resolveMapping` + provider 校验之后、`body.model = resolved.backend_model` 之前，插入 semaphore acquire 逻辑。在 failover continue 前和所有退出路径前释放。

关键集成点（参考 spec 伪代码）：

1. provider 校验通过后、`body.model = resolved.backend_model` 之前，执行 `acquire`
2. acquire 失败处理：AbortError 静默返回，QueueFull 返回 503，Timeout 返回 504
3. 在 try 块内的 failover `continue` 前 `releaseSemaphore()`
4. 在 try 块正常返回前 `releaseSemaphore()`
5. 在 catch 块的 failover `continue` 前 `releaseSemaphore()`
6. 在 catch 块的最终返回前 `releaseSemaphore()`
7. 使用 `semaphoreReleased` flag 防止重复释放

> **注意：request.raw 监听器累积**。failover 循环内每次迭代都创建新的 `AbortController` 并注册 `request.raw.on("close", ...)` 监听器。`abort()` 是幂等的，多次调用无副作用。典型场景 failover 2-3 次，累积 2-3 个监听器，随请求结束自动清理。若需严格清理，可在 acquire 成功后 `request.raw.removeListener("close", handler)`，但实际影响极小，当前不做处理。

在文件顶部增加导入：
```typescript
import { ProviderSemaphoreManager, SemaphoreQueueFullError, SemaphoreTimeoutError } from "./semaphore.js";
```

在 `handleProxyPost` 函数中（while 循环内、provider 校验后）插入：

```typescript
// === Semaphore acquire ===
const semaphoreManager = deps.semaphoreManager;
let semaphoreReleased = false;
const releaseSemaphore = () => {
  if (!semaphoreReleased) {
    semaphoreReleased = true;
    semaphoreManager?.release(provider.id);
  }
};

if (semaphoreManager) {
  const ac = new AbortController();
  request.raw.on("close", () => ac.abort());
  try {
    await semaphoreManager.acquire(provider.id, ac.signal);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return reply;
    if (err instanceof SemaphoreQueueFullError) {
      const e = errors.concurrencyQueueFull(provider.id);
      return reply.status(e.statusCode).send(e.body);
    }
    if (err instanceof SemaphoreTimeoutError) {
      const e = errors.concurrencyTimeout(provider.id, err.timeoutMs);
      return reply.status(e.statusCode).send(e.body);
    }
    throw err;
  }
}
```

在所有退出路径前调用 `releaseSemaphore()`：

```typescript
// Failover 成功路径（statusCode >= FAILOVER_FAIL_THRESHOLD）
if (isFailover && r.statusCode >= FAILOVER_FAIL_THRESHOLD && !reply.raw.headersSent) {
  releaseSemaphore();
  excludeTargets.push(resolved);
  continue;
}

// 正常返回前 — 流式成功 (return reply) 和非流式 (return reply.status().send()) 前调用
releaseSemaphore();
return reply;

// Failover 异常路径
if (isFailover && !reply.raw.headersSent) {
  releaseSemaphore();
  excludeTargets.push(resolved);
  continue;
}

// 最终异常返回前
releaseSemaphore();
```

- [ ] **Step 3: 修改 openai.ts / anthropic.ts 的 Options 接口和 deps 传递**

在 `src/proxy/openai.ts` 的 `OpenaiProxyOptions` 接口中增加：
```typescript
import { ProviderSemaphoreManager } from "./semaphore.js";

export interface OpenaiProxyOptions {
  // ... existing fields ...
  semaphoreManager?: ProviderSemaphoreManager;
}
```

在 `POST /v1/chat/completions` handler 中，构建 deps 时传入：
```typescript
const deps: ProxyHandlerDeps = { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher, semaphoreManager };
```

同样修改 `src/proxy/anthropic.ts` 的 `AnthropicProxyOptions` 和 deps 构建。

- [ ] **Step 4: 运行编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: 运行现有代理测试验证无回归**

Run: `npx vitest run tests/openai-proxy.test.ts tests/anthropic-proxy.test.ts --reporter=verbose`
Expected: 全部通过（semaphoreManager 默认 undefined，不影响现有逻辑）

- [ ] **Step 6: Commit**

```bash
git add src/proxy/proxy-core.ts src/proxy/openai.ts src/proxy/anthropic.ts
git commit -m "feat(semaphore): integrate semaphore acquire/release into handleProxyPost"
```

---

### Task 6: Admin API 集成

**Files:**
- Modify: `src/admin/providers.ts`

- [ ] **Step 1: 在 admin provider routes 中注入并使用 semaphoreManager**

修改 `src/admin/providers.ts`：

1. 导入 semaphore 模块：
```typescript
import { ProviderSemaphoreManager } from "../proxy/semaphore.js";
```

2. 在 `ProviderRoutesOptions` 中增加 semaphoreManager：
```typescript
interface ProviderRoutesOptions {
  db: Database.Database;
  semaphoreManager?: ProviderSemaphoreManager;
}
```

3. `GET /admin/api/providers` 响应增加并发字段和状态：
```typescript
// 在 providers.map 回调中增加：
max_concurrency: s.max_concurrency,
queue_timeout_ms: s.queue_timeout_ms,
max_queue_size: s.max_queue_size,
concurrency_status: semaphoreManager?.getStatus(s.id) ?? { active: 0, queued: 0 },
```

4. `CreateProviderSchema` 和 `UpdateProviderSchema` 增加可选字段：
```typescript
// CreateProviderSchema 增加：
max_concurrency: Type.Optional(Type.Number({ minimum: 0 })),
queue_timeout_ms: Type.Optional(Type.Number({ minimum: 0 })),
max_queue_size: Type.Optional(Type.Number({ minimum: 1 })),

// UpdateProviderSchema 增加同样三个可选字段
```

5. `POST /admin/api/providers` 创建后初始化 semaphore：
```typescript
// 在 createProvider 调用后：
semaphoreManager?.updateConfig(id, {
  maxConcurrency: body.max_concurrency ?? 0,
  queueTimeoutMs: body.queue_timeout_ms ?? 0,
  maxQueueSize: body.max_queue_size ?? 100,
});
```

6. `PUT /admin/api/providers/:id` 更新后同步 semaphore：
```typescript
// 在 updateProvider 调用后：
if (body.max_concurrency !== undefined || body.queue_timeout_ms !== undefined || body.max_queue_size !== undefined) {
  const updated = getProviderById(db, id)!;
  semaphoreManager?.updateConfig(id, {
    maxConcurrency: updated.max_concurrency,
    queueTimeoutMs: updated.queue_timeout_ms,
    maxQueueSize: updated.max_queue_size,
  });
}
```

7. `DELETE /admin/api/providers/:id` 删除后清理 semaphore：
```typescript
// 在 deleteProvider 调用后：
semaphoreManager?.remove(id);
```

- [ ] **Step 2: 更新 admin routes 注册入口传递 semaphoreManager**

修改 `src/admin/routes.ts`：

```typescript
import { ProviderSemaphoreManager } from "../proxy/semaphore.js";

interface AdminRoutesOptions {
  db: Database.Database;
  matcher: RetryRuleMatcher | null;
  semaphoreManager?: ProviderSemaphoreManager;
}

// adminProviderRoutes 注册改为：
app.register(adminProviderRoutes, { db: options.db, semaphoreManager: options.semaphoreManager });
```

- [ ] **Step 3: 运行 admin 测试验证**

Run: `npx vitest run tests/admin-providers.test.ts --reporter=verbose`
Expected: 全部通过（现有测试不传 semaphoreManager，行为不变）

- [ ] **Step 4: Commit**

```bash
git add src/admin/providers.ts src/admin/routes.ts
git commit -m "feat(semaphore): integrate semaphore into admin provider CRUD"
```

---

### Task 7: 启动初始化

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 在 buildApp 中初始化 semaphoreManager**

在 `src/index.ts` 的 `buildApp` 函数中，数据库初始化完成后：

```typescript
import { ProviderSemaphoreManager } from "./proxy/semaphore.js";
import { getAllProviders } from "./db/index.js";

// 在 seedDefaultRules(db) 之后：
const semaphoreManager = new ProviderSemaphoreManager();
const providers = getAllProviders(db);
for (const p of providers) {
  if (p.max_concurrency > 0) {
    semaphoreManager.updateConfig(p.id, {
      maxConcurrency: p.max_concurrency,
      queueTimeoutMs: p.queue_timeout_ms,
      maxQueueSize: p.max_queue_size,
    });
  }
}
```

将 `semaphoreManager` 传入代理插件和 admin 路由的 options 中：

```typescript
// 代理插件注册（第 132-145 行）：
app.register(openaiProxy, {
  db, streamTimeoutMs: config.STREAM_TIMEOUT_MS,
  retryMaxAttempts: config.RETRY_MAX_ATTEMPTS, retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
  matcher, semaphoreManager,
});
app.register(anthropicProxy, {
  db, streamTimeoutMs: config.STREAM_TIMEOUT_MS,
  retryMaxAttempts: config.RETRY_MAX_ATTEMPTS, retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
  matcher, semaphoreManager,
});

// admin 路由注册（第 147 行）：
app.register(adminRoutes, { db, matcher, semaphoreManager });
```

- [ ] **Step 2: 运行编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 运行全部测试**

Run: `npx vitest run --reporter=verbose`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(semaphore): initialize semaphore config from DB on startup"
```

---

### Task 8: 前端 — API 类型更新

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: 更新 ProviderPayload 接口**

```typescript
interface ProviderPayload {
  name: string
  api_type: string
  base_url: string
  api_key?: string
  models?: string[]
  is_active: number
  max_concurrency?: number
  queue_timeout_ms?: number
  max_queue_size?: number
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat(semaphore): update ProviderPayload type for concurrency fields"
```

---

### Task 9: 前端 — Providers 页面更新

**Files:**
- Modify: `frontend/src/views/Providers.vue`

- [ ] **Step 0: 确认 Switch 组件已安装**

检查 `frontend/src/components/ui/switch/` 是否存在。如不存在，执行：
```bash
cd frontend && npx shadcn-vue@latest add switch
```

- [ ] **Step 1: 表格增加"并发"列**

在 TableHeader（"状态"列之前）增加一列"并发"，在 TableRow 中显示配置值：
- `max_concurrency === 0` 或未设置 → 显示 `-`
- `max_concurrency > 0` → 显示蓝色 Badge 数字（如 `5`）

```vue
<TableHead class="text-muted-foreground">并发</TableHead>
```

```vue
<TableCell>
  <Badge v-if="p.max_concurrency > 0" variant="secondary">{{ p.max_concurrency }}</Badge>
  <span v-else class="text-muted-foreground">-</span>
</TableCell>
```

不显示实时活跃/等待数。后端 `concurrency_status` 字段已预留，为后续独立监控页面使用。

- [ ] **Step 2: 编辑表单增加 Switch 控制**

在"启用"Checkbox 之前增加并发控制区域：

```vue
<div>
  <div class="flex items-center gap-2 mb-1">
    <Switch v-model:checked="concurrencyEnabled" id="concurrency-switch" />
    <Label for="concurrency-switch" class="text-sm text-foreground">并发控制</Label>
  </div>
  <div v-if="concurrencyEnabled" class="mt-2">
    <Label class="block text-sm font-medium text-foreground mb-1">最大并发数</Label>
    <Input v-model.number="form.max_concurrency" type="number" min="1" max="100" placeholder="3" />
  </div>
</div>
```

需要在 script 中：
- 导入 Switch 组件：`import { Switch } from '@/components/ui/switch'`
- 增加 `concurrencyEnabled` ref
- `openCreate` 时重置为 false
- `openEdit` 时根据 `p.max_concurrency > 0` 设置
- `buildPayload` 中根据 `concurrencyEnabled` 设置 `max_concurrency`

- [ ] **Step 3: 更新 Provider 接口和 DEFAULT_FORM**

```typescript
interface Provider {
  // ... existing fields ...
  max_concurrency: number
  concurrency_status?: { active: number; queued: number }
}
```

```typescript
const DEFAULT_FORM = {
  name: '', api_type: 'anthropic', base_url: '', api_key: '',
  models: [] as string[], is_active: true, max_concurrency: 3,
}
```

- [ ] **Step 4: 验证前端构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Providers.vue
git commit -m "feat(semaphore): add concurrency control UI to Providers page"
```

---

### Task 10: 集成测试和端到端验证

**Files:**
- Modify: `tests/admin-providers.test.ts` (增加并发配置测试)
- Create: `tests/proxy-semaphore.test.ts` (proxy 层 semaphore 集成测试)

- [ ] **Step 0: 编写 proxy 层 semaphore 集成测试**

创建 `tests/proxy-semaphore.test.ts`，使用 mock 后端验证 semaphore 在代理链路中的行为：

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { encrypt } from "../src/utils/crypto.js";
import { createModelMapping, createMappingGroup } from "../src/db/index.js";
import { openaiProxy } from "../src/proxy/openai.js";
import { ProviderSemaphoreManager } from "../src/proxy/semaphore.js";

const TEST_KEY = "0123456789abcdef".repeat(4);

function createMockBackend(handler: (req: IncomingMessage, res: ServerResponse) => void) { /* ... 同 openai-proxy.test.ts */ }

describe("Proxy semaphore integration", () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let mockServer: Server;
  let mockPort: number;
  let semaphoreManager: ProviderSemaphoreManager;
  let close: () => Promise<void>;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_KEY);
    // 创建 provider 和 mapping
    // ...

    semaphoreManager = new ProviderSemaphoreManager();
    semaphoreManager.updateConfig(providerId, { maxConcurrency: 2, queueTimeoutMs: 0, maxQueueSize: 100 });

    const { server, port } = await createMockBackend(/* ... */);
    mockServer = server;
    mockPort = port;

    app = Fastify();
    app.register(openaiProxy, { db, streamTimeoutMs: 5000, retryMaxAttempts: 0, retryBaseDelayMs: 0, semaphoreManager });
  });

  afterEach(async () => { /* cleanup */ });

  it("releases semaphore after successful non-stream request", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/chat/completions", payload: { model: "test-model" } });
    expect(res.statusCode).toBe(200);
    expect(semaphoreManager.getStatus(providerId).active).toBe(0);
  });

  it("rejects with 503 when queue is full", async () => {
    // 设置 maxConcurrency=1, maxQueueSize=0
    semaphoreManager.updateConfig(providerId, { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 0 });
    // 发送一个会占用 semaphore 的慢请求，然后发第二个
    // 第二个应收到 503
  });

  it("releases semaphore on failover switch", async () => {
    // 配置 failover 策略，第一个 provider 返回 500
    // 验证第一个 provider 的 semaphore 被释放
  });
});
```

- [ ] **Step 1: 运行集成测试确认通过**

Run: `npx vitest run tests/proxy-semaphore.test.ts --reporter=verbose`
Expected: 全部通过

- [ ] **Step 2: 为 admin providers 增加并发配置测试**

- [ ] **Step 1: 为 admin providers 增加并发配置测试**

在 `tests/admin-providers.test.ts` 中增加：

```typescript
it("POST creates provider with max_concurrency", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/providers",
    headers: { cookie, "content-type": "application/json" },
    payload: {
      name: "Test-Concurrent",
      api_type: "openai",
      base_url: "https://api.openai.com",
      api_key: "sk-test-abc",
      max_concurrency: 5,
    },
  });
  expect(res.statusCode).toBe(201);

  const getRes = await app.inject({
    method: "GET",
    url: "/admin/api/providers",
    headers: { cookie },
  });
  const providers = getRes.json();
  expect(providers[0].max_concurrency).toBe(5);
});

it("PUT updates max_concurrency", async () => {
  const createRes = await app.inject({
    method: "POST",
    url: "/admin/api/providers",
    headers: { cookie, "content-type": "application/json" },
    payload: { name: "Test-Concurrent", api_type: "openai", base_url: "https://api.openai.com", api_key: "sk-test" },
  });
  const id = createRes.json().id;

  await app.inject({
    method: "PUT",
    url: `/admin/api/providers/${id}`,
    headers: { cookie, "content-type": "application/json" },
    payload: { max_concurrency: 3 },
  });

  const getRes = await app.inject({
    method: "GET",
    url: "/admin/api/providers",
    headers: { cookie },
  });
  expect(getRes.json()[0].max_concurrency).toBe(3);
});
```

- [ ] **Step 3: 运行全部测试**

Run: `npx vitest run --reporter=verbose`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add tests/proxy-semaphore.test.ts tests/admin-providers.test.ts
git commit -m "test(semaphore): add proxy and admin integration tests for concurrency"
```

---

## Task 依赖关系

```
Task 1 (migration) → Task 2 (db layer) → Task 3 (semaphore core) → Task 4 (error formatter) → Task 5 (proxy integration)
                    ↓                                                      ↓
                    └──────────────────────────────────────→ Task 6 (admin API) → Task 7 (startup init)
                                                                               ↓
                                                                          Task 8 (frontend types) → Task 9 (frontend UI) → Task 10 (integration tests)
```

- Task 1-3 可独立并行开发（但测试依赖迁移）
- Task 4 和 Task 5 有严格顺序
- Task 6 依赖 Task 2（需要更新后的 Provider 类型）和 Task 3（需要 ProviderSemaphoreManager 类型）
- Task 7 依赖 Task 5（代理插件 Options 需 semaphoreManager 字段）和 Task 6（admin routes 传递链）
- Task 8-9 为前端，可独立于后端 Task 5-7
- Task 10 应最后执行
