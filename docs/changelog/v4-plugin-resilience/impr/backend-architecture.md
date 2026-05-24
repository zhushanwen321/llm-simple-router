# LLM Simple Router — 后端架构质量分析报告

> 分析日期：2026-05-12 | 分析范围：`router/src/`（全部 TypeScript 源文件）

---

## 总览评分：7.5 / 10

**总体评价**：架构在核心路径（代理请求处理）上展现了良好的分层设计和明确的职责边界，但存在 Pipeline/Hook 系统半完成状态（emit 调用点远少于注册的 hook 数量）、格式转换层代码冗余度高、以及部分文件过度庞大（`failover-loop.ts` 558 行、`index.ts` 509 行）等结构性问题。

| 维度 | 评分 | 关键词 |
|------|------|--------|
| 1. 分层架构 | 8/10 | 四层清晰，部分内联逻辑破坏边界 |
| 2. 插件系统 | 7/10 | 注册顺序清晰，`createProxyHandler` 承担过多职责 |
| 3. Pipeline/Hook 架构 | 5/10 | 设计良好但实现不完整，大量废弃逻辑 |
| 4. 格式转换架构 | 6/10 | 接口抽象好，代码重复严重 |
| 5. 依赖注入 | 7/10 | 简洁可用，缺生命周期管理 |
| 6. 错误处理 | 8/10 | 体系完整、传播清晰 |
| 7. 数据库设计 | 7/10 | SQLite 实用主义，混合迁移机制 |
| 8. Admin API 设计 | 7/10 | 一致性较好，TypeBox 验证未全面覆盖 |
| 9. 代码组织 | 6/10 | 目录合理，存在循环依赖隐患 |
| 10. 可测试性 | 7/10 | DI 可注入，部分文件 test-by-construction 不足 |

---

## 1. 分层架构（8/10）

### 架构概览

```
入口层 (index.ts / cli.ts)
    ↓
插件注册层 (Fastify plugins: auth → proxy → admin → static)
    ↓
代理四层：Handler → Orchestration → Routing → Transport
    ↓
基础设施层 (core/, db/, utils/, middleware/)
```

### 1.1 Handler 层 — `failover-loop.ts`

**结构定位模糊**。`failover-loop.ts`（558 行）名义上是 "Handler 层文件"，但实际上它集成了路由解析、格式转换、溢出重定向、plugin 调用、transport 构建、resilience 日志、metrics 采集、工具错误日志六大职责。它是整个请求处理流程的**单体编排器**，而非 Handler 层的薄包装。

**问题**：
- `create-proxy-handler.ts`（314 行）中也有 `applyEnhancementPreprocess`（循环检测+轮数限制）的逻辑，与 `failover-loop.ts` 中的溢出重定向、格式转换、patches 等逻辑处于同一抽象层次，但分布在不同文件
- `failover-loop.ts` 的 while(true) 循环是请求处理的**完整状态机**，包含了 route → transform → transport → failover 全部逻辑，但缺乏明确的阶段划分

**改进建议**：
- `failover-loop.ts` 应在注释中明确标注阶段（Route / Transform / Transport / Failover），或将每个阶段提取为独立的纯函数
- `applyEnhancementPreprocess` 应从 `create-proxy-handler.ts` 移入 Pipeline Hook（已有 `enhancement-preprocess` hook 定义！），Handler 只保留调用点

### 1.2 Orchestration 层

**设计良好**。`orchestrator.ts`（含 `ProxyOrchestrator` 类和 `createOrchestrator` 工厂）职责单一：协调 semaphore → resilience → transport 的执行。semaphoreScope 和 trackerScope 的 RAII 封装（`scope.ts`）是很好的模式。

**问题**：
- `ProxyOrchestrator.sendResponse()` 方法中包含了 failover 场景下是否发送响应的判断逻辑（`ctx?.isFailover && statusCode >= failoverThreshold`），这应该是**失败响应决策**，与 `sendResponse` 的命名不符
- orchestrator 直接接收 `FastifyRequest` 和 `FastifyReply`，理论上这些框架类型应停留在 Handler 层

### 1.3 Routing 层

**职责清晰**。`mapping-resolver.ts` 纯函数设计，输入 DB + model，输出 Target。支持 schedule 时间窗口、concurrency 覆盖、failover 排除。`overflow.ts` 独立处理 token 溢出重定向。

