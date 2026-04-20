# Provider Semaphore 限流功能设计

## Context

使用智谱等 provider 的 Coding Plan 时，Claude Code 多 subagent 并发请求经常触发服务端限流（429）。客户端缺乏灵活的限流机制，只能通过限制 subagent 并发度来缓解，非常不灵活。

本功能在 router 层实现 per-provider 的 semaphore 限流，请求超过并发限制时排队等待而非直接拒绝，对客户端透明。

## 需求总结

1. 每个 provider 独立 semaphore，该 provider 下所有 model 共享
2. 超过并发限制的请求进入 FIFO 队列等待
3. 支持队列超时（可配置，0=无限等待）和队列大小限制（可配置）
4. 流式请求持有 semaphore 直到流结束
5. Failover 时切换到新 provider 的 semaphore
6. 客户端断开连接时自动从队列移除

## 并发模型

### 运行环境

项目运行在 Node.js 单进程上（Fastify 服务器）。Node.js 事件循环是单线程的，同步代码在一个 tick 内不可中断。这意味着：

- `Map.get()` / `Map.set()` / `Array.push()` / `Array.shift()` 等同步操作天然原子，无需 mutex
- `acquire()` 和 `release()` 内的状态修改（`current++`、`current--`、`queue.shift()`）不存在竞态
- 异步边界（`await`）是并发交错点：一个 `await` 挂起后，其他 handler 可以执行同步代码

因此 semaphore 的核心状态机全部使用同步操作，不引入锁。

### Semaphore 粒度

```
Provider A (id: "abc-123", max_concurrency: 5)
  ├── model: kimi-for-coding     ─┐
  ├── model: glm-4-plus          ─┤── 共享同一个 SemaphoreEntry (current=5)
  └── model: deepseek-chat       ─┘

Provider B (id: "def-456", max_concurrency: 3)
  └── model: claude-sonnet-4     ─── 独立 SemaphoreEntry (current=3)
```

- **粒度**：`provider.id`（UUID）。同一个 provider 的所有 model、所有请求路径（OpenAI/Anthropic）共享一个 semaphore
- **存储**：`ProviderSemaphoreManager` 内部 `Map<string, SemaphoreEntry>`
- **生命周期**：与进程相同。Provider 创建时 `updateConfig()`，删除时 `remove()`

### SemaphoreEntry 状态不变量

对于任意 provider，以下不变量始终成立：

```
Invariant 1: 0 <= entry.current <= entry.config.maxConcurrency  (当 maxConcurrency > 0)
Invariant 2: entry.queue.length <= entry.config.maxQueueSize
Invariant 3: entry.current + 排队中尚未被 resolve 的条目数 = 该 provider 的实际负载
```

### acquire/release 的计数逻辑

核心设计：`release()` 在有排队者时不递减 `current`（一个释放、一个获取，净变化为 0）：

```
acquire() 即时路径:
  current < maxConcurrency → current++, 返回

acquire() 排队路径:
  current >= maxConcurrency → 创建 Promise 加入 queue, 等待 resolve

release() 有排队者:
  queue.shift() → clearTimeout(timer) → resolve 该 Promise → current 不变（出1进1）

release() 无排队者:
  current--

abort/timeout 从队列移除:
  从 queue 中移除 → reject → current 不变（从未获取）
```

**为什么这避免了竞态**：在 Node.js 单线程中，`release()` 的 `queue.shift()` + `resolve()` 是同步执行的。被 resolve 的 Promise 的 `.then()` 回调在下一个微任务执行。在此期间，任何新的 `acquire()` 调用都会看到 `current` 仍为原值（因为 release 没有递减），因此正确地排队或获取。

## 数据模型

**Migration**: `src/db/migrations/017_add_provider_concurrency.sql`

