# 架构重构设计文档

日期：2026-04-29
版本：v0.6.5 → 架构重构
范围：后端 `src/` 目录

## 一、背景

### 项目演进概况

项目从 v0.3 到 v0.6.5，经历了以下关键功能迭代：

| 版本 | 新增模块 | 新增 proxy/ 文件 |
|------|---------|-----------------|
| v0.4.0 | 并发控制、Resilience 层 | semaphore.ts, scope.ts, resilience.ts |
| v0.5.0 | 版本检查、代理增强 | enhancement/, upgrade/ |
| v0.5.4 | DeepSeek 补丁、溢出重定向 | patch/, overflow.ts |
| v0.6.0 | 调度层 (Schedule) | （mapping-resolver.ts 扩展） |
| v0.6.5 | 循环检测 (N-gram) | loop-prevention/ |

**趋势**：每个新功能都在 `proxy/` 目录下增加新模块，但 `proxy-handler.ts` 作为唯一的"管线"越堆越大。

### 当前规模

```
src/ 后端总量: ~11,000 行 TypeScript
proxy/:       ~5,800 行 (52%)
admin/:       ~2,100 行
db/:          ~1,900 行
其他:         ~1,200 行 (monitor, metrics, middleware, upgrade, utils, config)
测试:         57 个测试文件, ~12,800 行
```

## 二、现状诊断

### 2.1 目录结构问题

#### 问题 P1：proxy/ "扁平米" — 20 个文件堆在根层

```
src/proxy/
  anthropic.ts (70)           ← 路由入口
  openai.ts (131)             ← 路由入口
  proxy-handler.ts (439)      ← 请求控制器（巨型）
  orchestrator.ts (189)       ← 编排器
  resilience.ts (312)         ← 重试决策
  stream-proxy.ts (349)       ← SSE 流代理
  transport.ts (151)          ← HTTP 调用
  transport-fn.ts (111)       ← Transport 工厂
  semaphore.ts (207)          ← 并发控制
  scope.ts (51)               ← Scope 包装
  mapping-resolver.ts (198)   ← 映射解析
  retry-rules.ts (30)         ← 重试规则
  overflow.ts (131)           ← 溢出重定向
  model-state.ts (148)        ← 会话状态
  enhancement-config.ts (30)  ← 增强配置
  usage-window-tracker.ts (88)← 用量窗口
  proxy-core.ts (142)         ← 共享工具（杂烩）
  proxy-logging.ts (203)      ← 日志
  log-helpers.ts (98)         ← 日志辅助
  types.ts (102)              ← 类型
```

20 个文件平铺一层，无法区分核心/辅助/特性模块。

#### 问题 P2：config/ 入口分散

`config.ts`（真正的配置入口）在 `src/` 根目录，而 `src/config/` 目录里只有 `recommended.ts` 和 `model-context.ts` 两个辅助文件。

#### 问题 P3：共享类型散落

4 个 `types.ts` 分布在不同目录，`constants.ts` 也有 2 个（`src/constants.ts` 和 `src/admin/constants.ts`），没有统一的共享类型层。

### 2.2 跨层依赖问题

通过全量 import 分析，发现以下跨层依赖违规：

```
⚠️ admin → proxy (9 处):
   providers.ts           → ProviderSemaphoreManager    (并发配置刷新)
   proxy-enhancement.ts   → loadEnhancementConfig       (读配置)
   proxy-enhancement.ts   → modelState                  (清理会话状态)
   retry-rules.ts         → RetryRuleMatcher            (刷新规则缓存)
   routes.ts              → RetryRuleMatcher + SemaphoreManager (传递依赖)
   settings-import-export.ts → modelState + RetryRuleMatcher + SemaphoreManager

⚠️ admin → monitor (3 处):
   monitor.ts             → RequestTracker  (SSE 广播)
   providers.ts           → RequestTracker  (更新配置)
   routes.ts              → RequestTracker  (传递)

⚠️ monitor → proxy (1 处):
   request-tracker.ts     → type ProviderSemaphoreManager  (仅类型引用)

⚠️ db → proxy (1 处):
   mappings.ts            → type Target  (仅类型，共享接口定义)

⚠️ proxy → monitor (10 处):
   request-tracker 被 proxy-handler, orchestrator, scope, transport-fn, openai, anthropic 引用
   stream-content-accumulator 被 transport-fn 引用

⚠️ proxy → metrics (7 处):
   metrics-extractor 被 stream-proxy, transport-fn, proxy-logging, types 引用
   sse-metrics-transform 被 stream-proxy, transport-fn 引用
```

