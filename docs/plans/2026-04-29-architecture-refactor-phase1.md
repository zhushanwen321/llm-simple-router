# Phase 1: core/ 抽取 + 跨层依赖解耦 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 `src/core/` 共享内核，消除 admin→proxy、monitor→proxy、db→proxy 的反向依赖，零逻辑变更。

**Architecture:** 采用"绞杀者"模式——先创建新文件（纯加法），再让旧文件 re-export（向后兼容），然后逐步迁移 import，最后删除旧文件。每个中间步骤代码都可编译、测试都通过。

**Tech Stack:** TypeScript, Vitest, Fastify, better-sqlite3

**前提：** 当前分支基于 `refactor-architecture-refactor`，所有测试通过。

**设计文档:** `docs/plans/2026-04-29-architecture-refactor-design.md`

---

## File Structure

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/core/constants.ts` | HTTP 状态码、时间常量、API 路由映射（从 `src/constants.ts` 移入） |
| `src/core/types.ts` | Target、TransportResult 等跨层共享类型（从 `proxy/strategy/types.ts` + `proxy/types.ts` 公共部分移入） |
| `src/core/errors.ts` | SemaphoreError、ProviderSwitchNeeded 错误类（从 `proxy/semaphore.ts` + `proxy/types.ts` 移出） |
| `src/core/registry.ts` | StateRegistry 接口 + ConcurrencyConfig、EnhancementConfig 类型 |

### 移动文件

| 原位置 | 新位置 |
|--------|--------|
| `src/config.ts` | `src/config/index.ts` |

### 删除文件（最后阶段）

| 文件 | 原因 |
|------|------|
| `src/constants.ts` | 已移到 `core/constants.ts`，所有引用迁移完毕 |
| `src/proxy/strategy/types.ts` | 已移到 `core/types.ts`，所有引用迁移完毕 |

### 修改 import 的文件（共 27 个）

**constants 引用迁移（11 个）：**
- `src/index.ts`
- `src/metrics/metrics-extractor.ts`
- `src/middleware/auth.ts`
- `src/monitor/runtime-collector.ts`
- `src/proxy/resilience.ts`
- `src/proxy/proxy-logging.ts`
- `src/proxy/anthropic.ts`
- `src/proxy/proxy-handler.ts`
- `src/proxy/openai.ts`
- `src/db/metrics.ts`
- `src/admin/upgrade.ts`

**strategy/types 引用迁移（8 个）：**
- `src/proxy/resilience.ts`
- `src/proxy/scope.ts`
- `src/proxy/transport-fn.ts`
- `src/proxy/orchestrator.ts`
- `src/proxy/proxy-handler.ts`
- `src/proxy/overflow.ts`
- `src/proxy/mapping-resolver.ts`
- `src/db/mappings.ts`

**admin→proxy 依赖消除（5 个 admin 文件 + admin/routes.ts）：**
- `src/admin/routes.ts`
- `src/admin/providers.ts`
- `src/admin/retry-rules.ts`
- `src/admin/proxy-enhancement.ts`
- `src/admin/settings-import-export.ts`

**monitor→proxy 依赖消除（1 个）：**
- `src/monitor/request-tracker.ts`

**proxy 内部文件适配（2 个）：**
- `src/proxy/types.ts`（改为 re-export core）
- `src/proxy/semaphore.ts`（错误类移出后 re-export）

---

## Task 1: 建立 baseline

- [ ] **Step 1: 确认所有测试通过**

```bash
npx tsc --noEmit && npm test
```

Expected: 编译无错误，57 个测试全部通过。

- [ ] **Step 2: Commit baseline**

```bash
git add -A
git commit -m "chore: baseline before phase 1 refactor"
```

---

## Task 2: 创建 core/constants.ts

**Files:**
- Create: `src/core/constants.ts`

- [ ] **Step 1: 创建文件**

```typescript
// src/core/constants.ts

// HTTP 状态码常量 — 全局唯一来源
export const HTTP_BAD_REQUEST = 400;
export const HTTP_CREATED = 201;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_INTERNAL_ERROR = 500;
export const HTTP_BAD_GATEWAY = 502;
export const HTTP_UNPROCESSABLE_ENTITY = 422;
export const HTTP_SERVICE_UNAVAILABLE = 503;

