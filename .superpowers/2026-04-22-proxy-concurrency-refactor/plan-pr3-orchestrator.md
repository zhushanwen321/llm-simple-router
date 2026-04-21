# PR-3: 横切层 + Orchestrator 重构

> 依赖 PR-1 (TransportLayer) 和 PR-2 (ResilienceLayer) 已完成

## 目标

用 SemaphoreScope、TrackerScope 和 ProxyOrchestrator 替换 `handleProxyPost` 的 270 行 God Function。

---

### Task 3.0: 创建 types.ts 中的 ProviderSwitchNeeded 异常

**Files:**
- Modify: `src/proxy/types.ts`

- [ ] **Step 1: 添加 ProviderSwitchNeeded 异常类**

```typescript
export class ProviderSwitchNeeded extends Error {
  constructor(public readonly targetProviderId: string) {
    super(`Provider switch needed: ${targetProviderId}`);
    this.name = "ProviderSwitchNeeded";
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`

- [ ] **Step 3: 提交**

```
feat: add ProviderSwitchNeeded exception for cross-provider failover
```

---

### Task 3.1: 编写 SemaphoreScope 测试

**Files:**
- Create: `tests/scope.test.ts`

测试场景：
1. withSlot 成功执行回调并释放信号量
2. withSlot 回调抛异常时仍然释放信号量
3. withSlot 回调返回成功结果
4. onQueued 回调在排队时被调用

- [ ] **Step 1: 编写 SemaphoreScope 测试**

```typescript
import { describe, it, expect, vi } from "vitest";
import { SemaphoreScope } from "../src/proxy/scope.js";
import { ProviderSemaphoreManager } from "../src/proxy/semaphore.js";

describe("SemaphoreScope", () => {
  function setup(maxConcurrency: number) {
    const manager = new ProviderSemaphoreManager();
    manager.updateConfig("p1", { maxConcurrency, queueTimeoutMs: 5000, maxQueueSize: 10 });
    const scope = new SemaphoreScope(manager);
    return { manager, scope };
  }

  it("should execute fn and release slot", async () => {
    const { scope, manager } = setup(1);
    const result = await scope.withSlot("p1", new AbortController().signal, vi.fn(), async () => 42);
    expect(result).toBe(42);
    expect(manager.getStatus("p1")).toEqual({ active: 0, queued: 0 });
  });

  it("should release slot when fn throws", async () => {
    const { scope, manager } = setup(1);
    await expect(scope.withSlot("p1", new AbortController().signal, vi.fn(), async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(manager.getStatus("p1")).toEqual({ active: 0, queued: 0 });
  });

  it("should call onQueued when entering wait queue", async () => {
    const { scope, manager } = setup(1);
    const onQueued = vi.fn();
    // 占满第一个槽位
    const block = scope.withSlot("p1", new AbortController().signal, vi.fn(), () => new Promise(() => {}));
    // 第二个请求应该进入队列
    const queued = scope.withSlot("p1", new AbortController().signal, onQueued, async () => "done");
    expect(onQueued).toHaveBeenCalled();
    // 清理：不 await，让测试结束
  });
});
```

- [ ] **Step 2: 运行确认测试失败**

Run: `npx vitest run tests/scope.test.ts`
Expected: FAIL (Cannot find module scope.js)

- [ ] **Step 3: 提交测试**

```
test: add SemaphoreScope tests (TDD red phase)
```

---

### Task 3.2: 实现 SemaphoreScope

**Files:**
- Create: `src/proxy/scope.ts`

- [ ] **Step 1: 实现 SemaphoreScope**

```typescript
import type { ProviderSemaphoreManager, AcquireToken } from "./semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";
import type { ActiveRequest } from "../monitor/types.js";

export class SemaphoreScope {
  constructor(private manager: ProviderSemaphoreManager) {}

  async withSlot<T>(
    providerId: string,
    signal: AbortSignal,
    onQueued: () => void,
    fn: () => Promise<T>,
  ): Promise<T> {
    const token = await this.manager.acquire(providerId, signal, onQueued);
    try {
      return await fn();
    } finally {
      this.manager.release(providerId, token);
    }
  }
}

export class TrackerScope {
  constructor(private tracker: RequestTracker) {}

  async track<T>(
    req: ActiveRequest,
    fn: () => Promise<T>,
    extractStatus: (result: T) => { status: "completed" | "failed"; statusCode?: number },
  ): Promise<T> {
    this.tracker.start(req);
    try {
      const result = await fn();
      this.tracker.complete(req.id, extractStatus(result));
      return result;
    } catch (e) {
      this.tracker.complete(req.id, { status: "failed" });
      throw e;
    }
  }
}
```

- [ ] **Step 2: 运行 SemaphoreScope 测试通过**