**核心矛盾**：admin 层需要"触发 proxy 层状态刷新"（如 Provider 更新后刷新信号量），但 admin 不应该知道 proxy 的内部实现。

### 2.3 代码设计问题

#### 问题 P4：proxy-handler.ts 过度膨胀（439 行）

`handleProxyRequest()` 单函数硬编码了完整的请求处理管线：

```
handleProxyRequest() 调用链:
  1. applyEnhancement()         ← 增强
  2. ToolLoopGuard.check()      ← 循环检测
  3. handleIntercept()          ← 拦截处理
  4. executeFailoverLoop()
     4a. resolveMapping()       ← 映射解析
     4b. getProviderById()      ← Provider 验证
     4c. applyOverflowRedirect()← 溢出重定向
     4d. applyProviderPatches() ← Provider 补丁
     4e. buildTransportFn()     ← Transport 构建
     4f. orchestrator.handle()  ← 编排执行
     4g. logResilienceResult()  ← 日志写入
     4h. collectTransportMetrics() ← 指标采集
     4i. updateLogStreamContent()  ← 流内容存储
```

新增步骤必须修改这个巨型函数。

#### 问题 P5：RouteHandlerDeps "万能参数包"

```typescript
export interface RouteHandlerDeps {
  db: Database.Database;
  streamTimeoutMs: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  tracker?: RequestTracker;
  orchestrator: ProxyOrchestrator;
  usageWindowTracker?: UsageWindowTracker;
  sessionTracker?: SessionTracker;
}
```

从 openai/anthropic → proxy-handler → orchestrator 传递。每加一个新组件就要改这个接口。

#### 问题 P6：buildApp() 手工装配（313 行）

`src/index.ts` 的 `buildApp()` 手动创建所有组件、手动传递依赖、手动管理生命周期。每新增一个功能模块都要修改此函数。

### 2.4 设计良好的部分（应保留）

以下模块设计合理，不需要重构：

| 模块 | 耦合度 | 设计优点 |
|------|--------|---------|
| `proxy/resilience.ts` | ✅ 松耦合 | 策略模式 + 依赖注入 transportFn，决策与执行分离 |
| `proxy/orchestrator.ts` | ✅ 较好 | 组合模式，注入 Semaphore/Tracker/Resilience |
| `proxy/patch/` | ✅ 松耦合 | 纯函数，按 provider 分发，易扩展 |
| `proxy/strategy/types.ts` | ✅ 松耦合 | 纯类型定义 |
| `proxy/loop-prevention/` | ✅ 独立 | 内聚的子模块 |
| `admin/` (16 个路由) | ✅ 已按领域拆分 | 每个文件对应一个 CRUD 域 |
| `db/` (15 个文件) | ✅ 已按表拆分 | 函数式调用，足够清晰 |

## 三、设计目标

1. **新功能零侵入**：新增 Pipeline 步骤只需写一个中间件文件，不改 handler
2. **依赖方向单向**：消除 admin→proxy、monitor→proxy 反向依赖
3. **目录即文档**：看目录结构就能理解模块归属
4. **渐进式实施**：3 个 Phase，每个可独立合并

**非目标**：
- ❌ 热加载 / 动态插件发现（服务端代理，重启成本极低）
- ❌ 微内核架构（无第三方插件需求）
- ❌ 事件驱动（代理是同步请求-响应模式）
- ❌ Admin/DB 层大重构（已足够好）

## 四、方案设计

### 4.1 新建 `src/core/` — 共享内核

`core/` 是零 `src/` 依赖的纯类型+常量+接口层。

#### core/types.ts

从现有文件中抽取被多目录共享的类型：

| 抽取来源 | 内容 |
|---------|------|
| `proxy/strategy/types.ts` 全部 | `Target`, `ResolveContext`, `ResolveResult`, `ConcurrencyOverride` |
| `proxy/types.ts` (公共部分) | `TransportResult`, `RawHeaders`, `StreamState` |
| `constants.ts` 全部 | HTTP 状态码, `MS_PER_SECOND`, `PROXY_API_TYPES`, `getProxyApiType`, `UPSTREAM_SUCCESS`, `filterHeaders` |

`proxy/types.ts` 保留 proxy 内部专用类型，改为 re-export core 中的公共类型以保持兼容。

#### core/errors.ts

| 抽取来源 | 内容 |
|---------|------|
| `proxy/semaphore.ts` | `SemaphoreQueueFullError`, `SemaphoreTimeoutError` |
| `proxy/types.ts` | `ProviderSwitchNeeded` |

这些错误类被 admin 和 monitor 引用，不应在 proxy 内部。

#### core/registry.ts — StateRegistry 接口