// api_type 路由映射：proxy path → api type，用于全局 hook/errorHandler 中识别代理请求
export const PROXY_API_TYPES: Record<string, string> = {
  "/v1/chat/completions": "openai",
  "/v1/models": "openai",
  "/v1/messages": "anthropic",
};

export function getProxyApiType(url: string): string | null {
  const path = url.split("?")[0];
  return PROXY_API_TYPES[path] ?? null;
}

export const MS_PER_SECOND = 1000;
```

- [ ] **Step 2: 让旧文件向后兼容 re-export**

将 `src/constants.ts` 内容替换为：

```typescript
// src/constants.ts — 向后兼容 re-export，迁移完毕后删除
export {
  HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_FORBIDDEN, HTTP_NOT_FOUND,
  HTTP_CONFLICT, HTTP_INTERNAL_ERROR, HTTP_BAD_GATEWAY,
  HTTP_UNPROCESSABLE_ENTITY, HTTP_SERVICE_UNAVAILABLE,
  PROXY_API_TYPES, getProxyApiType, MS_PER_SECOND,
} from "./core/constants.js";
```

- [ ] **Step 3: 验证编译和测试**

```bash
npx tsc --noEmit && npm test
```

Expected: 全部通过。现有 import 仍指向 `./constants.js`，通过 re-export 继续工作。

---

## Task 3: 创建 core/types.ts

**Files:**
- Create: `src/core/types.ts`

- [ ] **Step 1: 创建文件**

从 `proxy/strategy/types.ts` 和 `proxy/types.ts` 的公共部分抽取：

```typescript
// src/core/types.ts
// 被多个目录（proxy, db, monitor, admin）共享的类型定义

import type { MetricsResult } from "../metrics/metrics-extractor.js";

// ========== 来自原 proxy/strategy/types.ts ==========

export interface Target {
  backend_model: string;
  provider_id: string;
  overflow_provider_id?: string;
  overflow_model?: string;
}

export interface ResolveContext {
  now: Date;
  excludeTargets?: Target[];
}

export interface ConcurrencyOverride {
  max_concurrency?: number;
  queue_timeout_ms?: number;
  max_queue_size?: number;
}

export interface ResolveResult {
  target: Target;
  concurrency_override?: ConcurrencyOverride;
  /** 活跃规则（schedule 或 base）中的 target 总数，用于 failover 判断 */
  targetCount: number;
}

// ========== 来自原 proxy/types.ts 公共部分 ==========

export const UPSTREAM_SUCCESS = 200;

export type RawHeaders = Record<string, string | string[] | undefined>;

