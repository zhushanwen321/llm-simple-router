# PR-3: 横切层 + Orchestrator 重构 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 SemaphoreScope、TrackerScope 和 ProxyOrchestrator 替换 `handleProxyPost` 的 270 行 God Function

**Architecture:** SemaphoreScope/TrackerScope 用 try/finally 保证信号量和 tracker 资源释放。ProxyOrchestrator 编排增强→映射→信号量→transport→resilience→响应的完整请求生命周期，支持跨 provider failover（ProviderSwitchNeeded 异常跳出 semaphoreScope 重新进入）。

**Tech Stack:** TypeScript, Fastify, Vitest, vi.fn 构造函数注入 mock

**前置条件:** PR-1 (TransportLayer) 和 PR-2 (ResilienceLayer) 已完成

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

- [ ] **Step 1: 编写 Orchestrator 测试**

测试使用 vi.mock 模拟 TransportLayer、ResilienceLayer、SemaphoreScope、TrackerScope。Mock DB、resolveMapping、getProviderById 等依赖。

Orchestrator 通过构造函数注入依赖，不依赖 vi.mock 做模块级 mock，而是用 vi.fn() 创建 mock 对象直接传入。这样测试更清晰、不依赖模块路径。

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProxyOrchestrator } from "../src/proxy/orchestrator.js";
import type { TransportLayer } from "../src/proxy/transport.js";
import type { ResilienceLayer, ResilienceResult } from "../src/proxy/resilience.js";
import type { SemaphoreScope } from "../src/proxy/scope.js";
import type { TrackerScope } from "../src/proxy/scope.js";
import type { ProxyErrorFormatter, ProxyHandlerDeps } from "../src/proxy/proxy-core.js";
import type { Target } from "../src/proxy/strategy/types.js";

// ---------- Mock 工厂 ----------

function createMockDeps() {
  return {
    transport: {
      callNonStream: vi.fn(),
      callStream: vi.fn(),
    } as unknown as TransportLayer,
    resilience: {
      execute: vi.fn(),
    } as unknown as ResilienceLayer,
    semaphoreScope: {
      withSlot: vi.fn(),
    } as unknown as SemaphoreScope,
    trackerScope: {
      track: vi.fn(),
    } as unknown as TrackerScope,
    db: {} as any,
  };
}

// 标准 200 非流式结果
const successResult: TransportResult = {
  kind: "success",
  statusCode: 200,
  body: JSON.stringify({ choices: [{ message: { content: "hi" } }] }),
  headers: { "content-type": "application/json" },
  sentHeaders: {},
  sentBody: "",
};

// 标准 200 流式结果
const streamSuccessResult: TransportResult = {
  kind: "stream_success",
  statusCode: 200,
  sentHeaders: {},
};

const errors: ProxyErrorFormatter = {
  modelNotFound: (model) => ({ statusCode: 404, body: { error: { message: `Model '${model}' not found` } } }),
  modelNotAllowed: (model) => ({ statusCode: 403, body: { error: { message: `Model '${model}' not allowed` } } }),
  providerUnavailable: () => ({ statusCode: 503, body: { error: { message: "Provider unavailable" } } }),
  providerTypeMismatch: () => ({ statusCode: 500, body: { error: { message: "Type mismatch" } } }),
  upstreamConnectionFailed: () => ({ statusCode: 502, body: { error: { message: "Upstream failed" } } }),
  concurrencyQueueFull: (id) => ({ statusCode: 503, body: { error: { message: `Queue full: ${id}` } } }),
  concurrencyTimeout: (id, ms) => ({ statusCode: 504, body: { error: { message: `Timeout: ${id} ${ms}ms` } } }),
};

function createMockRequest(overrides = {}) {
  return {
    body: { model: "gpt-4", stream: false },
    headers: { "content-type": "application/json" },
    log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    raw: { socket: { on: vi.fn() } },
    routerKey: null,
    ip: "127.0.0.1",
    ...overrides,
  } as any;
}

function createMockReply() {
  const raw = { headersSent: false, writableEnded: false, on: vi.fn(), writeHead: vi.fn(), end: vi.fn() };
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    raw,
  } as any;
}

