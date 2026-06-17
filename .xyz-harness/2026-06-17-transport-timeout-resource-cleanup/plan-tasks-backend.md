---
verdict: pass
---

# 后端任务详情 — Transport 超时与资源泄漏修复

> 接口签名是设计契约，非实现代码。下方仅列签名 + 关键调用关系 + 测试要点，不写完整函数体。

## Task 1: transport signal + timeout 基础设施

**Type:** backend **Group:** BG1

**Files:**
- Modify: `router/src/proxy/transport/http.ts`（callNonStream 签名扩展）
- Modify: `router/src/proxy/transport/stream.ts`（callStream 签名扩展 + 响应头前 setTimeout）
- Modify: `router/src/proxy/transport/transport-fn.ts`（transportFn 闭包接 signal 参数）
- Test: `router/tests/core/proxy/transport-signal-timeout.test.ts`（新建）

**接口签名：**

```typescript
// http.ts — callNonStream 新增 opts 参数
export function callNonStream(
  backend: { base_url: string }, apiKey: string, body: Record<string, unknown>,
  clientHeaders: RawHeaders, upstreamPath: string, buildHeaders: BuildHeadersFn,
  agent?: Agent, opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<TransportResult>

// stream.ts — callStream 新增 opts 参数（connectTimeoutMs = 响应头前超时，复用 stream timeout 值）
export function callStream(
  /* ... 现有参数 ... */,
  agent?: Agent, opts?: { signal?: AbortSignal; connectTimeoutMs?: number },
): Promise<TransportResult>
```

**关键行为（实现要点，非代码）：**
- `createUpstreamRequest` 后立即：若 `opts.timeoutMs` 为正有限值，`req.setTimeout(opts.timeoutMs)`，并 `req.on("timeout", () => req.destroy(new Error("upstream inactivity timeout")))`。`0`/`Infinity` 跳过（与 idleTimer 守卫对称）。
- 若 `opts.signal`：`signal.addEventListener("abort", () => req.destroy(new AbortError(...)), { once: true })`。**destroy 必须带 error 参数**，否则不 emit `error` 事件，Promise 永挂（G-003/G4-002）。
- req 的 `error` 事件已有 `resolve({kind:"throw", error})`，destroy(abortError) → emit error → 走该 resolve。验证 destroy 后必有一处 resolve（G-022 实现要点）。

**测试要点：**
- TC：mock 上游 hang（不回响应），设 timeoutMs=100ms → 100ms 后 resolve throw，且 req 被销毁（检查 socket destroyed）。
- TC：signal.abort() 后 callNonStream resolve throw，upstreamReq.destroyed===true。
- TC：timeoutMs=0 时无 setTimeout（不触发超时）。

---

## Task 2: StreamProxy cleanup 销毁上游资源 + 健壮性

**Type:** backend **Group:** BG1 **Depends:** 1

**Files:**
- Modify: `router/src/proxy/transport/stream.ts`（StreamProxy 持有 upstreamRes/upstreamReq；cleanup destroy；passThrough error listener；idleTimer unref；onUpstreamError 走 transition）
- Test: `router/tests/core/proxy/stream-cleanup.test.ts`（新建或复用）

**关键改动：**
- `callStream` 创建 StreamProxy 时传入 `upstreamReq` 与 `upstreamRes` 引用，存为实例字段。
- `StreamProxy.cleanup()`（stream.ts:131）：destroy 前增加 `this.upstreamRes?.destroy()` 和 `this.upstreamReq?.destroy()`（幂等：destroyed 标志已有，res 检查 `!res.destroyed`）。
- `startStreaming()`：`this.passThrough.on("error", (err) => this.terminal("stream_abort", { metrics: this.collectMetrics(false), abortReason: "pipe_error" }))` 或 logger.warn + cleanup。防止 transform 报错冒泡 uncaughtException（G-007）。
- `resetIdleTimer()`（stream.ts:151）：`this.idleTimer = setTimeout(...); this.idleTimer.unref?.();`（G-008）。
- `onUpstreamError()`（stream.ts:362）：resolved 赋值前先 `this.transition("ABORTED")` 再 cleanup，保持状态机一致（G-009，次要）。