```sql
ALTER TABLE providers ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN queue_timeout_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN max_queue_size INTEGER NOT NULL DEFAULT 100;
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `max_concurrency` | INTEGER | 0 | 最大并发请求数，0=不限流 |
| `queue_timeout_ms` | INTEGER | 0 | 排队最大等待毫秒数，0=无限等待 |
| `max_queue_size` | INTEGER | 100 | 队列最大等待数，超出返回 503 |

`max_concurrency = 0` 时该 provider 不限流，其余两个字段无意义。

## 核心模块：Semaphore Manager

**文件**: `src/proxy/semaphore.ts`（新建，约 120 行）

```typescript
interface ConcurrencyConfig {
  maxConcurrency: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout | null;
}

interface SemaphoreEntry {
  config: ConcurrencyConfig;
  current: number;
  queue: QueueEntry[];
}

class ProviderSemaphoreManager {
  private entries = new Map<string, SemaphoreEntry>();

  // 从 provider 配置更新 semaphore 参数
  updateConfig(providerId: string, config: ConcurrencyConfig): void;

  // 获取 semaphore。maxConcurrency=0 直接返回。
  // 队列满抛 SemaphoreQueueFullError，超时抛 SemaphoreTimeoutError。
  // AbortSignal 触发时从队列移除并抛 AbortError。
  async acquire(providerId: string, signal?: AbortSignal): Promise<void>;

  // 释放 semaphore。有排队者时 FIFO 唤醒下一个（同时清理 timer）。
  // entry 不存在时静默返回（no-op，处理 provider 删除后请求完成的场景）。
  release(providerId: string): void;

  // 获取当前状态
  getStatus(providerId: string): { active: number; queued: number };