解决 admin→proxy 依赖的核心机制。Admin 只依赖接口，不依赖 proxy 实现：

```typescript
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
  refreshRetryRules(): void;
  updateProviderConcurrency(providerId: string, config: ConcurrencyConfig): void;
  clearModelState(): void;
  getEnhancementConfig(): EnhancementConfig;
}
```

#### core/container.ts — 轻量服务容器

```typescript
type Factory<T> = (c: Container) => T;

export class Container {
  private factories = new Map<string, Factory<unknown>>();
  private instances = new Map<string, unknown>();

  register<T>(key: string, factory: Factory<T>): void;
  resolve<T>(key: string): T;
}
```

### 4.2 Proxy Pipeline 架构

#### Pipeline 接口

```typescript
// proxy/pipeline.ts

/** Pipeline 上下文：所有中间件共享的请求状态 */
export interface ProxyContext {
  request: FastifyRequest;
  reply: FastifyReply;
  apiType: "openai" | "anthropic";

  // --- 请求阶段填充 ---
  clientModel: string;
  effectiveModel: string;
  originalModel: string | null;
  sessionId: string | undefined;
  body: Record<string, unknown>;
  isStream: boolean;

  // --- 解析阶段填充 ---
  target?: Target;
  provider?: { id: string; name: string; is_active: number; api_type: string; base_url: string; api_key: string };

  // --- 传输后填充 ---
  transportResult?: TransportResult;
}

/** 拦截响应：返回非 void 则终止 pipeline */
export interface InterceptResponse {
  statusCode: number;
  body: unknown;
  meta?: { action: string; detail?: string };
}

/** 中间件接口 */
export interface ProxyMiddleware {
  readonly name: string;
  beforeProxy?(ctx: ProxyContext): Promise<InterceptResponse | void>;
  afterProxy?(ctx: ProxyContext): Promise<void>;
}

/** Pipeline 引擎 */
export class ProxyPipeline {
  private middlewares: ProxyMiddleware[] = [];

  use(middleware: ProxyMiddleware): this;
  async executeBefore(ctx: ProxyContext): Promise<InterceptResponse | null>;
  async executeAfter(ctx: ProxyContext): Promise<void>;
}
```

#### 现有步骤 → Middleware 映射

| proxy-handler.ts 中的步骤 | → Middleware | 说明 |
|--------------------------|-------------|------|
| `applyEnhancement()` | `EnhancementMiddleware` | 代理增强（模型选择、命令拦截） |
| `ToolLoopGuard.check()` + 3 层处理 | `LoopPreventionMiddleware` | 工具调用循环检测 |
| `applyOverflowRedirect()` | `OverflowMiddleware` | 上下文溢出重定向 |
| `applyProviderPatches()` | `ProviderPatchMiddleware` | Provider 特定补丁 |
| `body.stream_options = { include_usage: true }` | `StreamOptionsMiddleware` | OpenAI 流式选项注入 |

#### proxy-handler.ts 简化后（~120 行）

```typescript
export async function handleProxyRequest(request, reply, apiType, upstreamPath, errors, deps) {
  const ctx: ProxyContext = buildContext(request, reply, apiType);

  // Phase 1: 前置中间件（增强、循环检测等）
  const intercepted = await deps.pipeline.executeBefore(ctx);
  if (intercepted) return handleIntercept(reply, intercepted);

  // Phase 2: Failover 循环（映射解析 → 传输 → 日志）
  return executeFailoverLoop(ctx, deps, errors, upstreamPath);

  // Phase 3: 后置中间件在 failover-loop 内部传输完成后调用
}
```

### 4.3 四层架构模型

本系统采用四层架构，每层有明确的职责边界和依赖方向：

```
┌──────────────────────────────────────────────────────────────┐
│                     入站适配 (Inbound)                        │
│  接收外部请求，转换为内部调用                                     │
│  admin/  proxy/openai  proxy/anthropic  cli.ts  middleware/  │
└──────────────────────────┬───────────────────────────────────┘
                           │ 调用
┌──────────────────────────▼───────────────────────────────────┐
│                       核心层 (Core)                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                   流程层 (Pipeline)                     │  │
│  │  proxy/pipeline + proxy/middleware                      │  │
│  │  Enhancement → LoopPrevention → Patch → ...            │  │
│  └────────────────────────────────────────────────────────┘  │
│  proxy/handler    请求处理（failover 循环、日志写入）           │
│  proxy/orchestration 编排（信号量、重试、追踪）                 │
│  proxy/routing    路由（映射解析、会话状态、溢出重定向）         │
│  proxy/enhancement, loop-prevention, patch  子模块           │
│  （不依赖任何外部系统，纯逻辑）                                 │
└──────────┬─────────────────────────────────────┬─────────────┘
           │ 调用                               │ 写入/读取
┌──────────▼──────────┐          ┌──────────────▼──────────────┐
│   出站适配 (Outbound) │          │    基础设施 (Infrastructure)  │
│  连接外部 LLM 服务     │          │  被多层共享的基础能力          │
│  proxy/transport/    │          │  db/    数据持久化            │
│  （数据面，每个请求必经）│          │  monitor/  可观测性           │
│                      │          │  metrics/  指标采集           │
└──────────┬───────────┘          │  config/  配置               │
           │                      │  utils/   工具函数           │
           ▼                      │  core/    共享类型/常量       │
    上游 LLM API                  └──────────────────────────────┘
    （外部服务）
```

