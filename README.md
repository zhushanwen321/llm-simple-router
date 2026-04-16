# LLM Simple Router

> **Status: Active Development**
>
> 核心代理、模型映射、自动重试、多密钥管理、请求日志、性能指标已完成。
> 代码规范 githook 检查已集成。欢迎试用和反馈。

解决个人使用 Claude Code 配合国产模型时的实际痛点：

- **自动重试** — 国产模型限流、网络错误频繁，对可恢复错误（429/500/网络超时）自动指数退避重试
- **多供应商模型映射** — 高峰期主模型不可用时，将 claude-opus 映射到 GLM，claude-sonnet 映射到 Kimi 等，低谷期再切回来
- **多密钥隔离** — 为不同使用方分配独立密钥，按密钥筛选日志和性能指标

## 功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 模型映射 | Done | 客户端模型名 -> 后端模型名 + 供应商，支持 OpenAI / Anthropic 格式 |
| 自动重试 | Done | 429/500/网络错误自动重试，指数退避，可配置次数和间隔 |
| 多供应商 | Done | 配置多个后端供应商，按模型映射路由 |
| 多密钥 (Router Keys) | Done | 为不同使用方创建独立密钥，支持模型白名单 |
| 流式代理 | Done | 完整支持 SSE 流式和非流式请求 |
| AES-256-GCM 加密 | Done | 后端 API Key 加密存储，可逆解密 |
| 管理后台 | Done | Vue 3 + shadcn-vue Web UI，管理供应商、映射、密钥 |
| 请求日志 | Done | 记录完整四阶段链路（客户端请求/上游请求/上游响应/客户端响应） |
| 性能指标 | Done | TTFT、吞吐量、Token 用量、缓存命中率，支持按模型/密钥筛选 |
| 代码规范检查 | Done | githook pre-commit 自动检查 ESLint + Vue 组件规范 |

## 工作原理

```
Claude Code -> Router (模型映射 + 自动重试) -> 智谱 GLM / Kimi / 其他供应商
```

Router 根据模型映射找到后端供应商 -> 解密 API Key 转发请求 -> 自动重试失败请求 -> 记录日志和性能指标 -> 返回响应。

## 典型使用场景

Claude Code 中配置 `.claude/settings.json`：

```json
{
  "apiProvider": "openai-compatible",
  "apiKey": "sk-router-xxx",
  "apiBaseUrl": "http://localhost:3000/v1"
}
```

在管理后台配置模型映射：

| 客户端模型 | 后端模型 | 供应商 |
|-----------|---------|--------|
| claude-opus-4-20250514 | glm-4-plus | 智谱 |
| claude-sonnet-4-20250514 | kimi-k2-0711 | Moonshot |

高峰期 GLM 频繁超限时，将 sonnet 切到 Kimi；低谷期切回 GLM。

## 快速开始

```bash
npm install
cp .env.example .env
# 编辑 .env，设置 ADMIN_PASSWORD、ENCRYPTION_KEY、JWT_SECRET
npm run dev
# 访问 http://localhost:3000/admin
```

生成随机密钥：`openssl rand -hex 32`

## Docker 部署

```bash
docker compose up -d
```

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `ADMIN_PASSWORD` | Yes | -- | 管理后台密码 |
| `ENCRYPTION_KEY` | Yes | -- | AES-256-GCM 密钥（64字符 hex） |
| `JWT_SECRET` | Yes | -- | JWT 签名密钥（64字符 hex） |
| `PORT` | No | `3000` | 服务端口 |
| `DB_PATH` | No | `./data/router.db` | SQLite 数据库路径 |
| `LOG_LEVEL` | No | `info` | 日志级别 |
| `TZ` | No | -- | 时区设置 |
| `STREAM_TIMEOUT_MS` | No | `3000000` | 流式代理空闲超时（ms） |
| `RETRY_MAX_ATTEMPTS` | No | `3` | 最大重试次数 |
| `RETRY_BASE_DELAY_MS` | No | `1000` | 重试基础延迟（ms） |

> `ROUTER_API_KEY` 已弃用，请从管理后台创建 Router Key。

## 开发

```bash
npm run dev                          # 后端开发（热重载）
npm run build && npm start           # 构建 + 启动
npm test                             # 运行测试
cd frontend && npm run dev           # 前端开发（代理到后端 :3000）
cd frontend && npm run build         # 前端构建
```

前后端需分别启动。开发时 Vite 自动将 `/admin/api` 请求代理到后端 :3000。

### 代码规范

项目使用 pre-commit githook 自动检查代码质量：

```bash
npm run prepare    # 安装 githook（npm install 时自动执行）
```

检查项：
- ESLint 自动修复 + 检查
- Vue 组件规范（禁止原生 HTML 交互元素、Emoji、自定义 CSS）

跳过检查：`SKIP_ALL_CHECKS=1 git commit ...`

## 架构

```
src/
  index.ts          # 入口，buildApp()
  config.ts         # 环境变量解析
  proxy/            # 代理插件（openai.ts / anthropic.ts）
  middleware/       # 认证中间件（auth.ts / admin-auth.ts）
  admin/            # 管理 API（routes / services / mappings / logs / stats / router-keys）
  db/               # 数据库（better-sqlite3 + 迁移）
  utils/            # 工具函数（crypto / logger）
frontend/
  src/
    api/            # API 客户端（axios）
    views/          # 页面组件
    components/ui/  # shadcn-vue 组件库
    router/         # 路由配置
```

代理使用原生 `http.request` 而非 axios（需要直接操作 SSE 流）。测试通过 `buildApp({ db: inMemoryDb })` 注入内存数据库，无需 mock。

## 管理 API

基础路径 `/admin/api`，需 Cookie JWT 认证。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /admin/api/auth/login | 登录 |
| POST | /admin/api/auth/logout | 登出 |
| GET | /admin/api/auth/check | 检查登录状态 |
| GET/POST | /admin/api/providers | 供应商 CRUD |
| GET/POST | /admin/api/mappings | 模型映射 CRUD |
| GET/POST | /admin/api/router-keys | Router Key CRUD |
| GET | /admin/api/logs | 请求日志（分页/筛选） |
| GET | /admin/api/logs/stats | 聚合统计 |
| GET | /admin/api/logs/metrics | 性能指标 |

代理接口（需 Bearer token）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /v1/chat/completions | OpenAI 格式代理 |
| POST | /v1/messages | Anthropic 格式代理 |
| GET | /v1/models | 模型列表 |
| GET | /health | 健康检查 |