  // 清理已删除 provider：reject 队列中所有等待者，清理 timer，移除 entry
  remove(providerId: string): void;
}
```

### updateConfig 的队列排空

当管理员将 `maxConcurrency` 从 3 调到 5，且当前有排队请求时，需要立即唤醒额外的排队者：

```typescript
updateConfig(providerId: string, newConfig: ConcurrencyConfig): void {
  const entry = this.getOrCreate(providerId);
  entry.config = newConfig;

  // 新增空闲槽位 → 唤醒排队者
  while (entry.current < newConfig.maxConcurrency && entry.queue.length > 0) {
    entry.current++;
    const queued = entry.queue.shift()!;
    if (queued.timer) clearTimeout(queued.timer);
    queued.resolve();
  }
}
```

当管理员将 `maxConcurrency` 调低时（如从 5 调到 3），不中断已运行的请求。新请求看到 `current >= maxConcurrency` 会排队，直到 `current` 自然下降。

### acquire AbortSignal 处理

```typescript
async acquire(providerId: string, signal?: AbortSignal): Promise<void> {
  const entry = this.getOrCreate(providerId);
  if (entry.config.maxConcurrency === 0) return; // 不限流

  if (entry.current < entry.config.maxConcurrency) {
    entry.current++;
    return;
  }

  if (entry.queue.length >= entry.config.maxQueueSize) {
    throw new SemaphoreQueueFullError(providerId);
  }

  return new Promise<void>((resolve, reject) => {
    const queueEntry: QueueEntry = { resolve, reject, timer: null };

    // 超时
    if (entry.config.queueTimeoutMs > 0) {
      queueEntry.timer = setTimeout(() => {
        const idx = entry.queue.indexOf(queueEntry);
        if (idx !== -1) entry.queue.splice(idx, 1);
        reject(new SemaphoreTimeoutError(providerId, entry.config.queueTimeoutMs));
      }, entry.config.queueTimeoutMs);
    }

    // 客户端断开
    if (signal) {
      const onAbort = () => {
        const idx = entry.queue.indexOf(queueEntry);
        if (idx !== -1) entry.queue.splice(idx, 1);
        if (queueEntry.timer) clearTimeout(queueEntry.timer);
        reject(new DOMException('Request aborted while waiting for semaphore', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    entry.queue.push(queueEntry);
  });
}
```

### getOrCreate 默认行为

当 `acquire()` 遇到未配置的 provider（Map 中无条目），创建一个 `maxConcurrency: 0` 的默认条目，等同于不限流。这防止了 admin 新建 provider 后、初始化完成前请求报错。

## 代理请求集成

**文件**: `src/proxy/proxy-core.ts`（修改 `handleProxyPost`）

### 核心原则

semaphore 的 acquire/release 必须使用 **try/finally 模式**，确保每一条退出路径都释放 semaphore。这是防止 semaphore 泄漏的关键。

### 集成伪代码

```
while (true) {
  // ... 现有 resolveMapping + provider 校验 ...

  // === acquire semaphore ===
  const ac = new AbortController();
  request.raw.on("close", () => ac.abort());
  try {
    await semaphoreManager.acquire(provider.id, ac.signal);
  } catch (err) {
    if (isAbortError(err)) return reply;           // 客户端已断开
    if (isQueueFull(err)) return reply.status(503).send(...);
    if (isTimeout(err)) return reply.status(504).send(...);
    throw err; // 不应到达
  }

  // === semaphore acquired，必须在所有退出路径释放 ===
  let semaphoreReleased = false;
  const releaseSemaphore = () => {
    if (!semaphoreReleased) {
      semaphoreReleased = true;
      semaphoreManager.release(provider.id);
    }
  };

  try {
    const { result: r, attempts } = retryableCall(...);

    // ... 现有日志记录 ...

    // --- Failover 成功路径（上游返回 >= 400）---
    if (isFailover && r.statusCode >= FAILOVER_FAIL_THRESHOLD && !reply.raw.headersSent) {
      releaseSemaphore(); // ← 关键：failover 切换前必须释放
      excludeTargets.push(resolved);
      continue;
    }

    // ... 现有响应发送 ...
    releaseSemaphore(); // 请求完成后释放（流式此时已结束）
    return reply;
  } catch (err) {
    // --- Failover 异常路径 ---
    if (isFailover && !reply.raw.headersSent) {
      releaseSemaphore(); // ← 关键：failover 切换前必须释放
      excludeTargets.push(resolved);
      continue;
    }

    releaseSemaphore();
    const e = errors.upstreamConnectionFailed();
    return reply.status(e.statusCode).send(e.body);
  }
}
```

### 流式释放时机

`upstreamStream`（`src/proxy/upstream-call.ts`）返回的 Promise 在以下 4 种事件之一触发时 resolve：

1. `upstreamRes.on("end")` — 上游正常结束
2. `reply.raw.on("close")` — 客户端断开
3. 空闲超时 — `setTimeout` 触发
4. `passThrough.on("error")` — 管道错误

`retryableCall` 包装了 `upstreamStream`，在 Promise resolve 后返回。此时流已完全结束（所有数据已传输或管道已清理），所以 `releaseSemaphore()` 在 `retryableCall` 返回后调用是正确的。semaphore 的持有时间 = 从 acquire 到流结束。

### request.raw 监听器清理

在 failover 循环中，每次迭代都添加 `request.raw.on("close", ...)` 监听器。为了避免监听器堆积：
- `AbortController` 的 `abort()` 是幂等的，多次调用无副作用
- 在 acquire 成功后（请求不再排队），新的 `close` 事件仅表示正常流结束，此时 `ac.abort()` 已无意义但不造成问题
- 若需严格清理，可在 acquire 成功后 `request.raw.removeListener("close", handler)`，但实际影响极小

## Admin API

**文件**: `src/admin/providers.ts`（修改）

- `GET /admin/api/providers` 响应增加 `max_concurrency`、`queue_timeout_ms`、`max_queue_size` 字段，以及 `concurrency_status: { active, queued }`
- `POST/PUT` schema 增加可选字段
- Provider 创建/更新时调用 `semaphoreManager.updateConfig()`
- Provider 删除时调用 `semaphoreManager.remove()`

## 前端

**文件**: `frontend/src/views/Providers.vue`（修改）

- 编辑表单增加 Switch（"并发控制"），开启时显示 `max_concurrency` 输入框，默认值 3
- 表格增加"并发"列，显示状态：不限 / `5 (3活跃/1等待)` 格式
- `queue_timeout_ms` 和 `max_queue_size` 使用默认值，不在前端暴露

**文件**: `frontend/src/api/client.ts`（修改 `ProviderPayload` 类型增加字段）

## 启动初始化

**文件**: `src/index.ts`（修改）

`buildApp()` 中，数据库初始化完成后，遍历所有 provider 调用 `semaphoreManager.updateConfig()` 加载配置。确保服务启动时 semaphore 状态正确。

## 错误响应

| 场景 | HTTP Status | 说明 |
|------|-------------|------|
| 队列已满 | 503 | `Provider concurrency queue is full` |
| 等待超时 | 504 | `Provider concurrency wait timeout` |
| 客户端断开 | 无响应 | 静默丢弃 |

错误响应格式遵循对应代理类型的格式（OpenAI / Anthropic），通过 `ProxyErrorFormatter` 新增两个方法实现。

## 涉及文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/db/migrations/017_add_provider_concurrency.sql` | 新建 | 数据库迁移 |
| `src/proxy/semaphore.ts` | 新建 | Semaphore Manager 核心模块 |
| `src/proxy/proxy-core.ts` | 修改 | 集成 acquire/release（try/finally 模式） |
| `src/proxy/proxy-core.ts` (ProxyErrorFormatter) | 修改 | 新增 queueFull / timeout 错误格式化方法 |
| `src/proxy/openai.ts` | 修改 | 更新 openaiErrors 增加两个新方法 |
| `src/proxy/anthropic.ts` | 修改 | 更新 anthropicErrors 增加两个新方法 |
| `src/db/providers.ts` | 修改 | Provider 类型增加字段，更新 PROVIDER_FIELDS |
| `src/admin/providers.ts` | 修改 | Admin API 增加 CRUD + 状态查询 |
| `src/index.ts` | 修改 | 启动时从 DB 初始化 semaphore 配置 |
| `frontend/src/views/Providers.vue` | 修改 | 表格和表单增加并发控制 |
| `frontend/src/api/client.ts` | 修改 | ProviderPayload 类型更新 |

## 已知限制

### 1. 并发度 ≠ 速率限制

Semaphore 限制"同时进行的请求数"，而非"每分钟请求数"。对于 Claude Code subagent 场景（长耗时流式请求），并发度与 RPM 天然对应（如 max_concurrency=5, 每请求 30s → ~10 RPM）。对于短请求场景，需配合 provider 侧 rate limit 规则使用。

### 2. 重试期间 semaphore 空转

`retryableCall` 在重试之间执行 `await sleep(delay)`，期间 semaphore 被持有但无上游请求。若重试退避时间较长（指数退避），会浪费并发槽位。当前阶段不处理，记录为后续优化方向。

**后续优化方案（双队列）**：引入 retryQueue 和 normalQueue 两个队列。`release()` 优先从 retryQueue 取请求。retry delay >= 阈值（如 20s）时 release semaphore → sleep → acquire(isRetry=true) 进入 retryQueue。这样长重试不浪费槽位，且重试请求优先于新请求获取 semaphore。

### 3. `GET /v1/models` 不受 semaphore 控制

OpenAI 代理的 `GET /v1/models` 路由独立于 `handleProxyPost`，不经过 semaphore。该端点调用频率极低，实际影响可忽略。

## 执行流程

三种机制的嵌套关系：**Failover（最外层）→ Semaphore（中层）→ Retry（最内层）**。

```
handleProxyPost()
│
├── applyEnhancement() → 命令拦截? → 是: 直接返回
├── 查询分组策略 isFailover = (strategy === "failover")
│
▼
╔═══════════════════════════════════════════════════════════╗
║  FAILOVER 循环 (while true)                                ║
║                                                            ║
║  resolveMapping(model, { excludeTargets })                  ║
║  白名单校验 + provider 校验                                  ║
║                          │                                  ║
║                          ▼                                  ║
║  ╔════════════════════════════════════════════════════════╗ ║
║  ║  SEMAPHORE 层                                          ║ ║
║  ║                                                        ║ ║
║  ║  acquire(provider.id, abortSignal)                     ║ ║
║  ║   ├── max_concurrency=0 → 直接通过                     ║ ║
║  ║   ├── current < max → current++, 通过                  ║ ║
║  ║   ├── queue 满 → 503                                   ║ ║
║  ║   ├── 排队超时 → 504                                    ║ ║
║  ║   ├── 客户端断开 → 静默返回                              ║ ║
║  ║   └── 被唤醒 → 通过                                     ║ ║
║  ║                                                        ║ ║
║  ║  [semaphore acquired ── 占用一个并发槽位]               ║ ║
║  ╚═══════════════════════╤════════════════════════════════╝ ║
║                          │                                  ║
║                          ▼                                  ║
║  ╔════════════════════════════════════════════════════════╗ ║
║  ║  RETRY 层 (retryableCall)                              ║ ║
║  ║                                                        ║ ║
║  ║  for each attempt:                                     ║ ║
║  ║    upstream call (stream / non-stream)                  ║ ║
║  ║      ├── < 400 → 返回成功                               ║ ║
║  ║      ├── >= 400 + 可重试 → sleep(delay) → 继续循环      ║ ║
║  ║      │        ⚠ sleep 期间 semaphore 被持有             ║ ║
║  ║      └── 异常 + 可重试 → sleep(delay) → 继续循环        ║ ║
║  ╚═══════════════════════════╤════════════════════════════╝ ║
║                              │                              ║
║                  retryableCall 返回结果                      ║
║                              │                              ║
║                              ▼                              ║
║  记录日志                                                    ║
║                                                            ║
║  FAILOVER 检查:                                             ║
║    isFailover && statusCode >= 400 && headers 未发送?       ║
║      ├── 是 → releaseSemaphore → exclude → continue         ║
║      │   (回到循环顶部, acquire 新 provider 的 semaphore)    ║
║      └── 否 → releaseSemaphore → 返回响应给客户端           ║
║                                                            ║
║  catch (异常):                                              ║
║    ├── isFailover → releaseSemaphore → continue             ║
║    └── 非 failover → releaseSemaphore → 502                 ║
╚════════════════════════════════════════════════════════════╝
```

### 场景示例

```
场景 A: 正常请求 (max_concurrency=5)
  acquire → [空闲] → upstream → 200 → release

场景 B: 并发排队 (max_concurrency=2, 已有 2 个在执行)
  acquire → [排队等待] → 被唤醒 → upstream → 200 → release

场景 C: 排队超时 (queue_timeout_ms=30000)
  acquire → [排队 30s] → 504 timeout

场景 D: 排队中客户端断开
  acquire → [排队中] → 客户端断开 → 从队列移除 → 静默返回

场景 E: 重试 (upstream 429, retry rule 匹配, delay=2s)
  acquire → upstream → 429 → sleep(2s) [持有semaphore] → upstream → 200 → release

场景 F: 重试耗尽 + Failover (策略=failover, Provider A→B)
  acquire(A) → upstream → 429 → sleep → upstream → 429 → sleep → upstream → 429
  → release(A) → failover
  → acquire(B) → upstream → 200 → release(B)

场景 G: 连接异常 + Failover (Provider A 抛出 ECONNRESET)
  acquire(A) → upstream → ECONNRESET → sleep → ECONNRESET → throw
  → release(A) → failover → acquire(B) → upstream → 200 → release(B)

场景 H: Provider 被删除 (admin 删除, 请求正在执行)
  [请求持有 semaphore, provider 数据已加载] → upstream → 200 → release → no-op (entry 不存在)
```

## 验证方式

1. 设置某 provider `max_concurrency = 2`，用 5 个并发 curl 请求验证：前 2 个立即响应，后 3 个排队等待
2. 流式请求：验证 semaphore 在流结束前不释放（用 `getStatus()` 观察活跃计数）
3. 客户端断开：排队中发送 Ctrl+C，验证请求被移除不浪费 semaphore
4. Failover：配置 failover 策略，验证切换 provider 时 semaphore 正确切换且不泄漏
5. 动态配置变更：运行中修改 `max_concurrency`，验证排队者被正确唤醒或新请求正确排队
6. 前端：验证 Switch 开关和并发状态显示
