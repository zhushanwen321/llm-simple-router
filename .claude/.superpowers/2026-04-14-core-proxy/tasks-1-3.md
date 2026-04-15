# Tasks 1-3：项目脚手架、数据库/加密、认证中间件

> TDD 流程：写测试 → 运行（红灯）→ 写实现 → 运行（绿灯）→ 提交

---

## Task 1: 项目脚手架 + 配置

### Files

| 操作 | 路径 |
|------|------|
| Create | `package.json` |
| Create | `tsconfig.json` |
| Create | `vitest.config.ts` |
| Create | `src/config.ts` |
| Create | `src/index.ts` |
| Create | `tests/config.test.ts` |

### Step 1.1: 初始化 package.json

```bash
cd /Users/zhushanwen/Code/llm-simple-router
```

创建 `package.json`：

```json
{
  "name": "llm-simple-router",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11.9.1",
    "dotenv": "^16.4.7",
    "fastify": "^5.3.3",
    "pino": "^9.6.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.15.3",
    "tsx": "^4.19.3",
    "typescript": "^5.8.3",
    "vitest": "^3.1.2"
  }
}
```

运行命令：

```bash
npm install
```

预期输出：依赖安装成功，生成 `node_modules/` 和 `package-lock.json`。

### Step 1.2: 创建 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### Step 1.3: 创建 vitest.config.ts

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

### Step 1.4: 写测试 tests/config.test.ts

```typescript
import { describe, it, expect, beforeEach } from "vitest";

describe("getConfig", () => {
  beforeEach(() => {
    // 清除模块缓存，确保 getConfig 重新解析
    delete process.env.ROUTER_API_KEY;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.PORT;
    delete process.env.DB_PATH;
    delete process.env.LOG_LEVEL;
    delete process.env.TZ;
    delete process.env.STREAM_TIMEOUT_MS;
  });

  it("should throw when required env vars are missing", async () => {
    // 动态导入以触发模块重新执行
    const mod = await import("../src/config.js?t=" + Date.now());
    const { getConfig, resetConfig } = mod;
    resetConfig();

    expect(() => getConfig()).toThrow("ROUTER_API_KEY");
  });

  it("should return config with defaults when required vars are set", async () => {
    process.env.ROUTER_API_KEY = "sk-test-key";
    process.env.ADMIN_PASSWORD = "admin123";
    process.env.ENCRYPTION_KEY = "0".repeat(64);

    const mod = await import("../src/config.js?t=" + Date.now());
    const { getConfig, resetConfig } = mod;
    resetConfig();

    const config = getConfig();

    expect(config.ROUTER_API_KEY).toBe("sk-test-key");
    expect(config.ADMIN_PASSWORD).toBe("admin123");
    expect(config.PORT).toBe(3000);
    expect(config.DB_PATH).toBe("./data/router.db");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.TZ).toBe("Asia/Shanghai");
    expect(config.STREAM_TIMEOUT_MS).toBe(30000);
  });

  it("should parse PORT as number", async () => {
    process.env.ROUTER_API_KEY = "sk-test-key";
    process.env.ADMIN_PASSWORD = "admin123";
    process.env.ENCRYPTION_KEY = "0".repeat(64);
    process.env.PORT = "8080";

    const mod = await import("../src/config.js?t=" + Date.now());
    const { getConfig, resetConfig } = mod;
    resetConfig();

    const config = getConfig();
    expect(config.PORT).toBe(8080);
  });

  it("should return cached config on subsequent calls", async () => {
    process.env.ROUTER_API_KEY = "sk-cached";
    process.env.ADMIN_PASSWORD = "pw";
    process.env.ENCRYPTION_KEY = "a".repeat(64);

    const mod = await import("../src/config.js?t=" + Date.now());
    const { getConfig, resetConfig } = mod;
    resetConfig();

    const config1 = getConfig();
    // 修改环境变量不应影响已缓存的配置
    process.env.ROUTER_API_KEY = "different";
    const config2 = getConfig();
    expect(config1).toBe(config2);
    expect(config2.ROUTER_API_KEY).toBe("sk-cached");
  });
});
```

运行测试：

```bash
npx vitest run tests/config.test.ts
```

预期：红灯，`src/config.ts` 不存在。

### Step 1.5: 写实现 src/config.ts

