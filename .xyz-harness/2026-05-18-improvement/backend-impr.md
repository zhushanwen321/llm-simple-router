# 后端架构审查报告（修订版）

**日期:** 2026-05-18
**范围:** `router/src/` 全部 172 个 TS 文件，约 20,352 行
**方法:** 逐文件阅读关键模块，对照插件化架构设计意图逐条验证

---

## 第一部分：插件化架构违规

项目设计了一套 Pipeline + Hook + Plugin 三层可扩展架构，但大量代码绕过这套架构直接内联实现。以下是所有违规点。

### V1. 9 个内置 Hook 中 8 个是死代码（828 行）

**背景：** `registerBuiltinHooks()` 在启动时将 9 个 hook 同时注册到 `proxyPipeline`（执行用）和 `hookRegistry`（Admin API 查询用）。但整个请求处理路径中，**只有 `create-proxy-handler.ts:279` 调用了 `proxyPipeline.emit("pre_route", ctx)`**，其余 5 个阶段（`post_route`、`pre_transport`、`post_response`、`on_error`、`on_stream_event`）从未被 emit。

**验证过程：**

```
grep -rn 'proxyPipeline\.emit' router/src/ → 只有一处调用
grep -rn 'emit(' proxy/pipeline/pipeline.ts → emit 方法本身存在但无其他调用者
```

**实际执行状态：**

| Hook | Phase | 是否被 emit | 是否实际执行 | 原因 |
|------|-------|-------------|-------------|------|
| `builtin:client-detection` | `pre_route` | 是 | **是** | emit 前已设置 `ctx.metadata.set("db", db)` |
| `builtin:enhancement-preprocess` | `pre_route` | 是 | **否** | 需要 `container`，但 emit 前只设置了 `db`，没有设置 `container` → early return |
| `builtin:allowed-models` | `post_route` | 否 | **否** | `post_route` 阶段从未被 emit |
| `builtin:overflow-redirect` | `post_route` | 否 | **否** | 同上 |
| `builtin:plugin-request` | `pre_transport` | 否 | **否** | `pre_transport` 阶段从未被 emit |
| `builtin:provider-patches` | `pre_transport` | 否 | **否** | 同上 |
| `builtin:cache-estimation` | `post_response` | 否 | **否** | `post_response` 阶段从未被 emit |
| `builtin:request-logging` | `post_response` | 否 | **否** | 同上 |
| `builtin:error-logging` | `on_error` | 否 | **否** | `on_error` 阶段从未被 emit |

**死代码统计：**

| 文件 | 行数 | 说明 |
|------|------|------|
| `proxy/hooks/builtin/` (8 个文件) | 589 行 | 有完整实现但永不执行 |
| `proxy/hooks/plugin-bridge.ts` | 126 行 | `bridgePlugin()` 将 `TransformPlugin` 桥接为 `PipelineHook[]`，从未被调用 |
| `proxy/hooks/sse-event-transform.ts` | 70 行 | `SSEEventTransform` 流式 SSE 事件拦截器，从未被使用 |
| `proxy/pipeline/hook-registry.ts` | 43 行 | 独立于 `proxyPipeline` 的查询注册表，`proxyPipeline.getHookChain()` 已有此功能 |
| **合计** | **828 行** | |

**影响：** 新增横切功能（如新的 provider patch、新的日志字段）时，开发者不知道应该写在 hook 里还是内联在 failover-loop 里。hook 代码写了、测了、注册了，但线上不执行 — 极度混淆。

---

### V2. `enhancement-preprocess` Hook 注册了但因缺少依赖而静默跳过

**位置:** `proxy/hooks/builtin/enhancement-preprocess.ts` + `proxy/handler/create-proxy-handler.ts:279-285`

**详细过程：**

1. `create-proxy-handler.ts:275` — `ctx.metadata.set("db", db)` 注入 DB
2. `create-proxy-handler.ts:279` — `proxyPipeline.emit("pre_route", ctx)` 触发 hooks
3. `enhancement-preprocess` hook 被触发，但 `ctx.metadata.get("container")` 返回 `undefined`
4. Hook 第一行 `if (!db || !container) return;` — **静默退出，不执行任何逻辑**
5. `create-proxy-handler.ts:285` — `applyEnhancementPreprocess(request, reply, ctx, db, container)` 执行内联版本

**根因：** emit 前只设置了 `db`，没设置 `container`。而 `enhancement-preprocess` hook 需要 `container` 来 resolve `SessionTracker`。

