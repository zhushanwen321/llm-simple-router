# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

LLM API 代理路由器。接收 OpenAI / Anthropic 格式的客户端请求，通过模型映射和路由策略转发到配置的后端 Provider，支持流式（SSE）和非流式代理。管理后台（Vue 3 + shadcn-vue）提供 Provider 管理、模型映射配置、重试规则、请求日志查看、实时监控等功能。

## 分支策略

- `main` — 可发布分支，始终保持稳定可发布状态

**流程：** 功能分支 → PR 直接合并到 `main`（发布）

功能分支基于 `main` 创建，命名规范：`feat/xxx`、`fix/xxx`、`refactor/xxx`、`chore/xxx`

## 常用命令

```bash
# 后端开发（热重载，端口 9980）
npm run dev

# 后端构建 & 启动
npm run build
mkdir -p dist/db/migrations && cp src/db/migrations/*.sql dist/db/migrations/
FRONTEND_DIST=./frontend/dist npm start

# 前端开发（自动代理 /admin/api 到后端 :9980）
cd frontend && npm run dev

# 前端构建
cd frontend && npm run build

# 完整构建（tsc + 复制 migrations + 构建前端）
npm run build:full

# 测试
npm test                              # 全部测试
npx vitest run tests/auth.test.ts     # 单个测试文件
npm run test:watch                    # 监听模式

# Lint
npm run lint                          # ESLint（零警告容忍）

# Docker
docker compose up -d
```

## 架构

### 后端（Fastify + SQLite）

**入口层：**
- `src/cli.ts` — npm bin 入口（带 shebang），无条件调用 `main()`
- `src/index.ts` — 库入口，导出 `buildApp` 和 `main`。`buildApp()` 组装所有插件，支持注入 `db`（测试用 in-memory）。使用 `ServiceContainer` 管理依赖
- `src/config/index.ts` — 单例配置，惰性缓存

**核心层 `src/core/`：**
- `core/types.ts` — 共享类型：`Target`、`MappingGroup`、`RetryStrategy` 等
- `core/constants.ts` — 共享常量：HTTP 状态码、API 类型判断
- `core/errors.ts` — 共享错误：`ProviderSwitchNeeded` 及其 `ResilienceAttempt` 类型
- `core/registry.ts` — `StateRegistry` 接口（admin→proxy 解耦）
- `core/container.ts` — 轻量 DI 容器（`ServiceContainer`），懒加载单例工厂

**核心层 `src/core/`：**
- `types.ts` — 共享类型：`Target`（映射目标）、`MappingStrategy` 等
- `constants.ts` — 共享常量：HTTP 状态码、API 类型工具函数
- `errors.ts` — 共享错误类型：`ProviderSwitchNeeded`、`ResilienceAttempt`
- `registry.ts` — `StateRegistry` 接口：admin→proxy 状态刷新的解耦边界
- `container.ts` — 轻量 DI 容器：懒加载单例工厂注册表

**`buildApp()` 插件注册顺序：**
```
seedDefaultRules → ModelStateManager.init → RetryRuleMatcher.load
→ ProviderSemaphoreManager → RequestTracker → 初始化所有 provider 并发配置
→ authMiddleware → openaiProxy → anthropicProxy → adminRoutes → fastifyStatic
```

**代理层 `src/proxy/`（四层架构：Handler → Orchestration → Routing → Transport）：**