#### 各层定位

| 层 | 目录 | 职责 | 特征 |
|---|------|------|------|
| **入站适配** | `admin/`, `proxy/openai.ts`, `proxy/anthropic.ts`, `cli.ts`, `middleware/` | 接收外部请求，转换为内部调用 | 知道外部协议（HTTP/CLI），不知道内部实现 |
| **核心层** | `proxy/handler/`, `proxy/orchestration/`, `proxy/routing/`, `proxy/middleware/`, `proxy/pipeline.ts` | 业务逻辑和流程编排 | 不依赖具体外部系统，纯逻辑 |
| **出站适配** | `proxy/transport/` | 连接上游 LLM API | 是代理存在的理由，每个请求必经的数据面 |
| **基础设施** | `core/`, `db/`, `monitor/`, `metrics/`, `config/`, `utils/` | 被多层共享的基础能力 | 不包含业务逻辑 |

#### transport vs monitor 的区别

这两个模块经常被混淆，但本质完全不同：

| | transport | monitor |
|---|-----------|---------|
| 角色 | 出站适配 | 基础设施（可观测性） |
| 连接谁 | 上游 LLM API（外部服务） | admin UI 浏览器（用户） |
| 谁调用它 | 核心层 | 核心层写入 + admin 入站路由读取 |
| 在请求路径上 | **是**（每个代理请求必经） | **否**（旁路观测） |
| 性能敏感 | **是**（流式转发延迟） | 否（异步推送，丢帧可接受） |
| 平面 | 数据面 | 控制面 |

monitor 不归入入站适配的原因：
1. 入站适配的职责是**接收请求并转换为内部调用**——这是 `admin/monitor.ts`（路由）干的
2. `monitor/` 模块本身是**被核心层写入 + 被入站适配读取**的双向基础设施
3. 把它放入站层，核心层就要"向上调用入站层"来写 tracker，依赖方向就反了

monitor 不归入出站适配的原因：
1. 出站适配是代理存在的理由（连接上游 LLM），每个请求必经，性能敏感
2. monitor 是旁路观测，异步推送，丢帧可接受——是完全不同的平面

#### 目标目录结构