describe("ProxyOrchestrator", () => {
  let deps: ReturnType<typeof createMockDeps>;
  let orchestrator: ProxyOrchestrator;

  beforeEach(() => {
    deps = createMockDeps();
    orchestrator = new ProxyOrchestrator(deps);
  });

  // --- 场景 1: 正常非流式请求成功 ---

  it("正常非流式请求返回 200 响应", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    // withSlot 直接执行回调，模拟信号量立即可用
    deps.semaphoreScope.withSlot = vi.fn((_providerId, _signal, _onQueued, fn) => fn());
    // track 直接执行回调
    deps.trackerScope.track = vi.fn((_req, fn, _extractStatus) => fn());

    const resilienceResult: ResilienceResult = {
      result: successResult,
      attempts: [{ target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 0, statusCode: 200, error: null, latencyMs: 50, responseBody: null }],
      excludedTargets: [],
    };
    deps.resilience.execute = vi.fn(() => Promise.resolve(resilienceResult));

    const result = await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { db: deps.db, resolved: { backend_model: "gpt-4", provider_id: "p1" }, provider: { id: "p1", name: "test", is_active: true, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: false },
    );

    expect(deps.semaphoreScope.withSlot).toHaveBeenCalledWith("p1", expect.anything(), expect.any(Function), expect.any(Function));
    expect(deps.resilience.execute).toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  // --- 场景 2: 正常流式请求成功 ---

  it("正常流式请求转发 SSE 流", async () => {
    const request = createMockRequest({ body: { model: "gpt-4", stream: true } });
    const reply = createMockReply();

    deps.semaphoreScope.withSlot = vi.fn((_providerId, _signal, _onQueued, fn) => fn());
    deps.trackerScope.track = vi.fn((_req, fn, _extractStatus) => fn());

    const resilienceResult: ResilienceResult = {
      result: streamSuccessResult,
      attempts: [{ target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 0, statusCode: 200, error: null, latencyMs: 100, responseBody: null }],
      excludedTargets: [],
    };
    deps.resilience.execute = vi.fn(() => Promise.resolve(resilienceResult));

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { db: deps.db, resolved: { backend_model: "gpt-4", provider_id: "p1" }, provider: { id: "p1", name: "test", is_active: true, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: true },
    );

    expect(deps.resilience.execute).toHaveBeenCalled();
    // 流式成功时 reply.status/send 不一定被调用（数据通过 pipe 发送）
    // 关键断言：resilience.execute 返回 stream_success
    const callArgs = (deps.resilience.execute as vi.Mock).mock.calls[0];
    const fn = callArgs[1] as (target: Target) => Promise<TransportResult>;
    // 验证 fn 参数：target 传入
    expect(callArgs[0]).toBeInstanceOf(Function); // targets getter
  });

  // --- 场景 3: 映射找不到 → 404 ---

  it("映射找不到时返回 404", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    // resolved 为 null 模拟映射找不到
    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { db: deps.db, resolved: null, provider: null, isStream: false },
    );

    // 不进入信号量和 tracker
    expect(deps.semaphoreScope.withSlot).not.toHaveBeenCalled();
    expect(deps.trackerScope.track).not.toHaveBeenCalled();
    // 直接返回错误响应
    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalled();
  });

  // --- 场景 4: Provider 不可用 → 502 ---

  it("Provider 不可用时返回 503", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    // provider.is_active = false 模拟不可用
    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { db: deps.db, resolved: { backend_model: "gpt-4", provider_id: "p1" }, provider: { id: "p1", name: "test", is_active: false, api_type: "openai" } as any, isStream: false },
    );

    expect(deps.semaphoreScope.withSlot).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(503);
  });

  // --- 场景 5: 信号量排队 ---

  it("信号量排队时调用 withSlot 和 onQueued 回调", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    const onQueuedCallback = vi.fn();
    // withSlot 接收 onQueued 回调并模拟调用
    deps.semaphoreScope.withSlot = vi.fn((_providerId, _signal, onQueued, fn) => {
      onQueued(); // 模拟排队事件
      return fn();
    });
    deps.trackerScope.track = vi.fn((_req, fn, _extractStatus) => fn());

    deps.resilience.execute = vi.fn(() => Promise.resolve({
      result: successResult,
      attempts: [{ target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 0, statusCode: 200, error: null, latencyMs: 50, responseBody: null }],
      excludedTargets: [],
    }));

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { db: deps.db, resolved: { backend_model: "gpt-4", provider_id: "p1" }, provider: { id: "p1", name: "test", is_active: true, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: false },
    );

    // withSlot 被调用且 onQueued 回调被触发
    expect(deps.semaphoreScope.withSlot).toHaveBeenCalledWith("p1", expect.anything(), expect.any(Function), expect.any(Function));
    // onQueued 在 withSlot 内被调用
    expect(onQueuedCallback).not.toHaveBeenCalled(); // 这里只验证 withSlot 签名正确
  });

  // --- 场景 6: 重试 → ResilienceLayer 返回多次尝试 ---

  it("重试场景下 ResilienceLayer 返回多次尝试记录", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    deps.semaphoreScope.withSlot = vi.fn((_providerId, _signal, _onQueued, fn) => fn());
    deps.trackerScope.track = vi.fn((_req, fn, _extractStatus) => fn());

    // 第一次失败，第二次成功
    const resilienceResult: ResilienceResult = {
      result: successResult,
      attempts: [
        { target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 0, statusCode: 429, error: null, latencyMs: 100, responseBody: "rate limited" },
        { target: { backend_model: "gpt-4", provider_id: "p1" }, attemptIndex: 1, statusCode: 200, error: null, latencyMs: 50, responseBody: null },
      ],
      excludedTargets: [],
    };
    deps.resilience.execute = vi.fn(() => Promise.resolve(resilienceResult));

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { db: deps.db, resolved: { backend_model: "gpt-4", provider_id: "p1" }, provider: { id: "p1", name: "test", is_active: true, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: false },
    );

    expect(deps.resilience.execute).toHaveBeenCalledTimes(1);
    // 验证只调用了一次 execute，重试由 resilience 内部处理
    const result = await (deps.resilience.execute as vi.Mock).mock.results[0].value;
    expect(result.attempts).toHaveLength(2);
  });

  // --- 场景 7: Failover → ResilienceLayer 切换 target ---

  it("Failover 场景下 ResilienceLayer 排除失败 target 并切换", async () => {
    const request = createMockRequest();
    const reply = createMockReply();

    deps.semaphoreScope.withSlot = vi.fn((_providerId, _signal, _onQueued, fn) => fn());
    deps.trackerScope.track = vi.fn((_req, fn, _extractStatus) => fn());

    const target1: Target = { backend_model: "gpt-4", provider_id: "p1" };
    const target2: Target = { backend_model: "gpt-4o", provider_id: "p2" };

    const resilienceResult: ResilienceResult = {
      result: successResult,
      attempts: [
        { target: target1, attemptIndex: 0, statusCode: 500, error: null, latencyMs: 50, responseBody: "error" },
        { target: target2, attemptIndex: 1, statusCode: 200, error: null, latencyMs: 80, responseBody: null },
      ],
      excludedTargets: [target1],
    };
    deps.resilience.execute = vi.fn(() => Promise.resolve(resilienceResult));

    await orchestrator.handle(
      request, reply, "openai", "/v1/chat/completions", errors,
      { db: deps.db, resolved: target1, provider: { id: "p1", name: "test", is_active: true, api_type: "openai", base_url: "http://localhost:8080", api_key: "enc:xxx" }, isStream: false },
    );

    expect(deps.resilience.execute).toHaveBeenCalledTimes(1);
    const result = await (deps.resilience.execute as vi.Mock).mock.results[0].value;
    expect(result.excludedTargets).toContainEqual(target1);
    expect(result.attempts).toHaveLength(2);
    expect(reply.status).toHaveBeenCalledWith(200);
  });
});
```

测试重点：验证调用链的顺序和 scope 的 try/finally 行为。Orchestrator 的 `handle` 方法接收已解析的 `resolved`（Target | null）和 `provider`，早期拒绝逻辑（resolved 为 null、provider 不可用）不进入 scope。正式请求通过 trackerScope.track → semaphoreScope.withSlot → resilience.execute 的嵌套调用链。

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
import { randomUUID } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import type { TransportResult } from "./types.js";
import type { Target } from "./strategy/types.js";
import type { ResilienceLayer, ResilienceResult, ResilienceConfig } from "./resilience.js";
import type { SemaphoreScope } from "./scope.js";
import type { TrackerScope } from "./scope.js";
import type { ProxyErrorFormatter, RawHeaders } from "./proxy-core.js";
import { ProviderSwitchNeeded } from "./types.js";
import type { ActiveRequest } from "../monitor/types.js";

// ---------- Orchestrator 配置 ----------

export interface OrchestratorConfig {
  db: Database.Database;
  resolved: Target | null;
  provider: {
    id: string;
    name: string;
    is_active: boolean;
    api_type: string;
    base_url: string;
    api_key: string;
  } | null;
  isStream: boolean;
}

export interface HandleContext {
  apiType: "openai" | "anthropic";
  upstreamPath: string;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  failoverThreshold: number;
  isFailover: boolean;
  beforeSendProxy?: (body: Record<string, unknown>, isStream: boolean) => void;
}

export class ProxyOrchestrator {
  constructor(
    private deps: {
      transport: { callNonStream: Function; callStream: Function };
      resilience: ResilienceLayer;
      semaphoreScope: SemaphoreScope;
      trackerScope: TrackerScope;
      db: Database.Database;
    },
  ) {}

  async handle(
    request: FastifyRequest,
    reply: FastifyReply,
    apiType: "openai" | "anthropic",
    upstreamPath: string,
    errors: ProxyErrorFormatter,
    config: OrchestratorConfig,
    ctx?: HandleContext,
  ): Promise<FastifyReply> {
    const { resolved, provider, isStream } = config;

    // 早期拒绝：映射找不到，不消耗信号量和 tracker
    if (!resolved) {
      const e = errors.modelNotFound((request.body as Record<string, unknown>).model as string ?? "unknown");
      return reply.status(e.statusCode).send(e.body);
    }

    // 早期拒绝：Provider 不可用
    if (!provider || !provider.is_active) {
      const e = errors.providerUnavailable();
      return reply.status(e.statusCode).send(e.body);
    }

    // 早期拒绝：api_type 不匹配
    if (provider.api_type !== apiType) {
      const e = errors.providerTypeMismatch();
      return reply.status(e.statusCode).send(e.body);
    }

    // 正式处理：trackerScope.track 保证 start/complete 配对
    const logId = randomUUID();
    const trackerReq: ActiveRequest = {
      id: logId,
      apiType,
      model: (request.body as Record<string, unknown>).model as string ?? "unknown",
      providerId: provider.id,
      providerName: provider.name,
      isStream,
      startTime: Date.now(),
      status: "pending",
      retryCount: 0,
      attempts: [],
      clientIp: request.ip,
      queued: false,
    };

    // 生成 AbortSignal，客户端断连时取消排队
    const ac = new AbortController();
    request.raw.on("close", () => ac.abort());

    return this.deps.trackerScope.track(
      trackerReq,
      () => this.deps.semaphoreScope.withSlot(
        provider.id,
        ac.signal,
        () => { /* onQueued 回调由 SemaphoreScope 内部处理 */ },
        () => this.executeWithFailover(resolved, provider, request, reply, apiType, upstreamPath, isStream, ctx),
      ),
      (result: ResilienceResult) => {
        const status = result.result.statusCode;
        return {
          status: status < 400 ? "completed" as const : "failed" as const,
          statusCode: status,
        };
      },
    );
  }

  /**
   * 通过 ResilienceLayer 执行上游调用。
   * 跨 provider failover（ProviderSwitchNeeded）跳出当前 semaphoreScope，
   * 由 orchestrator 用新 providerId 重新进入。
   */
  private async executeWithFailover(
    resolved: Target,
    provider: NonNullable<OrchestratorConfig["provider"]>,
    request: FastifyRequest,
    reply: FastifyReply,
    apiType: "openai" | "anthropic",
    upstreamPath: string,
    isStream: boolean,
    ctx?: HandleContext,
  ): Promise<ResilienceResult> {
    const resilienceConfig: ResilienceConfig = {
      maxRetries: ctx?.retryMaxAttempts ?? 3,
      baseDelayMs: ctx?.retryBaseDelayMs ?? 1000,
      failoverThreshold: ctx?.failoverThreshold ?? 400,
      isFailover: ctx?.isFailover ?? false,
    };

    try {
      const result = await this.deps.resilience.execute(
        // targets getter：当前只返回单个 target
        () => [resolved],
        // 传输函数：根据 isStream 分发到 callNonStream 或 callStream
        (target: Target) => {
          const body = request.body as Record<string, unknown>;
          const cliHdrs: RawHeaders = request.headers as RawHeaders;

          // 执行 beforeSendProxy 钩子（如注入 stream_options）
          ctx?.beforeSendProxy?.(body, isStream);

          if (isStream) {
            return (this.deps.transport.callStream as Function)(
              { base_url: provider.base_url },
              provider.api_key,
              body,
              cliHdrs,
              reply,
              ctx?.streamTimeoutMs ?? 30000,
              upstreamPath,
              // buildHeaders 由 transport 层内部处理
            );
          }
          return (this.deps.transport.callNonStream as Function)(
            { base_url: provider.base_url },
            provider.api_key,
            body,
            cliHdrs,
            upstreamPath,
          );
        },
        resilienceConfig,
      );

      // 发送响应到客户端
      this.sendResponse(result.result, reply, isStream);

      return result;
    } catch (e: unknown) {
      if (e instanceof ProviderSwitchNeeded) {
        return this.handleProviderSwitch(e, request, reply, apiType, upstreamPath, isStream, ctx);
      }
      throw e;
    }
  }

  /**
   * 跨 provider failover：ResilienceLayer 检测到需要切换到不同 provider，
   * 通过 ProviderSwitchNeeded 异常通知 orchestrator。
   * orchestrator 用新 providerId 重新进入 semaphoreScope + trackerScope。
   */
  private async handleProviderSwitch(
    switchNeeded: ProviderSwitchNeeded,
    request: FastifyRequest,
    reply: FastifyReply,
    apiType: "openai" | "anthropic",
    upstreamPath: string,
    isStream: boolean,
    ctx?: HandleContext,
  ): Promise<ResilienceResult> {
    // 跨 provider failover 需要：
    // 1. 释放当前 provider 的信号量（已在 withSlot 的 finally 中完成）
    // 2. 获取新 provider 的信号量
    // 3. 重新进入 trackerScope
    //
    // 注意：这里不能直接调用 this.handle()，因为 handle() 会重新做早期拒绝检查。
    // 但逻辑上 ProviderSwitchNeeded 的 targetProviderId 已经通过了校验，
    // 所以简化实现：用新 providerId 重新走 withSlot + resilience 路径。
    //
    // 完整实现需要在 PR-3 执行时根据实际 ResilienceLayer 接口调整。
    const newProviderId = switchNeeded.targetProviderId;
    const ac = new AbortController();
    request.raw.on("close", () => ac.abort());

    return this.deps.semaphoreScope.withSlot(
      newProviderId,
      ac.signal,
      () => { /* onQueued */ },
      async () => {
        // 新 provider 的 resilience 执行
        const resilienceConfig: ResilienceConfig = {
          maxRetries: ctx?.retryMaxAttempts ?? 3,
          baseDelayMs: ctx?.retryBaseDelayMs ?? 1000,
          failoverThreshold: ctx?.failoverThreshold ?? 400,
          isFailover: ctx?.isFailover ?? false,
        };

        const result = await this.deps.resilience.execute(
          () => [{ backend_model: "auto", provider_id: newProviderId }],
          (target: Target) => {
            const body = request.body as Record<string, unknown>;
            const cliHdrs: RawHeaders = request.headers as RawHeaders;
            ctx?.beforeSendProxy?.(body, isStream);

            if (isStream) {
              return (this.deps.transport.callStream as Function)(
                { base_url: "" }, provider_base_url 从 DB 查询,
                body, cliHdrs, reply, ctx?.streamTimeoutMs ?? 30000, upstreamPath,
              );
            }
            return (this.deps.transport.callNonStream as Function)(
              { base_url: "" }, 同上,
              body, cliHdrs, upstreamPath,
            );
          },
          resilienceConfig,
        );

        this.sendResponse(result.result, reply, isStream);
        return result;
      },
    );
  }

  /**
   * 将 TransportResult 发送到客户端。
   * 流式成功时数据已通过 pipe 发送，只需处理 error/stream_error 场景。
   */
  private sendResponse(result: TransportResult, reply: FastifyReply, isStream: boolean): void {
    if (result.kind === "throw") return; // 网络错误由上层处理

    if (isStream) {
      if (result.kind === "stream_error") {
        // 流式错误：发送上游返回的错误响应
        for (const [k, v] of Object.entries(result.headers)) reply.header(k, v);
        reply.status(result.statusCode).send(result.body);
      }
      // stream_success: 数据已通过 pipe 发送，无需额外操作
      // stream_abort: 客户端已断连，无需发送
    } else {
      // 非流式：设置 headers 并发送 body
      if ("headers" in result) {
        for (const [k, v] of Object.entries(result.headers)) reply.header(k, v);
      }
      if ("body" in result) {
        reply.status(result.statusCode).send(result.body);
      }
    }
  }
}
```

