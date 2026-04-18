# Task 3: 后端 Session API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Write failing test first, then implement.

**Goal:** 在 proxy-enhancement admin 路由中新增 3 个 session API 端点。

**Depends on:** Task 1（session-states.ts 已存在）、Task 2（ModelStateManager 已支持复合键 + DB 双写 + modelState.delete 已实现）

**注意：** `proxy-core.ts`、`enhancement-handler.ts`、`frontend/src/api/client.ts` 的修改分别在 Task 2 和 Task 4 中完成，本 Task 只负责 admin API 端点。

---

## Step 1: 写失败测试 — Session API 端点

- [ ] 创建 `tests/admin-session-states.test.ts`

**文件:** `tests/admin-session-states.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { initDatabase } from "../src/db/index.js";
import { setSetting } from "../src/db/settings.js";
import { hashPassword } from "../src/utils/password.js";
import {
  upsertSessionState,
  insertSessionHistory,
} from "../src/db/session-states.js";

const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeConfig() {
  return {
    PORT: 9981,
    DB_PATH: ":memory:",
    LOG_LEVEL: "silent",
    TZ: "Asia/Shanghai",
    STREAM_TIMEOUT_MS: 5000,
    RETRY_MAX_ATTEMPTS: 0,
    RETRY_BASE_DELAY_MS: 0,
  };
}

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/login",
    payload: { password: "test-admin-pass" },
  });
  const match = (res.headers["set-cookie"] as string).match(
    /admin_token=([^;]+)/,
  );
  return `admin_token=${match![1]}`;
}

function seedSettings(db: ReturnType<typeof initDatabase>) {
  setSetting(db, "encryption_key", TEST_ENCRYPTION_KEY);
  setSetting(db, "jwt_secret", "test-jwt-secret-for-testing");
  setSetting(db, "admin_password_hash", hashPassword("test-admin-pass"));
  setSetting(db, "initialized", "true");
}

describe("Session States API", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof initDatabase>;
  let close: () => Promise<void>;
  let cookie: string;

  beforeEach(async () => {
    db = initDatabase(":memory:");
    seedSettings(db);
    const result = await buildApp({ config: makeConfig() as any, db });
    app = result.app;
    close = result.close;
    cookie = await login(app);

    // Seed: provider + router_key + session state + history
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("prov-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);
    db.prepare(
      `INSERT INTO router_keys (id, name, key_hash, key_prefix, key_encrypted, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("rk-1", "Test Key", "hash1", "sk-", "enc", 1, now, now);

    upsertSessionState(db, {
      router_key_id: "rk-1",
      session_id: "sess-001",
      current_model: "claude-opus-4-20250514",
      original_model: "claude-sonnet-4-20250514",
    });
    insertSessionHistory(db, {
      router_key_id: "rk-1",
      session_id: "sess-001",
      old_model: "claude-sonnet-4-20250514",
      new_model: "claude-opus-4-20250514",
      trigger_type: "directive",
    });
  });

  afterEach(async () => {
    await close();
  });

  it("GET /admin/api/session-states returns list with router_key_name", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/session-states",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].session_id).toBe("sess-001");
    expect(body[0].current_model).toBe("claude-opus-4-20250514");
    expect(body[0].router_key_name).toBe("Test Key");
  });

  it("GET /admin/api/session-states/:keyId/:sessionId/history returns history", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/session-states/rk-1/sess-001/history",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].old_model).toBe("claude-sonnet-4-20250514");
    expect(body[0].new_model).toBe("claude-opus-4-20250514");
    expect(body[0].trigger_type).toBe("directive");
  });

  it("DELETE /admin/api/session-states/:keyId/:sessionId deletes state", async () => {
    const delRes = await app.inject({
      method: "DELETE",
      url: "/admin/api/session-states/rk-1/sess-001",
      headers: { cookie },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ success: true });

    // Verify state is gone
    const getRes = await app.inject({
      method: "GET",
      url: "/admin/api/session-states",
      headers: { cookie },
    });
    expect(getRes.json()).toHaveLength(0);
  });

  it("unauthenticated access returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/session-states",
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] 运行测试，确认失败（路由不存在返回 404）：

```bash
npx vitest run tests/admin-session-states.test.ts
```

---

## Step 2: 添加 3 个 Session API 路由

- [ ] 修改 `src/admin/proxy-enhancement.ts`，追加 import 和 3 个路由。

**文件:** `src/admin/proxy-enhancement.ts`

在现有 import 追加：

```ts
import {
  getSessionStates,
  getSessionHistory,
} from "../db/session-states.js";
import { modelState } from "../proxy/model-state.js";
```

在 `app.put("/admin/api/proxy-enhancement", ...)` 之后、`done()` 之前追加 3 个路由：

```ts
app.get("/admin/api/session-states", async (_req, reply) => {
  const states = getSessionStates(db);
  return reply.send(states);
});

app.get<{ Params: { keyId: string; sessionId: string } }>(
  "/admin/api/session-states/:keyId/:sessionId/history",
  async (req, reply) => {
    const { keyId, sessionId } = req.params;
    const history = getSessionHistory(db, keyId, sessionId);
    return reply.send(history);
  },
);

app.delete<{ Params: { keyId: string; sessionId: string } }>(
  "/admin/api/session-states/:keyId/:sessionId",
  async (req, reply) => {
    const { keyId, sessionId } = req.params;
    modelState.delete(keyId, sessionId);
    return reply.send({ success: true });
  },
);
```

> `modelState.delete` 已在 Task 2 中实现双写（内存 + DB + history），此处无需再调 `deleteSessionState`。

---

## Step 3: 运行测试确认通过

- [ ] 执行：

```bash
npx vitest run tests/admin-session-states.test.ts
```

所有 4 个测试应通过。

- [ ] 回归测试：

```bash
npm test
```

确认所有现有测试不受影响。