/** 过滤掉不应转发给下游的 hop-by-hop headers */
const SKIP_DOWNSTREAM = new Set([
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

export function filterHeaders(raw: RawHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || SKIP_DOWNSTREAM.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

export type TransportResult =
  | {
      kind: "success";
      statusCode: number;
      body: string;
      headers: Record<string, string>;
      sentHeaders: Record<string, string>;
      sentBody: string;
    }
  | {
      kind: "stream_success";
      statusCode: number;
      metrics?: MetricsResult;
      upstreamResponseHeaders?: Record<string, string>;
      sentHeaders: Record<string, string>;
    }
  | {
      kind: "stream_error";
      statusCode: number;
      body: string;
      headers: Record<string, string>;
      sentHeaders: Record<string, string>;
      headersSent?: boolean;
    }
  | {
      kind: "stream_abort";
      statusCode: number;
      metrics?: MetricsResult;
      upstreamResponseHeaders?: Record<string, string>;
      sentHeaders: Record<string, string>;
    }
  | {
      kind: "error";
      statusCode: number;
      body: string;
      headers: Record<string, string>;
      sentHeaders: Record<string, string>;
      sentBody: string;
    }
  | {
      kind: "throw";
      error: Error;
      headersSent?: boolean;
    };

/** 流式传输阶段状态 */
export type StreamState =
  | "BUFFERING"
  | "STREAMING"
  | "COMPLETED"
  | "EARLY_ERROR"
  | "ABORTED";
```

- [ ] **Step 2: 让 proxy/strategy/types.ts re-export**

将 `src/proxy/strategy/types.ts` 内容替换为：

```typescript
// src/proxy/strategy/types.ts — 向后兼容 re-export，迁移完毕后删除
export type {
  Target,
  ResolveContext,
  ConcurrencyOverride,
  ResolveResult,
} from "../../core/types.js";
```

- [ ] **Step 3: 让 proxy/types.ts 从 core re-export 公共部分，保留 proxy 内部类型**

将 `src/proxy/types.ts` 内容替换为：

```typescript
// src/proxy/types.ts — proxy 内部类型 + core 公共类型 re-export

// Re-export 公共类型（已被 core/types.ts 取代）
export { UPSTREAM_SUCCESS, filterHeaders } from "../core/constants.js";
export type { RawHeaders, TransportResult, StreamState } from "../core/types.js";
// ProviderSwitchNeeded 已移至 core/errors.ts
export { ProviderSwitchNeeded } from "../core/errors.js";
```

- [ ] **Step 4: 验证编译和测试**

```bash
npx tsc --noEmit && npm test
```

Expected: 全部通过。现有 import 仍指向旧位置，通过 re-export 继续工作。

---

## Task 4: 创建 core/errors.ts

**Files:**
- Create: `src/core/errors.ts`

- [ ] **Step 1: 创建文件**

```typescript
// src/core/errors.ts
// 被多目录共享的错误类型（从 proxy/semaphore.ts 和 proxy/types.ts 移出）

import type { TransportResult } from "./types.js";

/**
 * Provider 并发队列已满时抛出。
 */
export class SemaphoreQueueFullError extends Error {
  constructor(public readonly providerId: string) {
    super(`Provider '${providerId}' concurrency queue is full`);
    this.name = "SemaphoreQueueFullError";
  }
}

/**
 * Provider 并发等待超时时抛出。
 */
export class SemaphoreTimeoutError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Provider '${providerId}' concurrency wait timeout (${timeoutMs}ms)`,
    );
    this.name = "SemaphoreTimeoutError";
  }
}

/**
 * 跨 provider failover 时由 ResilienceLayer 抛出，
 * orchestrator 捕获后释放当前信号量并获取新 provider 的信号量。
 */
export class ProviderSwitchNeeded extends Error {
  constructor(
    public readonly targetProviderId: string,
    public readonly attempts?: import("../proxy/orchestration/resilience.js").ResilienceAttempt[],
    public readonly lastResult?: TransportResult,
  ) {
    super(`Provider switch needed: ${targetProviderId}`);
    this.name = "ProviderSwitchNeeded";
  }
}
```

**注意**：`ProviderSwitchNeeded` 的 `attempts` 参数类型暂时引用 `proxy/orchestration/resilience.js`（Phase 2 后的路径）。在 Phase 1 完成时，该路径仍是 `proxy/resilience.js`，所以这里需要使用 **当前实际路径**：

```typescript
// Phase 1 阶段使用此路径（Phase 2 后更新）
public readonly attempts?: import("../proxy/resilience.js").ResilienceAttempt[],
```

修正后的完整文件：

```typescript
// src/core/errors.ts

import type { TransportResult } from "./types.js";

export class SemaphoreQueueFullError extends Error {
  constructor(public readonly providerId: string) {
    super(`Provider '${providerId}' concurrency queue is full`);
    this.name = "SemaphoreQueueFullError";
  }
}

export class SemaphoreTimeoutError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Provider '${providerId}' concurrency wait timeout (${timeoutMs}ms)`,
    );
    this.name = "SemaphoreTimeoutError";
  }
}

