# LLM Simple Router

解决个人使用 Claude Code 配合国产模型时的实际痛点：

- **自动重试** — 国产模型限流、网络错误频繁，对可恢复错误（429/500/网络超时）自动指数退避重试
- **多供应商模型映射** — 高峰期主模型不可用时，将 claude-opus 映射到 GLM，claude-sonnet 映射到 Kimi 等，低谷期再切回来
- **多密钥隔离** — 为不同使用方分配独立密钥，按密钥筛选日志和性能指标

## 工作原理

Claude Code 发出的 API 请求 → Router 根据模型映射找到后端供应商 → 解密 API Key 转发请求 → 自动重试失败请求 → 记录日志和性能指标 → 返回响应。

```
Claude Code → Router (模型映射 + 自动重试) → 智谱 GLM / Kimi / 其他供应商
```

## 功能

| 功能 | 说明 |
|------|------|
| 模型映射 | 客户端模型名 → 后端模型名 + 供应商，支持 OpenAI / Anthropic 格式 |
| 自动重试 | 429/500/网络错误自动重试，指数退避，可配置次数和间隔 |
| 多供应商 | 配置多个后端供应商，按模型映射路由 |
| 多密钥 | 为不同使用方创建独立密钥，支持模型白名单 |
| 流式代理 | 完整支持 SSE 流式和非流式请求 |
| 管理后台 | Vue 3 Web UI，管理供应商、映射、密钥，查看日志和性能图表 |
| 请求日志 | 记录完整请求链路（请求/响应/上游/耗时/错误） |
| 性能指标 | TTFT、吞吐量、Token 用量、缓存命中率等，支持按模型/密钥筛选 |

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

高峰期（14:00-18:00）GLM 频繁超限时，将 sonnet 切到 Kimi；低谷期切回 GLM。

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
| `ADMIN_PASSWORD` | 是 | — | 管理后台密码 |
| `ENCRYPTION_KEY` | 是 | — | AES-256-GCM 密钥（64字符 hex） |
| `JWT_SECRET` | 是 | — | JWT 签名密钥（64字符 hex） |
| `PORT` | 否 | `3000` | 服务端口 |
| `DB_PATH` | 否 | `./data/router.db` | SQLite 数据库路径 |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `STREAM_TIMEOUT_MS` | 否 | `3000000` | 流式代理空闲超时（ms） |
| `RETRY_MAX_ATTEMPTS` | 否 | `3` | 最大重试次数 |
| `RETRY_BASE_DELAY_MS` | 否 | `1000` | 重试基础延迟（ms） |

## 开发

```bash
npm run dev                          # 后端开发（热重载）
npm run build && npm start           # 构建 + 启动
npm test                             # 运行测试
cd frontend && npm run dev           # 前端开发（代理到后端 :3000）
cd frontend && npm run build         # 前端构建
```
