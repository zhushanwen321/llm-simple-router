# LLM Simple Router

OpenAI / Anthropic 格式的 API 代理路由器。通过模型映射将请求转发到配置的后端服务，支持流式（SSE）和非流式代理。内置管理后台。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，替换以下值为自己的密钥：
#   ROUTER_API_KEY  — 客户端调用代理时使用的 API Key
#   ADMIN_PASSWORD  — 管理后台登录密码
#   ENCRYPTION_KEY  — 加密存储后端 API Key 的密钥（64 字符 hex）
#   JWT_SECRET      — 管理后台 JWT 签名密钥（64 字符 hex）

# 生成随机密钥：
openssl rand -hex 32

# 3. 启动开发服务器
npm run dev

# 4. 访问管理后台
# http://localhost:3000/admin
```

## Docker 部署

```bash
docker compose up -d
```

在 `docker-compose.yml` 中设置环境变量，或挂载 `.env` 文件。

## 常用命令

```bash
npm run dev          # 后端开发（热重载）
npm run build        # 后端构建
npm test             # 运行测试
cd frontend && npm run dev   # 前端开发
```

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `ROUTER_API_KEY` | 是 | — | 客户端 Bearer token |
| `ADMIN_PASSWORD` | 是 | — | 管理后台密码 |
| `ENCRYPTION_KEY` | 是 | — | AES-256-GCM 密钥（64字符 hex） |
| `JWT_SECRET` | 是 | — | JWT 签名密钥（64字符 hex） |
| `PORT` | 否 | `3000` | 服务端口 |
| `DB_PATH` | 否 | `./data/router.db` | SQLite 数据库路径 |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `STREAM_TIMEOUT_MS` | 否 | `30000` | 流式代理空闲超时（毫秒） |

## 使用方式

启动后，将原本发往 OpenAI/Anthropic 的请求改为发往本服务。在管理后台配置后端服务和模型映射。

```bash
# OpenAI 格式
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $ROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "hi"}]}'
```