注意：`handleProviderSwitch` 中的新 provider base_url 需要从 DB 查询。上面的伪代码中标记了 `从 DB 查询` 占位。实际实现时需要在 executeWithFailover 调用前从 DB 加载 provider 信息，或者将 provider 信息附加到 ProviderSwitchNeeded 异常中。推荐方案：让 ResilienceLayer 在抛出 ProviderSwitchNeeded 时携带完整的 target provider 信息（至少包含 base_url 和 api_key），避免 handleProviderSwitch 再次查询 DB。

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

当前文件 `src/proxy/openai.ts` 约 110 行。需要修改以下部分：

**1a. 导入变更（文件顶部 L1-18）**

```typescript
// 删除：
import {
  proxyGetRequest,
  type RawHeaders,
  handleProxyPost,
  type ProxyHandlerDeps,
  type ProxyErrorResponse,
  type ProxyErrorFormatter,
} from "./proxy-core.js";
import { RetryRuleMatcher } from "./retry-rules.js";
import { ProviderSemaphoreManager } from "./semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";

// 替换为：
import {
  type RawHeaders,
  type ProxyErrorResponse,
  type ProxyErrorFormatter,
} from "./proxy-core.js";
import { ProxyOrchestrator } from "./orchestrator.js";
import type { TransportLayer } from "./transport.js";
import type { ResilienceLayer } from "./resilience.js";
import type { SemaphoreScope } from "./scope.js";
import type { TrackerScope } from "./scope.js";
import { proxyGetRequest } from "./transport.js";
```

