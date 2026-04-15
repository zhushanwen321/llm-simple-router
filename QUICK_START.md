# Quick Start

## 环境要求

- Node.js >= 20
- npm >= 9

## 安装

```bash
# 克隆项目
git clone <repo-url>
cd llm-simple-router

# 安装后端依赖
npm install

# 安装前端依赖
cd frontend && npm install && cd ..
```

## 配置

复制环境变量文件并按需修改：

```bash
cp .env.example .env
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ROUTER_API_KEY` | API 代理认证密钥 | 必填 |
| `ADMIN_PASSWORD` | 管理后台登录密码 | 必填 |
| `ENCRYPTION_KEY` | API Key 加密密钥（64字符 hex） | 必填 |
| `PORT` | 服务端口 | 3000 |
| `DB_PATH` | SQLite 数据库路径 | ./data/router.db |
| `LOG_LEVEL` | 日志级别 | info |

## 启动

### 开发模式（前后端分离）

```bash
# 终端 1：启动后端（热重载）
npm run dev

# 终端 2：启动前端（热重载，自动代理 API 到后端）
cd frontend && npm run dev
```

- 后端：http://localhost:3000
- 前端：http://localhost:5173/admin/
- API 代理：前端开发服务器自动将 `/admin/api/*` 代理到后端

### 生产模式（前后端一体）

```bash
# 构建前端
cd frontend && npm run build && cd ..

# 构建后端
npm run build

# 复制 migrations（构建不会自动复制）
mkdir -p dist/db/migrations
cp src/db/migrations/*.sql dist/db/migrations/

# 启动（指定前端产物路径）
FRONTEND_DIST=./frontend/dist npm start
```

访问 http://localhost:3000/admin/

### Docker 模式

```bash
docker compose up -d
```

访问 http://localhost:3000/admin/

## 使用

1. 浏览器打开管理后台地址
2. 输入 `.env` 中配置的 `ADMIN_PASSWORD` 登录
3. 在「后端服务」页面添加 LLM 服务商（OpenAI / Anthropic）
4. 在「模型映射」页面配置客户端模型名到后端模型名的映射
5. 使用 `ROUTER_API_KEY` 作为 Bearer Token 调用代理 API：

```bash
# OpenAI 格式
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-router-change-me" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'

# Anthropic 格式
curl http://localhost:3000/v1/messages \
  -H "Authorization: Bearer sk-router-change-me" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3","messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'
```

## 测试

```bash
npm test
```