Run: `npx vitest run tests/scope.test.ts`
Expected: PASS

- [ ] **Step 3: 编写 TrackerScope 测试**

追加到 `tests/scope.test.ts`：

```typescript
import { RequestTracker } from "../src/monitor/request-tracker.js";
import type { ActiveRequest } from "../src/monitor/types.js";

describe("TrackerScope", () => {
  it("should call start and complete on success", async () => {
    const tracker = new RequestTracker();
    const scope = new TrackerScope(tracker);
    const req: ActiveRequest = {
      id: "test-1", apiType: "openai", model: "gpt-4",
      providerId: "p1", providerName: "test", isStream: false,
      startTime: Date.now(), status: "pending", retryCount: 0,
      attempts: [], clientIp: "127.0.0.1", queued: false,
    };
    const result = await scope.track(req, async () => "ok", () => ({ status: "completed", statusCode: 200 }));
    expect(result).toBe("ok");
    expect(tracker.getActive()).toHaveLength(0);
    expect(tracker.getRecent(1)).toHaveLength(1);
    expect(tracker.getRecent(1)[0].status).toBe("completed");
  });

  it("should complete as failed when fn throws", async () => {
    const tracker = new RequestTracker();
    const scope = new TrackerScope(tracker);
    const req: ActiveRequest = {
      id: "test-2", apiType: "openai", model: "gpt-4",
      providerId: "p1", providerName: "test", isStream: false,
      startTime: Date.now(), status: "pending", retryCount: 0,
      attempts: [], clientIp: "127.0.0.1", queued: false,
    };
    await expect(scope.track(req, async () => { throw new Error("fail"); }, () => ({ status: "completed" })))
      .rejects.toThrow("fail");
    expect(tracker.getRecent(1)[0].status).toBe("failed");
  });
});
```

- [ ] **Step 4: 运行全部 scope 测试**

Run: `npx vitest run tests/scope.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```
feat: add SemaphoreScope and TrackerScope with tests
```

---

### Task 3.3: 编写 ProxyOrchestrator 测试

**Files:**
- Create: `tests/orchestrator.test.ts`

测试场景（全部 mock）：
1. 正常非流式请求成功 → 200 响应
2. 正常流式请求成功 → SSE 流转发
3. 映射找不到 → 404 错误
4. Provider 不可用 → 502 错误
5. 信号量排队 → withSlot + onQueued 被调用
6. 重试 → ResilienceLayer 返回多次尝试
7. Failover → ResilienceLayer 切换 target

- [ ] **Step 1: 编写 Orchestrator 测试框架**

测试使用 vi.mock 模拟 TransportLayer、ResilienceLayer、SemaphoreScope、TrackerScope。Mock DB、resolveMapping、getProviderById 等依赖。

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
// Mock 所有外部依赖
vi.mock("../src/db/index.js", () => ({
  getProviderById: vi.fn(),
  getMappingGroup: vi.fn(),
  resolveMapping: vi.fn(),
  insertRequestLog: vi.fn(),
}));
vi.mock("../src/db/settings.js", () => ({ getSetting: vi.fn() }));
vi.mock("../src/utils/crypto.js", () => ({ decrypt: vi.fn() }));
vi.mock("../src/proxy/enhancement-handler.js", () => ({
  applyEnhancement: vi.fn(() => ({ effectiveModel: "gpt-4", originalModel: null, interceptResponse: null })),
  buildModelInfoTag: vi.fn(() => ""),
}));
vi.mock("../src/proxy/mapping-resolver.js", () => ({ resolveMapping: vi.fn() }));
vi.mock("../src/proxy/proxy-logging.js", () => ({
  logRetryAttempts: vi.fn(() => "log-id"),
  collectMetrics: vi.fn(),
  handleIntercept: vi.fn(),
  sanitizeHeadersForLog: vi.fn((h) => h),
  UPSTREAM_SUCCESS: 200,
}));
```

测试重点：验证调用链的顺序和 scope 的 try/finally 行为。

- [ ] **Step 2: 运行确认测试失败**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: FAIL

- [ ] **Step 3: 提交测试**

```
test: add ProxyOrchestrator tests (TDD red phase)
```

---

### Task 3.4: 实现 ProxyOrchestrator

**Files:**
- Create: `src/proxy/orchestrator.ts`

- [ ] **Step 1: 实现 Orchestrator**

核心结构：