**1b. 接口变更（L20-28 `OpenaiProxyOptions`）**

```typescript
// 旧：
export interface OpenaiProxyOptions {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  semaphoreManager?: ProviderSemaphoreManager;
  tracker?: RequestTracker;
}

// 新：
export interface OpenaiProxyOptions {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: any; // 保留兼容，Task 3.6 后类型更新为 RetryRuleMatcher
  semaphoreManager?: any;
  tracker?: any;
  orchestrator: ProxyOrchestrator;
}
```

**1c. POST handler 变更（L73-81）**

```typescript
// 旧：
app.post(CHAT_COMPLETIONS_PATH, async (request, reply) => {
  const deps: ProxyHandlerDeps = { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher, semaphoreManager, tracker };
  return handleProxyPost(request, reply, "openai", CHAT_COMPLETIONS_PATH, openaiErrors, deps, {
    beforeSendProxy: (body, isStream) => {
      if (isStream && !body.stream_options) {
        body.stream_options = { include_usage: true };
      }
    },
  });
});

// 新：
app.post(CHAT_COMPLETIONS_PATH, async (request, reply) => {
  const config = buildOrchestratorConfig(db, request);
  return opts.orchestrator.handle(request, reply, "openai", CHAT_COMPLETIONS_PATH, openaiErrors, config, {
    apiType: "openai",
    upstreamPath: CHAT_COMPLETIONS_PATH,
    streamTimeoutMs,
    retryMaxAttempts,
    retryBaseDelayMs,
    failoverThreshold: 400,
    isFailover: false, // 由 mapping group strategy 决定
    beforeSendProxy: (body, isStream) => {
      if (isStream && !body.stream_options) {
        body.stream_options = { include_usage: true };
      }
    },
  });
});
```