**影响：** Hook 的代码（91 行）写得完全正确，但因为依赖注入遗漏而从未执行。同样的逻辑在 `create-proxy-handler.ts:136-190` 有一个完全独立的内联实现（55 行），这才是实际运行的代码。

**对比（两份实现完全相同的功能）：**

```
proxy/hooks/builtin/enhancement-preprocess.ts (91 行, Hook 版, 未执行)
  ↓ 等价于
proxy/handler/create-proxy-handler.ts:136-190 (55 行, 内联版, 实际运行)
```

---

### V3. `plugin-bridge.ts` 将 TransformPlugin 桥接为 PipelineHook，但从未被调用

**位置:** `proxy/hooks/plugin-bridge.ts`

**设计意图：** 外部 `.js` 插件和 DB 声明式规则都注册为 `TransformPlugin`。`bridgePlugin()` 函数可以将它们转换为 `PipelineHook[]` 并注册到 `proxyPipeline`，让插件系统与 Pipeline 系统打通。

**实际情况：** `bridgePlugin()` 导出了但零调用者。外部插件只通过 `failover-loop.ts:105-106` 的内联 `pluginRegistry.applyBeforeRequest/AfterRequest` 调用生效，不经过 Pipeline。

**影响：** 插件系统的 `onStreamEvent` 和 `onError` 回调永远无法触发 — 因为只有 Pipeline emit 时才会调用对应的 hook，而 Pipeline 没有桥接插件。插件的能力被限制在 `beforeRequest/afterRequest` 和 `beforeResponse/afterResponse` 四个方法上，`onStreamEvent` 和 `onError` 是死接口。

---

### V4. Hook 版本与 Failover-Loop 内联版本的语义差异

Hook 是为"单次请求、单个 resolved target"的场景设计的，但 failover-loop 处理的是"多 target 列表 + 跨迭代累积"场景。两者的语义差距导致 hook 无法直接替代内联实现：

**V4a. `overflow-redirect` 差异**

| | Hook 版本 | 内联版本 |
|---|---------|---------|
| 函数 | `applyOverflowRedirect(target, db, body)` | `expandOverflowTargets(allTargets, db, body)` |
| 输入 | 单个 `Target` | `Target[]` 列表 |
| 输出 | 单个重定向结果或 null | 扩展后的列表 + `overflowIndices` 追踪集合 |
| 语义 | "当前 target 溢出 → 替换 resolved" | "为每个 target 预计算溢出目标，prepend 到列表" |

内联版本需要追踪哪些 index 是 overflow 产生的（`overflowIndices`），用于后续 failover 日志中标记 `mappingReason: "overflow_redirect"`。Hook 版本没有这个概念。

**V4b. `allowed-models` 差异**

| | Hook 版本 | 内联版本 |
|---|---------|---------|
| 函数 | 检查 `resolved.backend_model` 是否在白名单 | 过滤整个 `allTargets` 列表 |
| 行为 | 不匹配 → `PipelineAbort(403)` 直接拒绝 | 移除不允许的 target，保留允许的，同时重建 `overflowIndices` |
| 语义 | "reject" — 单 target 场景 | "filter and continue" — 多 target 场景 |

内联版本的 filter 语义允许：如果首选 target 不在白名单，但备选 target 在白名单，可以自动选择备选。Hook 版本直接 abort，丢失了这个能力。

**V4c. 日志传递路径差异**

| | Hook 版本 | 内联版本 |
|---|---------|---------|
| 依赖获取 | `ctx.metadata.get("resilienceResult") as ...` （10+ 次 unsafe `as` 断言） | 闭包变量直接引用（`resilienceResult`, `startTime` 等） |
| 类型安全 | `metadata.get()` 返回 `unknown`，每次需要 `as` 断言 | 变量有具体类型，编译器检查 |

**影响：** Hook 设计假设"单次执行"模型，无法表达 failover 循环中的列表级操作。要让 Pipeline 真正接管这些逻辑，需要扩展 `PipelineContext` 的数据模型（如增加 `allTargets`、`overflowIndices` 字段），而不能只传递 `resolved: Target | null`。

---

### V5. `patch` 层不通过插件系统接入

**位置:** `proxy/patch/index.ts` + `proxy/patch/deepseek/`

