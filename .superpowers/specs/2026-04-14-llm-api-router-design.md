# LLM Simple Router - 设计文档

## 概述

LLM Simple Router（R）是一个 LLM API 透传路由器，位于客户端（C）和 LLM 服务端（S）之间。它同时提供 OpenAI 和 Anthropic 兼容的 API 接口，根据客户端请求的 API 格式，以相同格式转发到配置的后端服务，实现出入参透传。

## 核心需求

| # | 需求 | 说明 |
|---|------|------|
| 1 | 双协议 API | 同时提供 OpenAI 兼容和 Anthropic 兼容的 API |
| 2 | 双协议转发 | 能够调用 OpenAI 兼容和 Anthropic 兼容的后端服务 |
| 3 | 协议匹配透传 | OpenAI 请求转发到 OpenAI 后端，Anthropic 请求转发到 Anthropic 后端，出入参透传 |
| 4 | 独立认证 | 路由器提供自己的 API Key，客户端使用此密钥认证 |
| 5 | SSE 流式 | 必须支持 Chat Completion 的 SSE 流式响应 |
| 6 | 模型映射 | 支持客户端模型名到后端模型名的映射 |
| 7 | Web 管理 | 提供动态配置管理的 Web 界面 |
| 8 | Docker 部署 | 以 Docker 容器形式部署 |

## 技术栈

| 层级 | 技术选型 | 理由 |
|------|---------|------|
| HTTP 框架 | Fastify | 高性能，原生 async/stream 支持 |
| 语言 | TypeScript | 类型安全 |
| 数据库 | SQLite (better-sqlite3) | 单文件，无需额外服务 |
| 前端 | Vue 3 + Tailwind CSS v3 + shadcn-vue | 用户指定 |
| 部署 | Docker 多阶段构建 | 镜像精简 |

## 架构

```
┌─────────────┐         ┌─────────────────────────────────┐         ┌─────────────┐
│  Client (C) │◄──────► │         Router (R)              │◄──────► │  Server (S) │
│             │         │                                 │         │             │
│ OpenAI 格式 │  HTTP   │  ┌──────────┐  ┌─────────────┐  │  HTTP   │ OpenAI 格式 │
│ Anthropic格式│ ◄─────►│  │API 代理层│  │  管理层     │  │◄──────► │ Anthropic格式│
│             │         │  └──────────┘  └─────────────┘  │         │             │
│             │         │  ┌──────────┐  ┌─────────────┐  │         │             │
│             │         │  │ 认证中间件│  │  SQLite     │  │         │             │
│             │         │  └──────────┘  └─────────────┘  │         │             │
└─────────────┘         └─────────────────────────────────┘         └─────────────┘
```

### 设计原则

1. **透传代理**：不解析请求体中的业务字段（除 `model`），直接转发请求和响应
2. **协议匹配**：请求路径决定转发目标，`/v1/chat/completions`、`/v1/models` → OpenAI，`/v1/messages` → Anthropic
3. **路径隔离**：代理路径（`/v1/*`）与管理路径（`/admin/*`）完全分离

## 数据模型

### backend_services - 后端服务配置

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| name | TEXT | NOT NULL | 服务名称 |
| api_type | TEXT | NOT NULL | `openai` 或 `anthropic` |
| base_url | TEXT | NOT NULL | 后端服务地址 |
| api_key | TEXT | NOT NULL | 后端 API Key（AES-256-GCM 加密存储） |
| is_active | BOOLEAN | DEFAULT true | 是否启用 |
| created_at | TEXT | NOT NULL | 创建时间（ISO 8601） |
| updated_at | TEXT | NOT NULL | 更新时间（ISO 8601） |

### model_mappings - 模型名映射

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| client_model | TEXT | NOT NULL, UNIQUE | 客户端模型名（唯一，一对一映射） |
| backend_model | TEXT | NOT NULL | 后端模型名 |
| backend_service_id | TEXT | FK → backend_services.id | 关联后端服务 |
| is_active | BOOLEAN | DEFAULT true | 是否启用 |
| created_at | TEXT | NOT NULL | 创建时间 |