| 文件 | 角色 |
|------|------|
| `handler/proxy-handler.ts` | **Handler 层**：`handleProxyRequest()` — Fastify 路由回调，负责映射解析、header 构建、日志记录，调用 Orchestrator |
| `handler/openai.ts` | OpenAI 代理插件（`POST /v1/chat/completions`、`GET /v1/models`），注入 `stream_options` |
| `handler/anthropic.ts` | Anthropic 代理插件（`POST /v1/messages`），与 openai.ts 对称 |
| `orchestration/orchestrator.ts` | **Orchestration 层**：`ProxyOrchestrator` — 协调信号量、tracker、resilience 三大 scope，驱动重试/failover 循环 |
| `orchestration/resilience.ts` | 重试决策层：`ResilienceLayer` + fixed/exponential 策略，判断是否重试/failover |
| `orchestration/semaphore.ts` | Provider 级并发控制：基于 Promise 的等待队列，支持 AbortSignal 和超时 |
| `orchestration/scope.ts` | 信号量/追踪器 scope 包装：`SemaphoreScope`（acquire/release）+ `TrackerScope`（start/complete） |
| `orchestration/retry-rules.ts` | `RetryRuleMatcher`：从 DB 加载规则到内存，按 status_code 分组缓存 |
| `routing/mapping-resolver.ts` | **Routing 层**：将 client_model 解析为 `{ backend_model, provider_id }` |
| `routing/model-state.ts` | `ModelStateManager` 单例：内存 + SQLite 双层缓存，24h 滑动窗口 |
| `routing/overflow.ts` | 溢出重定向：上下文超出时切换到更大模型 |
| `routing/usage-window-tracker.ts` | 5h 用量窗口追踪，启动时自动补齐缺失窗口 |
| `routing/enhancement-config.ts` | 加载代理增强配置（DB settings） |
| `transport/http.ts` | **Transport 层**：底层 HTTP 调用 `callNonStream()`/`callGet()`，构建原始 `http.request` |
| `transport/stream.ts` | SSE 流式代理引擎：`StreamProxy` 类管理缓冲状态机 + `SSEMetricsTransform` 旁路采集 |
| `transport/transport-fn.ts` | 构建传输函数闭包，桥接 handler 参数和 transport 层 |
| `proxy-core.ts` | 共享工具：错误格式化工厂、上游 header 构建、GET 代理、URL 拼接 |
| `types.ts` | 代理层类型 re-export hub（实际类型定义在 `core/types.ts`） |
| `proxy-logging.ts` | 日志工具：header 脱敏、拦截日志、resilience 结果日志、transport 指标采集 |
| `log-helpers.ts` | DB 日志插入：`insertRejectedLog()`，携带 failover/retry 元数据 |
| `enhancement/enhancement-handler.ts` | 代理增强：指令解析、命令拦截、会话记忆 |
| `enhancement/directive-parser.ts` | 从 user 消息中提取 `$SELECT-MODEL` / `[router-model]` / `[router-command]` 标记 |
| `enhancement/response-cleaner.ts` | 清理历史消息中的路由标签 |
| `loop-prevention/` | 工具调用循环检测 + 流式循环检测（N-gram） |
| `patch/` | 上游响应修补（DeepSeek 等） |
| `strategy/` | 四种路由策略：`scheduled`（定时）、`round-robin`（轮询）、`random`（随机）、`failover`（故障转移） |

**请求处理流程（四层调用链）：**
```
Handler (handler/proxy-handler.ts)
  applyEnhancement → resolveMapping → buildHeaders
  → orchestrator.execute()
    → SemaphoreScope.acquire（队列满→503，超时→504）
    → ResilienceLayer（transportFn 循环：重试/failover 决策）
      → Transport (transport/http.ts / transport/stream.ts)
    → TrackerScope.complete
  → insertSuccessLog + collectTransportMetrics
```

**认证 `src/middleware/`：**
- `auth.ts` — 全局 `onRequest` hook，Bearer token → SHA256 哈希 → 查 `router_keys` 表。跳过 `/health`、`/admin`
- `admin-auth.ts` — JWT + Cookie 认证。跳过 `/admin/api/setup/*`、`/admin/api/login`、`/admin/api/logout`

**数据库 `src/db/`（better-sqlite3）：**
- `index.ts` — `initDatabase()` 自动创建目录、执行 `src/db/migrations/*.sql`
- 按领域拆分文件：`providers.ts`、`mappings.ts`、`logs.ts`、`metrics.ts`、`stats.ts`、`retry-rules.ts`、`router-keys.ts`、`settings.ts`、`session-states.ts`、`helpers.ts`
- `helpers.ts` 提供 `buildUpdateQuery()`（白名单过滤安全字段的通用 UPDATE）和 `deleteById()`

**数据表（19 个迁移，11 张表）：**

| 表 | 核心用途 |
|----|---------|
| `providers` | 供应商（含并发控制字段：max_concurrency、queue_timeout_ms、max_queue_size） |
| `model_mappings` | 旧版单映射（保留兼容） |
| `mapping_groups` | 映射组（strategy: scheduled/round_robin/random/failover，rule 为 JSON） |
| `retry_rules` | 重试规则（status_code + body_pattern 正则 + fixed/exponential 策略） |
| `request_logs` | 请求日志（含完整链路：client_request/upstream_request/upstream_response/client_response） |
| `request_metrics` | Token 统计（input/output/cache、ttft、tps、stop_reason） |
| `router_keys` | 客户端密钥（SHA256 哈希存储 + AES 加密原文） |
| `settings` | 系统设置（密码哈希、加密密钥、JWT 密钥、proxy_enhancement） |
| `session_model_states` | 会话模型状态（router_key_id + session_id 联合唯一） |
| `session_model_history` | 会话模型变更历史 |

