# 零配置启动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx llm-simple-router` 后打开浏览器设置密码即可使用，无需环境变量。

**Architecture:** 两阶段启动 — 先用基础配置初始化 DB，再从 settings 表加载密钥。Setup 模式通过 `initialized` 标志控制。

**Tech Stack:** Node.js crypto (scryptSync)、SQLite settings 表、Vue 3 Setup 页面

---

### Task 1: 新增 settings migration + DB CRUD

**Files:**
- Create: `src/db/migrations/014_create_settings.sql`
- Create: `src/db/settings.ts`
- Modify: `src/db/index.ts` (添加 re-export)

- [ ] **创建 migration**

```sql
-- src/db/migrations/014_create_settings.sql
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **创建 src/db/settings.ts**

```typescript
import Database from "better-sqlite3";

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function isInitialized(db: Database.Database): boolean {
  return getSetting(db, "initialized") === "true";
}
```

- [ ] **在 src/db/index.ts 添加 re-export**

在 re-export 区域添加:
```typescript
export { getSetting, setSetting, isInitialized } from "./settings.js";
```

- [ ] **运行测试确认 migration 不影响现有功能**

Run: `npm test`
Expected: 全部通过（新 migration 会被自动执行）

- [ ] **Commit**

```bash
git add src/db/migrations/014_create_settings.sql src/db/settings.ts src/db/index.ts
git commit -m "feat(db): add settings table for persistent config"
```

---

### Task 2: 两阶段 config.ts 重构

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`

- [ ] **重写 src/config.ts**

核心变更：
- `getBaseConfig()` — 读取 PORT、DB_PATH（默认 `~/.llm-simple-router/router.db`）、LOG_LEVEL 等，不校验 secrets
- `loadSettingsToConfig(db)` — 从 settings 表加载 secrets，合并到缓存
- `getConfig()` — 返回合并后的完整 Config，保持同步
- `Config` 新增 `needsSetup: boolean` 字段
- DB_PATH 迁移策略：环境变量 > `./data/router.db` 已存在 > `~/.llm-simple-router/router.db`

```typescript
import "dotenv/config";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

export interface Config {
  ADMIN_PASSWORD: string;
  ENCRYPTION_KEY: string;
  JWT_SECRET: string;
  PORT: number;
  DB_PATH: string;
  LOG_LEVEL: string;
  TZ: string;
  STREAM_TIMEOUT_MS: number;
  RETRY_MAX_ATTEMPTS: number;
  RETRY_BASE_DELAY_MS: number;
  needsSetup: boolean;
}

let cachedConfig: Config | null = null;

function getDefaultDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const localPath = "./data/router.db";
  if (existsSync(localPath)) return localPath;
  return join(homedir(), ".llm-simple-router", "router.db");
}

export function resetConfig(): void {
  cachedConfig = null;
}

// 阶段1：基础配置，不校验 secrets
export function getBaseConfig(): Omit<Config, "ADMIN_PASSWORD" | "ENCRYPTION_KEY" | "JWT_SECRET" | "needsSetup"> & {
  ADMIN_PASSWORD: string;
  ENCRYPTION_KEY: string;
  JWT_SECRET: string;
  needsSetup: boolean;
} {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "",
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "",
    JWT_SECRET: process.env.JWT_SECRET ?? "",
    PORT: parseInt(process.env.PORT || "9981", 10),
    DB_PATH: getDefaultDbPath(),
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    TZ: process.env.TZ || "Asia/Shanghai",
    STREAM_TIMEOUT_MS: parseInt(process.env.STREAM_TIMEOUT_MS || "3000000", 10),
    RETRY_MAX_ATTEMPTS: parseInt(process.env.RETRY_MAX_ATTEMPTS || "3", 10),
    RETRY_BASE_DELAY_MS: parseInt(process.env.RETRY_BASE_DELAY_MS || "1000", 10),
    needsSetup: false,
  };
  return cachedConfig;
}

// 阶段2：DB 就绪后加载 secrets
export function loadSettingsToConfig(db: Database.Database): void {
  const config = getBaseConfig();
  // 环境变量已满足则跳过 DB 读取
  if (config.ADMIN_PASSWORD && config.ENCRYPTION_KEY && config.JWT_SECRET) return;

  const { getSetting, isInitialized } = require("./db/settings.js") as typeof import("./db/settings.js");
  if (!isInitialized(db)) {
    config.needsSetup = true;
    return;
  }
  if (!config.ENCRYPTION_KEY) config.ENCRYPTION_KEY = getSetting(db, "encryption_key") ?? "";
  if (!config.JWT_SECRET) config.JWT_SECRET = getSetting(db, "jwt_secret") ?? "";
}

export function getConfig(): Config {
  return getBaseConfig() as Config;
}
```

注意：`require` 在 ESM 中不可用，需改为动态 import 或直接导入函数。实际实现中 `loadSettingsToConfig` 直接 import `getSetting`/`isInitialized` 即可，上面的 require 只是伪代码示意调用时机。

- [ ] **更新 tests/config.test.ts**

适配新的 `getBaseConfig()` + `loadSettingsToConfig(db)` 模式：
- 测试 `getBaseConfig()` 无环境变量时不 throw
- 测试 `loadSettingsToConfig(db)` 从 settings 表读取
- 测试环境变量优先于 settings 表
- 测试 DB_PATH 迁移策略