### request_logs - 请求日志

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | UUID |
| api_type | TEXT | NOT NULL | `openai` 或 `anthropic` |
| model | TEXT | | 使用的模型名 |
| backend_service_id | TEXT | FK → backend_services.id | 转发的后端服务 |
| status_code | INTEGER | | HTTP 状态码 |
| latency_ms | INTEGER | | 响应延迟（毫秒） |
| is_stream | BOOLEAN | | 是否流式请求 |
| error_message | TEXT | | 错误信息 |
| created_at | TEXT | NOT NULL | 请求时间 |

### 认证配置

路由器的全局 API Key 通过环境变量 `ROUTER_API_KEY` 配置，不存储在数据库中。后端服务的 API Key 使用 AES-256-GCM 加密后存储在 `backend_services` 表中，加密密钥通过 `ENCRYPTION_KEY` 环境变量配置。

## API 代理层流程

```
Client 请求
  → [1] 认证中间件：验证 API Key
  → [2] 路由匹配：根据路径判断 API 类型
  → [3] 查找后端服务：匹配 api_type 且 is_active=true（多个匹配时取第一个，后续可扩展负载均衡）
  → [4] 模型映射：查找 model_mappings，替换 model 字段
  → [5] 转发请求：替换认证头，修改 URL，保持 body 不变
  → [6] 响应处理：非流式直接返回 JSON，流式 SSE pipe 转发
  → [7] 记录日志：异步写入 request_logs
```

### SSE 流式转发

- 使用 Node.js PassThrough stream 逐 chunk 转发
- 后端中断时发送 `data: [DONE]` 优雅关闭
- 默认空闲超时 30 秒，可通过 `STREAM_TIMEOUT_MS` 环境变量配置
- 超时后关闭连接，客户端收到连接断开

### 错误处理

**核心原则：尽量透传原始错误。** 后端服务返回的错误响应（状态码 + body）应原样转发给客户端，不做格式转换或包装。只有路由器自身产生的错误（认证、后端未配置等）才需要自行构造响应，且尽量匹配对应协议的错误格式。

| 场景 | 状态码 | 响应 |
|------|--------|------|
| 认证失败 | 401 | 按 OpenAI/Anthropic 错误格式返回 |
| 后端不可达 | 502 | 透传网络错误信息 |
| 后端返回错误 | 透传 | 原样转发后端的状态码和响应体 |
| 后端服务未配置 | 404 | 提示信息 |
| 请求体解析失败 | 透传 | 尽量将请求直接转发到后端，由后端返回错误 |

## 管理接口

### REST API（路径前缀 `/admin/api/`）

#### 后端服务管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/services` | GET | 列出所有后端服务 |
| `/services` | POST | 添加后端服务 |
| `/services/:id` | PUT | 更新后端服务 |
| `/services/:id` | DELETE | 删除后端服务 |

#### 模型映射管理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/mappings` | GET | 列出所有模型映射 |
| `/mappings` | POST | 添加模型映射 |
| `/mappings/:id` | PUT | 更新模型映射 |
| `/mappings/:id` | DELETE | 删除模型映射 |

#### 日志与统计

| 接口 | 方法 | 说明 |
|------|------|------|
| `/logs` | GET | 查询请求日志（支持分页、过滤） |
| `/logs/before` | DELETE | 清理指定时间之前的日志 |
| `/stats` | GET | 统计概览 |

### 管理界面认证

- 独立的 `ADMIN_PASSWORD` 环境变量
- 登录后通过 JWT token 维持会话
- JWT 过期时间 24 小时，通过 HttpOnly cookie 传递
- 不支持刷新，过期后重新登录

### Vue 3 SPA 页面

| 页面 | 功能 |
|------|------|
| Dashboard | 仪表盘：请求统计、延迟图表 |
| Services | 后端服务 CRUD（含 API Key 管理） |
| ModelMappings | 模型映射配置 |
| Logs | 请求日志查看 |
| Login | 登录页 |

Vue 3 SPA 构建后由 Fastify `@fastify/static` 在 `/admin/` 路径下提供服务。

## 项目结构