**监控层 `src/monitor/`：**
- `request-tracker.ts` — `RequestTracker`：活跃请求 Map + 最近完成列表（200 条/5min TTL）+ SSE 广播（6 种事件）
- `stats-aggregator.ts` — `StatsAggregator`：环形缓冲区（1000）存储延迟样本，计算 p50/p99
- `runtime-collector.ts` — `RuntimeCollector`：采集内存、句柄、事件循环延迟

**指标采集 `src/metrics/`：**
- `sse-parser.ts` — 行缓冲 SSE 解析器，按 `\n\n` 边界切割事件
- `metrics-extractor.ts` — 按 apiType 从 SSE 事件中提取 usage/TTFT/stop_reason
- `sse-metrics-transform.ts` — Transform stream 旁路采集指标（不修改流经数据）

**管理 API `src/admin/`：**
- `routes.ts` 统一注册，按领域拆分：`providers.ts`、`mappings.ts`、`groups.ts`、`retry-rules.ts`、`logs.ts`、`stats.ts`、`metrics.ts`、`router-keys.ts`、`proxy-enhancement.ts`、`monitor.ts`
- 所有 CRUD 端点在 `/admin/api/` 下，需 JWT 认证（setup/login 除外）
- Provider 更新时同步刷新内存中的 SemaphoreManager 配置
- RetryRule 更新时自动刷新 RetryRuleMatcher 内存缓存

**工具 `src/utils/`：**
- `crypto.ts` — AES-256-GCM 加解密（格式：`iv:authTag:ciphertext`）
- `password.ts` — scrypt 密码哈希（格式：`salt:hash`）
- `token-counter.ts` — 统一 token 计数工具，基于 `gpt-tokenizer`（o200k_base）。
  提供 `countTokens(text)`（长文本采样外推）和 `estimateInputTokens(body)`（从请求体提取文本并计数）。

### 前端（Vue 3 + shadcn-vue + Tailwind CSS）

**技术栈：** Vue 3.5 + TypeScript + Vite 8 + Tailwind 3.4 + shadcn-vue 2.6 + Chart.js 4.5 + @tanstack/vue-table 8.21 + lucide-vue-next + vue-sonner

**路由（`frontend/src/router/index.ts`）：**
| 路径 | 视图 | 认证 |
|------|------|------|
| `/setup` | Setup.vue | 否 |
| `/login` | Login.vue | 否 |
| `/` | Dashboard.vue | 是 |
| `/providers` | Providers.vue | 是 |
| `/mappings` | ModelMappings.vue | 是 |
| `/retry-rules` | RetryRules.vue | 是 |
| `/router-keys` | RouterKeys.vue | 是 |
| `/proxy-enhancement` | ProxyEnhancement.vue | 是 |
| `/logs` | Logs.vue | 是 |
| `/monitor` | Monitor.vue | 是 |

**关键模式：**
- 无 Pinia/Vuex：使用 composable（`useMetrics`、`useClipboard`、`useLogs`、`useMonitorSSE`、`useMonitorData`）+ 组件本地 `ref`/`computed`
- API 客户端（`frontend/src/api/client.ts`）：axios + Cookie 认证，401 自动跳登录，`request<T>()` 解包响应
- Toast 错误处理：所有异步操作用 `vue-sonner` 的 `toast.error()`/`toast.success()`
- 并行请求用 `Promise.allSettled`（不使用 `Promise.all`）
- 设计令牌：oklch 色彩空间 + CSS 变量，支持亮/暗模式
- SSE 实时通信：Monitor 页面用原生 `EventSource`，6 种事件类型驱动 UI
- 开发时 Vite 将 `/admin/api` 代理到后端；生产时 `@fastify/static` 托管前端构建产物
- 部署在 `/admin/` base path（`vite.config.ts: base: '/admin/'`）

### 关键设计决策

- 代理使用原生 Node.js `http.request` 而非 axios，因为需要直接操作 SSE 流
- 代理层采用三层架构：Handler（路由处理）→ Orchestrator（信号量/追踪器/resilience 协调）→ Transport（HTTP 调用），替代旧的单函数 `handleProxyPost()`
- `fastify-plugin (fp)` 包装代理插件以打破 Fastify 封装，使 hook 作用于全局
- 数据库在 `initDatabase()` 时自动创建目录和执行迁移，无需手动建表
- 测试中通过 `buildApp({ config, db })` 注入内存数据库，不做 DB 层 mock
- SSE 流式代理使用 `StreamProxy` 状态机 + `SSEMetricsTransform` 旁路采集指标，不修改业务数据流
- Resilience 层统一处理重试（fixed/exponential）和 failover 决策，替代旧 `retry.ts`
- 信号量按 Provider 维度独立管理，基于 Promise 队列，支持 AbortSignal（客户端断连自动取消）
- **token 计数统一使用 `gpt-tokenizer`（o200k_base）**：禁止用字符长度估算 token 数。当 API 未返回 `input_tokens`（如部分第三方模型）时，`collectTransportMetrics()` 自动回退到 `estimateInputTokens()` 从请求体计数。
  相关文件：`src/utils/token-counter.ts`（共享工具）、`src/proxy/routing/overflow.ts`（请求 token 估算溢出）、`src/metrics/metrics-extractor.ts`（thinking 模型 text-only TPS 计算）。
  长文本（>4000 字符）采用采样外推策略避免性能问题。