**问题**：
- `filterExcluded` 在 `failover-loop.ts` 中有 BP-H2 缓存优化，但 `resolveMapping` 内部也调用了 `filterExcluded`——存在重复过滤
- `mapping-resolver.ts` 输出 `allTargets` 字段仅为 cache 语义设计，与核心 `target` 输出耦合

### 1.4 Transport 层

**薄封装，设计合理**。`http.ts`（非流式）、`stream.ts`（流式）、`transport-fn.ts`（闭包构建）职责边界清晰。`buildTransportFn` 接受依赖注入参数（provider、apiKey、headers 等）返回 `(target) => TransportResult` 闭包，符合函数式设计。

**问题**：
- `buildTransportFn` 的闭包参数列表过长（约 15 个参数），可考虑用参数对象模式

---

## 2. 插件系统（7/10）

### 2.1 `buildApp()` 注册顺序

```
seedDefaultRules → ModelStateManager.init → RetryRuleMatcher.load
→ ProviderSemaphoreManager → RequestTracker → initializeProviderState
→ authMiddleware → openaiProxy → anthropicProxy → responsesProxy
→ adminRoutes → fastifyStatic
```

**注册顺序清晰**，依赖方向自上而下：
- `initializeProviderState` 在 proxy 注册前初始化信号量和 tracker
- 使用 `fastify-plugin (fp)` 包装 proxy handlers 打破 Fastify 封装

**问题**：
- `createProxyHandler` 的工厂模式（接受 `{apiType, paths}`）比旧的独立文件优雅，但工厂内部通过 `container.resolve()` 获取依赖，这实际上是**服务定位器模式**而非 DI，与 Fastify 原生 `app.register(plugin, options)` 模式不兼容。容器作为 `options` 传入，而非作为插件依赖声明
- `seedDefaultRules` 和 `ModelStateManager.init` 在 CLAUDE.md 中描述但未在当前 `index.ts` 中看到对应调用，可能是已删除或命名变更

### 2.2 封装边界

Fastify 插件的封装边界使用正确——`public/private` 路径由 `auth.ts` 统一管理，Admin API 通过 JWT + Cookie 独立认证。

---

## 3. Pipeline/Hook 架构（5/10）【最高优先改进项】

### 3.1 核心问题：注册了 9 个 hook，emit 只调用了 1 个位置

这是本架构最大的结构性问题。

**注册情况**（`register-hooks.ts`）：
```
enhancementPreprocessHook (phase: pre_route, priority: 110)
allowedModelsHook        (phase: pre_route, priority: 150)
overflowRedirectHook     (phase: post_route, priority: 100)
pluginRequestHook        (phase: pre_transport, priority: 100)
providerPatchesHook      (phase: pre_transport, priority: 110)
requestLoggingHook       (phase: post_response, priority: 900)
errorLoggingHook         (phase: on_error, priority: 900)
clientDetectionHook      (phase: pre_route, priority: 200)
cacheEstimationHook      (phase: pre_route, priority: 120)
```

**emit 调用情况**：
```bash
$ grep -rn "proxyPipeline.emit" --include="*.ts" router/src/
router/src/proxy/handler/create-proxy-handler.ts:263:  await proxyPipeline.emit("pre_route", ctx)
```

**只有一个 emit 调用！** `post_route`、`pre_transport`、`post_response`、`on_error`、`on_stream_event` 五个阶段没有任何 emit 点。已注册的 hook 中，以下 7 个**从未被执行**：

| Hook | Phase | 状态 |
|------|-------|------|
| `overflowRedirectHook` | post_route | **未 emit** |
| `pluginRequestHook` | pre_transport | **未 emit** |
| `providerPatchesHook` | pre_transport | **未 emit** |
| `requestLoggingHook` | post_response | **未 emit** |
| `errorLoggingHook` | on_error | **未 emit** |
| `cacheEstimationHook` | pre_route | **已 emit 但功能可能不完整** |
| `allowedModelsHook` | pre_route | **未 emit** |

**为什么系统仍然能工作？**