**测试要点：**
- TC：loop_detection 触发 terminal 后，upstreamRes.destroyed===true（模拟上游继续推数据，验证不再 write）。
- TC：cleanup 重复调用幂等（多次不抛错）。
- TC：passThrough emit error 后不触发 uncaughtException（process.on 监听验证）。

---

## Task 3: callGet 超时 + 非流式 signal

**Type:** backend **Group:** BG1 **Depends:** 1

**Files:**
- Modify: `router/src/proxy/transport/http.ts`（callGet 加 timeoutMs opts）
- Modify: `router/src/proxy/transport/provider-connectivity.ts`（调用处传 `DEFAULT_GET_TIMEOUT_MS`）
- Modify: `router/src/core/constants.ts` 或 `transport-fn.ts`（定义 `DEFAULT_GET_TIMEOUT_MS = 30_000`）
- Test: 复用 transport-signal-timeout.test.ts

**关键改动：**
- callGet 新增 `opts?: { timeoutMs?: number }`，`req.setTimeout(opts.timeoutMs ?? DEFAULT_GET_TIMEOUT_MS)` + `req.on("timeout", () => req.destroy(timeoutError))`。callGet 无 signal 需求（admin 探测，无客户端关联），仅超时。
- `provider-connectivity.ts:19` 调用 callGet 时传 `{ timeoutMs: DEFAULT_GET_TIMEOUT_MS }`。

**测试要点：**
- TC：mock 探测上游 hang → 30s（测试用小值）超时后 reject/resolve。

---

## Task 4: orchestrator close handler + signal 透传 + resilience 短路

**Type:** backend **Group:** BG2 **Depends:** 1

**Files:**
- Modify: `router/src/proxy/orchestration/orchestrator.ts`（close handler 修复、signal 透传、adaptive 过滤、listener 幂等）
- Modify: `router/src/proxy/orchestration/resilience.ts`（execute 加 signal）
- Modify: `router/src/proxy/transport/transport-fn.ts`（transportFn 接收并传递 signal）
- Test: `router/tests/core/proxy/orchestrator-client-disconnect.test.ts`（新建）

**关键改动（orchestrator.ts:96-106）：**
- 移除 `if (!request.raw.readableEnded)` 守卫。改为监听 `reply.raw`（客户端响应端）：
  ```typescript
  // listener 幂等：同一 reply 只挂一次（failover 循环复用 reply）
  // 用模块级 WeakSet 避免 any（CLAUDE.md no-explicit-any: error）
  if (!ABORT_LISTENER_ATTACHED.has(reply.raw)) {
    ABORT_LISTENER_ATTACHED.add(reply.raw);
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
  }
  // ABORT_LISTENER_ATTACHED = new WeakSet<FastifyReply["raw"]>() 定义在模块级
  ```
  用 `writableEnded` 判断响应未完成才 abort（响应已完成时 close 是正常结束，不 abort）。G4-003 幂等。
- signal 透传：`controller.signal` 通过 HandleContext 或直接传入 `executeResilience` → `resilience.execute(fn, config, controller.signal)`。execute 把 signal 传给 `fn(currentTarget, signal)`。

**关键改动（resilience.ts execute）：**
- 签名加 `signal?: AbortSignal`。while(true) 顶部、每次 `fn(currentTarget)` 前：
  ```typescript
  if (signal?.aborted) {
    return { result: { kind: "throw", error: new AbortError(...) }, attempts: allAttempts, ... };
  }
  ```
- `retry` 的 `await sleep(delayMs)` 后再查一次 signal.aborted（sleep 期间客户端可能断连）。

**测试要点：**
- TC：流式 TTFT 阶段 `reply.raw.destroy()`（模拟客户端断连）→ controller.abort → callStream resolve throw → 槽位释放。
- TC：客户端断连后 resilience 不进入 retry（signal 短路），attempts 长度=1。

---

## Task 5: adaptive 过滤客户端断连

**Type:** backend **Group:** BG2 **Depends:** 4

**Files:**
- Modify: `router/src/proxy/orchestration/orchestrator.ts`（onRequestComplete 调用前检查 signal.aborted）
- Modify: `router/src/core/concurrency/adaptive-controller.ts`（可选：AdaptiveResult 加 clientAborted 标记）
- Test: `router/tests/core/concurrency/adaptive-client-abort.test.ts`