- **禁止对 DB 中的 JSON 字段直接 JSON.parse**：`providers.models` 等字段存储的是 JSON 文本，数据格式会演进（如从 `string[]` 到 `ModelEntry[]`）。所有解析必须通过对应的类型安全函数（如 `parseModels()`），禁止裸 `JSON.parse`。ESLint 规则 `taste/no-raw-json-parse-models` 会强制执行此约束。

## 环境变量

所有 secrets 通过首次启动的 Setup 页面设置，存入 DB settings 表。
可选环境变量：`PORT`（默认 9981）、`DB_PATH`（默认 `~/.llm-simple-router/router.db`）、`LOG_LEVEL`、`STREAM_TIMEOUT_MS`（默认 3000000）、`RETRY_BASE_DELAY_MS`（默认 1000）

## 开发规范

### Pipeline Hook 执行路径验证

新增 PipelineHook 时，必须同时满足两个条件：
1. 在 `registerBuiltinHooks()` 中注册到 `proxyPipeline`（非 `hookRegistry` 单表）
2. 确保 `create-proxy-handler.ts` 中对应 phase 的 `proxyPipeline.emit()` 被调用

`hookRegistry` 仅为 Admin API 查询用，**不执行 hook**。只有 `proxyPipeline.emit()` 调用才会实际执行 hook。

```typescript
// 正确：同时注册到两者
hookRegistry.register(hook);
proxyPipeline.register(hook);  // 必须
```

### 新字段数据消费者检查

新增 DB 列或 metadata 字段时，必须在 spec 阶段列出所有数据消费者并逐一验证：
- DB 写入（`insertMetrics()`、`insertRequestLog()` 等）
- SSE 实时监控推送（`RequestTracker` 的 streamMetrics 等）
- Admin API 查询（`getMetricsSummary()` 等）
- 前端展示（组件取数据路径）

**任何消费者遗漏即视为 MUST FIX。**

### 测试验收标准覆盖矩阵

每个 spec 的验收标准（AC）必须有对应的测试用例。测试评审环节强制检查 AC 覆盖矩阵。

```
AC1: 开关 OFF → 测试 xxxx
AC2: 开关 ON + 无 session_id → 测试 xxxx
...
```

### 前端控件交互模式一致性

新增 UI 控件时，必须遵循页面的既有人机交互模式：
- `ProxyEnhancement.vue`：编辑→保存按钮模式，禁止 Switch/Input 直调 API
- `Dashboard.vue` / `Monitor.vue`：实时模式，允许自动刷新

### L1 Gate 执行强制化

`.xyz-harness/gate/` 下的 pass 文件必须通过 `gate-script.sh` 生成，**禁止人工创建**。

## 质量门禁

- 编译: `npm run build`
- 测试: `npm run test`
- 后端 lint: `npm run lint -w router`
- 前端 lint: `cd frontend && npx eslint . --max-warnings=0`
- 前端类型检查: `cd frontend && npx vue-tsc -b --noEmit`

## 测试

**框架：** Vitest 3.1.2，配置 `vitest.config.ts`（globals: true, environment: node）

**测试模式：**
- **组件测试**：`Fastify()` + `.register()` + `app.inject()` 模拟 HTTP 请求（不启动真实服务器）
- **内存数据库**：`initDatabase(":memory:")` 创建 SQLite 内存库，测试间完全隔离
- **Mock 后端**：`http.createServer()` 在随机端口模拟 OpenAI/Anthropic 响应
- **集成测试**：`buildApp({ config, db })` 组装完整应用
- **策略测试**：纯函数式，构造 Target/rule 对象验证 select() 返回值

**辅助函数模式**（多文件重复定义）：`createMockBackend()`、`closeServer()`、`buildTestApp()`、`insertMockBackend()`、`insertModelMapping()`