`applyProviderPatches()` 是一个硬编码的分发函数，根据 provider 的 `base_url` 和 `api_type` 决定应用哪些补丁（DeepSeek developer_role 转换等）。它：
- 不通过 `TransformPlugin` 接口注册
- 不通过 `FormatAdapter` 机制扩展
- 在 `failover-loop.ts:341` 和 `hooks/builtin/provider-patches.ts:24` 都有调用（但只有 failover-loop 的调用生效）

Provider patches 应该是 `TransformPlugin` 的典型使用场景（按 provider 匹配 + 修改 request body），但当前是硬编码在 `patch/index.ts` 中的 if-else 链。

---

### V6. Enhancement 配置检查散落在三个位置

**涉及文件：**

1. `proxy/hooks/builtin/enhancement-preprocess.ts` — Hook 版本（未执行，因缺少 container）
2. `proxy/handler/create-proxy-handler.ts:136-190` — `applyEnhancementPreprocess()` 内联版本（实际运行）
3. `proxy/handler/failover-loop.ts:155-262` — `enhancementConfig` 的 `tool_error_logging_enabled`、`stream_loop_enabled`

配置 `enhancementConfig` 在 failover-loop 中被读取两次（`tool_error_logging_enabled` 和 `stream_loop_enabled`），在 create-proxy-handler 中被读取一次。三处都独立调用 `loadEnhancementConfig(db)`，不共享缓存。

---

### V7. `SSEEventTransform` 已实现但从未接入流式管道

**位置:** `proxy/hooks/sse-event-transform.ts`

`SSEEventTransform` 是一个 Transform stream，设计用于插入 SSE 流式管道中，解析每个 SSE 事件后调用 `on_stream_event` hook。它是 `TransformPlugin.onStreamEvent` 回调的接入点。

**问题：**
- 从未被任何代码实例化
- `StreamProxy`（`proxy/transport/stream.ts`）中的流式管道不包含这个 transform
- 因此 `TransformPlugin.onStreamEvent` 是一个永远无法触发的死接口

---

### V8. `HookRegistry` 与 `ProxyPipeline` 双注册导致混淆

**位置:** `proxy/pipeline/register-hooks.ts` + `proxy/pipeline/hook-registry.ts`

`registerBuiltinHooks()` 将每个 hook 同时注册到两个独立的数据结构：

```ts
for (const hook of ALL_HOOKS) {
  hookRegistry.register(hook);   // Admin API 查询用
  proxyPipeline.register(hook);  // 实际执行用
}
```

但 `hookRegistry` 和 `proxyPipeline` 的注册逻辑是独立的 — `hookRegistry` 不检查幂等（允许同名重复注册），`proxyPipeline` 检查幂等（同名跳过）。Admin API 的 `/admin/api/pipeline/hooks` 查询的是 `hookRegistry`，它反映的"已注册 hook"与 `proxyPipeline` 的实际执行列表不一致。

---

## 第二部分：真实存在的 Bug

### B1. `resilience.ts` errMsg 三元表达式重复

**位置:** `proxy/orchestration/resilience.ts:241`

```ts
const errMsg = err instanceof Error ? err.message : err instanceof Error ? err.message : JSON.stringify(err);
```

第二个 `err instanceof Error` 永远不会执行（第一个条件已覆盖）。应改为：

```ts
const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
```

### B2. `enhancement-preprocess` Hook 因依赖注入遗漏而从未执行

**位置:** `proxy/handler/create-proxy-handler.ts:275-285`

详见 V2。`emit("pre_route")` 前只设置了 `ctx.metadata.set("db", db)`，没有设置 `container`。导致 hook 静默退出。修复只需在 emit 前加一行：

```ts
ctx.metadata.set("container", container);
```

---

## 第三部分：架构层面的合理问题

### A1. `failover-loop.ts` (592行) 过度膨胀

**位置:** `proxy/handler/failover-loop.ts`

**问题分析：** 这个文件是 V1-V8 所有违规的共同症状。因为它绕过了 Pipeline 架构内联了所有逻辑，导致：

- 46 个 import（项目最多）
- 单函数 `executeFailoverLoop()` 约 400 行
- 同时处理路由、格式转换、加密解密、插件调用、日志记录、流式内容采集、failover 循环控制

**膨胀来源对照表：**

