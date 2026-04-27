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
- `src/index.ts` — 库入口，导出 `buildApp` 和 `main`。`buildApp()` 组装所有插件，支持注入 `db`（测试用 in-memory）
- `src/config.ts` — 单例配置，惰性缓存

**`buildApp()` 插件注册顺序：**
```
seedDefaultRules → ModelStateManager.init → RetryRuleMatcher.load
→ ProviderSemaphoreManager → RequestTracker → 初始化所有 provider 并发配置
→ authMiddleware → openaiProxy → anthropicProxy → adminRoutes → fastifyStatic
```

**代理层 `src/proxy/`（三层架构：Handler → Orchestrator → Transport）：**

| 文件 | 角色 |
|------|------|
| `proxy-handler.ts` | **Handler 层**：`handleProxyRequest()` — Fastify 路由回调，负责映射解析、header 构建、日志记录，调用 Orchestrator |
| `orchestrator.ts` | **Orchestrator 层**：`ProxyOrchestrator` — 协调信号量、tracker、resilience 三大 scope，驱动重试/failover 循环 |
| `resilience.ts` | 重试决策层（替代旧 `retry.ts`）：`ResilienceLayer` + fixed/exponential 策略，判断是否重试/failover |
| `transport.ts` | **Transport 层**：底层 HTTP 调用 `callNonStream()`/`callGet()`，构建原始 `http.request` |
| `stream-proxy.ts` | SSE 流式代理引擎：`StreamProxy` 类管理缓冲状态机 + `SSEMetricsTransform` 旁路采集 |
| `scope.ts` | 信号量/追踪器 scope 包装：`SemaphoreScope`（acquire/release）+ `TrackerScope`（start/complete） |
| `proxy-logging.ts` | 日志工具：header 脱敏、拦截日志、resilience 结果日志、transport 指标采集 |
| `log-helpers.ts` | DB 日志插入：`insertSuccessLog()` / `insertRejectedLog()`，携带 failover/retry 元数据 |
| `proxy-core.ts` | 共享工具：错误格式化工厂、上游 header 构建、GET 代理。Re-export `types.ts` 和 `transport.ts` 类型 |
| `types.ts` | 代理层常量和类型：`UPSTREAM_SUCCESS`、`RawHeaders`、`TransportResult`、`ProviderSwitchNeeded` |
| `openai.ts` | OpenAI 代理插件（`POST /v1/chat/completions`、`GET /v1/models`），注入 `stream_options` |
| `anthropic.ts` | Anthropic 代理插件（`POST /v1/messages`），与 openai.ts 对称 |
| `semaphore.ts` | Provider 级并发控制：基于 Promise 的等待队列，支持 AbortSignal 和超时 |
| `retry-rules.ts` | `RetryRuleMatcher`：从 DB 加载规则到内存，按 status_code 分组缓存 |
| `enhancement-handler.ts` | 代理增强：指令解析、命令拦截、会话记忆 |
| `directive-parser.ts` | 从 user 消息中提取 `$SELECT-MODEL` / `[router-model]` / `[router-command]` 标记 |
| `model-state.ts` | `ModelStateManager` 单例：内存 + SQLite 双层缓存，24h 滑动窗口 |
| `response-cleaner.ts` | 清理历史消息中的路由标签 |
| `mapping-resolver.ts` | 将 client_model 解析为 `{ backend_model, provider_id }` |
| `strategy/` | 四种路由策略：`scheduled`（定时）、`round-robin`（轮询）、`random`（随机）、`failover`（故障转移） |

**请求处理流程（三层调用链）：**
```
Handler (proxy-handler.ts)
  applyEnhancement → resolveMapping → buildHeaders
  → orchestrator.execute()
    → SemaphoreScope.acquire（队列满→503，超时→504）
    → ResilienceLayer（transportFn 循环：重试/failover 决策）
      → Transport (transport.ts / stream-proxy.ts)
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
  相关文件：`src/utils/token-counter.ts`（共享工具）、`src/proxy/overflow.ts`（请求 token 估算溢出）、`src/metrics/metrics-extractor.ts`（thinking 模型 text-only TPS 计算）。
  长文本（>4000 字符）采用采样外推策略避免性能问题。

## 环境变量

所有 secrets 通过首次启动的 Setup 页面设置，存入 DB settings 表。
可选环境变量：`PORT`（默认 9981）、`DB_PATH`（默认 `~/.llm-simple-router/router.db`）、`LOG_LEVEL`、`STREAM_TIMEOUT_MS`（默认 3000000）、`RETRY_BASE_DELAY_MS`（默认 1000）

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

## 代码质量工具

### taste-lint 自定义 ESLint 插件

项目内建 `taste-lint/` ESLint 插件（`eslint-plugin-taste`），5 条自定义规则：

| 规则 | 级别 | 说明 |
|------|------|------|
| `taste/prefer-allsettled` | warn | 独立数据源用 `Promise.allSettled` |
| `taste/no-silent-catch` | warn | catch 不能为空或仅 console |
| `taste/no-unsafe-object-entries` | warn | `Object.entries()` 后拼 SQL/配置前必须白名单过滤 |
| `taste/no-hardcoded-colors` | warn | 前端禁止 Tailwind 原始色名，必须用语义 token |
| `taste/no-magic-spacing` | warn | 前端禁止任意值间距如 `p-[17px]` |

基础规则：`no-explicit-any: error`、`max-lines: 500`、`max-lines-per-function: 300`、`no-magic-numbers: warn`、`no-eval: error`。测试文件被排除在 lint 之外。

### Git Pre-commit Hook

`.githooks/pre-commit` 通过 `npm prepare` 自动安装，两阶段检查：

| 阶段 | 检查内容 | 跳过方式 |
|------|---------|---------|
| ESLint | `frontend/` 下变更的 `.vue`/`.ts` 文件 | `SKIP_FRONTEND_LINT=1` |
| 代码规范 | `vue_rules_checker.py`（见下） | `SKIP_CODE_RULES_CHECK=1` |
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

## npm 发布流程

项目已发布到 npm（`llm-simple-router`），用户可通过 `npx llm-simple-router` 或 `npm install -g llm-simple-router` 使用。

### 入口文件

- `src/cli.ts` — npm bin 入口（带 shebang），无条件调用 `main()` 启动服务器
- `src/index.ts` — 库入口，导出 `buildApp` 和 `main`；开发时 `tsx src/index.ts` 仍可直接运行
- 两者分离是因为 npm 通过 wrapper 脚本调用时 `process.argv[1]` 不以 `index.js` 结尾

### 版本与发布规则

- **合并 PR 到 main 不需要更新版本号**，多个 PR 可以积攒后统一发布
- **发布流程**：更新 `package.json` 的 `version` → 推送到 main → 在 GitHub 创建 Release → CI 自动 `npm publish`
- **构建命令**：`npm run build:full`（tsc + 复制 migrations + 构建前端）；`prepublishOnly` 会自动执行前端构建
- npm 不允许重复发布同一版本号，发布前必须 bump version