**覆盖范围（40 个测试文件）：** 加密、认证、数据库、配置、SSE 解析、指标提取、4 种路由策略、resilience 重试、并发信号量、代理转发（OpenAI/Anthropic）、Admin API（7 个 CRUD 测试）、监控、日志清理

**验收标准覆盖矩阵：** 每个 spec 的 AC 必须有至少一个测试用例覆盖。测试评审时以 AC 覆盖矩阵为依据。

## 代码质量工具

### taste-lint 自定义 ESLint 插件

项目内建 `taste-lint/` ESLint 插件（`eslint-plugin-taste`），10 条自定义规则：

| 规则 | 级别 | 说明 |
|------|------|------|
| `taste/prefer-allsettled` | warn | 独立数据源用 `Promise.allSettled` |
| `taste/no-silent-catch` | warn | catch 不能为空或仅 console |
| `taste/no-unsafe-object-entries` | warn | `Object.entries()` 后拼 SQL/配置前必须白名单过滤 |
| `taste/no-hardcoded-colors` | warn | 前端禁止 Tailwind 原始色名，必须用语义 token |
| `taste/no-magic-spacing` | warn | 前端禁止任意值间距如 `p-[17px]` |
| `taste/no-deprecated-rule-format` | warn | 禁止访问已废弃的 `rule.default` / `rule.windows` 字段 |
| `taste/no-raw-json-parse-models` | error | 禁止直接 `JSON.parse(provider.models)`，必须用 `parseModels()` |
| `taste/no-unsafe-string-conversion` | warn | 禁止对非原始类型使用 `String()`，可能输出 `[object Object]` |
| `taste/no-unbounded-while-true` | warn | `while(true)` 必须包含迭代计数器 + 上限检查 |
| `taste/no-inline-import-type` | warn | 禁止行内 `as import(...).Type`，应在文件顶部统一 import 类型 |

基础规则：`no-explicit-any: error`、`max-lines: 500`、`max-lines-per-function: 300`、`no-magic-numbers: warn`、`no-eval: error`。测试文件被排除在 lint 之外。

### 代码品味原则

以下原则自动规则难以覆盖，需要开发时自觉遵守：

| 原则 | 说明 | 反例 |
|------|------|------|
| **兜底响应** | 所有 `catch` 分支、switch default、防御性检查必须发送响应，不能让客户端挂起 | `failover-loop.ts` 缺少兜底响应 |
| **完整错误提取** | 解析上游错误响应时提取 `message` + `code` + `type` 所有字段 | `registry.ts` `transformError` 只取 message，丢了 code |
| **幂等注册** | `register()` / `registerAdapter()` 方法必须检测重复，不可静默追加 | `pipeline.ts` `register()` 允许同一 hook 重复注册 |
| **structuredClone** | 深拷贝对象用 `structuredClone()` 替代 `JSON.parse(JSON.stringify())`（Node 17+） | `context.ts`、`failover-loop.ts` 使用 JSON roundtrip |
| **SSE data 拼接** | SSE 多行 `data:` 用 `\n` 连接，不是直接拼接 | `sse-event-transform.ts` 多行 data 缺少换行符 |
| **插件过滤一致性** | Plugin 的 onError 必须与 beforeRequest 做同等的 provider 过滤 | `plugin-bridge.ts` `onError` 缺 `pluginMatches` |
| **headers 安全** | headers 写入日志前必须脱敏（authorization、cookie、x-api-key） | `failover-loop.ts` `clientReq` 未脱敏 headsers |
| **Hook 降级** | PipelineHook 的 `execute()` 必须用 try-catch 包裹，异常不得传播到调用链 | `cache-estimation.ts` 缺少降级逻辑 |
| **数据消费者完整性** | 新增数据字段时必须列出所有消费点（DB、SSE、Admin API、前端） | cache_read_tokens_estimated 漏了实时监控同步 |
| **前端控件模式一致** | 保存按钮模式页面新增控件不得直调 API | ProxyEnhancement.vue Switch 直调 API |
| **Hook 注册验证** | 新增 Hook 时除了注册到 `hookRegistry`，还需注册到 `proxyPipeline` 并验证 emit 路径 | 所有 hooks 仅注册到 hookRegistry，从未被执行 |

### 转换层类型安全规范

`src/proxy/transform/` 下的格式转换代码必须遵循以下规范，防止字段名拼写错误导致运行时 bug：

**规则 1：使用结构化类型，禁止裸 `Record<string, unknown>` 访问 API 字段**