**关键改动（orchestrator.ts handle 的 success 和 catch 分支）：**
- 调 `adaptiveController.onRequestComplete` 前：`if (controller.signal.aborted) return;`（客户端断连不计入）。
- 或：传 `onRequestComplete(providerId, { success, statusCode, retryRuleMatched, requestId, clientAborted: controller.signal.aborted })`，adaptive-controller 内 clientAborted===true 时跳过 transitionFailure。

**测试要点：**
- TC：客户端断连后 adaptive 的 consecutiveFailures 不增加（G5-001）。
- TC：真实上游失败（signal 未 abort）仍正常退避。

---

## Task 6: killRequest 同步幂等释放 + semaphore/withSlot 防护

**Type:** backend **Group:** BG2

**Files:**
- Modify: `router/src/core/concurrency/semaphore.ts`（reqId→token 映射 + releaseByReqId + 幂等）
- Modify: `router/src/core/monitor/request-tracker.ts`（注入 release 回调、killRequest 调用）
- Modify: `router/src/proxy/orchestration/scope.ts`（withSlot acquire 抛错不 release(undefined)）
- Modify: `router/src/proxy/orchestration/orchestrator.ts`（传 reqId 给 withSlot）
- Modify: `router/src/index.ts` 或 orchestrator 注册处（绑定 release 回调）
- Test: `router/tests/core/monitor/kill-release.test.ts`

**接口签名：**

```typescript
// semaphore.ts —— 内聚 reqId→token 映射，token 细节不外泄
export interface AcquireToken {
  readonly generation: number
  readonly bypassed: boolean
  released: boolean  // 新增：幂等标志
}
interface TokenRecord { token: AcquireToken; providerId: string }  // 同时存 providerId，release 时一次性清理
export class SemaphoreManager {
  private reqTokenMap = new Map<string, TokenRecord>()
  // acquire 增可选 reqId，成功后存入 { token, providerId }
  async acquire(providerId, signal?, onQueued?, logger?, override?, reqId?): Promise<AcquireToken>
  release(providerId, token, logger?): void  // token.released===true → return（幂等）；成功后同步 reqTokenMap.delete（按 reqId）
  releaseByReqId(reqId: string): void  // 取 TokenRecord 后 release(providerId, token)；不存在→noop
}

// scope.ts —— withSlot 传 reqId 给 acquire；finally release 后 reqTokenMap 自动清理
async withSlot<T>(providerId, signal, onQueued, fn, concurrencyOverride?, reqId?): Promise<T>

// request-tracker.ts
setReleaseSlotProvider(fn: (reqId: string) => void): void  // 注入 semaphore.releaseByReqId
killRequest(id: string): boolean  // complete 后调 releaseSlotProvider(id)
```

**关键改动（token 流转链路，修正审查 MUST_FIX #1 + LOW #7/#8）：**
- `SemaphoreManager` 的 `reqTokenMap` 存 `TokenRecord = { token, providerId }`，acquire 成功时若传 reqId 存入。
- **reqTokenMap 存入时机（审查 SHOULD_FIX #10）：必须在 acquire 的 resolve 回调内执行（即排队获取槽位成功后），不能在 Promise executor 创建 token 后立即存**——否则排队中被 kill 会误减 current。
- `release(providerId, token)` 成功递减/dequeue 后，**同步 `reqTokenMap.delete(reqId)`**（若 token 关联 reqId）——自然完成路径自动清理，避免 map 无限增长（LOW #8）。token 需记录所属 reqId（acquire 时传入）。
- `releaseByReqId(reqId)`：取 TokenRecord 拿到 `{token, providerId}`，调 `release(providerId, token)`（LOW #7 解决 providerId 来源）。
- `AcquireToken` 加 `released: boolean`。`release` 开头检查 `token.released===true → return`。kill 强制释放与自然释放都走同一 release，幂等。
- `withSlot` 把 reqId（来自 trackerReq.id）透传给 acquire；finally `if (token) release(token)`。
- `RequestTracker.killRequest`：complete 后调 `releaseSlotProvider?.(id)`（= semaphore.releaseByReqId）。
- **场景覆盖验证：**
  - kill 已 acquire 请求 → releaseByReqId 取 token → current 递减 ✓
  - kill 排队中请求（无 token）→ releaseByReqId noop，不抛 TypeError ✓（AC-10）
  - kill 后 transport 又自然 resolve → withSlot finally release(token)，token.released 已 true → 跳过，不双重递减 ✓（AC-13）

