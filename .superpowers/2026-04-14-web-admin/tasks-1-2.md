# Task 1-2: JWT 认证 + 服务 CRUD + 映射 CRUD + 日志统计

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

## 前置条件

阶段 1 已完成。需安装新依赖：
```bash
npm install jsonwebtoken @fastify/cookie
npm install -D @types/jsonwebtoken
```

## 现有代码关键信息

- `buildApp()` 接受 `{ config?, db? }` 参数，测试时传入内存 db
- `authMiddleware` 跳过 `/health` 和 `/admin` 前缀路径（已有）
- 数据库 schema 中 `backend_services.api_key` 存储加密值，`model_mappings.client_model` 有 UNIQUE 约束
- `ENCRYPTION_KEY` 为 hex 格式，`encrypt/decrypt` 使用 AES-256-GCM
- `model_mappings.backend_service_id` 有 FK 指向 `backend_services.id`

---

## Task 1: JWT 认证 + 服务 CRUD

### Step 1.1: 数据库查询函数

**文件:** `src/db/index.ts`（追加）

**添加类型:**
```typescript
export interface RequestLog {
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

export interface Stats {
  totalRequests: number;
  successRate: number;
  avgLatency: number;
  requestsByType: Record<string, number>;
  recentRequests: number;
}
```

**添加函数（全部同步，使用 better-sqlite3 的同步 API）:**

```typescript
// --- BackendService CRUD ---
getAllBackendServices(db: Database.Database): BackendService[]
getBackendServiceById(db: Database.Database, id: string): BackendService | undefined
createBackendService(db: Database.Database, service: Omit<BackendService, 'id' | 'created_at' | 'updated_at'>): string  // 返回 id
updateBackendService(db: Database.Database, id: string, fields: Partial<Pick<BackendService, 'name' | 'api_type' | 'base_url' | 'api_key' | 'is_active'>>): void
deleteBackendService(db: Database.Database, id: string): void

// --- ModelMapping CRUD (Task 2 用，此处一并添加) ---
getAllModelMappings(db: Database.Database): ModelMapping[]
createModelMapping(db: Database.Database, mapping: Omit<ModelMapping, 'id' | 'created_at'>): string  // 返回 id
updateModelMapping(db: Database.Database, id: string, fields: Partial<Pick<ModelMapping, 'client_model' | 'backend_model' | 'backend_service_id' | 'is_active'>>): void
deleteModelMapping(db: Database.Database, id: string): void

// --- RequestLog 查询 (Task 2 用) ---
getRequestLogs(db: Database.Database, options: { page: number; limit: number; api_type?: string; model?: string }): { data: RequestLog[]; total: number }
deleteLogsBefore(db: Database.Database, beforeDate: string): number  // 返回删除行数
getStats(db: Database.Database): Stats
```

**实现要点:**
- `createBackendService`: 用 `randomUUID()` 生成 id，`new Date().toISOString()` 生成时间戳。api_key 应已是加密后的值传入（加密逻辑在路由层处理）。
- `updateBackendService`: 动态构建 SET 子句，只更新传入的字段。`updated_at` 始终更新。
- `getAllModelMappings`: 可考虑 JOIN `backend_services` 获取关联服务名称（供前端展示用）。
- `getRequestLogs`: 分页用 `LIMIT ? OFFSET ?`，total 用 `SELECT COUNT(*)`。支持 `api_type` 和 `model` 可选过滤。
- `getStats`: 用 SQL 聚合。successRate = `status_code >= 200 AND status_code < 300` 的比例。recentRequests = 最近 24h 的请求数。avgLatency = 平均 latency_ms。

**验证:** 在 `tests/db.test.ts` 中追加测试用例，覆盖每个新增函数。

---

### Step 1.2: JWT 认证中间件

**文件:** `src/middleware/admin-auth.ts`（新建）

**依赖:** `jsonwebtoken`, `@fastify/cookie`

**导出内容:**
1. `adminAuthPlugin` - Fastify 插件，注册 `@fastify/cookie`，挂载 `onRequest` 钩子
2. `adminLoginRoutes` - Fastify 插件，注册 login/logout 路由