转换函数内部必须使用 `types.ts` / `types-responses.ts` 中定义的结构化类型（如 `ResponsesApiRequest`、`ResponseInputItem`、`ChatCompletionMessage`、`AnthropicMessage`、`AnthropicContentBlock`），不得用 `Record<string, unknown>` 访问 API 字段。

```typescript
// 禁止：字段名拼错不会报编译错误
const id = (item.id ?? "") as string;  // 实际上应该是 call_id

// 正确：入口断言为结构化类型，编译器检查字段名
const req = body as unknown as ResponsesApiRequest;
for (const item of (req.input as ResponseInputItem[])) {
  if (item.type === "function_call") {
    // TypeScript discriminated union 自动收窄
    const id = item.call_id ?? item.id ?? "";  // 编译器知道这两个字段存在
  }
}
```

**规则 2：函数签名保持 `Record<string, unknown>` 不变**

导出函数的参数和返回类型保持 `Record<string, unknown>`（兼容 `format/types.ts` 的 `FormatConverter` 接口），仅在函数体内部断言为具体类型。

```typescript
// 签名不变
export function responsesToChatRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  // 入口断言
  const req = body as unknown as ResponsesApiRequest;
  // 后续全用 req.xxx
}
```

**规则 3：数组遍历使用 discriminated union 收窄**

遍历 `ResponseInputItem[]`、`AnthropicContentBlock[]`、`ResponseOutputItem[]` 等 union type 数组时，通过 `item.type` 判断后让 TypeScript 自动收窄类型，不再用 `as` 断言。

**规则 4：SSE 流式和 patch 层允许 `Record<string, unknown>`**

流式转换（`stream-*.ts`）和 patch 层（`patch/*.ts`）的数据来自上游 JSON.parse，结构不完全可控。这些文件中 `Record<string, unknown>` 是合理的，但仍应优先用具体类型。

**规则 5：`Record<string, unknown>` 白名单**

以下场景中 `Record<string, unknown>` 是合理且允许的，不视为类型安全违规：

| 场景 | 文件 | 说明 |
|------|------|------|
| 外部接口签名 | `format/types.ts` | `FormatConverter` 接口定义 `body: Record<string, unknown>`，所有转换函数签名必须兼容 |
| 输出对象构造 | `request-*.ts`, `response-*.ts` | 转换函数返回 `Record<string, unknown>`，输出对象的字段通过 `result.xxx = ...` 赋值 |
| 中间集合 | `request-bridge-responses.ts` | `pendingFnCalls`、`chatTools` 等混合了多种 tool_call 结构的集合 |
| 流式 SSE payload | `stream-*.ts`（6 个文件） | SSE `data:` 字段经 `JSON.parse` 解析，结构由上游决定 |
| Patch 层 | `patch/*.ts` | 处理上游响应，字段访问多为单值 `as string`/`as number` |
| 错误格式转换 | `response-transform.ts` `transformErrorResponse` | 错误响应结构多变，用 `Record<string, unknown>` 解构 |
| tool_choice 映射 | `mapToolChoice*` 函数 | tool_choice 格式跨 API 差异大，参数保持 `unknown` |
| PSF 扩展字段 | `request-transform.ts` | Anthropic `signature` 等非标准字段需 `as unknown as Record<string, unknown>` 写入 |
| provider_meta | `provider-meta.ts` | 跨 provider 的元数据结构不定型 |
| 插件接口 | `plugin-types.ts` | 插件数据结构由外部定义，无法预知 |
| usage 映射 | `usage-mapper.ts` | usage 字段跨 API 格式差异大，保持灵活 |
| sanitize 工具 | `sanitize.ts` | `parseToolArguments` 返回 `Record<string, unknown>`，因为 JSON.parse 结果类型不定 |

**类型定义位置：**
- Responses API 类型：`src/proxy/transform/types-responses.ts`
- Chat Completions / Anthropic 类型：`src/proxy/transform/types.ts`
- 新增 API 字段时必须同步更新对应的类型定义
- 类型定义跨文件共享时，统一放在 `types.ts` 中（如 `AnthropicRequest`），禁止在各文件中重复定义同名接口

### 前端错误处理规范

所有前端 API 调用的 `catch` 块必须同时包含两层错误处理：

```typescript
// 正确：双层错误处理
} catch (e: unknown) {
  console.error('模块名.操作名:', e)    // 开发调试：记录完整错误堆栈
  toast.error(getApiMessage(e, t('xxx')))
}

// 错误：只有 toast 没有 console
} catch (e: unknown) {
  toast.error(getApiMessage(e, t('xxx')))
}
```