export class ProviderSwitchNeeded extends Error {
  constructor(
    public readonly targetProviderId: string,
    public readonly attempts?: import("../proxy/resilience.js").ResilienceAttempt[],
    public readonly lastResult?: TransportResult,
  ) {
    super(`Provider switch needed: ${targetProviderId}`);
    this.name = "ProviderSwitchNeeded";
  }
}
```

- [ ] **Step 2: 让 proxy/semaphore.ts re-export 错误类**

在 `src/proxy/semaphore.ts` 顶部，将 SemaphoreQueueFullError 和 SemaphoreTimeoutError 的 class 定义替换为 re-export：

```typescript
// 原来的 class 定义删除，改为：
export { SemaphoreQueueFullError, SemaphoreTimeoutError } from "../core/errors.js";
```

同时保留文件中其余部分（ConcurrencyConfig, QueueEntry, SemaphoreEntry, ProviderSemaphoreManager 等）不变。

- [ ] **Step 3: 验证编译和测试**

```bash
npx tsc --noEmit && npm test
```

Expected: 全部通过。

---

## Task 5: 创建 core/registry.ts（StateRegistry 接口）

**Files:**
- Create: `src/core/registry.ts`

- [ ] **Step 1: 创建文件**

```typescript
// src/core/registry.ts
// Admin 层通过此接口触发 proxy 层状态刷新，消除 admin→proxy 直接依赖