**测试要点：**
- TC：kill 已 acquire 请求 → semaphore.current 递减，槽位可复用。
- TC：kill 后请求自然完成（竞态）→ 不双重 release（current 不超减）。
- TC：kill 排队中请求（未 acquire）→ releaseByReqId noop，不抛 TypeError，current 未受影响。

---

## Task 7: graceful shutdown abort inflight

**Type:** backend **Group:** BG2 **Depends:** 6

**Files:**
- Modify: `router/src/app/register-routes.ts`（close() 遍历 killCallbacks）
- Modify: `router/src/core/monitor/request-tracker.ts`（暴露 abortAllInflight 方法）
- Test: `router/tests/core/monitor/shutdown-abort.test.ts`

**关键改动：**
- `RequestTracker` 加 `abortAllInflight(): void`：遍历 `killCallbacks` 逐个调用并清空（复用 kill 机制）。
- `register-routes.ts close()`：在 `semaphoreManager.removeAll()` 前 `tracker.abortAllInflight()`。

**测试要点：**
- TC：有 inflight 请求时 close() → 所有 killCallbacks 被调用，upstreamReq 销毁。

---

## Task 8: 超时配置数据层 + 默认值统一

**Type:** backend **Group:** BG3

**Files:**
- Modify: `router/src/config/model-context.ts`（ModelEntry/ModelInfo 加字段；parseModels 解析；buildModelInfoList 输出）
- Modify: `router/src/db/providers.ts`（getModelStreamTimeout→getModelTimeouts；DEFAULT_STREAM_TIMEOUT_MS 改 300000）
- Modify: `router/src/admin/providers.ts`（TypeBox schema + extractModelOverrides L104 镜像点）
- Modify: `router/src/admin/quick-setup.ts`（QuickSetupProviderSchema + createAll L151 镜像点）
- Modify: `router/src/proxy/handler/iteration-setup.ts`（调 getModelTimeouts 传 transport）
- Modify: `router/src/proxy/transport/transport-fn.ts`（TransportFnParams 加 nonStreamTimeoutMs）
- Test: `router/tests/config/model-timeouts.test.ts`

**接口签名：**

```typescript
// db/providers.ts
export const DEFAULT_STREAM_TIMEOUT_MS = 300_000;  // 600000 → 300000
export function getModelTimeouts(
  provider: Provider, backendModel: string
): { stream: number; nonStream: number }
// stream: 现有逻辑（entry.stream_timeout_ms ?? DEFAULT_STREAM_TIMEOUT_MS，0→Infinity）
// nonStream: entry.non_stream_timeout_ms ?? DEFAULT_NON_STREAM_TIMEOUT_MS，0→Infinity
export const DEFAULT_NON_STREAM_TIMEOUT_MS = 600_000
```

**关键改动：**
- `model-context.ts` ModelEntry/ModelInfo 加 `non_stream_timeout_ms?: number`，parseModels L267-278 解析，buildModelInfoList L300 输出。
- TypeBox schema（admin/providers.ts L173/L196 + quick-setup.ts）：`non_stream_timeout_ms: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400_000 }))`（复用 stream 范围）。
- `extractModelOverrides`（providers.ts:104）和 `createAll`（quick-setup.ts:151）的 `stream_timeout_ms → entry` 镜像点同步加 non_stream_timeout_ms。
- `iteration-setup.ts:165`：`const { stream, nonStream } = getModelTimeouts(provider, resolved.backend_model)`，传 transport-fn 的 `streamTimeoutMs` 和 `nonStreamTimeoutMs`。

**测试要点：**
- TC：getModelTimeouts 返回 {stream:配置值, nonStream:配置值}；未配置返回默认 300000/600000；0→Infinity。
- TC：parseModels 正确解析 non_stream_timeout_ms（JSON→ModelEntry）。

**验证命令：**
```bash
cd router && npx vitest run tests/config/model-timeouts.test.ts
npm run lint -w router && npm run build
```