| 规则 | 说明 |
|------|------|
| **console.error 在 toast 之前** | 先记录日志，再通知用户 |
| **console.error 格式** | `console.error('模块名.操作名:', e)`，模块名用 camelCase |
| **纯 JSON.parse 验证可省略 console** | 输入格式验证不是 API 错误，只需 toast 提示用户 |
| **silent catch 必须注释** | 空的 `catch {}` 必须加 `/* 原因 */` 注释 |

### Git Pre-commit Hook

`.githooks/pre-commit` 通过 `npm prepare` 自动安装，四阶段检查：

| 阶段 | 检查内容 | 跳过方式 |
|------|---------|---------|
| Prettier + ESLint | `frontend/` + `router/src/` 变更文件 | `SKIP_FRONTEND_LINT=1` / `SKIP_BACKEND_LINT=1` |
| vue-tsc | 前端 TypeScript 类型检查（全量） | `SKIP_TYPE_CHECK=1` |
| 代码规范 | `vue_rules_checker.py` + startsWith 路径前缀检查 | `SKIP_CODE_RULES_CHECK=1` |
| 全部跳过 | — | `SKIP_ALL_CHECKS=1` |

**vue_rules_checker.py 四项硬性规范：**
- 原生 HTML 元素（button/input/select/dialog/label/table 等）→ 必须用 shadcn-vue 组件（`components/ui/` 豁免）
- Emoji → 必须用 `lucide-vue-next` 图标
- 自定义 CSS → `<style scoped>` 内只允许 `@apply`，禁止手写选择器（`@keyframes`/`animation`/`transition` 例外）
- 行数上限 → `<template>` 400 行、`<script setup>` 300 行

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

## Frontend 规范：禁止使用原生 HTML 表单/交互组件

前端（`frontend/`）使用 **shadcn-vue** 组件库，**禁止**使用浏览器原生 HTML 表单和交互元素。所有 UI 组件必须使用 shadcn-vue 提供的对应组件。

| 禁止的原生元素 | 必须使用的 shadcn-vue 组件 |
|---------------|--------------------------|
| `<button>` | `<Button>` |
| `<input>` | `<Input>` |
| `<select>` + `<option>` | `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>` |
| `<table>` 系列 | `<Table>` + `<TableHeader>` + `<TableBody>` + ... |
| 手写模态框 | `<Dialog>` + `<DialogContent>` + ... |
| 手写确认弹窗 | `<AlertDialog>` + ... |
| `<span>` 状态标签 | `<Badge>` |
| `<div>` 卡片容器 | `<Card>` + `<CardHeader>` + `<CardContent>` |
| `<label>` | `<Label>` |

组件安装：`cd frontend && npx shadcn-vue@latest add <component>`

## 发布流程（一键 GitHub Actions）

项目使用 **GitHub Actions `Publish` workflow** 一键发布，**无需本地操作**。

### 发布方式

**方式一（推荐）：本地一键脚本**

```bash
bash scripts/publish.sh patch   # 或 minor / major
```

自动完成：触发 workflow → 等待完成 → 验证 npm + release + docker。

**方式二：GitHub Actions UI**

1. 打开 https://github.com/zhushanwen321/llm-simple-router/actions/workflows/publish.yml
2. 点击 **Run workflow** 按钮
3. 选择版本类型：`patch`（默认）、`minor`、`major`
4. 点击绿色 **Run workflow** 确认

Workflow 自动完成：

```
版本升级（router + core）→ commit + tag → GitHub Release
→ npm publish: @llm-router/core
→ npm publish: llm-simple-router
→ Docker 镜像推送到 GHCR
→ Release Asset 上传
```

### 发布后检查（验证机制）

发布完成后，运行以下命令验证所有产物正常：

```bash
# 1. 检查 npm 包版本
npm info @llm-router/core version && npm info llm-simple-router version
# 输出应显示最新版本号，且两个包版本一致

# 2. 检查 GitHub Release
gh release view v$(jq -r '.version' router/package.json) --json tagName,url,assets
# 应包含 llm-simple-router-linux-x64.tar.gz

# 3. 检查 CI 状态（最新 workflow 应全部绿色）
gh run list --workflow=Publish --limit 1 --json conclusion,status
# conclusion 应为 "success"

# 4. 检查 Docker 镜像（可选）
# https://github.com/zhushanwen321/llm-simple-router/pkgs/container/llm-simple-router
```

### 常见失败原因

| 失败步骤 | 原因 | 解决 |
|---------|------|------|
| Bump version | workflow 权限不足 | 确保 GITHUB_TOKEN 有 contents: write |
| Publish @llm-router/core | npm token 过期或权限不足 | 更新 NPM_TOKEN（需 bypass 2FA 权限） |
| Publish llm-simple-router | 同上 | 同上 |
| Build | TypeScript 编译错误 | 本地先通过所有检查再发布 |
| Docker build | Dockerfile 问题 | 检查 CI 日志定位具体错误 |