```
src/
├── index.ts                         buildApp() — 容器装配 (~150行)
├── cli.ts                           npm bin 入口（不变）
│
├── core/                            【新】共享内核（基础设施）
│   ├── types.ts                     Target, TransportResult, RawHeaders, UPSTREAM_SUCCESS, filterHeaders
│   ├── constants.ts                 HTTP_*, MS_PER_SECOND, PROXY_API_TYPES, getProxyApiType
│   ├── errors.ts                    ProviderSwitchNeeded, SemaphoreQueueFullError, SemaphoreTimeoutError
│   ├── container.ts                 ServiceContainer
│   └── registry.ts                  StateRegistry, ConcurrencyConfig, EnhancementConfig 接口
│
├── config/                          配置（基础设施）
│   ├── index.ts                     getBaseConfig, Config（从 src/config.ts 移入）
│   ├── recommended.ts               推荐配置（不变）
│   └── model-context.ts             模型上下文窗口（不变）
│
├── db/                              数据持久化（基础设施）
│   ├── migrations/                  32 个迁移
│   ├── index.ts, providers.ts, mappings.ts, ...
│
├── monitor/                         可观测性（基础设施）
│   ├── types.ts                     监控类型
│   ├── request-tracker.ts           请求追踪 + SSE 广播
│   ├── stats-aggregator.ts          延迟/成功率统计
│   ├── runtime-collector.ts         内存/事件循环指标
│   ├── stream-content-accumulator.ts 流式内容累积
│   └── stream-extractor.ts          SSE chunk 文本提取
│
├── metrics/                         指标采集（基础设施）
│   ├── sse-parser.ts
│   ├── metrics-extractor.ts
│   └── sse-metrics-transform.ts
│
├── utils/                           工具函数（基础设施）
│   ├── crypto.ts, password.ts, token-counter.ts, datetime.ts, time-range.ts
│
├── middleware/                       认证中间件（入站适配）
│   ├── auth.ts                      客户端 API Key 认证
│   └── admin-auth.ts                管理后台 JWT 认证
│
├── admin/                           管理页面 API（入站适配）
│   ├── routes.ts                    路由注册
│   ├── api-response.ts, constants.ts
│   ├── providers.ts, mappings.ts, groups.ts, schedules.ts, ...
│
├── proxy/                           代理核心（核心层 + 出站适配）
│   ├── openai.ts                    OpenAI 入站端点（入站适配）
│   ├── anthropic.ts                 Anthropic 入站端点（入站适配）
│   ├── proxy-handler.ts             请求入口 (~120行)
│   ├── pipeline.ts                  Pipeline 引擎（流程层）
│   │
│   ├── middleware/                   Pipeline 中间件（流程层）
│   │   ├── enhancement.ts             EnhancementMiddleware
│   │   ├── loop-prevention.ts         LoopPreventionMiddleware
│   │   ├── provider-patch.ts          ProviderPatchMiddleware
│   │   └── stream-options.ts          StreamOptionsMiddleware
│   │
│   ├── handler/                     请求处理（核心层）
│   │   ├── failover-loop.ts            executeFailoverLoop()
│   │   ├── error-formatter.ts          createErrorFormatter()
│   │   ├── intercept-handler.ts        handleIntercept()
│   │   └── log-writer.ts              logResilienceResult() + collectTransportMetrics()
│   │
│   ├── orchestration/               编排（核心层）
│   │   ├── orchestrator.ts             ProxyOrchestrator
│   │   ├── resilience.ts              ResilienceLayer
│   │   ├── semaphore.ts              ProviderSemaphoreManager
│   │   ├── scope.ts                   SemaphoreScope + TrackerScope
│   │   └── retry-rules.ts            RetryRuleMatcher
│   │
│   ├── routing/                     路由/映射（核心层）
│   │   ├── mapping-resolver.ts        resolveMapping()
│   │   ├── model-state.ts            ModelStateManager
│   │   ├── overflow.ts              applyOverflowRedirect()
│   │   ├── usage-window-tracker.ts   UsageWindowTracker
│   │   └── enhancement-config.ts     loadEnhancementConfig()
│   │
│   ├── transport/                   传输（出站适配）
│   │   ├── http.ts                     callNonStream, buildRequestOptions
│   │   ├── stream.ts                   StreamProxy, callStream
│   │   ├── transport-fn.ts            buildTransportFn
│   │   └── headers.ts                 buildUpstreamHeaders, buildUpstreamUrl
│   │
│   ├── enhancement/                 增强子模块（核心层，不变）
│   ├── loop-prevention/             循环检测子模块（核心层，不变）
│   └── patch/                       Provider 补丁子模块（核心层，不变）
│
└── upgrade/                         版本检查（入站适配辅助）
    ├── checker.ts, deployment.ts, version.ts
```

#### 依赖方向规则

```
四层依赖方向（只允许单向）：

入站适配    ← 依赖 核心层 + 基础设施
  (admin, proxy/openai+anthropic, middleware, cli)

核心层      ← 依赖 基础设施（不依赖入站/出站适配）
  (proxy/handler, orchestration, routing, middleware, pipeline)
  流程层(Pipeline) 在核心层内部

出站适配    ← 依赖 基础设施（不依赖核心层，被核心层调用）
  (proxy/transport)

基础设施    ← 零 src/ 依赖（core/ 零依赖，其他基础设施只依赖 core/）
  (core, db, monitor, metrics, config, utils)

关键约束：
1. core/ 不 import 任何其他 src/ 目录
2. admin 不直接 import proxy/ — 通过 StateRegistry 接口
3. monitor 不依赖 proxy/ — SemaphoreManager 通过接口注入
4. proxy/middleware/* 之间互不依赖
5. proxy/transport/ 不依赖 proxy/ 核心层模块（只依赖 core/ + metrics/）
```

#### 重构后四层依赖图

