# Task 2: ModelStateManager 改造 + Enhancement Handler + Proxy Core

> 依赖：Task 1（DB 迁移 + `src/db/session-states.ts` CRUD 模块）已完成
> 本 Task 拥有 `model-state.ts`、`enhancement-handler.ts`、`proxy-core.ts`、`src/index.ts` 的修改权

## 总览

将 `ModelStateManager` 从纯内存 Map 改为「内存优先 + DB 持久化」双写架构。同时更新所有调用链：proxy-core → enhancement-handler → model-state。

---

## Step 1: 写测试 — 新增 session-scoped 测试用例

文件：`tests/model-state.test.ts`

在现有测试之后新增一个 `describe("session-scoped", ...)` 块。需要一个 mock DB 对象来验证双写行为。

```ts
function createMockDb() {
  return {
    transaction: vi.fn((fn) => (...args: unknown[]) => fn(...args)),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
    })),
  };
}
```

测试骨架（8 个用例）：

```ts
describe("session-scoped", () => {
  let mgr: ModelStateManager;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    mgr = new ModelStateManager(mockDb as unknown as Database.Database);
    vi.useFakeTimers();
  });

  it("set with sessionId 写入内存", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    expect(mgr.get("key-1", "sess-1")).toBe("glm-5.1");
  });

  it("set with sessionId 调用 DB transaction", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("get 内存命中时不查 DB", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    const result = mgr.get("key-1", "sess-1");
    expect(result).toBe("glm-5.1");
    // prepare 不应被调用（无 DB 读取）
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });

  it("get 内存 miss 时查 DB 并回填", () => {
    // 模拟 DB 返回
    const mockGet = vi.fn().mockReturnValue({
      current_model: "deepseek-v3",
      last_active_at: new Date().toISOString(),
    });
    mockDb.prepare.mockReturnValue({ get: mockGet, run: vi.fn(), all: vi.fn() });

    const result = mgr.get("key-1", "sess-1");
    expect(result).toBe("deepseek-v3");
    expect(mockGet).toHaveBeenCalled();
    // 验证内存回填
    expect(mgr.get("key-1", "sess-1")).toBe("deepseek-v3");
  });

  it("get 内存 miss + DB miss 返回 null", () => {
    mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined), run: vi.fn(), all: vi.fn() });
    expect(mgr.get("key-1", "sess-1")).toBeNull();
  });

  it("delete 清理内存 + DB", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    mgr.delete("key-1", "sess-1");
    expect(mgr.get("key-1", "sess-1")).toBeNull();
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("set default with sessionId 删除内存 + DB", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    mgr.set("key-1", "default", "sess-1");
    expect(mgr.get("key-1", "sess-1")).toBeNull();
  });

  it("无 sessionId 保持原有行为", () => {
    mgr.set("key-1", "glm-5.1");
    expect(mgr.get("key-1")).toBe("glm-5.1");
  });

  it("不同 sessionId 之间隔离", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    mgr.set("key-1", "deepseek-v3", "sess-2");
    expect(mgr.get("key-1", "sess-1")).toBe("glm-5.1");
    expect(mgr.get("key-1", "sess-2")).toBe("deepseek-v3");
  });
});
```

**验证命令：** `npx vitest run tests/model-state.test.ts`（预期失败）

- [ ] Step 1 完成

---

## Step 2: 改造 ModelStateManager

文件：`src/proxy/model-state.ts`

完整替换为：

```ts
import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import {
  upsertSessionState,
  getSessionState,
  deleteSessionState,
  insertSessionHistory,
} from "../db/session-states.js";

const HOUR_MS = 3600_000;
const TTL_HOURS = 24;
const TTL_MS = TTL_HOURS * HOUR_MS;

interface StateEntry {
  model: string;
  updatedAt: number;
}

export class ModelStateManager {
  private store = new Map<string, StateEntry>();
  private db?: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db;
  }

  /** 运行时注入数据库实例（用于 singleton 场景） */
  init(db: Database.Database): void {
    this.db = db;
  }

  private buildKey(routerKeyId: string | null, sessionId?: string): string {
    const base = routerKeyId ?? "null";
    return sessionId ? `${base}:${sessionId}` : base;
  }

  set(
    routerKeyId: string | null,
    model: string,
    sessionId?: string,
    originalModel?: string,
    triggerType?: "directive" | "command",
  ): void {
    const key = this.buildKey(routerKeyId, sessionId);

    if (model === "default") {
      this.store.delete(key);
      if (sessionId && this.db && routerKeyId) {
        this.deleteFromDb(routerKeyId, sessionId);
      }
      return;
    }

    this.store.set(key, { model, updatedAt: Date.now() });

    if (sessionId && this.db && routerKeyId) {
      this.writeToDb(routerKeyId, sessionId, model, originalModel, triggerType ?? "command");
    }
  }

  get(routerKeyId: string | null, sessionId?: string): string | null {
    const key = this.buildKey(routerKeyId, sessionId);
    const entry = this.store.get(key);

    if (entry) {
      if (Date.now() - entry.updatedAt > TTL_MS) {
        this.store.delete(key);
        return null;
      }
      return entry.model;
    }

    // 内存 miss → 尝试 DB 回填
    if (sessionId && this.db && routerKeyId) {
      return this.loadFromDb(routerKeyId, sessionId);
    }

    return null;
  }

  delete(routerKeyId: string, sessionId: string): void {
    const key = this.buildKey(routerKeyId, sessionId);
    this.store.delete(key);

    if (this.db) {
      this.deleteFromDb(routerKeyId, sessionId);
    }
  }

  private writeToDb(
    routerKeyId: string,
    sessionId: string,
    model: string,
    originalModel: string | undefined,
    triggerType: "directive" | "command",
  ): void {
    try {
      this.db!.transaction(() => {
        upsertSessionState(this.db!, {
          router_key_id: routerKeyId,
          session_id: sessionId,
          current_model: model,
          original_model: originalModel ?? null,
        });
        insertSessionHistory(this.db!, {
          router_key_id: routerKeyId,
          session_id: sessionId,
          old_model: originalModel,
          new_model: model,
          trigger_type: triggerType,
        });
      })();
    } catch (err) {
      // DB 写入失败不影响内存状态
      console.error("Failed to persist session state:", err);
    }
  }

  private loadFromDb(routerKeyId: string, sessionId: string): string | null {
    try {
      const row = getSessionState(this.db!, routerKeyId, sessionId);
      if (!row) return null;
      const key = this.buildKey(routerKeyId, sessionId);
      this.store.set(key, { model: row.current_model, updatedAt: Date.now() });
      return row.current_model;
    } catch {
      return null;
    }
  }

  private deleteFromDb(routerKeyId: string, sessionId: string): void {
    try {
      this.db!.transaction(() => {
        deleteSessionState(this.db!, routerKeyId, sessionId);
        insertSessionHistory(this.db!, {
          router_key_id: routerKeyId,
          session_id: sessionId,
          new_model: "default",
          trigger_type: "manual_clear",
        });
      })();
    } catch (err) {
      console.error("Failed to delete session state:", err);
    }
  }
}

// singleton
export const modelState = new ModelStateManager();
```