### 入口文件

- `src/cli.ts` — npm bin 入口（带 shebang），无条件调用 `main()` 启动服务器
- `src/index.ts` — 库入口，导出 `buildApp` 和 `main`；开发时 `tsx src/index.ts` 仍可直接运行
- 两者分离是因为 npm 通过 wrapper 脚本调用时 `process.argv[1]` 不以 `index.js` 结尾

### 版本规则

- **合并 PR 到 main 不需要更新版本号**，多个 PR 可以积攒后统一发布
- 发布时 workflow 自动升级版本，无需手动修改 `package.json`
- npm 不允许重复发布同一版本号，重复发布需 bump 到下一个版本
- `@llm-router/core` 和 `llm-simple-router` 始终保持相同版本号

## merge-worktree 对接说明

本项目的发布流程由 **GitHub Actions Publish workflow** 驱动，merge-worktree skill 执行时遵循以下规则：

### PR 提交前验证（强制）

**所有 workspace 子包都必须通过验证**，包括非本次修改的子包（如 pi-extension）。
类型错误会跨子包传播，遗漏检查会导致合并后 main 分支 CI 失败。

```bash
# 一键验证（推荐）：自动检测 monorepo，覆盖所有子包的 tsc/lint/test/build
bash ~/.pi/agent/skills/merge-worktree/pre-merge-check.sh
```

| 检查项 | 要求 |
|--------|------|
| 所有子包 tsc --noEmit | 0 error |
| lint | 0 error 0 warning |
| 单元测试 | 全部通过 |
| 构建 | router + frontend 成功 |
| Git 工作区 | 干净 + 已推送 |

### 合并流程（CLAUDE.md 脚本覆盖）

| 阶段 | 脚本/操作 | 说明 |
|------|-----------|------|
| 验证 | `bash ~/.pi/agent/skills/merge-worktree/pre-merge-check.sh` | PR push 前 + merge 前必须全部通过 |
| 合并 | `gh pr merge <num> --merge --auto` | 使用 GitHub merge，不调用 merge-worktree-release.sh |
| 发布 | `bash scripts/publish.sh <patch\|minor\|major>` | 替换 merge-worktree-release.sh，触发 Actions 发布 |
| 清理 | `bash ~/.claude/skills/merge-worktree/merge-worktree.sh <branch>` | 删除 worktree + 同步其他分支 |

**不使用 `merge-worktree-release.sh`**，因为发布全部通过 GitHub Actions 完成，无需本地 tag + release。

### 完整执行顺序

```bash
# 1. 本地验证（lint + test + build）
cd <worktree>
npm run lint && npm test && npm run build

# 2. 合并 PR
gh pr merge <num> --merge --auto

# 3. 等待 merge 完成
gh pr view <num> --json state --jq '.state'

# 4. 触发发布
bash scripts/publish.sh patch

# 5. 清理 worktree
cd <workspace-root>
bash ~/.claude/skills/merge-worktree/merge-worktree.sh <branch>
```

### 旧版脚本（备用）

仍可通过 `scripts/release.sh` 在 worktree 中手动发布（旧方式，不推荐）。

| 脚本 | 用途 |
|------|------|
| `scripts/release.sh` | 手动合并 + 版本升级 + tag + push + GitHub Release |

#### `scripts/release.sh` 执行环境

- **运行位置**：feature worktree 目录
- **前提**：所有变更已 commit 并 push、gh CLI 已登录
- **幂等**：最新 commit 含 "bump version" 时跳过版本升级；tag/release 已存在时跳过

## 已知陷阱

- `providers.models` 等 DB JSON 字段禁止裸 `JSON.parse`，必须用 `parseModels()` 等类型安全函数（ESLint 规则强制）
- `while(true)` 必须包含迭代计数器和上限检查（ESLint 规则强制）
- token 计数禁止用字符长度估算，统一使用 `gpt-tokenizer`（o200k_base）
- SSE 多行 `data:` 必须用 `\n` 连接，不能直接拼接
- 前端禁止使用原生 HTML 表单元素，必须用 shadcn-vue 组件
- 前端 `<style scoped>` 内只允许 `@apply`，禁止手写 CSS 选择器
- `structuredClone()` 替代 `JSON.parse(JSON.stringify())` 做深拷贝
- headers 写入日志前必须脱敏（authorization、cookie、x-api-key）