**`adminAuthPlugin` 逻辑:**
```
onRequest 钩子:
  IF path.startsWith("/admin/api/") AND path !== "/admin/api/login":
    token = request.cookies['admin_token']
    IF 无 token:
      reply 401 { error: { message: "Not authenticated" } }
    TRY:
      jwt.verify(token, ADMIN_PASSWORD)  // JWT secret = ADMIN_PASSWORD
    CATCH:
      reply 401 { error: { message: "Invalid or expired token" } }
```

**`adminLoginRoutes` 逻辑:**

`POST /admin/api/login`:
```
body: { password: string }
IF body.password === getConfig().ADMIN_PASSWORD:
  token = jwt.sign({ role: 'admin' }, ADMIN_PASSWORD, { expiresIn: '24h' })
  reply.setCookie('admin_token', token, {
    path: '/admin',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 86400  // 24h
  })
  reply.send({ success: true })
ELSE:
  reply 401 { error: { message: "Invalid password" } }
```

`POST /admin/api/logout`:
```
reply.clearCookie('admin_token', { path: '/admin' })
reply.send({ success: true })
```

**注意:** 需要在 Fastify 实例上注册 `@fastify/cookie`。在 `adminAuthPlugin` 内部调用 `app.register(cookie)` 注册。用 `fp()` 包装确保全局生效。

---

### Step 1.3: 服务 CRUD 路由

**文件:** `src/admin/services.ts`（新建）

**导出:** `adminServiceRoutes` - Fastify 插件

**接收参数:** `{ db, encryptionKey }`

**路由实现:**

| 路由 | 实现要点 |
|------|---------|
| `GET /admin/api/services` | 调用 `getAllBackendServices(db)`，返回时 `api_key` 脱敏：取 decrypt 后前4后4，中间用 `...` 连接。如果 key 长度 <= 8，直接遮蔽为 `****` |
| `POST /admin/api/services` | body 校验：`name, api_type, base_url, api_key` 必填，`is_active` 可选默认 1。加密 api_key 后调用 `createBackendService` |
| `PUT /admin/api/services/:id` | 检查服务存在。如果 body 含 `api_key`，先加密再传给 `updateBackendService` |
| `DELETE /admin/api/services/:id` | 调用 `deleteBackendService`。返回 `{ success: true }` |

**api_key 脱敏函数:**
```typescript
function maskApiKey(encrypted: string, key: string): string {
  const decrypted = decrypt(encrypted, key);
  if (decrypted.length <= 8) return '****';
  return `${decrypted.slice(0, 4)}...${decrypted.slice(-4)}`;
}
```

---

### Step 1.4: 管理路由注册

**文件:** `src/admin/routes.ts`（新建）

**导出:** `adminRoutes` - Fastify 插件

**接收参数:** `{ db, adminPassword, encryptionKey }`

**内部注册顺序:**
1. `adminAuthPlugin`（注册 cookie + JWT 验证钩子）
2. `adminLoginRoutes`（login/logout 端点）
3. `adminServiceRoutes`（服务 CRUD，需认证）

**为什么单独一个 routes.ts:** 将所有管理相关插件的注册集中在一处，`index.ts` 只需调用一次 `app.register(adminRoutes, {...})`。

---

### Step 1.5: 修改 buildApp

**文件:** `src/index.ts`

在 `buildApp` 函数中，`app.get("/health", ...)` 之前添加：
```typescript
app.register(adminRoutes, {
  db,
  adminPassword: config.ADMIN_PASSWORD,
  encryptionKey: config.ENCRYPTION_KEY,
});
```

添加 import:
```typescript
import { adminRoutes } from "./admin/routes.js";
```

---

### Step 1.6: 测试 - JWT 认证

**文件:** `tests/admin-services.test.ts`（新建）

**测试辅助函数:**
```typescript
function buildAdminApp() {
  const db = initDatabase(":memory:");
  const config = {
    ROUTER_API_KEY: "sk-test-key",
    ADMIN_PASSWORD: "test-admin-pass",
    ENCRYPTION_KEY: generateValidHexKey(),  // 64字符hex
    // ...其他字段
  };
  return buildApp({ config, db });
}

function login(app): Promise<string> {
  // 调用 POST /admin/api/login，返回 set-cookie header 值
}
```

**测试用例:**

