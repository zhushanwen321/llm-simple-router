# Task 1-3: 后端数据层

## Task 1: 数据库迁移

**Files:**
- Create: `src/db/migrations/008_create_router_keys.sql`

- [ ] **Step 1: 编写迁移文件**

```sql
-- 008_create_router_keys.sql
CREATE TABLE IF NOT EXISTS router_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  allowed_models TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_router_keys_hash ON router_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_router_keys_active ON router_keys(is_active);

ALTER TABLE request_logs ADD COLUMN router_key_id TEXT;

CREATE INDEX IF NOT EXISTS idx_request_logs_router_key ON request_logs(router_key_id);
```

- [ ] **Step 2: 启动 dev 验证迁移执行**

Run: `npm run dev`（Ctrl+C 后确认无报错即可）

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/008_create_router_keys.sql
git commit -m "feat: add router_keys migration with request_logs FK"
```

---

## Task 2: DB 层 Router Keys CRUD 函数

**Files:**
- Modify: `src/db/index.ts`

- [ ] **Step 1: 在 `src/db/index.ts` 底部（`getStats` 之前）添加 RouterKey 类型和 CRUD 函数**

新增接口：
```typescript
export interface RouterKey {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  allowed_models: string | null;  // JSON array string
  is_active: number;
  created_at: string;
  updated_at: string;
}
```

新增函数：
- `getRouterKeyByHash(db, hash)` — 按 hash 查找活跃 key
- `getAllRouterKeys(db)` — 列表（不含 hash）
- `getRouterKeyById(db, id)` — 单个
- `createRouterKey(db, { name, key_hash, key_prefix, allowed_models })` — 创建
- `updateRouterKey(db, id, fields)` — 更新
- `deleteRouterKey(db, id)` — 删除

- [ ] **Step 2: 修改 `getRequestLogs` 增加 `router_key_id` 筛选**

在 options 类型中增加 `router_key_id?: string`，在 WHERE 动态拼接中增加：
```typescript
if (options.router_key_id) { where += " AND router_key_id = ?"; params.push(options.router_key_id); }
```

- [ ] **Step 3: 修改 `insertRequestLog` 增加 `router_key_id` 参数**

在 log 参数类型中增加 `router_key_id?: string | null`，INSERT 语句增加对应列。

- [ ] **Step 4: Commit**

```bash
git add src/db/index.ts
git commit -m "feat: add router_keys CRUD and extend logs with router_key_id"
```

---

## Task 3: Config 层调整

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: 在 `src/config.ts` 中将 ROUTER_API_KEY 从必需改为可选**

将 `requiredVars` 数组中的 `"ROUTER_API_KEY"` 移除。在 `cachedConfig` 中改为可选：
```typescript
ROUTER_API_KEY: process.env.ROUTER_API_KEY || "",
```

- [ ] **Step 2: 更新 `.env.example`，标注 ROUTER_API_KEY 为可选并加注释说明**

```env
# Router API Key（已弃用，请从管理后台创建 API Key）
# ROUTER_API_KEY=sk-your-router-api-key
```

- [ ] **Step 3: 适配 `tests/config.test.ts`**

现有 config 测试验证"缺失 ROUTER_API_KEY 时抛错"和 `config.ROUTER_API_KEY` 值。需要：
- 移除对 ROUTER_API_KEY 必需校验的断言
- 改为验证 ROUTER_API_KEY 可选时的行为（不设值时默认空字符串）

- [ ] **Step 4: Commit**

```bash
git add src/config.ts .env.example tests/config.test.ts
git commit -m "refactor: make ROUTER_API_KEY optional, managed via DB"
```