**关键点：**
- `writeToDb` 在 `db.transaction()` 中同时调用 `upsertSessionState` + `insertSessionHistory`
- `deleteFromDb` 在 `db.transaction()` 中同时调用 `deleteSessionState` + `insertSessionHistory(manual_clear)`
- DB 函数参数使用 snake_case（与 `session-states.ts` 的接口一致）

**验证命令：** `npx vitest run tests/model-state.test.ts`

- [ ] Step 2 完成

---

## Step 3: 更新 enhancement-handler.ts — 透传 sessionId + triggerType

文件：`src/proxy/enhancement-handler.ts`

### 3.1 函数签名变更

```ts
export function applyEnhancement(
  db: Database.Database,
  request: FastifyRequest,
  clientModel: string,
  sessionId?: string,
): EnhancementResult {
```

### 3.2 select-model 命令分支（~L65）

```ts
// 原来：modelState.set(routerKeyId, arg);
modelState.set(routerKeyId, arg, sessionId, clientModel, "command");
```

### 3.3 内联指令分支（~L92）

```ts
// 原来：modelState.set(request.routerKey?.id ?? null, directive.modelName);
modelState.set(request.routerKey?.id ?? null, directive.modelName, sessionId, clientModel, "directive");
```

### 3.4 会话记忆查询分支（~L101）

```ts
// 原来：const remembered = modelState.get(request.routerKey?.id ?? null);
const remembered = modelState.get(request.routerKey?.id ?? null, sessionId);
```

**验证命令：** `npx vitest run tests/directive-parser.test.ts`

- [ ] Step 3 完成

---

## Step 4: 更新 proxy-core.ts — 提取 sessionId header + init modelState

### 4.1 proxy-core.ts：提取 header

文件：`src/proxy/proxy-core.ts`

在 `handleProxyPost` 中，`applyEnhancement` 调用之前添加 header 提取：

```ts
// 原来（L137）：
// const { effectiveModel, originalModel, interceptResponse } = applyEnhancement(db, request, clientModel);

// 改为：
const sessionId = (request.headers as RawHeaders)["x-claude-code-session-id"] as string | undefined;
const { effectiveModel, originalModel, interceptResponse } = applyEnhancement(db, request, clientModel, sessionId);
```

### 4.2 src/index.ts：init modelState

在 `buildApp()` 中 db 初始化后，调用 `modelState.init(db)`：

```ts
import { modelState } from "./proxy/model-state.js";
// ... 在 initDatabase(dbPath) 之后：
modelState.init(db);
```

**验证命令：** `npm test`

- [ ] Step 4 完成

---

## Step 5: 全量测试验证

```bash
# 1. model-state 单元测试
npx vitest run tests/model-state.test.ts

# 2. directive-parser 测试（确认无破坏）
npx vitest run tests/directive-parser.test.ts

# 3. 全量测试
npm test

# 4. TypeScript 编译检查
npx tsc --noEmit
```

- [ ] Step 5 完成

---

## 检查清单

| 检查项 | 标准 |
|--------|------|
| 无 sessionId 时行为不变 | 所有原有测试通过 |
| 有 sessionId 时双写 | 内存 + DB states + history 均写入 |
| get DB 回填 | 内存 miss 时从 DB 恢复 |
| delete 双清 + history | 内存 + DB states 删除 + manual_clear history |
| DB 失败降级 | 内存操作不受影响 |
| triggerType 正确 | directive / command 区分 |
| TypeScript 编译 | `npx tsc --noEmit` 无错误 |
