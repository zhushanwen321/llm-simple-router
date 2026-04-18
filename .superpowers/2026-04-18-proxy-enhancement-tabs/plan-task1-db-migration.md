# Task 1: 数据库迁移 + CRUD

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Write failing test first, then implement.

**Goal:** 创建 `session_model_states` 和 `session_model_history` 两张表，以及对应的 CRUD 模块。

**Depends on:** 无（首个任务）

---

## Step 1: 写失败测试

> 前置：确认迁移计数为 15，新迁移后应为 16。

- [ ] 在 `tests/db.test.ts` 末尾追加新的 `describe("session states", ...)` 块。

**文件:** `tests/db.test.ts`

在现有最后一个 `});` 之后追加：

```ts
describe("session states", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
  });

  function setupDb(): Database.Database {
    db = initDatabase(":memory:");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("prov-1", "Test", "openai", "https://api.openai.com", "key", 1, now, now);
    db.prepare(
      `INSERT INTO router_keys (id, name, key_hash, key_prefix, key_encrypted, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("rk-1", "Test Key", "hash1", "sk-", "enc", 1, now, now);
    return db;
  }

  it("should create session state and query it back", () => {
    const database = setupDb();
    const id = upsertSessionState(database, {
      router_key_id: "rk-1",
      session_id: "sess-001",
      current_model: "claude-sonnet-4-20250514",
      original_model: "claude-sonnet-4-20250514",
    });

    const states = getSessionStates(database);
    expect(states).toHaveLength(1);
    expect(states[0].session_id).toBe("sess-001");
    expect(states[0].current_model).toBe("claude-sonnet-4-20250514");
    expect(states[0].router_key_name).toBe("Test Key");
  });

  it("should upsert update existing state", () => {
    const database = setupDb();
    upsertSessionState(database, {
      router_key_id: "rk-1",
      session_id: "sess-001",
      current_model: "claude-sonnet-4-20250514",
      original_model: "claude-sonnet-4-20250514",
    });

    const id2 = upsertSessionState(database, {
      router_key_id: "rk-1",
      session_id: "sess-001",
      current_model: "claude-opus-4-20250514",
      original_model: "claude-sonnet-4-20250514",
    });

    const states = getSessionStates(database);
    expect(states).toHaveLength(1);
    expect(states[0].current_model).toBe("claude-opus-4-20250514");
  });

  it("should insert and query history", () => {
    const database = setupDb();
    insertSessionHistory(database, {
      router_key_id: "rk-1",
      session_id: "sess-001",
      old_model: "claude-sonnet-4-20250514",
      new_model: "claude-opus-4-20250514",
      trigger_type: "directive",
    });

    const history = getSessionHistory(database, "rk-1", "sess-001");
    expect(history).toHaveLength(1);
    expect(history[0].old_model).toBe("claude-sonnet-4-20250514");
    expect(history[0].new_model).toBe("claude-opus-4-20250514");
    expect(history[0].trigger_type).toBe("directive");
  });

  it("should delete session state", () => {
    const database = setupDb();
    upsertSessionState(database, {
      router_key_id: "rk-1",
      session_id: "sess-001",
      current_model: "claude-sonnet-4-20250514",
      original_model: "claude-sonnet-4-20250514",
    });

    deleteSessionState(database, "rk-1", "sess-001");
    const states = getSessionStates(database);
    expect(states).toHaveLength(0);
  });
});
```

同时在测试文件顶部 import 中追加：

```ts
import {
  getSessionStates,
  getSessionHistory,
  upsertSessionState,
  insertSessionHistory,
  deleteSessionState,
} from "../src/db/index.js";
```

- [ ] 运行测试，确认失败（import 找不到）：

```bash
npx vitest run tests/db.test.ts
```

---

## Step 2: 创建迁移文件

- [ ] 创建 `src/db/migrations/016_create_session_model_tables.sql`

**文件:** `src/db/migrations/016_create_session_model_tables.sql`

```sql
CREATE TABLE IF NOT EXISTS session_model_states (
  id TEXT PRIMARY KEY,
  router_key_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  current_model TEXT NOT NULL,
  original_model TEXT,
  last_active_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(router_key_id, session_id),
  FOREIGN KEY (router_key_id) REFERENCES router_keys(id)
);
CREATE INDEX idx_sms_router_key ON session_model_states(router_key_id);