```
            ┌─────────────────────────────────────────┐
            │           入站适配 (Inbound)              │
            │  admin/  proxy/openai+anthropic  middleware/
            │  cli.ts                                  │
            └──────────────────┬──────────────────────┘
                               │ 调用
            ┌──────────────────▼──────────────────────┐
            │              核心层 (Core)                │
            │  ┌──────────────────────────────────┐   │
            │  │        流程层 (Pipeline)           │   │
            │  │  proxy/pipeline + proxy/middleware │   │
            │  └──────────────────────────────────┘   │
            │  proxy/handler  orchestration  routing   │
            │  enhancement  loop-prevention  patch     │
            └─────┬────────────────────┬──────────────┘
                  │ 调用               │ 写入/读取
    ┌─────────────▼──────┐   ┌────────▼────────────────┐
    │  出站适配 (Outbound) │   │   基础设施 (Infra)       │
    │  proxy/transport/   │   │  core/  db/  monitor/   │
    │  上游 LLM API 连接   │   │  metrics/ config/ utils/│
    │  （数据面）          │   │  （被多层共享）          │
    └────────┬────────────┘   └─────────────────────────┘
             │
             ▼
      上游 LLM API
```

## 五、实施计划

### Phase 1：core/ 抽取 + 跨层依赖解耦

**原则**：零逻辑变更，纯移动 + 改 import。TypeScript 编译器验证所有路径。

#### 新增文件

| 文件 | 来源 |
|------|------|
| `core/types.ts` | `proxy/strategy/types.ts` 全部 + `proxy/types.ts` 公共部分 |
| `core/constants.ts` | `src/constants.ts` 全部 + `proxy/types.ts` 中 UPSTREAM_SUCCESS, filterHeaders |
| `core/errors.ts` | `proxy/semaphore.ts` 中 SemaphoreError 类 + `proxy/types.ts` 中 ProviderSwitchNeeded |
| `core/registry.ts` | 新增 StateRegistry 接口 + ConcurrencyConfig + EnhancementConfig 接口 |

#### 移动文件

| 原位置 | 新位置 |
|--------|--------|
| `src/config.ts` | `src/config/index.ts` |

#### 删除文件

| 文件 | 原因 |
|------|------|
| `src/constants.ts` | 移到 core/constants.ts |
| `src/proxy/strategy/types.ts` | 移到 core/types.ts |

#### 修改文件（改 import 路径）

**消除 db→proxy 依赖：**
- `src/db/mappings.ts`: `import from "../proxy/strategy/types.js"` → `import from "../../core/types.js"`

**消除 monitor→proxy 依赖：**
- `src/monitor/request-tracker.ts`: 不再直接引用 `ProviderSemaphoreManager` 类型，改为通过构造参数注入（或定义 core 中的接口）

**消除 admin→proxy 依赖（9 处→0）：**
- `src/admin/providers.ts`: 引用 SemaphoreManager → 通过 StateRegistry 接口调用
- `src/admin/proxy-enhancement.ts`: 引用 enhancement-config + modelState → 通过 StateRegistry
- `src/admin/retry-rules.ts`: 引用 RetryRuleMatcher → 通过 StateRegistry
- `src/admin/routes.ts`: 传递 RetryRuleMatcher + SemaphoreManager → 传递 StateRegistry
- `src/admin/settings-import-export.ts`: 引用 3 个 proxy 模块 → 通过 StateRegistry

**admin→monitor 依赖（3 处）：保留，不改**

`admin/monitor.ts` 直接调用 `tracker.getActive()`, `tracker.addClient()` 等方法——这是 Admin 管理 Monitor 配置的合理依赖，与 admin→proxy（跨层访问实现细节）性质不同。
- `src/admin/monitor.ts`: 保留直接引用 `RequestTracker`
- `src/admin/providers.ts`: 保留直接引用 `RequestTracker`（仅调用 `updateProviderConfig`）
- `src/admin/routes.ts`: 保留传递 `RequestTracker`

**所有引用 constants.ts 的文件**：改为 `import from "../core/constants.js"` (约 15 个文件)

**所有引用 strategy/types.js 的文件**：改为从 core/types.js 引用 (约 8 个文件)

#### 影响

- ~35 个文件 import 路径变更
- 0 行逻辑变更
- 风险：低（TypeScript 编译器 + 57 个测试文件全覆盖验证）

### Phase 2：proxy/ 子目录拆分

**原则**：零逻辑变更，文件按职责归入子目录。

#### 拆分规则

