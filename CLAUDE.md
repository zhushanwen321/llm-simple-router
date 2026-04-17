# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

LLM API 代理路由器。接收 OpenAI / Anthropic 格式的客户端请求，通过模型映射转发到配置的后端服务，支持流式（SSE）和非流式代理。管理后台（Vue 3 + shadcn-vue）提供后端服务管理、模型映射配置、请求日志查看等功能。

## 常用命令

```bash
# 后端开发（热重载）
npm run dev

# 后端构建 & 启动
npm run build
mkdir -p dist/db/migrations && cp src/db/migrations/*.sql dist/db/migrations/
FRONTEND_DIST=./frontend/dist npm start

# 前端开发（自动代理 /admin/api 到后端 :3000）
cd frontend && npm run dev

# 前端构建
cd frontend && npm run build

# 测试
npm test              # 全部测试
npx vitest run tests/auth.test.ts  # 单个测试文件
npm run test:watch    # 监听模式

# Docker
docker compose up -d
```

## 架构

### 后端（Fastify + SQLite）

- **入口** `src/index.ts` — `buildApp()` 组装所有插件，支持注入 `db`（测试用 in-memory）
- **代理层** `src/proxy/openai.ts` / `anthropic.ts` — 各自是 Fastify 插件，包含非流式 `proxyNonStream()` 和流式 `proxyStream()` 两个代理函数。流式代理使用 `PassThrough` 管道 + 空闲超时，防止连接泄漏和 EPIPE 崩溃
- **认证** `src/middleware/auth.ts` — 全局 `onRequest` hook，对非 `/health`、`/admin` 路径校验 Bearer token。`admin-auth.ts` 使用 JWT + Cookie 做管理后台认证
- **数据库** `src/db/index.ts` — better-sqlite3，迁移文件在 `src/db/migrations/`，启动时自动执行。所有 CRUD 和查询函数都在此文件
- **管理 API** `src/admin/` — 按 `routes.ts` → `services.ts` / `mappings.ts` / `logs.ts` / `stats.ts` 拆分
- **加密** `src/utils/crypto.ts` — AES-256-GCM 加解密后端 API Key

### 请求流程

```
客户端 → auth middleware (Bearer token 校验)
       → proxy handler (查找后端服务 → 模型映射 → 解密 API Key → 转发请求)
       → 插入 request_logs（含完整请求链路：client_request / upstream_request / upstream_response / client_response）
       → 响应客户端
```

### 前端（Vue 3 + shadcn-vue + Tailwind CSS）

- 路由在 `frontend/src/router/index.ts`，所有管理页面在 `/admin/*` 下
- API 客户端在 `frontend/src/api/client.ts`，使用 axios
- 开发时 Vite 将 `/admin/api` 代理到后端；生产时前端构建产物由后端 `@fastify/static` 托管
- 所有 UI 组件使用 **shadcn-vue**，禁止原生 HTML 表单元素（见下方规范）

### 关键设计决策

- 代理使用原生 Node.js `http.request` 而非 axios，因为需要直接操作 SSE 流
- `fastify-plugin (fp)` 包装代理插件以打破 Fastify 封装，使 hook 作用于全局
- 数据库在 `initDatabase()` 时自动创建目录和执行迁移，无需手动建表
- 测试中通过 `buildApp({ db: inMemoryDb })` 注入内存数据库，无需 mock

## 环境变量

必需：`ADMIN_PASSWORD`、`ENCRYPTION_KEY`（64字符 hex）、`JWT_SECRET`（64字符 hex）
可选：`PORT`（默认 3000）、`DB_PATH`、`LOG_LEVEL`、`STREAM_TIMEOUT_MS`（默认 30000）
参考 `.env.example`

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
