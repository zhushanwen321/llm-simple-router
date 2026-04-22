# 零配置启动设计

## 目标

用户执行 `npx llm-simple-router` 后，打开浏览器访问 `http://localhost:9981/admin`，看到 Setup 页面设置密码即可开始使用。无需预先创建 `.env` 文件或设置环境变量。

## 数据目录

默认路径从 `./data/router.db` 改为 `~/.llm-simple-router/router.db`。启动时自动创建目录。所有状态（数据库、配置）统一存放。

**迁移策略**：如果 `DB_PATH` 环境变量已设置（Docker 场景），使用环境变量。否则检测 `./data/router.db` 是否已存在，存在则继续使用旧路径。两者都不存在时使用新默认路径 `~/.llm-simple-router/router.db`。

## 新增 settings 表

Migration SQL：
```sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

存储内容：
- `admin_password_hash` — `scryptSync(password, salt, 64)` 生成的 hash，格式 `salt_hex:hash_hex`
- `encryption_key` — 自动生成的 64 字符 hex
- `jwt_secret` — 自动生成的 64 字符 hex
- `initialized` — 标记 `"true"` 表示初始化完成

## 配置加载 — 两阶段启动

解决 Config 与 DB 初始化的循环依赖（鸡生蛋问题）：

**阶段 1：最小 Config（同步）**

`getConfig()` 拆分为两部分：
- `getBaseConfig()` — 只读 PORT、DB_PATH、LOG_LEVEL 等无需 secrets 的字段，不校验 required vars，同步函数
- DB_PATH 的默认值改为 `~/.llm-simple-router/router.db`（遵循上述迁移策略）

**阶段 2：从 DB 加载 Secrets（同步，DB 就绪后）**

新增 `loadSettingsToConfig(db)` 函数：
1. DB 初始化后调用
2. 查询 `settings` 表中 `encryption_key`、`jwt_secret`
3. 合并到 Config 缓存：环境变量 > settings 表 > 占位值
4. 如果 settings 表中也没有 → Config 中这些字段为空字符串，标记 `needsSetup = true`
5. `getConfig()` 保持同步

## 配置优先级

```
环境变量 > settings 表 > 代码默认值
```

Docker 部署通过环境变量覆盖 DB 配置，完全向后兼容。

## 密码校验双路径

- **环境变量模式**（`ADMIN_PASSWORD` 存在）：`timingSafeEqual` 明文对比（现有逻辑不变）
- **DB 模式**（`ADMIN_PASSWORD` 不存在）：从 settings 表读 `admin_password_hash`，用 scrypt 验证

## Setup 模式

### 后端 API

1. **`GET /admin/api/setup/status`** — 返回 `{ initialized: boolean }`
2. **`POST /admin/api/setup/initialize`** — 接收 `{ password }`（最少 6 位），**在 DB 事务中**：
   - 再次检查 `initialized` 值，防止竞态（原子操作）
   - `crypto.randomBytes(32).toString("hex")` 生成 encryption_key 和 jwt_secret
   - 存储 admin_password_hash（scrypt + 随机 salt）、encryption_key、jwt_secret、`initialized=true`
   - 调用 `loadSettingsToConfig(db)` 刷新运行时 Config
   - 返回成功

### 鉴权调整

admin-auth middleware 增加 Setup 模式判断：
- `initialized` 为 false → 只放行 `/admin/api/setup/*`，其他 `/admin/api/*` 返回 401 + `{ needsSetup: true }`
- `initialized` 为 true → 保持现有鉴权逻辑
- **代理层**（`/v1/*`）：Setup 模式下返回 503 + `{ error: "Service not initialized" }`，因为此时没有 ENCRYPTION_KEY

### 代理 API Key

代理层认证（`src/middleware/auth.ts`）使用 `router_keys` 表中的 key，不依赖环境变量。Setup 模式下代理层返回 503，用户需先完成初始化再在管理后台创建 Router Key。

### 前端

新增 Setup 页面（`/admin/setup`）：
- 使用 Vue Router `beforeEach` 全局守卫，在路由加载时检查 `/setup/status`
- `initialized: false` → 重定向到 Setup 页面（避免登录页闪烁）
- Setup 页面：输入密码 + 确认密码，提交后自动跳转到登录页
- `initialized: true` → 现有登录流程不变

## 不变的部分

- 代理层核心逻辑（proxy-core、openai、anthropic）完全不变
- Docker 部署方式完全兼容（环境变量优先）
- 现有前端页面不变，只新增 Setup 页面
- 已有数据库的用户升级时：新 migration 创建 settings 表，但环境变量仍在生效，无需重新配置