| 目标目录 | 文件 | 原位置 |
|---------|------|--------|
| `proxy/transport/` | `http.ts` | `proxy/transport.ts` |
| | `stream.ts` | `proxy/stream-proxy.ts` |
| | `transport-fn.ts` | `proxy/transport-fn.ts` |
| | `headers.ts` | `proxy/proxy-core.ts` 中 buildUpstreamHeaders/Url |
| `proxy/orchestration/` | `orchestrator.ts` | `proxy/orchestrator.ts` |
| | `resilience.ts` | `proxy/resilience.ts` |
| | `semaphore.ts` | `proxy/semaphore.ts` |
| | `scope.ts` | `proxy/scope.ts` |
| | `retry-rules.ts` | `proxy/retry-rules.ts` |
| `proxy/routing/` | `mapping-resolver.ts` | `proxy/mapping-resolver.ts` |
| | `model-state.ts` | `proxy/model-state.ts` |
| | `overflow.ts` | `proxy/overflow.ts` |
| | `usage-window-tracker.ts` | `proxy/usage-window-tracker.ts` |
| | `enhancement-config.ts` | `proxy/enhancement-config.ts` |
| `proxy/handler/` | `failover-loop.ts` | 从 `proxy/proxy-handler.ts` 拆出 executeFailoverLoop |
| | `error-formatter.ts` | 从 `proxy/proxy-core.ts` 拆出 createErrorFormatter |
| | `intercept-handler.ts` | 从 `proxy/proxy-logging.ts` 拆出 handleIntercept |
| | `log-writer.ts` | 合并 `proxy/proxy-logging.ts` + `proxy/log-helpers.ts` |

#### 拆分后删除的文件

| 文件 | 原因 |
|------|------|
| `proxy/proxy-core.ts` | 拆分到 handler/ + transport/ |
| `proxy/proxy-logging.ts` | 拆分到 handler/ |
| `proxy/log-helpers.ts` | 合并到 handler/log-writer.ts |
| `proxy/types.ts` | 公共类型已移到 core/，仅保留 proxy 内部 re-export |
| `proxy/strategy/` | 已移到 core/ |

#### proxy-handler.ts 精简

拆分前：439 行
拆分后：~150 行（保留 handleProxyRequest 入口 + 辅助函数）

#### 影响

- proxy/ 下所有文件 import 路径变更
- 28 个测试文件 import 路径变更
- 风险：中（大量路径变更，但 TypeScript + 测试全覆盖验证）

### Phase 3：Pipeline 架构 + ServiceContainer

**原则**：这是唯一有逻辑变更的 Phase。引入 Pipeline 模式和轻量容器。

#### 新增文件

| 文件 | 说明 |
|------|------|
| `core/container.ts` | 轻量 DI 容器 (~50 行) |
| `proxy/pipeline.ts` | ProxyPipeline + ProxyMiddleware + ProxyContext (~100 行) |
| `proxy/middleware/enhancement.ts` | EnhancementMiddleware |
| `proxy/middleware/loop-prevention.ts` | LoopPreventionMiddleware |
| `proxy/middleware/provider-patch.ts` | ProviderPatchMiddleware |
| `proxy/middleware/stream-options.ts` | StreamOptionsMiddleware |

#### 重构文件

| 文件 | 变更 |
|------|------|
| `proxy/proxy-handler.ts` | 从 ~150 行精简到 ~120 行，管线步骤改为 pipeline.execute |
| `src/index.ts` (buildApp) | 从 313 行精简到 ~150 行，改用 Container 装配 |

#### Pipeline 中间件实现

每个 middleware 封装当前 proxy-handler.ts 中的一段逻辑：

1. **EnhancementMiddleware**: 封装 `applyEnhancement()` + `cleanRouterResponses()`
2. **LoopPreventionMiddleware**: 封装 `extractLastToolUse()` + `ToolLoopGuard.check()` + 3 层处理
3. **ProviderPatchMiddleware**: 封装 `applyProviderPatches()`
4. **StreamOptionsMiddleware**: 封装 `body.stream_options = { include_usage: true }`（OpenAI 专用）
5. **OverflowMiddleware**: 封装 `applyOverflowRedirect()`（在 failover loop 内部调用）

#### Container 注册

```typescript
// buildApp() 中
const container = new Container();
container.register("db", () => db);
container.register("matcher", (c) => { const m = new RetryRuleMatcher(); m.load(c.resolve("db")); return m; });
container.register("semaphoreManager", () => new ProviderSemaphoreManager());
container.register("tracker", (c) => new RequestTracker({ semaphoreManager: c.resolve("semaphoreManager"), ... }));
container.register("sessionTracker", () => new SessionTracker(...));
container.register("pipeline", (c) => {
  const p = new ProxyPipeline();
  p.use(new EnhancementMiddleware(c.resolve("db")));
  p.use(new LoopPreventionMiddleware(c.resolve("sessionTracker")));
  return p;
});
container.register("stateRegistry", (c) => new AppStateRegistry(c.resolve("matcher"), c.resolve("semaphoreManager"), c.resolve("db")));
```

#### RouteHandlerDeps 简化