```
llm-simple-router/
├── src/                        # 后端源码（TypeScript）
│   ├── index.ts                # 入口
│   ├── config.ts               # 环境变量解析
│   ├── db/
│   │   ├── index.ts            # SQLite 初始化
│   │   └── migrations/         # 数据库迁移脚本
│   ├── proxy/
│   │   ├── openai.ts           # OpenAI 格式代理
│   │   └── anthropic.ts        # Anthropic 格式代理
│   ├── admin/
│   │   ├── routes.ts           # 管理 API 路由
│   │   ├── services.ts         # 后端服务 CRUD
│   │   ├── mappings.ts         # 模型映射 CRUD
│   │   └── logs.ts             # 日志查询与清理
│   ├── middleware/
│   │   ├── auth.ts             # 客户端认证
│   │   └── admin-auth.ts       # 管理界面认证
│   └── utils/
│       ├── logger.ts           # 日志工具
│       └── crypto.ts           # 加密/解密工具（AES-256-GCM）
├── frontend/                   # Vue 3 前端
│   ├── src/
│   │   ├── views/              # 页面组件
│   │   ├── components/         # shadcn-vue 组件
│   │   ├── api/                # API 调用封装
│   │   └── router/             # Vue Router
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── Dockerfile                  # 多阶段构建
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── .env.example
```

## Docker 部署

### 环境变量

```env
# 必需
ROUTER_API_KEY=sk-router-xxxxx        # 客户端认证密钥
ADMIN_PASSWORD=admin123               # 管理界面密码
ENCRYPTION_KEY=                       # 后端 API Key 加密密钥（32 字节 hex）

# 可选
PORT=3000                             # 监听端口
DB_PATH=./data/router.db             # SQLite 数据库路径
LOG_LEVEL=info                        # 日志级别
TZ=Asia/Shanghai                     # 时区设置
STREAM_TIMEOUT_MS=30000              # SSE 流式空闲超时（毫秒）
```

### Dockerfile 要点

- 三阶段构建：前端构建 → 后端构建 → 运行时
- 运行时镜像基于 `node:20-alpine`
- 安装 `tzdata` 包，默认时区 `Asia/Shanghai`
- 前端静态文件通过 COPY 注入
- 暴露端口 3000

### docker-compose.yml 要点

- 设置 `TZ=Asia/Shanghai` 环境变量
- 使用 volume 持久化 SQLite 数据库文件
- 支持 `.env` 文件加载敏感配置

## 分步实施计划

项目分为两个阶段：

### 阶段 1：核心代理

| 步骤 | 内容 | 验收标准 |
|------|------|---------|
| 1.1 | 项目脚手架搭建（TypeScript + Fastify） | 服务器启动，监听配置端口 |
| 1.2 | SQLite 数据库初始化与迁移 | 三张表创建成功，迁移脚本可重复执行 |
| 1.3 | API Key 认证中间件 | 无效 Key 返回 401，有效 Key 放行 |
| 1.4 | OpenAI 格式代理（含 SSE 流式） | 非流式和流式请求均能正确透传 |
| 1.5 | Anthropic 格式代理（含 SSE 流式） | 非流式和流式请求均能正确透传 |
| 1.6 | 模型映射功能 | 模型名正确替换，无映射时原样透传 |
| 1.7 | 请求日志记录 | 异步写入数据库，不影响请求延迟 |
| 1.8 | `/v1/models` 代理 | OpenAI 模型列表请求正确透传到后端 |
| 1.9 | Docker 构建配置 | 镜像构建成功，容器启动正常 |

### 阶段 2：管理界面

| 步骤 | 内容 | 验收标准 |
|------|------|---------|
| 2.1 | 管理 REST API 实现 | 所有 CRUD 接口通过测试 |
| 2.2 | Vue 3 前端项目初始化 | 开发服务器启动，页面可访问 |
| 2.3 | 登录页 + JWT 认证 | 登录/登出流程正常，token 过期自动跳转 |
| 2.4 | 后端服务管理页面 | 增删改查功能正常，含 API Key 展示 |
| 2.5 | 模型映射管理页面 | 增删改查功能正常 |
| 2.6 | 仪表盘（统计概览） | 展示请求统计和延迟图表 |
| 2.7 | 请求日志查看页面 | 分页、过滤功能正常 |
| 2.8 | 集成测试与 Docker 多阶段构建 | 前后端集成正常，镜像构建并运行 |