```typescript
import "dotenv/config";

export interface Config {
  ROUTER_API_KEY: string;
  ADMIN_PASSWORD: string;
  ENCRYPTION_KEY: string;
  PORT: number;
  DB_PATH: string;
  LOG_LEVEL: string;
  TZ: string;
  STREAM_TIMEOUT_MS: number;
}

let cachedConfig: Config | null = null;

export function resetConfig(): void {
  cachedConfig = null;
}

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const requiredVars = ["ROUTER_API_KEY", "ADMIN_PASSWORD", "ENCRYPTION_KEY"];
  for (const name of requiredVars) {
    if (!process.env[name]) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }

  cachedConfig = {
    ROUTER_API_KEY: process.env.ROUTER_API_KEY!,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD!,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
    PORT: parseInt(process.env.PORT || "3000", 10),
    DB_PATH: process.env.DB_PATH || "./data/router.db",
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    TZ: process.env.TZ || "Asia/Shanghai",
    STREAM_TIMEOUT_MS: parseInt(process.env.STREAM_TIMEOUT_MS || "30000", 10),
  };

  return cachedConfig;
}
```

运行测试：

```bash
npx vitest run tests/config.test.ts
```

预期：绿灯，4 个测试通过。

### Step 1.6: 写实现 src/index.ts

```typescript
import Fastify from "fastify";
import { getConfig } from "./config.js";

async function main() {
  const config = getConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`Server listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
```

验证服务器启动：

```bash
ROUTER_API_KEY=sk-test ADMIN_PASSWORD=pw ENCRYPTION_KEY=$(printf 'a%.0s' {1..64}) npx tsx src/index.ts &
sleep 2
curl http://localhost:3000/health
# 预期输出: {"status":"ok"}
kill %1
```

### Step 1.7: 提交

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/config.ts src/index.ts tests/config.test.ts
git commit -m "feat: project scaffold with config and health endpoint"
```

---

## Task 2: SQLite + 加密工具

### Files

| 操作 | 路径 |
|------|------|
| Create | `src/db/index.ts` |
| Create | `src/db/migrations/001_init.sql` |
| Create | `src/utils/crypto.ts` |
| Create | `tests/db.test.ts` |
| Create | `tests/crypto.test.ts` |

### Step 2.1: 写迁移 SQL src/db/migrations/001_init.sql

```sql
CREATE TABLE IF NOT EXISTS migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backend_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_type TEXT NOT NULL CHECK(api_type IN ('openai', 'anthropic')),
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_mappings (
  id TEXT PRIMARY KEY,
  client_model TEXT NOT NULL UNIQUE,
  backend_model TEXT NOT NULL,
  backend_service_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (backend_service_id) REFERENCES backend_services(id)
);

CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  api_type TEXT NOT NULL,
  model TEXT,
  backend_service_id TEXT,
  status_code INTEGER,
  latency_ms INTEGER,
  is_stream INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL
);
```

### Step 2.2: 写测试 tests/db.test.ts

