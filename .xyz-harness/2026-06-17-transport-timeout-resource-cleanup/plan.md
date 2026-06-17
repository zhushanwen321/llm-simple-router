---
verdict: pass
complexity: L2
---

# Transport 超时统一与资源泄漏修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 transport 层请求中断链路（kill/客户端断连/上游 hang），使并发槽位准确释放、上游连接及时切断；新增非流式超时配置，统一上游交互超时语义。

**Architecture:** 在现有三层代理（Handler→Orchestrator→Transport）内补全信号链路——orchestrator 的 `controller.signal` 穿透 `resilience.execute` 边界直达 transport 的 `upstreamReq.destroy()`；transport 层用 `req.setTimeout + on("timeout", destroy)` 覆盖响应头前阶段，与现有 idleTimer 共同构成完整无活动超时；StreamProxy.cleanup 直接销毁 upstreamRes/upstreamReq 覆盖所有内部终止路径；kill/shutdown 通过 RequestTracker 注入的幂等释放回调强制回收信号量槽位。

**Tech Stack:** Fastify + better-sqlite3 + 原生 http.ClientRequest + Vue 3 + shadcn-vue + zod。

## Scope Check

单一子系统（代理 transport 层 + 配置 UI），前后端仅通过 `providers.models` JSON 的 `non_stream_timeout_ms` 字段解耦，无新 HTTP endpoint。无需拆分多 plan。

## 子文档索引