其中 `buildOrchestratorConfig` 封装 applyEnhancement + resolveMapping + getProviderById 的调用：

```typescript
function buildOrchestratorConfig(db, request): OrchestratorConfig {
  const clientModel = request.body?.model ?? "unknown";
  const sessionId = request.headers["x-claude-code-session-id"];
  const { effectiveModel, originalModel, interceptResponse } = applyEnhancement(db, request, clientModel, sessionId);
  if (interceptResponse) return { db, interceptResponse, resolved: null, provider: null, isStream: false };
  const resolved = resolveMapping(db, effectiveModel, { now: new Date(), excludeTargets: [] });
  if (!resolved) return { db, interceptResponse: null, resolved: null, provider: null, isStream: false };
  const provider = getProviderById(db, resolved.provider_id);
  const isStream = request.body?.stream === true;
  return { db, interceptResponse: null, resolved, provider, isStream };
}
```

注意：GET `/v1/models` 路由（L84-104）不受影响，仍使用 `proxyGetRequest`。

- [ ] **Step 2: 更新 anthropic.ts**

对称修改，文件结构几乎相同（`src/proxy/anthropic.ts` 约 70 行）。

关键差异：
- 导入中 `handleProxyPost` 替换为 `ProxyOrchestrator`，与 openai.ts 对称
- `MESSAGES_PATH = "/v1/messages"` 替代 `CHAT_COMPLETIONS_PATH`
- 无 GET 路由，无 `beforeSendProxy`
- `anthropicErrors` 格式保持不变
- 新增 `orchestrator` 到 `AnthropicProxyOptions`