CREATE TABLE IF NOT EXISTS session_model_history (
  id TEXT PRIMARY KEY,
  router_key_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  old_model TEXT,
  new_model TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (router_key_id) REFERENCES router_keys(id)
);
CREATE INDEX idx_smh_session ON session_model_history(router_key_id, session_id);
```

---

## Step 3: 实现 CRUD 模块

- [ ] 创建 `src/db/session-states.ts`

**文件:** `src/db/session-states.ts`

```ts
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

// --- Types ---

export interface SessionModelState {
  id: string;
  router_key_id: string;
  router_key_name?: string;
  session_id: string;
  current_model: string;
  original_model: string | null;
  last_active_at: string;
  created_at: string;
}

export interface SessionModelHistory {
  id: string;
  router_key_id: string;
  session_id: string;
  old_model: string | null;
  new_model: string;
  trigger_type: string;
  created_at: string;
}

export interface UpsertSessionStateInput {
  id?: string;
  router_key_id: string;
  session_id: string;
  current_model: string;
  original_model?: string | null;
}

export interface InsertSessionHistoryInput {
  router_key_id: string;
  session_id: string;
  old_model?: string | null;
  new_model: string;
  trigger_type: string;
}

// --- CRUD ---

export function getSessionStates(db: Database.Database): SessionModelState[] {
  return db.prepare(
    `SELECT sms.*, rk.name AS router_key_name
     FROM session_model_states sms
     JOIN router_keys rk ON rk.id = sms.router_key_id
     ORDER BY sms.last_active_at DESC`
  ).all() as SessionModelState[];
}

export function getSessionHistory(
  db: Database.Database,
  routerKeyId: string,
  sessionId: string,
): SessionModelHistory[] {
  return db.prepare(
    `SELECT * FROM session_model_history
     WHERE router_key_id = ? AND session_id = ?
     ORDER BY created_at DESC`
  ).all(routerKeyId, sessionId) as SessionModelHistory[];
}

export function upsertSessionState(
  db: Database.Database,
  input: UpsertSessionStateInput,
): string {
  const now = new Date().toISOString();
  const id = input.id ?? randomUUID();

  db.prepare(
    `INSERT INTO session_model_states (id, router_key_id, session_id, current_model, original_model, last_active_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(router_key_id, session_id) DO UPDATE SET
       current_model = excluded.current_model,
       original_model = excluded.original_model,
       last_active_at = excluded.last_active_at`
  ).run(
    id,
    input.router_key_id,
    input.session_id,
    input.current_model,
    input.original_model ?? null,
    now,
    now,
  );

  return id;
}

export function insertSessionHistory(
  db: Database.Database,
  input: InsertSessionHistoryInput,
): string {
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO session_model_history (id, router_key_id, session_id, old_model, new_model, trigger_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.router_key_id,
    input.session_id,
    input.old_model ?? null,
    input.new_model,
    input.trigger_type,
    now,
  );

  return id;
}

export function deleteSessionState(
  db: Database.Database,
  routerKeyId: string,
  sessionId: string,
): void {
  db.prepare(
    `DELETE FROM session_model_states WHERE router_key_id = ? AND session_id = ?`
  ).run(routerKeyId, sessionId);
}

export function getSessionState(
  db: Database.Database,
  routerKeyId: string,
  sessionId: string,
): SessionModelState | undefined {
  return db.prepare(
    `SELECT * FROM session_model_states WHERE router_key_id = ? AND session_id = ?`
  ).get(routerKeyId, sessionId) as SessionModelState | undefined;
}
```

---

## Step 4: 更新 re-export

- [ ] 在 `src/db/index.ts` 追加 re-export

**文件:** `src/db/index.ts`

在文件末尾（`export { getSetting, setSetting, isInitialized } from "./settings.js";` 之后）追加：

```ts
export {
  getSessionStates,
  getSessionState,
  getSessionHistory,
  upsertSessionState,
  insertSessionHistory,
  deleteSessionState,
} from "./session-states.js";
export type { SessionModelState, SessionModelHistory, UpsertSessionStateInput, InsertSessionHistoryInput } from "./session-states.js";
```

---

## Step 5: 更新迁移计数断言

- [ ] 在 `tests/db.test.ts` 的 "should record migration in migrations table" 测试中，将 `expect(rows.length).toBe(15)` 改为 `expect(rows.length).toBe(16)`。

---

## Step 6: 运行测试确认通过

- [ ] 执行：

```bash
npx vitest run tests/db.test.ts
```

所有测试应通过，包括新增的 4 个 session states 测试和更新后的迁移计数断言。