- 后端任务详情：`plan-tasks-backend.md`
- 前端任务详情：`plan-tasks-frontend.md`
- 接口链路：`interface_chain.json`

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/proxy/transport/http.ts` | modify | BG1 | callNonStream/callGet 加 signal+timeout+destroy |
| `router/src/proxy/transport/stream.ts` | modify | BG1 | callStream 加 signal+timeout；非200分支补 error listener；StreamProxy.cleanup 销毁 upstreamRes/upstreamReq；idleTimer unref；passThrough error listener |
| `router/src/proxy/transport/transport-fn.ts` | modify | BG1 | transportFn 签名加 signal；传 nonStreamTimeoutMs；callGet 传 GET 超时 |
| `router/src/proxy/transport/provider-connectivity.ts` | modify | BG1 | callGet 传 DEFAULT_GET_TIMEOUT_MS |
| `router/src/proxy/orchestration/orchestrator.ts` | modify | BG2 | reply.raw close handler 替换 readableEnded；signal 透传；adaptive 过滤客户端断连；listener 幂等 |
| `router/src/proxy/orchestration/resilience.ts` | modify | BG2 | execute 加 signal 参数，attempt 前短路 |
| `router/src/proxy/orchestration/scope.ts` | modify | BG2 | withSlot acquire 抛错防护 + reqId 传递 |
| `router/src/core/concurrency/semaphore.ts` | modify | BG2 | release 对 undefined/已释放 token 安全 |
| `router/src/core/monitor/request-tracker.ts` | modify | BG2 | killRequest 同步幂等释放；注入 release 回调 |
| `router/src/core/concurrency/adaptive-controller.ts` | modify | BG2 | onRequestComplete 结果类型加 clientAborted 标记 |
| `router/src/app/register-routes.ts` | modify | BG2 | close() 遍历 killCallbacks abort inflight |
| `router/src/config/model-context.ts` | modify | BG3 | ModelEntry/ModelInfo 加 non_stream_timeout_ms；parseModels 解析 |
| `router/src/db/providers.ts` | modify | BG3 | getModelStreamTimeout→getModelTimeouts；DEFAULT_STREAM_TIMEOUT_MS 600000→300000 |
| `router/src/admin/providers.ts` | modify | BG3 | TypeBox schema 加字段；extractModelOverrides 镜像点 |
| `router/src/admin/quick-setup.ts` | modify | BG3 | QuickSetupProviderSchema 加字段；createAll 镜像点 |
| `router/src/proxy/handler/iteration-setup.ts` | modify | BG3 | 调 getModelTimeouts 传 transport |
| `frontend/src/constants.ts` | modify | FG1 | DEFAULT_STREAM_TIMEOUT_MS 30000→300000；加 DEFAULT_NON_STREAM_TIMEOUT_MS=600000 |
| `frontend/src/types/mapping.ts` | modify | FG1 | ModelConfig 加 non_stream_timeout_ms |
| `frontend/src/components/quick-setup/types.ts` | modify | FG1 | ModelConfig 加字段 |
| `frontend/src/components/mappings/cascading-types.ts` | modify | FG1 | 关联类型加字段 |
| `frontend/src/composables/useProviderForm.ts` | modify | FG1 | 读取/默认/赋值/序列化 |
| `frontend/src/composables/quick-setup-actions.ts` | modify | FG1 | 2 处 |
| `frontend/src/composables/quick-setup-helpers.ts` | modify | FG1 | 2 处 |
| `frontend/src/composables/useProviderGroups.ts` | modify | FG1 | 读取处 |
| `frontend/src/views/QuickSetup.vue` | modify | FG1 | 透传 |
| `frontend/src/components/quick-setup/ModelCard.vue` | modify | FG1 | 主行双超时输入框 |
| `frontend/src/components/providers/ModelCapabilitiesEditor.vue` | modify | FG1 | updateModelNonStreamTimeout |

测试文件：每个 task 对应 `router/tests/` 或 `frontend/` 下测试，见各任务详情。

## Task List

| # | Task | Type | Depends on | Group | Spec FR/AC |
|---|------|------|-----------|-------|-----------|
| 1 | transport signal+timeout 基础设施 | backend | — | BG1 | FR-1,FR-3,FR-9 / AC-3,AC-3b,AC-4,AC-12 |
| 2 | StreamProxy cleanup 销毁上游资源 + 健壮性 | backend | 1 | BG1 | FR-6,FR-7 / AC-8 |
| 3 | callGet 超时 + 非流式 signal | backend | 1 | BG1 | FR-9 / AC-12 |
| 4 | orchestrator close handler + signal 透传 + resilience 短路 | backend | 1 | BG2 | FR-1,FR-10 / AC-3,AC-9 |
| 5 | adaptive 过滤客户端断连 | backend | 4 | BG2 | FR-10 |
| 6 | killRequest 同步幂等释放 + semaphore/withSlot 防护 | backend | — | BG2 | FR-2,FR-7 / AC-10,AC-13 |
| 7 | graceful shutdown abort inflight | backend | 6 | BG2 | FR-8 / AC-11 |
| 8 | 超时配置数据层 + 默认值统一 | backend | — | BG3 | FR-4 |
| 9 | 前端 non_stream_timeout_ms 字段贯通 | frontend | — | FG1 | FR-4,FR-5 |
| 10 | ModelCard 主行双超时输入框 UI | frontend | 9 | FG1 | FR-5 / AC-6,AC-7 |

任务详细步骤见 `plan-tasks-backend.md`（Task 1-8）和 `plan-tasks-frontend.md`（Task 9-10）。

## Execution Groups

### BG1: transport 资源管理与超时

**Description:** transport 层的 signal 接入、超时机制、上游资源销毁。内聚于 http.ts/stream.ts/transport-fn.ts。
**Tasks:** 1, 2, 3
**Files:** ~4 modify
**Dependencies:** 无（基础层）

### BG2: orchestration 信号链路与生命周期

**Description:** signal 从 orchestrator 穿透到 transport、客户端断连检测修复、adaptive 过滤、kill/shutdown 槽位回收、幂等释放。
**Tasks:** 4, 5, 6, 7
**Files:** ~7 modify
**Dependencies:** BG1（Task 1 的 transport signal 接口）

### BG3: 超时配置数据层

**Description:** non_stream_timeout_ms 字段解析、getModelTimeouts、默认值统一、admin schema。
**Tasks:** 8
**Files:** ~5 modify
**Dependencies:** 无（独立数据层，但 BG1/BG2 消费其超时值）

### FG1: 前端字段与 UI

**Description:** non_stream_timeout_ms 前端 11 文件贯通 + ModelCard 主行 UI。
**Tasks:** 9, 10
**Files:** ~11 modify
**Dependencies:** BG3（字段语义参考，但 JSON 解耦，可并行启动）

## Dependency Graph & Wave Schedule

```
  BG1 (transport基础) ─┬─→ BG2 (orchestration信号链)
  BG3 (数据层)        ─┘
  FG1 (前端)          ←─ BG3 字段语义（弱依赖，可并行）