```
describe("Admin Auth")
  1. "login with correct password returns cookie"
     POST /admin/api/login { password: "test-admin-pass" }
     expect 200, response.headers['set-cookie'] 包含 admin_token

  2. "login with wrong password returns 401"
     POST /admin/api/login { password: "wrong" }
     expect 401

  3. "unauthenticated CRUD returns 401"
     GET /admin/api/services (无 cookie)
     expect 401

  4. "logout clears cookie"
     POST /admin/api/login -> 拿到 cookie
     POST /admin/api/logout (带 cookie)
     expect 200, 之后 GET /admin/api/services 返回 401
```

### Step 1.7: 测试 - 服务 CRUD

**文件:** `tests/admin-services.test.ts`（继续）

```
describe("Service CRUD")
  前置: 先 login 获取 cookie

  5. "GET services returns empty list"
     GET /admin/api/services
     expect 200, body = []

  6. "POST creates service successfully"
     POST /admin/api/services { name, api_type: "openai", base_url, api_key: "sk-test-abc123xyz" }
     expect 201, body 包含 id

  7. "GET returns services with masked api_key"
     GET /admin/api/services
     expect body[0].api_key === "sk-t...xyz"（脱敏后的值）

  8. "PUT updates service"
     PUT /admin/api/services/:id { name: "Updated" }
     expect 200
     再次 GET 验证 name 已变更

  9. "DELETE removes service"
     DELETE /admin/api/services/:id
     expect 200
     再次 GET 返回空列表

  10. "POST with missing required field returns 400"
      POST /admin/api/services { name: "NoKey" }
      expect 400
```

**TDD 顺序建议:** 先写 Step 1.6 的测试 -> 实现 Step 1.2 -> 验证通过 -> 写 Step 1.7 测试 -> 实现 Step 1.1 + 1.3 + 1.4 + 1.5 -> 验证通过。

---

## Task 2: 映射 CRUD + 日志查询 + 统计

### Step 2.1: 映射 CRUD 路由

**文件:** `src/admin/mappings.ts`（新建）

**导出:** `adminMappingRoutes` - Fastify 插件

**接收参数:** `{ db }`

**路由实现:**

| 路由 | 实现要点 |
|------|---------|
| `GET /admin/api/mappings` | 调用 `getAllModelMappings(db)`。可 JOIN backend_services 返回关联服务名称 |
| `POST /admin/api/mappings` | body 校验：`client_model, backend_model, backend_service_id` 必填，`is_active` 可选默认 1。验证 `backend_service_id` 存在（FK 约束由 DB 保证，但给出友好错误） |
| `PUT /admin/api/mappings/:id` | 检查映射存在，调用 `updateModelMapping` |
| `DELETE /admin/api/mappings/:id` | 调用 `deleteModelMapping` |

**注意:** `client_model` 有 UNIQUE 约束，POST/PUT 时需处理重复冲突，返回 409 Conflict。

---

### Step 2.2: 日志查询与清理路由

**文件:** `src/admin/logs.ts`（新建）

**导出:** `adminLogRoutes` - Fastify 插件

**接收参数:** `{ db }`

**路由实现:**

`GET /admin/api/logs`:
- query 参数：`page` (默认 1), `limit` (默认 20), `api_type` (可选), `model` (可选)
- 调用 `getRequestLogs(db, { page, limit, api_type, model })`
- 返回 `{ data: [...], total, page, limit }`

`DELETE /admin/api/logs/before`:
- body：`{ before: "2026-01-01T00:00:00Z" }`
- 调用 `deleteLogsBefore(db, before)`
- 返回 `{ deleted: number }`

---

### Step 2.3: 统计路由

**文件:** `src/admin/stats.ts`（新建）

**导出:** `adminStatsRoutes` - Fastify 插件

**接收参数:** `{ db }`

`GET /admin/api/stats`:
- 调用 `getStats(db)`
- 直接返回 stats 对象

**`getStats` SQL 实现要点:**
```sql
-- totalRequests
SELECT COUNT(*) FROM request_logs

-- successRate
SELECT CAST(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*)
FROM request_logs

-- avgLatency (ms)
SELECT AVG(latency_ms) FROM request_logs WHERE latency_ms IS NOT NULL

-- requestsByType
SELECT api_type, COUNT(*) FROM request_logs GROUP BY api_type

-- recentRequests (最近 24h)
SELECT COUNT(*) FROM request_logs WHERE created_at >= datetime('now', '-1 day')
```