```typescript
// 重构前 (8 个字段)
export interface RouteHandlerDeps {
  db, streamTimeoutMs, retryBaseDelayMs, matcher, tracker, orchestrator, usageWindowTracker, sessionTracker
}

// 重构后 (3 个字段)
export interface RouteHandlerDeps {
  db: Database.Database;
  pipeline: ProxyPipeline;
  orchestrator: ProxyOrchestrator;
}
```

streamTimeoutMs, retryBaseDelayMs 从 config 读取（不再传递），matcher/tracker/usageWindowTracker/sessionTracker 由 orchestrator 或 pipeline 内部管理。

#### 影响

- 核心逻辑重组
- 需要全量回归测试（57 个测试文件）
- 风险：高

## 六、新增功能规范

### 场景 1：新增一个 Pipeline 中间件（如"内容审计"）

```
1. 在 proxy/middleware/ 下新建 content-audit.ts，实现 ProxyMiddleware 接口
2. 在 pipeline 初始化处注册：pipeline.use(new ContentAuditMiddleware())
3. 不需要修改 handler、orchestrator、transport
4. 不需要修改 RouteHandlerDeps
```

### 场景 2：新增一个 Provider 补丁（如"Qwen 补丁"）

```
1. 在 proxy/patch/ 下新建 qwen/ 目录
2. 在 proxy/patch/index.ts 的 applyProviderPatches() 中增加一条 if
3. 不需要修改 handler、transport
```

### 场景 3：新增一张数据库表 + Admin CRUD

```
1. 在 db/migrations/ 添加迁移文件
2. 在 db/ 下新建对应 CRUD 文件
3. 在 db/index.ts 中 re-export
4. 在 admin/ 下新建对应路由文件
5. 在 admin/routes.ts 中 register
6. 如需触发 proxy 状态刷新：在 StateRegistry 中增加方法
```

### 场景 4：新增一个 API 类型（如"Google Gemini"）

```
1. 在 proxy/ 下新建 gemini.ts（Fastify 路由插件）
2. 复用 pipeline + orchestrator
3. 在 core/constants.ts 的 PROXY_API_TYPES 中注册路由
4. 在 index.ts 中 register
```

## 七、测试策略

### 每个 Phase 的验证方式

| Phase | 验证方式 |
|-------|---------|
| P1 | `tsc --noEmit` + `npm test` 全量通过 |
| P2 | `tsc --noEmit` + `npm test` 全量通过 + 人工检查 import 路径正确性 |
| P3 | `npm test` 全量通过 + 手动集成测试（代理请求、Admin API、Monitor SSE） |

### 测试文件影响

57 个测试文件中，预计需要修改 import 路径的：

- P1: ~15 个（引用 constants, types 的测试）
- P2: ~28 个（引用 proxy 内部模块的测试）
- P3: ~5 个（引用 RouteHandlerDeps 的测试）

### 不需要修改的测试

- `tests/crypto.test.ts`, `tests/password.test.ts` — 纯 utils
- `tests/sse-parser.test.ts`, `tests/metrics-extractor.test.ts` — 纯 metrics
- `tests/directive-parser.test.ts`, `tests/response-cleaner.test.ts` — 纯 enhancement
- `tests/loop-prevention/*.test.ts` — 纯子模块

## 八、风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| Import 路径变更导致遗漏 | 中 | 编译错误 | TypeScript 编译器捕获 |
| Pipeline 执行顺序错误 | 低 | 代理行为异常 | P3 中逐个迁移中间件，每次跑全量测试 |
| Container 循环依赖 | 低 | 运行时错误 | Container.resolve 检测循环并报错 |
| 测试文件遗漏修改 | 低 | CI 失败 | CI 全量运行 |
| proxy-core.ts 拆分后 re-export 不完整 | 中 | 编译错误 | 按调用方逐个验证 |

## 九、不采纳的方案及理由

| 方案 | 理由 |
|------|------|
| **热加载** | 服务端代理，重启成本极低，热加载引入的状态一致性/内存泄漏风险远大于收益 |
| **动态插件发现（`import()` 扫描目录）** | 模块数量有限（~10 个），静态 import 的明确性 > 动态 import 的灵活性 |
| **微内核架构** | 无第三方开发插件的需求，过度设计 |
| **事件驱动解耦** | 代理是同步请求-响应模式，事件驱动增加延迟和调试难度 |
| **Admin 引入 Service 层** | 项目规模 ~11K 行，db 函数式调用已足够清晰，过度抽象增加维护负担 |
| **完整 DI 框架（InversifyJS/Awilix）** | 一个 ~50 行的 Container 足够，引入框架是 over-engineering |