```

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1, BG3 | transport 基础 + 数据层，无依赖可并行 |
| Wave 2 | BG2 | 依赖 BG1 的 signal 接口 |
| Wave 3 | FG1 | 依赖 BG3 字段定义（弱依赖，实际 Wave 1 可启动字段部分）|

并行约束：同一文件不允许多 subagent 修改；BG2 内 Task 4→5→7 串行（同 orchestrator.ts），Task 6 独立可并行。

## Interface Contracts

详见各任务签名。核心接口变更：

### Module: transport

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| callNonStream | (backend, apiKey, body, cliHdrs, upstreamPath, buildHeaders, agent?, opts?: {signal?, timeoutMs?}) | Promise<TransportResult> | signal abort→destroy(abortError)→resolve throw；timeoutMs=0/Infinity 跳过 setTimeout | AC-3b,AC-4 |
| callStream | (..., opts?: {signal?, connectTimeoutMs?}) | Promise<TransportResult> | 同上；响应头前 setTimeout，响应头后交 idleTimer | AC-3,AC-4 |
| callGet | (backend, apiKey, cliHdrs, upstreamPath, buildHeaders, agent?, opts?: {timeoutMs?}) | Promise<GetTransportResult> | timeoutMs=DEFAULT_GET_TIMEOUT_MS | AC-12 |
| transportFn | (target, signal?) => Promise<TransportResult> | — | signal 由 orchestrator 传入 | FR-1 |

### Module: orchestration

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| ResilienceLayer.execute | (targets, fn: (target, signal?) => ..., config, signal?) | Promise<ResilienceResult> | 每轮 attempt 前查 signal.aborted→abort | AC-9 |
| ProxyOrchestrator.handle | (request, reply, apiType, config, ctx?) | Promise<ResilienceResult> | reply.raw close→abort（幂等 listener）；adaptive 调用前过滤 signal.aborted | FR-10 |
| SemaphoreScope.withSlot | (providerId, signal, onQueued, fn, override?, reqId?) | Promise<T> | acquire 抛错时不调 release(undefined)；reqId 传给 acquire 存映射 | AC-10,AC-13 |

### Module: monitor

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| RequestTracker.killRequest | (id) | boolean | 同步调 releaseSlotProvider（reqId） | AC-1,AC-2,AC-13 |
| RequestTracker.setReleaseSlotProvider | (fn: (reqId: string) => void) | void | 注入 semaphore.releaseByReqId | FR-2 |

### Module: concurrency

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| SemaphoreManager.release | (providerId, token?, logger?) | void | token undefined/已释放→安全返回；幂等 | AC-13 |
| getModelTimeouts | (provider, model) | {stream:number, nonStream:number} | 0→Infinity | FR-4 |

完整链路见 `interface_chain.json`。

## Spec Coverage Matrix

| Spec AC | Interface Method | Data Flow | Task |
|---------|-----------------|-----------|------|
| AC-1 kill 流式 TTFT→并发度降 | RequestTracker.killRequest | kill→releaseSlot→semaphore.release | 6 |
| AC-2 kill 非流式→并发度降 | RequestTracker.killRequest | 同上 | 6 |
| AC-3 流式 TTFT 客户端断连→销毁 | ProxyOrchestrator.handle + callStream | reply close→abort→destroy upstreamReq | 1,4 |
| AC-3b 非流式客户端断连→销毁 | callNonStream(signal) | 同上 | 1,4 |
| AC-4 上游真 hang→超时结束 | callStream/callNonStream setTimeout+destroy | req.on timeout→destroy(timeoutError)→resolve | 1 |
| AC-5 流式 idle 超时 | StreamProxy.resetIdleTimer | 现有行为保留（值改 300s） | 8 |
| AC-6 主行双超时配置 | ModelCard UI | 主行两个 Input | 10 |
| AC-7 =0 禁用 | getModelTimeouts | 0→Infinity，前端显示"禁用" | 8,10 |
| AC-8 各路径 destroy 上游 | StreamProxy.cleanup | cleanup destroy upstreamRes/upstreamReq | 2 |
| AC-9 客户端断连不耗 retry | ResilienceLayer.execute(signal) | attempt 前 signal.aborted 短路 | 4 |
| AC-10 kill 排队中不抛 TypeError | SemaphoreScope.withSlot + release | acquire 抛错跳过 release(undefined) | 6 |
| AC-11 shutdown abort inflight | close() | 遍历 killCallbacks abort | 7 |
| AC-12 callGet 超时 | callGet(timeoutMs) | setTimeout+destroy | 3 |
| AC-13 释放幂等无双重 release | SemaphoreManager.release | request id 去重 + token 防护 | 6 |

## Spec Metrics Traceability

| Spec FR/AC | 采纳状态 | 对应 Task |
|-----------|---------|----------|
| FR-1 transport signal 透传 | adopted | 1,4 |
| FR-2 kill 同步幂等释放 | adopted | 6 |
| FR-3 upstreamReq 无活动超时 | adopted | 1 |
| FR-4 拆分流式/非流式超时 | adopted | 8,9 |
| FR-5 前端主行双超时 UI | adopted | 10 |
| FR-6 cleanup 销毁 upstreamRes/upstreamReq | adopted | 2 |
| FR-7 健壮性修复 | adopted | 2,6 |
| FR-8 shutdown abort inflight | adopted | 7 |
| FR-9 callGet 超时 | adopted | 3 |
| FR-10 客户端断连检测修复 + adaptive 过滤 | adopted | 4,5 |
| retry headersSent（已知问题） | postponed | — (out-of-scope，spec 已声明) |