| 内联逻辑 | 行数 | 对应的死 Hook |
|---------|------|-------------|
| resolveMapping + modality redirect + overflow | ~70 | `overflow-redirect` hook |
| allowed_models 过滤 | ~20 | `allowed-models` hook |
| applyPluginAdjustments | ~15 | `plugin-request` hook |
| applyProviderPatches | ~5 | `provider-patches` hook |
| logResilienceResult + collectTransportMetrics | ~25 | `request-logging` hook |
| insertRejectedLog / insertRequestLog (error) | ~30 | `error-logging` hook |
| tool error logging | ~15 | `request-logging` hook |
| **合计可迁移** | **~180** | |

如果 Pipeline 架构被激活，failover-loop 可缩减到约 400 行，只保留循环控制 + 有状态依赖管理。

### A2. 双层日志系统

**问题：** 日志相关逻辑分散在 6 个文件中，且 `logResilienceResult()` 内部有 4 条路径（stream_error / error / 非200 / 成功），每条都是大段重复的 `insertRequestLog()` 调用。

**涉及文件：**

| 文件 | 职责 | 行数 |
|------|------|------|
| `proxy/log-helpers.ts` | `insertSuccessLog()` + `insertRejectedLog()` | 103 |
| `proxy/proxy-logging.ts` | `logResilienceResult()` + `collectTransportMetrics()` | 233 |
| `proxy/handler/failover-loop.ts` | 内联 `insertRequestLog()` 调用（error/catch 场景） | ~40 |
| `proxy/hooks/builtin/error-logging.ts` | Pipeline hook 版本（未执行） | 113 |
| `proxy/hooks/builtin/request-logging.ts` | Pipeline hook 版本（未执行） | 124 |
| `index.ts` | 全局 errorHandler 中内联 `insertRequestLog()` | ~20 |

**重复模式：** 每个路径都手动构造一个 ~15 字段的 `RequestLogInsert` 对象。改一个字段（如新增 `pipeline_snapshot`）需要改所有路径。Hook 版本的日志代码（113 + 124 = 237 行）是死代码，与内联版本做同样的事。

**建议：** 统一为 `RequestLogWriter` 类，提供 `logSuccess()` / `logError()` / `logRejected()` / `logResilienceResult()` 方法。

### A3. `ErrorKind` 类型在两个文件中独立定义

**位置:**
- `proxy/proxy-core.ts` — `ErrorKind` union type，被 `createErrorFormatter()` 使用
- `proxy/format/types.ts` — 同名 union type，被 `FormatAdapter.errorMeta` 使用

两个定义值完全相同，但没有共享。如果新增一种错误类型，需要同时改两个文件。

---

## 第四部分：代码品味问题

### T1. `getConfig()` 废弃函数仍有调用者

**位置:** `config/index.ts` + `proxy/handler/failover-loop.ts:153`

`getConfig()` 标记为 `@deprecated`，建议用 `getBaseConfig()`，但 `failover-loop.ts` 仍在使用。

### T2. `tokens_per_second` 废弃字段未清理

**位置:** `core/types.ts:67`

```ts
/** @deprecated Use total_tps instead */
tokens_per_second: number | null;
```

仍在 `toStreamMetrics()` 中被映射、在 `LOG_LIST_SELECT` 中被查询。废弃字段在 API/DB/前端三处都有消费者，清理需要协调。

### T3. `JSON.parse(JSON.stringify())` 做深拷贝

**位置:** `core/loop-prevention/tool-loop-guard.ts:46`

```ts
const cloned = JSON.parse(JSON.stringify(body));
```

项目品味规范要求 `structuredClone()`。另外两处（`proxy/pipeline/context.ts`、`proxy/patch/index.ts`）已改用 `structuredClone()`，这里遗漏了。

### T4. Target key 构造散落 4 处

```
provider_id:backend_model
```

这个字符串拼接在以下位置各自独立实现：
- `proxy/routing/mapping-resolver.ts` — `filterExcluded()`
- `proxy/orchestration/resilience.ts` — `execute()` 内联
- `proxy/handler/failover-loop.ts` — 调用 `filterExcluded()` 但也有独立的 target key 构造
- `proxy/transport/transport-fn.ts` — 不构造但消费 target

应提取为 `Target.toKey()` 或在 `Target` 类型上定义 `equals()` 方法。

### T5. `console.warn` / `console.error` 替代 logger

**位置:**
- `proxy/routing/mapping-resolver.ts:166` — `console.warn`
- `proxy/routing/modality-redirect.ts:241` — `console.error`
- `proxy/routing/overflow.ts:89` — `console.error`
- `db/index.ts` — `console.error`
- `proxy/transform/plugin-registry.ts` — `console.error`