因为 `failover-loop.ts` 中仍然保留了**内联的旧逻辑**，与 hook 定义**重复实现**：
- 溢出重定向：`failover-loop.ts` 直接调用 `applyOverflowRedirect()`
- Plugin 请求/响应：`failover-loop.ts` 直接调用 `applyPluginAdjustments()` / `pluginRegistry.applyBeforeResponse()`
- Provider patches：`failover-loop.ts` 直接调用 `applyProviderPatches()`
- 请求日志：`failover-loop.ts` 直接调用 `logResilienceResult()` + `collectTransportMetrics()`
- 错误日志：`failover-loop.ts` 的 catch 分支直接写 DB
- 客户端检测：`failover-loop.ts` 中无此逻辑，但 `create-proxy-handler.ts` 依赖 hook emit 执行
- allowed models：`failover-loop.ts` 直接在 while 循环里检查 `request.routerKey?.allowed_models`

**这是一个典型的"重构到一半"状态。** Pipeline/Hook 架构的意图是将上述逻辑从单体编排器中解耦，但迁移未完成，导致：
1. **双重维护**：新 hook 文件和旧内联逻辑同时存在
2. **hook 定义成为死代码**：7/9 的 hook 文件实际上是**未测试的孤立代码**
3. **`hookRegistry` 沦为展示层**：仅用于 Admin API 查询（`GET /admin/api/pipeline/hooks`），不参与实际执行

### 3.2 `hookRegistry` vs `proxyPipeline` 双注册表问题

当前 `registerBuiltinHooks()` 同时注册到两个对象：
```typescript
hookRegistry.register(hook);  // Admin API 查询用
proxyPipeline.register(hook);  // 实际执行用
```

`hookRegistry.register()` **允许重复注册**（数组 push），而 `proxyPipeline.register()` **幂等**（同名跳过）。但两个注册表的**内容可能不一致**——如果某个 hook 注册到 hookRegistry 但忘记注册到 proxyPipeline（或反过来），没有任何编译时检查。

### 3.3 PipelineSnapshot 的边界

`PipelineSnapshot` 类是用于记录请求处理链路的审计日志。当前在 `failover-loop.ts` 中手动调用 `iterationSnapshot.add()`（7 处），这些调用本应分散到各 hook 的 `execute()` 中。但由于 hook 未执行，snapshot 的完整性依赖手动维护。

### 改进建议

1. **完成 Pipeline 迁移**（P0）：在 `failover-loop.ts` 的关键节点添加 `proxyPipeline.emit()`：
   - Route 之后 → `emit("post_route", ctx)`
   - Transport 之前 → `emit("pre_transport", ctx)`
   - 请求成功后 → `emit("post_response", ctx)`
   - 错误发生后 → `emit("on_error", ctx)`（需要在 catch 分支中调用）
2. **移除内联重复逻辑**：emit 生效后，从 `failover-loop.ts` 中删除对应的内联调用
3. **合并 hookRegistry 和 proxyPipeline**：`proxyPipeline.getHookChain()` 已可满足 Admin API 查询需求，`hookRegistry` 是多余的
4. **添加编译时检查**：用 TypeScript 确保 hook 注册和 emit 的一致性（如：通过 typed emission）

---

## 4. 格式转换架构（6/10）

### 4.1 两阶段设计

```
上层 (format/) — FormatAdapter + FormatConverter 的抽象墙
    FormatAdapter:   提供 apiType、defaultPath、errorMeta、formatError
    FormatConverter: 提供 transformRequest / transformResponse / createStreamTransform
    FormatRegistry:  管理 adapter/converter 注册和路由

下层 (transform/) — 具体的请求/响应/流式转换实现
    6个 converter 入口文件 + stream/request/response bridge + tool/thinking/usage mapper
```

### 4.2 接口抽象质量：好

`FormatAdapter`、`FormatConverter`、`FormatRegistry` 的接口设计合理：
- `FormatRegistry.needsTransform(source, target)` 判断是否需要转换
- `FormatRegistry.transformRequest/transformResponse/transformError` 封装转换逻辑
- `FormatRegistry.createStreamTransform` 返回 Node.js `Transform` 流

三个 adapter（openai/anthropic/responses）之间通过 `shared-error-meta.ts` 共享 OpenAI 家族的 errorMeta，避免重复。

### 4.3 代码重复：严重

`transform/` 目录共 4161 行，由 24 个文件组成。以下文件存在显著的**结构复制**：

- `stream-ant2oa.ts` (207行) 和 `stream-oa2ant.ts` (212行)：两个方向的流式转换，结构对称
- `request-bridge-responses.ts` (345行) 和 `response-bridge-responses.ts` (207行)：bridge 文件共享大量类型映射
- 6 个 converter 入口文件（`openai-anthropic.ts`、`anthropic-openai.ts` 等）均使用 `createConverter()` 工厂，结构统一，但内部的 `requestTransform` 函数包含大量相似的类型映射逻辑