- [ ] **运行测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "refactor(config): two-phase config loading with DB settings fallback"
```

---

### Task 3: Setup API + 密码 hash

**Files:**
- Create: `src/admin/setup.ts`
- Create: `src/utils/password.ts`
- Modify: `src/admin/routes.ts`

- [ ] **创建 src/utils/password.ts**

```typescript
import { randomBytes, scryptSync } from "node:crypto";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return derived === hash;
}
```

- [ ] **创建 src/admin/setup.ts**

```typescript
import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { getSetting, setSetting, isInitialized } from "../db/settings.js";
import { hashPassword } from "../utils/password.js";
import { loadSettingsToConfig } from "../config.js";

interface SetupOptions {
  db: Database.Database;
}

export const adminSetupRoutes: FastifyPluginCallback<SetupOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/setup/status", async () => {
    return { initialized: isInitialized(db) };
  });

  app.post("/admin/api/setup/initialize", async (request, reply) => {
    const { password } = request.body as { password?: string };
    if (!password || password.length < 6) {
      return reply.code(400).send({ error: { message: "Password must be at least 6 characters" } });
    }

    // 原子检查防竞态
    const initialized = db.transaction(() => {
      if (isInitialized(db)) return true;
      const encryptionKey = randomBytes(32).toString("hex");
      const jwtSecret = randomBytes(32).toString("hex");
      setSetting(db, "admin_password_hash", hashPassword(password));
      setSetting(db, "encryption_key", encryptionKey);
      setSetting(db, "jwt_secret", jwtSecret);
      setSetting(db, "initialized", "true");
      return false;
    })();

    if (initialized) {
      return reply.code(409).send({ error: { message: "Already initialized" } });
    }

    // 刷新运行时配置
    loadSettingsToConfig(db);
    return { success: true };
  });

  done();
};
```

- [ ] **在 src/admin/routes.ts 注册 setup 路由**

在 `adminRoutes` 中添加 setup 路由注册（在 auth plugin 之前，setup 不需要 auth）。

- [ ] **运行测试**

Run: `npm test`

- [ ] **Commit**

```bash
git add src/admin/setup.ts src/utils/password.ts src/admin/routes.ts
git commit -m "feat(admin): add setup API with password hashing"
```

---

### Task 4: 鉴权调整 — Setup 模式支持

**Files:**
- Modify: `src/middleware/admin-auth.ts`
- Modify: `src/middleware/auth.ts`（代理层 503）
- Modify: `src/index.ts`（buildApp 两阶段启动）

- [ ] **修改 admin-auth.ts**

在 `onRequest` hook 中：
- 放行 `/admin/api/setup/*` 路径
- 非Setup路径未初始化时返回 401 + `{ needsSetup: true }`

传入 `db` 选项，在 hook 中调用 `isInitialized(db)` 判断状态。

- [ ] **修改代理层 auth.ts**

在 proxy 路由顶部检查 `config.needsSetup`，为 true 时返回 503。

- [ ] **修改 src/index.ts buildApp()**

启动顺序改为：
1. `getBaseConfig()` — 不校验 secrets
2. `initDatabase(config.DB_PATH)` — 创建 DB + 运行迁移
3. `loadSettingsToConfig(db)` — 从 settings 表加载 secrets
4. 继续注册插件（传入 config 中的 secrets）

将 `db` 传入 `adminRoutes` 和 `adminAuthPlugin`，用于运行时检查 initialized 状态。

- [ ] **修改 login 路由**

密码校验双路径：
- `ADMIN_PASSWORD` 环境变量存在 → `timingSafeEqual` 明文对比
- 否则 → `verifyPassword(password, getSetting(db, "admin_password_hash"))`

- [ ] **更新受影响的测试**

- [ ] **运行测试**

Run: `npm test`

- [ ] **Commit**

```bash
git add src/middleware/admin-auth.ts src/middleware/auth.ts src/index.ts src/admin/routes.ts
git commit -m "feat(auth): support setup mode with dual password verification"
```

---

### Task 5: 前端 Setup 页面

**Files:**
- Create: `frontend/src/views/Setup.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **在 frontend/src/api/client.ts 添加 setup API**

```typescript
checkSetupStatus: () => api.get('/setup/status'),
initializeSetup: (password: string) => api.post('/setup/initialize', { password }),
```

- [ ] **创建 frontend/src/views/Setup.vue**

参照 Login.vue 的样式，包含：
- 标题 "LLM Simple Router — 初始设置"
- 密码输入 + 确认密码输入
- 提交按钮
- 错误提示

- [ ] **修改 router/index.ts**

- 添加 `/setup` 路由（不需要 auth）
- `beforeEach` 守卫中：对所有路由先检查 setup status
  - `initialized: false` 且不在 `/setup` → 重定向到 `/setup`
  - `initialized: true` 且在 `/setup` → 重定向到 `/login`
  - 保留现有 auth 守卫逻辑

- [ ] **构建前端验证**

Run: `cd frontend && npm run build`

- [ ] **Commit**

```bash
git add frontend/src/views/Setup.vue frontend/src/router/index.ts frontend/src/api/client.ts
git commit -m "feat(frontend): add setup page for zero-config initialization"
```

---

### Task 6: 端到端验证

- [ ] **本地测试零配置启动**

```bash
# 清除环境变量启动
unset ADMIN_PASSWORD ENCRYPTION_KEY JWT_SECRET
npm run dev
# 访问 http://localhost:9981/admin → 应看到 Setup 页面
# 设置密码 → 跳转到登录页 → 登录成功
```

- [ ] **测试环境变量覆盖**

```bash
ADMIN_PASSWORD=test ENCRYPTION_KEY=$(openssl rand -hex 32) JWT_SECRET=$(openssl rand -hex 32) npm run dev
# 应跳过 Setup 页面直接到登录页
```

- [ ] **运行全部测试**

Run: `npm test`

- [ ] **Commit（如有修复）**