在 Fastify 上下文中这些应该用 `request.log` 或 `app.log`，保证日志格式和级别统一。

### T6. Hook 通过 `metadata.get()` 传依赖的不安全模式

**位置:** 所有 `proxy/hooks/builtin/*.ts`

Hook 通过 `ctx.metadata.get("db") as Database.Database` 获取依赖。每次调用都需要 `as` 类型断言，编译器无法检查 key 是否正确、值类型是否匹配。`request-logging.ts` 有 10 处这样的断言，`error-logging.ts` 有 9 处。

应该改为通过 PipelineContext 的显式字段或 DI 容器注入。

### T7. `modality-redirect.ts` snapshot 记录高度重复

**位置:** `proxy/routing/modality-redirect.ts`

`computeModalityRedirectTargets()` 中有 7 处 `snapshot.add({...satisfies StageRecord})`，每处都重复填写 `stage`、`triggered`、`original_model`、`redirect_to`、`redirect_provider`、`reason` 六个字段。应提取一个闭包 helper。

### T8. `admin/providers.ts` (502行) 混合了 HTTP 处理和业务逻辑

**位置:** `admin/providers.ts`

`cascadeProviderDisable()` 和 `extractModelOverrides()` 是纯业务逻辑函数，不依赖 Fastify request/reply，但放在了 HTTP handler 文件中。应移到 `db/` 或 `core/` 层。

---

## 第五部分：之前审查中修正的误判

### M1. `index.ts` 不是 God File — 是合理的 Composition Root

`buildApp()` 本质上是 DI 组装点。26 行 Fastify 配置 + 85 行全局 hooks + 56 行 DI 注册 + 43 行路由注册，线性可读。拆成 4 个文件反而增加跳转成本。

### M2. `TransportResult` 6 个 variant 不过大

6 个 variant（success / stream_success / stream_error / stream_abort / error / throw）是对代理请求所有可能结局的完整枚举，每个都有独立且必要的数据结构。拆分会增加类型转换代码。

### M3. `SemaphoreScope` / `TrackerScope` 不是多余的间接层

它们是 RAII guard，保证 acquire/release 和 start/complete 的配对时序。内联到 orchestrator 会暴露底层协议给调用者。

---

## 优先级矩阵

| 优先级 | 编号 | 问题 | 类型 | 预估修复量 |
|--------|------|------|------|-----------|
| **P0** | V1 | 828 行 Hook 死代码 | 架构违规 | 大（需要激活 Pipeline emit） |
| **P0** | V2 | enhancement-preprocess 因依赖注入遗漏未执行 | Bug | 小（加 1 行 metadata.set） |
| **P0** | B1 | resilience.ts errMsg 重复三元 | Bug | 小（改 1 行） |
| **P1** | V3 | plugin-bridge 从未被调用 | 架构违规 | 中（桥接到 Pipeline 或删除） |
| **P1** | V4 | Hook 与内联版本语义差异 | 架构设计 | 大（扩展 PipelineContext） |
| **P1** | V5 | Patch 层不通过插件系统接入 | 架构违规 | 中（改为 TransformPlugin） |
| **P1** | A2 | 双层日志系统 | 架构 | 中（统一为 RequestLogWriter） |
| **P1** | A1 | failover-loop 592 行膨胀 | 架构 | 依赖 V1 解决后自动缓解 |
| **P2** | V6 | Enhancement 配置散落 3 处 | 违规 | 小 |
| **P2** | V7 | SSEEventTransform 未接入 | 架构违规 | 中（插入 StreamProxy 管道） |
| **P2** | V8 | 双注册 HookRegistry | 架构违规 | 小（删除 hookRegistry） |
| **P2** | A3 | ErrorKind 双定义 | DRY | 小 |
| **P2** | T1-T8 | 代码品味问题 | 品味 | 各小 |

---

## 决策记录

### D1. Pipeline 死代码 — 选项 C: 标记 + 文档

**决策日期**: 2026-05-18
**选定选项**: C（标记 + 文档）
**理由**: 当前分支 scope 为 bug 修复和小重构，不适合做大范围架构改动（选项 A 需 ~2-3 周、高风险核心路径重构；选项 B 需单独 spec/plan）。选项 C 零风险，减少未来开发者的困惑。
**下一步**: 在下一个迭代中评估选项 B（删除 828 行死代码）。选项 A（激活 Pipeline）需要单独的 spec + plan。
**涉及问题**: V1, V3, V7, V8, A1
