# Task 4-5: 认证层

## Task 4: 改造 Auth Middleware

**Files:**
- Modify: `src/middleware/auth.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: 重写 `src/middleware/auth.ts`**

核心变更：
1. 移除 `timingSafeEqual` 导入，改用 `createHash("sha256")` 计算 token hash
2. 插件选项从 `{ apiKey: string }` 改为 `{ db: Database.Database }`
3. 插件初始化时创建 prepared statement：`stmt = db.prepare("SELECT id, name, allowed_models FROM router_keys WHERE key_hash = ? AND is_active = 1")`
4. onRequest hook 中：计算 hash → `stmt.get(hash)` → 挂载 `request.routerKey`

```typescript
import { FastifyInstance, FastifyPluginCallback, FastifyReply } from "fastify";
import { createHash } from "crypto";
import fp from "fastify-plugin";
import Database from "better-sqlite3";

// 扩展 FastifyRequest 类型
declare module "fastify" {
  interface FastifyRequest {
    routerKey?: { id: string; name: string; allowed_models: string | null }; // allowed_models 是 JSON 字符串，需 JSON.parse
  }
}

interface RouterKeyRow { id: string; name: string; allowed_models: string | null; }

const SKIP_PATHS = ["/health", "/admin"];
const HTTP_UNAUTHORIZED = 401;
const BEARER_PREFIX_LENGTH = "Bearer ".length;

function shouldSkipAuth(url: string): boolean {
  const path = url.split("?")[0];
  return SKIP_PATHS.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}

function unauthorizedReply(reply: FastifyReply): void {
  reply.code(HTTP_UNAUTHORIZED).send({
    error: { message: "Invalid API key", type: "invalid_request_error", code: "invalid_api_key" },
  });
}

const authMiddlewareRaw: FastifyPluginCallback<{ db: Database.Database }> = (app, options, done) => {
  const stmt = options.db.prepare(
    "SELECT id, name, allowed_models FROM router_keys WHERE key_hash = ? AND is_active = 1"
  ) as Database.Statement<RouterKeyRow>;

  app.addHook("onRequest", async (request, reply) => {
    if (shouldSkipAuth(request.url)) return;
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      unauthorizedReply(reply);
      return reply;
    }
    const token = authHeader.slice(BEARER_PREFIX_LENGTH);
    const hash = createHash("sha256").update(token).digest("hex");
    const row = stmt.get(hash);
    if (!row) {
      unauthorizedReply(reply);
      return reply;
    }
    request.routerKey = { id: row.id, name: row.name, allowed_models: row.allowed_models };
  });
  done();
};

export const authMiddleware = fp(authMiddlewareRaw, { name: "auth-middleware" });
```

- [ ] **Step 2: 修改 `src/index.ts` 中 auth middleware 注册**

将 `app.register(authMiddleware, { apiKey: config.ROUTER_API_KEY })` 改为 `app.register(authMiddleware, { db })`

同时在 DB 初始化之后、注册 middleware 之前，添加环境变量自动迁移逻辑（仅在非注入 DB 时执行，避免测试环境意外触发）：
```typescript
// 自动迁移：仅在自行创建 DB 时执行（测试注入 DB 跳过）
if (!options?.db && config.ROUTER_API_KEY) {
  const count = (db.prepare("SELECT COUNT(*) as c FROM router_keys").get() as { c: number }).c;
  if (count === 0) {
    const hash = createHash("sha256").update(config.ROUTER_API_KEY).digest("hex");
    const prefix = config.ROUTER_API_KEY.slice(0, 8);
    db.prepare(
      "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)"
    ).run(randomUUID(), "Default", hash, prefix);
    app.log.info("Migrated ROUTER_API_KEY to router_keys table as 'Default'");
  }
}
```

需要在 `src/index.ts` 顶部新增导入 `createHash` 和 `randomUUID`。

- [ ] **Step 3: Commit**

```bash
git add src/middleware/auth.ts src/index.ts
git commit -m "feat: refactor auth to use DB-backed router_keys with SHA-256 hash"
```

---

## Task 5: 适配 auth 测试

**Files:**
- Modify: `tests/auth.test.ts`

- [ ] **Step 1: 重写 auth 测试，使用内存 DB**

关键变更：
- `buildApp()` 改为创建内存 DB，初始化 migrations，插入一条测试用 router_key
- 验证 hash 匹配、key 不匹配、无 Authorization、malformed header 等场景

```typescript
import Database from "better-sqlite3";
import { createHash } from "crypto";
import { initDatabase } from "../src/db/index.js";

const TEST_KEY = "sk-router-test-key-1234567890";
const TEST_KEY_HASH = createHash("sha256").update(TEST_KEY).digest("hex");

function buildTestApp() {
  const db = initDatabase(":memory:");
  // 插入测试 key
  db.prepare(
    "INSERT INTO router_keys (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)"
  ).run("test-id", "Test Key", TEST_KEY_HASH, TEST_KEY.slice(0, 8));

  const app = Fastify();
  app.register(authMiddleware, { db });
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/admin/dashboard", async () => ({ page: "admin" }));
  app.get("/v1/chat/completions", async (request) => ({ result: "proxied", key: request.routerKey?.name }));
  return { app, db };
}
```

测试用例保持原有覆盖范围，额外验证 `request.routerKey` 正确挂载。

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/auth.test.ts`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add tests/auth.test.ts
git commit -m "test: adapt auth tests for DB-backed router_keys"
```