```typescript
export class ProxyOrchestrator {
  constructor(
    private deps: {
      transport: TransportLayer;
      resilience: ResilienceLayer;
      semaphoreScope: SemaphoreScope;
      trackerScope: TrackerScope;
      db: Database.Database;
    },
  ) {}

  async handle(request, reply, apiType, upstreamPath, errors, config): Promise<FastifyReply> {
    // 1. 增强解析
    const enhanced = applyEnhancement(this.deps.db, request, ...);
    if (enhanced.interceptResponse) return handleIntercept(...);

    // 2. 早期拒绝（不消耗信号量和 tracker）
    const resolved = resolveMapping(this.deps.db, enhanced.effectiveModel);
    if (!resolved) return reject(errors.modelNotFound(...));
    const provider = getProviderById(this.deps.db, resolved.provider_id);
    if (!provider?.is_active) return reject(errors.providerUnavailable());
    if (provider.api_type !== apiType) return reject(errors.providerTypeMismatch());

    // 3. 正式处理
    const logId = randomUUID();
    return this.deps.trackerScope.track(
      { id: logId, ... },
      () => this.deps.semaphoreScope.withSlot(
        provider.id,
        abortSignal,
        () => this.deps.trackerScope.tracker.update(logId, { queued: true }),
        () => this.executeWithFailover(resolved, provider, request, reply, ...),
      ),
      (result) => extractStatus(result),
    );
  }

  private async executeWithFailover(...) {
    try {
      return await this.deps.resilience.execute(
        () => resolveAllTargets(...),
        (target) => this.deps.transport.call({ ... }),
        config,
      );
    } catch (e) {
      if (e instanceof ProviderSwitchNeeded) {
        // 跨 provider failover: 由 orchestrator 重新进入 semaphoreScope
        return this.handleProviderSwitch(e, ...);
      }
      throw e;
    }
  }
}
```

- [ ] **Step 2: 运行 Orchestrator 测试**

Run: `npx vitest run tests/orchestrator.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

```
feat: add ProxyOrchestrator with scope-based resource management
```

---

### Task 3.5: 更新 openai.ts 和 anthropic.ts 适配新接口

**Files:**
- Modify: `src/proxy/openai.ts`
- Modify: `src/proxy/anthropic.ts`

- [ ] **Step 1: 更新 openai.ts**

将当前直接调用 `handleProxyPost` 改为实例化 `ProxyOrchestrator` 并调用 `orchestrator.handle()`。保持 Fastify 插件注册模式不变，deps 注入方式不变。

- [ ] **Step 2: 更新 anthropic.ts**

同上，对称修改。

- [ ] **Step 3: 运行现有代理集成测试**

Run: `npx vitest run tests/openai-proxy.test.ts tests/anthropic-proxy.test.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```
refactor: wire openai.ts and anthropic.ts to ProxyOrchestrator
```

---

### Task 3.6: 更新 proxy-logging.ts 适配新类型

**Files:**
- Modify: `src/proxy/proxy-logging.ts`

- [ ] **Step 1: 更新 logRetryAttempts 和 collectMetrics**

将参数类型从 `ProxyResult | StreamProxyResult` 改为 `TransportResult`。内部逻辑根据 `kind` 字段分发。

- [ ] **Step 2: 运行测试**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: 提交**

```
refactor: update proxy-logging to use TransportResult types
```

---

### Task 3.7: 更新 index.ts 依赖注入

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 更新 buildApp**

将 TransportLayer、ResilienceLayer、SemaphoreScope、TrackerScope、ProxyOrchestrator 的实例化加入 buildApp。传递给 openaiProxy 和 anthropicProxy。

- [ ] **Step 2: 运行全量测试**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 3: 提交**

```
refactor: update buildApp to wire new architecture components
```

---

### Task 3.8: 删除旧代码并清理

**Files:**
- Delete or gut: `src/proxy/proxy-core.ts`
- Delete: `src/proxy/upstream-call.ts` (if PR-1 kept it as shim)
- Delete: `src/proxy/retry.ts` (if PR-2 kept it as shim)

- [ ] **Step 1: 确认 proxy-core.ts 无外部消费者**

搜索所有 import from proxy-core 的文件，确认已迁移。

- [ ] **Step 2: 删除 proxy-core.ts 中不再需要的导出**

保留 `proxyGetRequest`（GET 代理仍需要）和 header 工具函数，移除 `handleProxyPost`。

- [ ] **Step 3: 删除 upstream-call.ts 和 retry.ts**

如果 PR-1/PR-2 保留了旧文件作为兼容 shim，此时删除。

- [ ] **Step 4: 运行全量测试 + lint + 编译**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```
refactor: remove legacy proxy-core handleProxyPost, upstream-call, retry
```

---

### Task 3.9: 全量验证

- [ ] **Step 1: 运行全部测试**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: 运行 lint**

Run: `npm run lint`
Expected: 0 warnings

- [ ] **Step 3: 编译检查**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: 手动冒烟测试**

启动 dev server，通过 Claude Code 发送请求，验证：
1. 正常请求成功
2. 监控页面活跃请求显示正确
3. 队列请求在有并发时显示
4. 请求完成后正确标记 completed/failed