**具体问题**：
- Anthropic Content Block ↔ OpenAI tool_call 的映射在 4 个文件中重复（2 个 request + 2 个 stream）
- `message-mapper.ts`（234行）和 `request-bridge-responses.ts`（345行）共享 Messages ↔ Input Items 的映射逻辑
- `stream-bridge-chat2resp.ts`（410行）是本目录最长的文件，包含流式状态机，与 `stream-bridge-resp2chat.ts`（249行）的反向逻辑高度对称但独立维护

### 4.4 类型安全性

`transform/` 内部使用了结构化类型（`AnthropicContentBlock`、`ChatCompletionMessage` 等），符合 CLAUDE.md 中定义的**转换层类型安全规范**。外部函数签名保持 `Record<string, unknown>`，内部断言为具体类型，balance 合理。

### 改进建议

1. 提取共享类型映射表：Anthropic ↔ OpenAI tool/thinking/usage 的映射可提取为独立的映射常量
2. 双向流式转换可考虑共享状态机基类（`stream-transform-base.ts` 已有 65 行的基类，可进一步强化）
3. bridge 文件可合并为单一文件，通过 direction 参数控制行为

---

## 5. 依赖注入（7/10）

### 5.1 ServiceContainer 实现

```typescript
class ServiceContainer {
  factories: Map<string, Factory>
  cache: Map<string, unknown>
  register(key, factory)  // 惰性注册
  resolve<T>(key): T      // 首次调用执行工厂 + 缓存
}
```

轻量实现，约 40 行代码，语义清晰。

**优点**：
- 惰性初始化：服务按需创建，启动快
- 显式依赖图：每个 factory 通过 `c.resolve(key)` 声明依赖
- 类型安全：`resolve<T>(key)` 泛型支持

**问题**：
- **缺生命周期管理**：没有 `dispose()`/`close()` 方法。服务销毁逻辑散落在 `buildApp()` 返回的 `close()` 函数中，需要手动列出需要清理的服务
- **重注册行为不明确**：注释说"重复注册会覆盖但已缓存的实例不会被清除"，这意味着如果在 resolve 后重新 register，新 factory 不会生效
- **单例假设硬编码**：所有服务都是单例，无法表达 request-scoped 或 transient 的生命周期
- **SERVICE_KEYS 同时被用于容器和 metadata**：`ctx.metadata.set("db", db)` 和 `c.resolve(SERVICE_KEYS.db)` 使用不同的 key 系统，metadata 用字符串字面量而非 SERVICE_KEYS 常量

### 5.2 测试可注入性

`buildApp()` 支持 `options.db` 注入 Database 实例，测试中通过 `buildApp({ db: inMemoryDb })` 创建隔离环境。`ServiceContainer` 本身的工厂机制也支持 mock 注入。

### 改进建议

1. 为 `ServiceContainer` 添加 `dispose()` 方法，集中管理清理逻辑
2. metadata key 统一使用 `SERVICE_KEYS` 常量而非字符串字面量
3. 考虑将 `close()` 函数中散落的清理逻辑（`sessionTracker.stop()`、`logFileWriter?.stop()` 等）委托给容器的 dispose 机制

---

## 6. 错误处理（8/10）

### 6.1 错误类型体系

定义了三层错误：

| 层级 | 类型 | 说明 |
|------|------|------|
| 核心错误 | `SemaphoreQueueFullError`、`SemaphoreTimeoutError`、`ProviderSwitchNeeded` | 机房层错误，用于控制流 |
| 管道错误 | `PipelineAbort`（含 statusCode + body） | 在 pipeline hook 中抛出，中断请求 |
| 代理错误 | `ProxyErrorFormatter`（8 个工厂方法） | 面向客户端的格式化错误响应 |

**优点**：
- `ProviderSwitchNeeded` 携带 `attempts` 和 `lastResult`，在 `failover-loop.ts` 中正确处理（排除当前 target 后继续循环）
- `ProxyErrorFormatter` 是工厂模式，formatBody 回调根据 apiType 生成不同格式的 body（OpenAI `{error:{}}` vs Anthropic `{type:"error",error:{}}`）
- 全局 errorHandler 区分代理路由（`{error:{message}}`）和 Admin API（信封格式 `{code, message, data}`）