export interface ConcurrencyConfig {
  maxConcurrency: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

export interface EnhancementConfig {
  claude_code_enabled: boolean;
  tool_call_loop_enabled: boolean;
  stream_loop_enabled: boolean;
}

export interface StateRegistry {
  /** 刷新重试规则缓存（RetryRuleMatcher.load） */
  refreshRetryRules(): void;
  /** 更新 provider 并发配置（ProviderSemaphoreManager.updateConfig） */
  updateProviderConcurrency(providerId: string, config: ConcurrencyConfig): void;
  /** 清空所有会话模型状态（modelState.clearAll） */
  clearModelState(): void;
  /** 读取 proxy enhancement 配置 */
  getEnhancementConfig(): EnhancementConfig;
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 通过。此文件尚未被引用，不影响现有代码。

---

## Task 6: 迁移 constants 引用到 core/constants.ts

**Files:** 修改 11 个文件的 import 路径

- [ ] **Step 1: 批量替换 import 路径**

对以下每个文件，将 `from "../constants.js"` 或 `from "./constants.js"` 改为指向 `core/constants.js`：

| 文件 | 旧 import | 新 import |
|------|-----------|-----------|
| `src/index.ts` | `"./constants.js"` | `"./core/constants.js"` |
| `src/metrics/metrics-extractor.ts` | `"../constants.js"` | `"../core/constants.js"` |
| `src/middleware/auth.ts` | `"../constants.js"` | `"../core/constants.js"` |
| `src/monitor/runtime-collector.ts` | `"../constants.js"` | `"../core/constants.js"` |
| `src/proxy/resilience.ts` | `"../constants.js"` | `"../core/constants.js"` |
| `src/proxy/proxy-logging.ts` | `"../constants.js"` | `"../core/constants.js"` |
| `src/proxy/anthropic.ts` | `"../constants.js"` | `"../core/constants.js"` |
| `src/proxy/proxy-handler.ts` | `"../constants.js"` | `"../core/constants.js"` |
| `src/proxy/openai.ts` | `"../constants.js"` | `"../core/constants.js"` |
| `src/db/metrics.ts` | `"../constants.js"` | `"../core/constants.js"` |
| `src/admin/upgrade.ts` | `"../constants.js"` | `"../core/constants.js"` |

- [ ] **Step 2: 验证编译和测试**

```bash
npx tsc --noEmit && npm test
```

Expected: 全部通过。

- [ ] **Step 3: 删除 src/constants.ts**

```bash
rm src/constants.ts
```

- [ ] **Step 4: 再次验证**

```bash
npx tsc --noEmit && npm test
```

Expected: 全部通过。没有任何文件再引用 `src/constants.ts`。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: create core/constants.ts, migrate all imports, delete old constants.ts"
```

---

## Task 7: 迁移 strategy/types 引用到 core/types.ts

**Files:** 修改 8 个文件的 import 路径

- [ ] **Step 1: 批量替换 import 路径**

| 文件 | 旧 import | 新 import |
|------|-----------|-----------|
| `src/proxy/resilience.ts` | `"./strategy/types.js"` | `"../core/types.js"` |
| `src/proxy/scope.ts` | `"./strategy/types.js"` | `"../core/types.js"` |
| `src/proxy/transport-fn.ts` | `"./strategy/types.js"` | `"../core/types.js"` |
| `src/proxy/orchestrator.ts` | `"./strategy/types.js"` | `"../core/types.js"` |
| `src/proxy/proxy-handler.ts` | `"./strategy/types.js"` | `"../core/types.js"` |
| `src/proxy/overflow.ts` | `"./strategy/types.js"` | `"../core/types.js"` |
| `src/proxy/mapping-resolver.ts` | `"./strategy/types.js"` | `"../core/types.js"` |
| `src/db/mappings.ts` | `"../proxy/strategy/types.js"` | `"../core/types.js"` |

- [ ] **Step 2: 验证编译和测试**

```bash
npx tsc --noEmit && npm test
```

Expected: 全部通过。

- [ ] **Step 3: 删除 src/proxy/strategy/types.ts**

```bash
rm src/proxy/strategy/types.ts
rmdir src/proxy/strategy
```

- [ ] **Step 4: 再次验证**

```bash
npx tsc --noEmit && npm test
```

Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: create core/types.ts, migrate strategy/types imports, delete old file"
```

---

## Task 8: 迁移 proxy/types.ts 的直接引用到 core/types.ts

`src/proxy/types.ts` 现在 re-export core 的类型。proxy 内部文件仍从 `./types.js` 导入，这是 OK 的——proxy/types.ts 作为便利的 re-export hub 可以保留。

但 proxy 外部的文件如果引用了 `proxy/types.ts` 中的公共类型，应该改为直接从 core 导入。

当前 proxy 外部直接引用 proxy/types.ts 的情况：

- `src/monitor/request-tracker.ts` — 无（它引用的是 proxy/semaphore）
- `src/index.ts` — 无（它引用 proxy/types 是通过 re-export）

**结论**：proxy/types.ts 作为 re-export hub 保留。proxy 内部文件继续从 `./types.js` 导入（通过 re-export 获得类型）。proxy 外部的新代码应直接从 `core/types.js` 导入。

此 Task 无需改动，跳过。

---

## Task 9: 消除 monitor→proxy 依赖

**Files:**
- Modify: `src/monitor/request-tracker.ts`

- [ ] **Step 1: 修改 request-tracker.ts**

当前引用：
```typescript
import type { ProviderSemaphoreManager } from "../proxy/semaphore.js";
```

改为在 `monitor/types.ts` 中定义一个接口，让 request-tracker 只依赖接口：

在 `src/monitor/types.ts` 中添加（如果文件不存在则创建，已存在则追加）：

```typescript
/** request-tracker 需要的信号量状态查询接口 */
export interface ISemaphoreStatus {
  getStatus(providerId: string): { active: number; queued: number };
}
```

然后修改 `src/monitor/request-tracker.ts`：
- 将 `import type { ProviderSemaphoreManager } from "../proxy/semaphore.js"` 删除
- 将构造参数中的 `semaphoreManager?: ProviderSemaphoreManager` 改为 `semaphoreManager?: ISemaphoreStatus`
- 在文件头部添加 `import type { ISemaphoreStatus } from "./types.js";`
- getConcurrency() 方法中 `this.semaphoreManager` 的使用保持不变（ISemienceStatus 接口覆盖了所需方法）

- [ ] **Step 2: 验证编译和测试**

```bash
npx tsc --noEmit && npm test
```

Expected: 全部通过。ProviderSemaphoreManager 已经实现了 getStatus() 方法，满足 ISemaphoreStatus 接口。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: eliminate monitor→proxy dependency via ISemaphoreStatus interface"
```

---

## Task 10: 消除 admin→proxy 依赖（StateRegistry）

**Files:**
- Modify: `src/admin/routes.ts`
- Modify: `src/admin/providers.ts`
- Modify: `src/admin/retry-rules.ts`
- Modify: `src/admin/proxy-enhancement.ts`
- Modify: `src/admin/settings-import-export.ts`
- Modify: `src/index.ts`（buildApp 中创建 StateRegistry 实现）

- [ ] **Step 1: 在 buildApp 中创建 StateRegistry 实现**

在 `src/index.ts` 的 `buildApp()` 函数中，在创建 matcher 和 semaphoreManager 之后，添加：

```typescript
import type { StateRegistry } from "./core/registry.js";

// ... 在 buildApp() 内，创建 tracker 之前 ...
const stateRegistry: StateRegistry = {
  refreshRetryRules: () => matcher.load(db),
  updateProviderConcurrency: (providerId, config) => semaphoreManager.updateConfig(providerId, config),
  clearModelState: () => modelState.clearAll(),
  getEnhancementConfig: () => loadEnhancementConfig(db),
};
```

需要新增 import：
```typescript
import { loadEnhancementConfig } from "./proxy/enhancement-config.js";
```

注意：`loadEnhancementConfig` 仍从 proxy 导入（这在 buildApp 组装层是允许的——buildApp 是"组合根"，可以依赖所有模块）。

- [ ] **Step 2: 修改 admin/routes.ts**

将接口从：
```typescript
import { RetryRuleMatcher } from "../proxy/retry-rules.js";
import { ProviderSemaphoreManager } from "../proxy/semaphore.js";

interface AdminRoutesOptions {
  db: Database.Database;
  matcher: RetryRuleMatcher | null;
  tracker?: RequestTracker;
  semaphoreManager?: ProviderSemaphoreManager;
}
```

改为：
```typescript
import type { StateRegistry } from "../core/registry.js";

interface AdminRoutesOptions {
  db: Database.Database;
  stateRegistry: StateRegistry;
  tracker?: RequestTracker;
}
```

在路由注册中，将传递 matcher/semaphoreManager 的子路由改为传递 stateRegistry：

```typescript
app.register(adminProviderRoutes, { db: options.db, stateRegistry: options.stateRegistry, tracker: options.tracker });
app.register(adminRetryRuleRoutes, { db: options.db, stateRegistry: options.stateRegistry });
app.register(adminImportExportRoutes, { db: options.db, stateRegistry: options.stateRegistry });
app.register(adminProxyEnhancementRoutes, { db: options.db, stateRegistry: options.stateRegistry });
```

- [ ] **Step 3: 修改 admin/providers.ts**

将：
```typescript
import { ProviderSemaphoreManager } from "../proxy/semaphore.js";

interface ProviderRoutesOptions {
  db: Database.Database;
  semaphoreManager?: ProviderSemaphoreManager;
  tracker?: RequestTracker;
}
```

改为：
```typescript
import type { StateRegistry } from "../core/registry.js";

interface ProviderRoutesOptions {
  db: Database.Database;
  stateRegistry?: StateRegistry;
  tracker?: RequestTracker;
}
```

将使用 `semaphoreManager.updateConfig()` 的地方改为 `stateRegistry.updateProviderConcurrency()`。
将使用 `semaphoreManager.removeProvider()` 类方法的地方改为对应的 registry 方法（如果需要，在 StateRegistry 接口中补充）。

- [ ] **Step 4: 修改 admin/retry-rules.ts**

将：
```typescript
import { RetryRuleMatcher } from "../proxy/retry-rules.js";

interface RetryRuleRoutesOptions {
  db: Database.Database;
  matcher?: RetryRuleMatcher;
}
```

改为：
```typescript
import type { StateRegistry } from "../core/registry.js";

interface RetryRuleRoutesOptions {
  db: Database.Database;
  stateRegistry?: StateRegistry;
}
```

将 `matcher.load(db)` 改为 `stateRegistry.refreshRetryRules()`。

- [ ] **Step 5: 修改 admin/proxy-enhancement.ts**

将：
```typescript
import { loadEnhancementConfig } from "../proxy/enhancement-config.js";
import { modelState } from "../proxy/model-state.js";
```

改为通过 stateRegistry：
```typescript
import type { StateRegistry } from "../core/registry.js";

// 使用 options.stateRegistry.getEnhancementConfig() 替代 loadEnhancementConfig(db)
// 使用 options.stateRegistry.clearModelState() 替代 modelState.clearAll()
```

- [ ] **Step 6: 修改 admin/settings-import-export.ts**

将：
```typescript
import { modelState } from "../proxy/model-state.js";
import { RetryRuleMatcher } from "../proxy/retry-rules.js";
import { ProviderSemaphoreManager } from "../proxy/semaphore.js";
```

改为通过 stateRegistry：
```typescript
import type { StateRegistry } from "../core/registry.js";

// 使用 options.stateRegistry 替代 matcher/semaphoreManager/modelState
```

- [ ] **Step 7: 更新 buildApp 中传递给 adminRoutes 的参数**

在 `src/index.ts` 中：
```typescript
app.register(adminRoutes, { db, stateRegistry, tracker });
```

- [ ] **Step 8: 验证编译和测试**

```bash
npx tsc --noEmit && npm test
```

Expected: 全部通过。admin/ 下不再有任何 `import from "../proxy/"` 语句。

- [ ] **Step 9: 验证 admin→proxy 依赖已消除**

```bash
grep -r "from.*proxy/" src/admin/ || echo "✅ admin→proxy 依赖已完全消除"
```

Expected: 输出 `✅ admin→proxy 依赖已完全消除`。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: eliminate admin→proxy dependency via StateRegistry interface"
```

---

## Task 11: 移动 config.ts → config/index.ts

**Files:**
- Move: `src/config.ts` → `src/config/index.ts`

- [ ] **Step 1: 移动文件**

```bash
git mv src/config.ts src/config/index.ts
```

- [ ] **Step 2: 验证编译和测试**

所有引用 `"./config.js"` 的文件路径不需要改变（`src/config/index.ts` 可以通过 `./config.js` 导入）。

```bash
npx tsc --noEmit && npm test
```

Expected: 全部通过。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: move config.ts to config/index.ts"
```

---

## Task 12: 最终验证 + 清理

- [ ] **Step 1: 验证所有跨层依赖已消除**

```bash
echo "=== admin→proxy ===" && grep -r "from.*proxy/" src/admin/ || echo "✅ 已消除"
echo "=== monitor→proxy ===" && grep -r "from.*proxy/" src/monitor/ || echo "✅ 已消除"
echo "=== db→proxy ===" && grep -r "from.*proxy/" src/db/ || echo "✅ 已消除"
```

Expected: 三项都输出 `✅ 已消除`。

- [ ] **Step 2: 全量测试**

```bash
npm test
```

Expected: 57 个测试全部通过。

- [ ] **Step 3: Lint 检查**

```bash
npm run lint
```

Expected: 零警告。

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "refactor: phase 1 complete — core/ extraction + cross-layer dependency decoupling

- Created src/core/ with types, constants, errors, registry
- Eliminated admin→proxy (9→0), monitor→proxy (1→0), db→proxy (1→0)
- All 57 tests pass, zero logic changes"
```

---

## 自检清单

### 1. Spec 覆盖

| 设计文档要求 | 对应 Task |
|-------------|----------|
| 创建 core/types.ts | Task 3 |
| 创建 core/constants.ts | Task 2 |
| 创建 core/errors.ts | Task 4 |
| 创建 core/registry.ts | Task 5 |
| 消除 db→proxy (Target 类型) | Task 7 |
| 消除 monitor→proxy (SemaphoreManager) | Task 9 |
| 消除 admin→proxy (9 处) | Task 10 |
| 移动 config.ts → config/index.ts | Task 11 |
| 删除旧 constants.ts | Task 6 Step 3 |
| 删除旧 strategy/types.ts | Task 7 Step 3 |
| admin→monitor 保留不改 | ✅ 未改动 |

### 2. Placeholder 扫描

无 TBD、TODO、implement later 等占位符。

### 3. 类型一致性

- StateRegistry 接口定义在 `core/registry.ts`，buildApp 中创建实现，admin 使用接口 — ✅ 一致
- ISemaphoreStatus 接口定义在 `monitor/types.ts`，ProviderSemaphoreManager 实现它 — ✅ 一致（duck typing，TypeScript structural typing 保证兼容）
- TransportResult 定义在 `core/types.ts`，proxy/types.ts re-export — ✅ 一致

---

## Phase 2/3 计划

Phase 1 完成后，编写：
- `docs/plans/2026-04-29-architecture-refactor-phase2.md` — proxy/ 子目录拆分
- `docs/plans/2026-04-29-architecture-refactor-phase3.md` — Pipeline + ServiceContainer

Phase 2/3 的具体 import 路径依赖 Phase 1 的最终状态，因此在 Phase 1 完成后再细化。