处理空表情况：无请求时 successRate 返回 0，avgLatency 返回 0。

---

### Step 2.4: 注册新路由

**文件:** `src/admin/routes.ts`（修改）

在已有注册后追加：
```typescript
app.register(adminMappingRoutes, { db });
app.register(adminLogRoutes, { db });
app.register(adminStatsRoutes, { db });
```

---

### Step 2.5: 测试 - 映射 CRUD

**文件:** `tests/admin-mappings.test.ts`（新建）

```
describe("Mapping CRUD")
  前置: login + 创建一个 backend service（映射的 FK 需要）

  1. "GET mappings returns empty list"

  2. "POST creates mapping"
     POST /admin/api/mappings { client_model: "gpt-4", backend_model: "gpt-4-turbo", backend_service_id: serviceId }
     expect 201

  3. "GET returns mappings"

  4. "PUT updates mapping"
     PUT /admin/api/mappings/:id { backend_model: "gpt-4o" }
     验证更新成功

  5. "DELETE removes mapping"

  6. "POST duplicate client_model returns 409"
     创建两个相同 client_model 的映射，第二个 expect 409

  7. "POST with non-existent service_id returns error"
     POST /admin/api/mappings { ..., backend_service_id: "non-existent" }
     expect 400 或 500（FK 约束）

  8. "unauthenticated access returns 401"
     所有接口不带 cookie 测试
```

### Step 2.6: 测试 - 日志与统计

**文件:** `tests/admin-logs.test.ts`（新建）

```
describe("Logs API")
  前置: login + 插入测试日志数据（直接用 db.prepare 插入）

  1. "GET logs returns paginated results"
     GET /admin/api/logs?page=1&limit=10
     expect 200, body.data.length, body.total

  2. "GET logs filters by api_type"
     GET /admin/api/logs?api_type=openai
     验证只返回 openai 类型

  3. "GET logs filters by model"
     GET /admin/api/logs?model=gpt-4
     验证过滤正确

  4. "DELETE logs before date"
     DELETE /admin/api/logs/before { before: future_date }
     expect { deleted: N }

  5. "unauthenticated returns 401"

describe("Stats API")
  前置: login + 插入混合日志数据（成功/失败/不同 api_type）

  6. "GET stats returns correct aggregate"
     验证 totalRequests, successRate, avgLatency, requestsByType, recentRequests

  7. "GET stats with empty database"
     无日志数据时返回合理默认值

  8. "unauthenticated returns 401"
```

---

## 执行顺序总结

```
Step 1.1 (DB 函数) ─────────────────────────────┐
Step 1.2 (JWT 中间件) ──────────────────────────┤
Step 1.6 (认证测试，TDD 先写) ── 实现 1.2 通过 ──┤ 串行
Step 1.7 (CRUD 测试，TDD 先写) ── 实现 1.3-1.5 ─┘
         │
         ▼
Step 2.1 (映射路由) ────────────────────────────┐
Step 2.2 (日志路由) ────────────────────────────┤
Step 2.3 (统计路由) ────────────────────────────┤ 串行
Step 2.4 (注册路由) ────────────────────────────┤
Step 2.5 (映射测试) ────────────────────────────┤
Step 2.6 (日志统计测试) ────────────────────────┘
```

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 安装 | package.json | 添加 jsonwebtoken, @fastify/cookie, @types/jsonwebtoken |
| 修改 | src/db/index.ts | 追加 CRUD 查询函数 + RequestLog/Stats 类型 |
| 新建 | src/middleware/admin-auth.ts | JWT 认证插件 + login/logout 路由 |
| 新建 | src/admin/routes.ts | 管理 API 路由注册入口 |
| 新建 | src/admin/services.ts | 后端服务 CRUD 路由 |
| 新建 | src/admin/mappings.ts | 模型映射 CRUD 路由 |
| 新建 | src/admin/logs.ts | 日志查询与清理路由 |
| 新建 | src/admin/stats.ts | 统计概览路由 |
| 修改 | src/index.ts | 注册 adminRoutes |
| 新建 | tests/admin-services.test.ts | 认证 + 服务 CRUD 测试 |
| 新建 | tests/admin-mappings.test.ts | 映射 CRUD 测试 |
| 新建 | tests/admin-logs.test.ts | 日志 + 统计测试 |