**问题**：
- `failover-loop.ts` 中 catch 分支的分类过多（`PipelineAbort` / `ProviderSwitchNeeded` / `SemaphoreQueueFullError` / `SemaphoreTimeoutError` / `AbortError` / 其他），部分分支行为相似但分别处理
- `orchestrator.ts` 中 `handle()` 捕获 `ProviderSwitchNeeded` 和信号量错误后分别调用 `adaptiveController.onRequestComplete()`，参数略有不同，可统一
- 全局 errorHandler 中的 proxy 路由 catch 分支嵌套了 `try { insertRequestLog() } catch { ... }`，内层 catch 是防御性的日志记录失败处理——合理

### 6.2 兜底响应检查

经过审查，以下路径均有兜底响应：
- `errorHandler`（Fastify 全局）→ 覆盖所有未捕获错误
- `failover-loop.ts` while(true) 循环 → 每个分支都有 rejectAndReply 或 reply.code().send()
- `orchestrator.ts` handle() → catch 后必有 throw（由外层 failover-loop 处理）
- `resilience.ts` execute() → `iterationCap` 超限和 `all targets exhausted` 有兜底
- stream timeout → `stream_abort` kind 由 `failover-loop.ts` 的 stream timeout 分支处理

**未发现缺少兜底的路径。**

---

## 7. 数据库设计（7/10）

### 7.1 SQLite 配置

```sql
PRAGMA journal_mode = WAL;
PRAGMA auto_vacuum = INCREMENTAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -16000;     -- 16MB
PRAGMA busy_timeout = 5000;     -- 5s
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 67108864;    -- 64MB
PRAGMA journal_size_limit = 67108864; -- 64MB
```

WAL 模式 + NORMAL synchronous 是读多写少的代理服务器场景的标准配置。cache_size 16MB 和 mmap_size 64MB 合理。

### 7.2 迁移机制

**混合迁移方案**：SQL 文件（44 个）+ 应用层迁移（`runApplicationMigrations`）。

**优点**：
- 增量式迁移，向前兼容
- 重命名映射表（`MIGRATION_RENAMES`）解决文件编号冲突
- `ALTER TABLE ADD COLUMN` 自动检测列是否存在，避免重复执行

**问题**：
- 44 个迁移文件过多，建议定期 squash 前 30 个文件为单一基线迁移
- 应用层迁移（`runApplicationMigrations`）通过 settings 表的 marker key 控制幂等性，但没有版本号管理，难以追踪执行历史
- `db/index.ts` 中 SQL 迁移的 `stmt.split(";")` 方式在处理含分号的字符串字面量时会出错

### 7.3 索引策略

`044_add_performance_indexes.sql` 是最新的迁移，添加了性能索引。关键表 `request_logs` 和 `request_metrics` 应有适当索引。但未在源码中看到复合索引（如 `(api_type, created_at)`），这可能影响日志查询性能。

### 改进建议

1. 定期 squash 历史迁移文件（如 001-030 合并为基线）
2. 应用层迁移增加版本号追踪
3. 审核 `request_logs` 表的 Admin API 查询模式，确认复合索引覆盖

---

## 8. Admin API 设计（7/10）

### 8.1 RESTful 一致性

统一信封格式：
```typescript
{ code: number, message: string, data: T | null }
```

错误码采用 XXYYZ 格式（如 `40002` = 400 类别的第 2 号业务错误），设计合理。

**一致性检查**：
- 所有 Admin 路由通过 `onSend` hook 自动包装成功响应为信封格式
- 错误响应通过 `apiError(code, message)` 构造
- SSE 端点（monitor）跳过信封包装（content-type 检查）

### 8.2 输入验证

`providers.ts` 使用了 TypeBox schema 验证：
```typescript
import { Type, Static } from "@sinclair/typebox";
```

但不是所有 Admin 路由都使用了 TypeBox 验证。部分路由依赖手动参数检查 + `apiError(API_CODE.BAD_REQUEST, ...)`。

### 8.3 路由组织

`admin/routes.ts` 按领域注册插件（providers、mappings、groups、retry-rules 等 16 个子插件）。每个子插件接受 `{ db, stateRegistry?, tracker? }` 等 options。结构清晰，但 `providers.ts` 文件（约 484 行）偏大。