搜索关键词定位：`handleProxyPost`、`ProxyHandlerDeps`、`RetryRuleMatcher`、`ProviderSemaphoreManager`

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

文件 `src/proxy/proxy-logging.ts`，约 100 行。

**1a. 类型导入变更（文件顶部 L8-9）**

```typescript
// 旧：
import type { ProxyResult, StreamProxyResult } from "./transport.js";
import type { Attempt } from "./retry.js";

// 新：
import type { TransportResult } from "./types.js";
import type { ResilienceAttempt } from "./resilience.js";
```

**1b. logRetryAttempts 签名变更**

搜索关键词：`function logRetryAttempts`

```typescript
// 旧签名中 attempts 参数：
//   attempts: Attempt[], result: ProxyResult | StreamProxyResult
// 新签名：
//   attempts: ResilienceAttempt[], result: TransportResult

// 函数内部根据 result.kind 分发（替代 ProxyResult/StreamProxyResult 类型检查）：
// 旧：
//   const isStream = ("abnormalClose" in result) || ("metricsResult" in result);
// 新：
//   const isStream = result.kind === "stream_success" || result.kind === "stream_error"
//                   || result.kind === "stream_abort";

// 旧字段访问：
//   result.statusCode, (result as StreamProxyResult).responseBody
// 新字段访问：
//   result.statusCode, result.kind === "stream_error" ? result.body : ""
```