```typescript
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../src/db/index.js";

describe("initDatabase", () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it("should create all tables", () => {
    db = new Database(":memory:");
    initDatabase(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("migrations");
    expect(tableNames).toContain("backend_services");
    expect(tableNames).toContain("model_mappings");
    expect(tableNames).toContain("request_logs");
  });

  it("should record migration in migrations table", () => {
    db = new Database(":memory:");
    initDatabase(db);

    const rows = db
      .prepare("SELECT name FROM migrations")
      .all() as { name: string }[];

    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("001_init.sql");
  });

  it("should be idempotent - running twice does not error", () => {
    db = new Database(":memory:");
    initDatabase(db);
    // 第二次执行不应抛出异常
    expect(() => initDatabase(db)).not.toThrow();

    const rows = db
      .prepare("SELECT name FROM migrations")
      .all() as { name: string }[];
    // 不应重复记录
    expect(rows.length).toBe(1);
  });

  it("should allow inserting a backend service", () => {
    db = new Database(":memory:");
    initDatabase(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("svc-1", "Test OpenAI", "openai", "https://api.openai.com", "encrypted-key", 1, now, now);

    const row = db
      .prepare("SELECT * FROM backend_services WHERE id = ?")
      .get("svc-1") as any;
    expect(row.name).toBe("Test OpenAI");
    expect(row.api_type).toBe("openai");
  });

  it("should enforce api_type CHECK constraint", () => {
    db = new Database(":memory:");
    initDatabase(db);

    const now = new Date().toISOString();
    expect(() =>
      db.prepare(
        `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run("svc-2", "Bad", "invalid_type", "https://example.com", "key", 1, now, now)
    ).toThrow();
  });

  it("should allow inserting a model mapping with FK", () => {
    db = new Database(":memory:");
    initDatabase(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("svc-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);

    db.prepare(
      `INSERT INTO model_mappings (id, client_model, backend_model, backend_service_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("map-1", "gpt-4", "gpt-4-turbo", "svc-1", 1, now);

    const row = db
      .prepare("SELECT * FROM model_mappings WHERE id = ?")
      .get("map-1") as any;
    expect(row.client_model).toBe("gpt-4");
    expect(row.backend_model).toBe("gpt-4-turbo");
  });

  it("should enforce UNIQUE on client_model", () => {
    db = new Database(":memory:");
    initDatabase(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO backend_services (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("svc-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);

    db.prepare(
      `INSERT INTO model_mappings (id, client_model, backend_model, backend_service_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("map-1", "gpt-4", "gpt-4-turbo", "svc-1", 1, now);

    expect(() =>
      db.prepare(
        `INSERT INTO model_mappings (id, client_model, backend_model, backend_service_id, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run("map-2", "gpt-4", "gpt-4o", "svc-1", 1, now)
    ).toThrow();
  });
});
```

运行测试：

```bash
npx vitest run tests/db.test.ts
```

预期：红灯，`src/db/index.ts` 不存在。

### Step 2.3: 写实现 src/db/index.ts

```typescript
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, "migrations");

export function initDatabase(db: Database.Database): void {
  // 确保 migrations 表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (
      db.prepare("SELECT name FROM migrations").all() as {
        name: string;
      }[]
    ).map((r) => r.name)
  );

  // 读取目录下的 .sql 文件，按文件名排序
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    db.exec(sql);
    db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run(
      file,
      new Date().toISOString()
    );
  }
}

export interface BackendService {
  id: string;
  name: string;
  api_type: "openai" | "anthropic";
  base_url: string;
  api_key: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ModelMapping {
  id: string;
  client_model: string;
  backend_model: string;
  backend_service_id: string;
  is_active: number;
  created_at: string;
}

export function getActiveBackendServices(
  db: Database.Database,
  apiType: "openai" | "anthropic"
): BackendService[] {
  return db
    .prepare(
      "SELECT * FROM backend_services WHERE api_type = ? AND is_active = 1"
    )
    .all(apiType) as BackendService[];
}

export function getModelMapping(
  db: Database.Database,
  clientModel: string
): ModelMapping | undefined {
  return db
    .prepare(
      "SELECT * FROM model_mappings WHERE client_model = ? AND is_active = 1"
    )
    .get(clientModel) as ModelMapping | undefined;
}

export function insertRequestLog(
  db: Database.Database,
  log: {
    id: string;
    api_type: string;
    model: string | null;
    backend_service_id: string | null;
    status_code: number | null;
    latency_ms: number | null;
    is_stream: number;
    error_message: string | null;
    created_at: string;
  }
): void {
  db.prepare(
    `INSERT INTO request_logs (id, api_type, model, backend_service_id, status_code, latency_ms, is_stream, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    log.id,
    log.api_type,
    log.model,
    log.backend_service_id,
    log.status_code,
    log.latency_ms,
    log.is_stream,
    log.error_message,
    log.created_at
  );
}
```

运行数据库测试：

```bash
npx vitest run tests/db.test.ts
```

预期：绿灯，7 个测试通过。

### Step 2.4: 写测试 tests/crypto.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../src/utils/crypto.js";

// 固定 32 字节密钥（64 hex chars）
const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("crypto", () => {
  it("should encrypt and decrypt back to original text", () => {
    const plaintext = "sk-my-secret-api-key";
    const encrypted = encrypt(plaintext, KEY);
    const decrypted = decrypt(encrypted, KEY);
    expect(decrypted).toBe(plaintext);
  });

  it("should produce different ciphertext each time (random IV)", () => {
    const plaintext = "same-text";
    const enc1 = encrypt(plaintext, KEY);
    const enc2 = encrypt(plaintext, KEY);
    // 不同 IV 产生不同密文
    expect(enc1).not.toBe(enc2);
    // 但都能正确解密
    expect(decrypt(enc1, KEY)).toBe(plaintext);
    expect(decrypt(enc2, KEY)).toBe(plaintext);
  });

  it("should return hex formatted string with two colons", () => {
    const encrypted = encrypt("hello", KEY);
    const parts = encrypted.split(":");
    // iv:authTag:ciphertext
    expect(parts.length).toBe(3);
    // 每部分都应该是合法的 hex
    for (const part of parts) {
      expect(/^[0-9a-f]+$/.test(part)).toBe(true);
    }
  });

  it("should throw on wrong key", () => {
    const encrypted = encrypt("secret", KEY);
    const wrongKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it("should throw on tampered ciphertext", () => {
    const encrypted = encrypt("secret", KEY);
    const parts = encrypted.split(":");
    // 篡改密文
    parts[2] = parts[2].replace(/a/g, "b");
    const tampered = parts.join(":");
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it("should handle empty string", () => {
    const encrypted = encrypt("", KEY);
    const decrypted = decrypt(encrypted, KEY);
    expect(decrypted).toBe("");
  });

  it("should handle unicode text", () => {
    const plaintext = "你好世界 API-KEY-中文测试 🔑";
    const encrypted = encrypt(plaintext, KEY);
    const decrypted = decrypt(encrypted, KEY);
    expect(decrypted).toBe(plaintext);
  });
});
```

运行测试：

```bash
npx vitest run tests/crypto.test.ts
```

预期：红灯，`src/utils/crypto.ts` 不存在。

### Step 2.5: 写实现 src/utils/crypto.ts

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM 推荐 12 字节
const AUTH_TAG_LENGTH = 16;

export function encrypt(text: string, key: string): string {
  const keyBuf = Buffer.from(key, "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuf, iv);

  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(encrypted: string, key: string): string {
  const keyBuf = Buffer.from(key, "hex");
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format, expected iv:authTag:ciphertext");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");

  const decipher = createDecipheriv(ALGORITHM, keyBuf, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
```

运行测试：

```bash
npx vitest run tests/crypto.test.ts
```

预期：绿灯，7 个测试通过。

### Step 2.6: 运行全部测试确认无回归

```bash
npx vitest run
```

预期：全部绿灯（config 4 + db 7 + crypto 7 = 18 个测试）。

### Step 2.7: 提交

```bash
git add src/db/ src/utils/crypto.ts tests/db.test.ts tests/crypto.test.ts
git commit -m "feat: SQLite database init with migrations and AES-256-GCM crypto"
```

---

## Task 3: 认证中间件

### Files

| 操作 | 路径 |
|------|------|
| Create | `src/middleware/auth.ts` |
| Create | `tests/auth.test.ts` |

### Step 3.1: 写测试 tests/auth.test.ts

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { authMiddleware } from "../src/middleware/auth.js";

const VALID_KEY = "sk-router-test-key";

function buildApp() {
  const app = Fastify();
  app.register(authMiddleware, { apiKey: VALID_KEY });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/admin/dashboard", async () => ({ page: "admin" }));
  app.get("/v1/chat/completions", async () => ({ result: "proxied" }));

  return app;
}

describe("auth middleware", () => {
  let app: Fastify.FastifyInstance;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("should allow /health without auth", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("should allow /admin/* without auth", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/admin/dashboard",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ page: "admin" });
  });

  it("should reject request without Authorization header", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("invalid_api_key");
  });

  it("should reject request with wrong API key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Bearer wrong-key",
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.message).toBe("Invalid API key");
  });

  it("should allow request with correct Bearer token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${VALID_KEY}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: "proxied" });
  });

  it("should reject malformed Authorization header", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
      headers: {
        authorization: "Basic some-credentials",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("should return OpenAI-compatible error format", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/chat/completions",
    });

    const body = response.json();
    expect(body).toEqual({
      error: {
        message: "Invalid API key",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    });
  });
});
```

运行测试：

```bash
npx vitest run tests/auth.test.ts
```

预期：红灯，`src/middleware/auth.ts` 不存在。

### Step 3.2: 写实现 src/middleware/auth.ts

```typescript
import { FastifyInstance, FastifyPluginCallback } from "fastify";

const SKIP_PATHS = ["/health", "/admin"];

function shouldSkipAuth(path: string): boolean {
  return SKIP_PATHS.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}

function unauthorizedReply(reply: any): void {
  reply.status(401).send({
    error: {
      message: "Invalid API key",
      type: "invalid_request_error",
      code: "invalid_api_key",
    },
  });
}

export const authMiddleware: FastifyPluginCallback<{ apiKey: string }> = (
  app: FastifyInstance,
  options,
  done
) => {
  app.addHook("onRequest", async (request, reply) => {
    if (shouldSkipAuth(request.url)) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      unauthorizedReply(reply);
      return;
    }

    const token = authHeader.slice(7);
    if (token !== options.apiKey) {
      unauthorizedReply(reply);
      return;
    }
  });

  done();
};
```

运行测试：

```bash
npx vitest run tests/auth.test.ts
```

预期：绿灯，7 个测试通过。

### Step 3.3: 运行全部测试确认无回归

```bash
npx vitest run
```

预期：全部绿灯（config 4 + db 7 + crypto 7 + auth 7 = 25 个测试）。

### Step 3.4: 提交

```bash
git add src/middleware/auth.ts tests/auth.test.ts
git commit -m "feat: Bearer token auth middleware with path-based skip"
```

---

## 验收检查清单

| 检查项 | 命令 |
|--------|------|
| 全部测试通过 | `npx vitest run` (25 tests) |
| TypeScript 编译无错 | `npx tsc --noEmit` |
| 服务器可启动 | 设置环境变量后 `npx tsx src/index.ts` |
| /health 端点可用 | `curl http://localhost:3000/health` |