### 问题

- `admin/providers.ts` 导入了 `../proxy/proxy-core.js` 和 `../proxy/transport/http.js`，用于 provider 连接测试——这引入了 admin → proxy 的反向依赖，虽通过 `StateRegistry` 隔离了状态刷新，但 transport 的导入绕过了抽象
- 部分路由的 `try/catch` 块中错误处理模式不统一（有的返回 `apiError`，有的直接 `reply.code().send()`）

---

## 9. 代码组织（6/10）

### 9.1 目录结构

```
router/src/
├── cli.ts            # 入口
├── index.ts          # buildApp + main (509 行)
├── config/           # 配置加载
├── core/             # 核心类型、DI、错误、并发控制、监控、循环检测
├── proxy/            # 代理层（handler/orchestration/routing/transport/format/transform/pipeline/hooks/patch）
├── middleware/        # auth.ts、admin-auth.ts
├── admin/            # REST API
├── db/               # 数据访问层 + 迁移
├── metrics/          # SSE 解析 + 指标提取
├── storage/          # 文件日志
├── upgrade/          # 版本升级检查
├── routing/          # 路由层（已基本迁移到 proxy/routing/）
└── utils/            # crypto、password、token-counter
```

**合理之处**：
- `core/` 只依赖自身（内部只有 `concurrency/`、`monitor/`、`loop-prevention/` 子目录之间的横向引用）
- `middleware/` 只依赖 `db/`、`core/constants`
- `proxy/` 各子目录（handler、orchestration、routing、transport）的引用链单向

**问题**：
- `router/src/routing/` 目录：存在但功能已迁移到 `proxy/routing/`，属废弃目录
- `proxy/hooks/plugin-bridge.ts` 和 `proxy/hooks/sse-event-transform.ts`：两个"桥接"文件在有 pipeline 架构后定位模糊
- `metrics/` 和 `core/monitor/` 存在职责重叠：两者都涉及请求追踪和指标采集

### 9.2 循环依赖检查

```bash
# core/ 内的相对引用只向下（types.ts 是最底层）
core/monitor/request-tracker.ts → core/types.ts (Logger)
core/concurrency/adaptive-controller.ts → core/types.ts (Logger)
core/concurrency/semaphore.ts → core/errors.js (SemaphoreQueueFullError)
```

core/ 内部无循环依赖。proxy/ 子目录之间的引用方向：
- handler → orchestration → routing/transport
- pipeline/hooks → handler（通过 proxy-handler-utils）
- admin/providers → proxy/proxy-core → proxy/transport/http（反向依赖）

**循环依赖风险**：`proxy/hooks/builtin/request-logging.ts` → `proxy/handler/proxy-handler-utils.ts` 形成了 hooks → handler 的依赖。如果 handler 未来引用 hooks，会产生循环。当前 handler 不引用 hooks 文件（仅通过 failover-loop 内联逻辑），所以无实际循环。

### 9.3 大文件

| 文件 | 行数 | 建议 |
|------|------|------|
| `failover-loop.ts` | 558 | 提取 route/transform/transport 为独立阶段函数 |
| `index.ts` | 509 | 将 ServiceContainer 初始化和 close 逻辑提取到独立模块 |
| `request-tracker.ts` | 485 | 考虑将 SSE 广播逻辑分离 |
| `providers.ts` (admin) | ~484 | 按操作拆分（CRUD / test / cascade） |

### 改进建议

1. 删除废弃的 `src/routing/` 目录
2. 提取 `index.ts` 中的初始化逻辑到 `src/bootstrap.ts`
3. `failover-loop.ts` 的 while 循环拆分为可组合的阶段函数

---

## 10. 可测试性（7/10）

### 10.1 测试注入接口

**已提供的注入点**：
- `buildApp({ config, db })`：注入自定义 Config 和内存 Database
- `ServiceContainer`：工厂可替换
- `SemaphoreManager`、`RequestTracker`、`AdaptiveController`：各自独立，可直接实例化测试
- `ResilienceLayer`：纯决策逻辑，`decide()` 方法可完全独立测试
- `mapping-resolver.ts`：纯函数，接受参数返回结果

### 10.2 纯函数比例