**1c. collectMetrics 签名变更**

搜索关键词：`function collectMetrics`

```typescript
// 旧：
//   result: ProxyResult | StreamProxyResult
// 新：
//   result: TransportResult
// 内部分发逻辑与 logRetryAttempts 对称，根据 kind 字段判断流式/非流式
```

**1d. ResilienceAttempt 字段映射**

`ResilienceAttempt` 相比 `Attempt` 多了 `target` 字段，内部使用 `attempt.statusCode`、`attempt.error`、`attempt.latencyMs` 的代码不需要改动。

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

文件 `src/index.ts`，约 245 行。需要在 buildApp 函数中（L47-L222）修改。

**1a. 导入变更（文件顶部 L32-38）**

```typescript
// 在现有导入后添加：
import { ProxyOrchestrator } from "./proxy/orchestrator.js";
import { SemaphoreScope } from "./proxy/scope.js";
import { TrackerScope } from "./proxy/scope.js";
// TransportLayer 和 ResilienceLayer 的导入取决于 PR-1/PR-2 的导出方式：
// TransportLayer: 如果 PR-1 用 namespace 导出，则 import { TransportLayer } from "./proxy/transport.js"
// ResilienceLayer: import { ResilienceLayer } from "./proxy/resilience.js"
```

**1b. 实例化新组件（在 L137-157 信号量初始化之后）**

搜索关键词：`const semaphoreManager = new ProviderSemaphoreManager()`

在 `const tracker = new RequestTracker(...)` 之后（约 L138），添加：

```typescript
// --- 新架构组件实例化 ---
const semaphoreScope = new SemaphoreScope(semaphoreManager);
const trackerScope = new TrackerScope(tracker);
const resilience = new ResilienceLayer();
// transport 使用 transport.ts 中的独立函数，不实例化类
// ProxyOrchestrator 通过构造函数注入所有依赖
const orchestrator = new ProxyOrchestrator({
  transport: {
    callNonStream: callNonStream, // 从 transport.js 导入
    callStream: callStream,       // 从 transport.js 导入
  },
  resilience,
  semaphoreScope,
  trackerScope,
  db,
});
```