- `mapping-resolver.ts`：`resolveMapping()` 有 DB 副作用，但 `filterExcluded`、`findMatchingSchedule`、`scheduleMatchesNow` 是纯函数
- `resilience.ts`：`decide()` 是纯决策函数（输入 TransportResult + State，输出 Decision），适合 TDD
- `proxy-core.ts`：`buildUpstreamUrl`、`selectHeaders` 是纯函数
- `semaphore.ts`：所有方法修改内部状态（Map），不可测试纯函数
- `failover-loop.ts`：整个函数是 IO 密集型，几乎无纯函数

### 10.3 Mock 友好度

- HTTP 传输层通过 `http.request` 发起，测试中使用 `http.createServer()` 创建 mock 后端
- 数据库通过 `better-sqlite3` 内存模式隔离
- 信号量通过独立 `SemaphoreManager` 实例隔离

### 问题

- `failover-loop.ts` 难以单元测试：558 行单体函数，混合了路由、转换、传输、日志、错误处理
- `request-tracker.ts` 的 SSE 广播逻辑与请求追踪耦合，测试需要 mock EventEmitter 行为
- Hook 文件无法独立测试：它们依赖 `PipelineContext` 中的 `metadata.get("db")`、`metadata.get("container")`，而 metadata 构造分散在 `create-proxy-handler.ts` 和 `failover-loop.ts` 中

### 改进建议

1. 将 `failover-loop.ts` 的 while 循环拆分为独立的阶段函数，每个可独立测试
2. 将 `ResilienceLayer.decide()` 的分支逻辑提取为纯函数（部分已做，如 `isRetryableThrow`、`parseRetryAfter`）
3. Hook 的 metadata 依赖应通过类型化的 context 字段而非 `Map<string, unknown>` 传递

---

## 优先级排序的改进清单

### 高优先级（影响系统正确性）

| # | 问题 | 建议 | 影响范围 |
|---|------|------|----------|
| H1 | Pipeline emit 点缺失 | 在 `failover-loop.ts` 的阶段节点添加 `emit()`，完成从内联到 hook 的迁移 | 9 个 hook 中 7 个未执行 |
| H2 | 内联逻辑与 hook 重复实现 | 迁移完成后删除 `failover-loop.ts` 中的对应内联代码 | 双重维护风险 |
| H3 | `hookRegistry` 和 `proxyPipeline` 双注册表 | 合并为单一注册表，由 `proxyPipeline.getHookChain()` 满足 Admin API 查询 | 数据不一致风险 |
| H4 | `providers.ts` admin → proxy transport 反向依赖 | 通过 StateRegistry 或独立接口封装连接测试逻辑 | 层次违反 |

### 中优先级（影响可维护性）

| # | 问题 | 建议 | 影响范围 |
|---|------|------|----------|
| M1 | 格式转换层重复代码 | 提取共享类型映射表；双向转换共享状态机基类 | 4161 行 transform/ 目录 |
| M2 | `failover-loop.ts` 过长（558行） | 提取为 Route → Transform → Transport → Failover 四个阶段函数 | 代码可读性 |
| M3 | `index.ts` 过长（509行） | 提取 `initializeProviderState` 和容器初始化到独立模块 | 代码可读性 |
| M4 | ServiceContainer 缺 dispose | 添加生命周期管理，集中清理逻辑 | 资源管理 |
| M5 | 废弃 `src/routing/` 目录 | 删除或标注废弃 | 开发者混淆 |
| M6 | 44 个迁移文件 | 定期 squash 到基线迁移 | 迁移执行效率和可读性 |
| M7 | `metrics/` 和 `core/monitor/` 职责重叠 | 明确分工：metrics = 数据提取，monitor = 实时追踪 | 模块内聚度 |

### 低优先级（长期优化）

| # | 问题 | 建议 | 影响范围 |
|---|------|------|----------|
| L1 | Admin API 验证未全面 TypeBox | 统一所有路由使用 TypeBox + JSON Schema | 输入安全性 |
| L2 | Hook 的 metadata 用 `Map<string, unknown>` | 使用类型化的 context 字段替代 weak-typed map | 类型安全 |
| L3 | `request-tracker.ts` SSE 与追踪耦合 | 分离 SSE 广播逻辑为独立模块 | 测试可隔离性 |
| L4 | `createProxyHandler` 服务定位器模式 | 探索 Fastify 原生 DI 集成（如 fastify-decorators） | 架构一致性 |
| L5 | 应用层迁移缺版本追踪 | 增加版本号表 | 迁移管理 |