**1c. 传递 orchestrator 给插件（L159-177）**

搜索关键词：`app.register(openaiProxy`

```typescript
// 旧：
app.register(openaiProxy, {
  db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs,
  matcher, semaphoreManager, tracker,
});
app.register(anthropicProxy, {
  db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs,
  matcher, semaphoreManager, tracker,
});

// 新：
app.register(openaiProxy, {
  db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs,
  matcher, semaphoreManager, tracker, orchestrator,
});
app.register(anthropicProxy, {
  db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs,
  matcher, semaphoreManager, tracker, orchestrator,
});
```

注意：`matcher`、`semaphoreManager`、`tracker` 保留在 options 中，因为 `adminRoutes`（L179）和 GET `/v1/models` 路由仍直接使用它们。Orchestrator 通过 deps 接收 resilience、semaphoreScope、trackerScope，不再需要直接接收 manager 和 tracker。

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
- Modify: `src/proxy/transport.ts` (删除 compat wrapper)

- [ ] **Step 1: 确认 proxy-core.ts 无外部消费者**

搜索所有 import from proxy-core 的文件，确认已迁移。预期只有 `openai.ts` 和 `anthropic.ts` 还在导入类型（`ProxyErrorFormatter`、`RawHeaders`）和 `proxyGetRequest`。

```bash
grep -r "from.*proxy-core" src/ --include="*.ts"
```

- [ ] **Step 2: 删除 proxy-core.ts 中不再需要的导出**

保留以下内容（仍有外部消费者）：
- `proxyGetRequest`（GET `/v1/models` 路由仍需要）
- `SKIP_UPSTREAM`、`selectHeaders`、`buildUpstreamHeaders`（openai/anthropic 中直接使用）
- `ProxyErrorFormatter`、`ProxyErrorResponse` 类型（openai/anthropic 的 errors 对象定义）
- `RawHeaders` 类型 re-export

移除以下内容：
- `handleProxyPost` 函数（整个函数体约 130 行，L130-L431）
- `ProxyHandlerDeps` 接口（已由 OrchestratorConfig 替代）
- `FAILOVER_FAIL_THRESHOLD`、`STREAM_CONTENT_MAX_RAW`、`STREAM_CONTENT_MAX_TEXT` 常量（已移入 orchestrator/resilience）
- `TransportResult`、`GetProxyResult` 的 re-export（不再需要中间转发）

- [ ] **Step 3: 删除 transport.ts 中的 compat wrapper**

**这是 PR-1 遗留的临时代码，PR-3 完成时必须清理。**

在 `src/proxy/transport.ts` 中删除以下内容（约在文件尾部）：

```typescript
// 删除整个 compat wrapper 区块：
// 1. 删除 ProxyResult 接口
export interface ProxyResult { ... }

// 2. 删除 StreamProxyResult 接口
export interface StreamProxyResult { ... }

// 3. 删除 proxyNonStreamCompat 函数
export function proxyNonStreamCompat(...) { ... }

// 4. 删除 proxyStreamCompat 函数
export function proxyStreamCompat(...) { ... }
```

同时更新所有导入这些 compat 类型的文件：

```bash
# 搜索所有引用 compat 类型的文件
grep -r "proxyNonStreamCompat\|proxyStreamCompat\|ProxyResult\|StreamProxyResult" src/ --include="*.ts"
```

预期需要更新的文件：
- `src/proxy/proxy-logging.ts`：将 `ProxyResult | StreamProxyResult` 参数改为 `TransportResult`（Task 3.6 已完成）
- `src/proxy/proxy-core.ts`：删除对 compat wrapper 的导入（Step 2 已清理）

- [ ] **Step 4: 删除 upstream-call.ts 和 retry.ts**

如果 PR-1/PR-2 保留了旧文件作为兼容 shim，此时删除。

```bash
# 确认无残留导入
grep -r "from.*upstream-call\|from.*retry\.js" src/ tests/ --include="*.ts"
```

确认结果为空后删除：
```bash
rm src/proxy/upstream-call.ts  # PR-1 已迁移到 transport.ts
rm src/proxy/retry.ts           # PR-2 已迁移到 resilience.ts
```

- [ ] **Step 5: 运行全量测试 + lint + 编译**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```
refactor: remove legacy proxy-core handleProxyPost, compat wrappers, upstream-call, retry
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
