# Admin 层重构设计

> 日期：2026-04-15 | 源自 ts-taste-check 审查 | 范围：src/ 非 proxy 代码

## 问题

品味检查发现：P1 × 14 | P2 × 8 | P3 × 2 | P4 × 1

核心问题：5 个 admin 文件全部使用 `db: any`；认证层缺少 timing-safe 比较；JWT 密钥与密码复用；SQL 动态拼接无白名单；每次 GET provider 列表都解密所有 key。

## 目标

- 消除所有 `any`
- 认证操作使用 timing-safe 比较
- JWT 密钥与 admin 密码分离（新增 JWT_SECRET 环境变量）
- SQL 动态字段加白名单
- providers 表预存 api_key_preview，消除"为脱敏而解密"

约束：不改变现有 API 行为和响应格式。

## 实现步骤

### Step 1: config.ts — 新增 JWT_SECRET

1. `Config` 接口新增 `JWT_SECRET: string`
2. `getConfig()` 中 `requiredVars` 加入 `"JWT_SECRET"`
3. 读取 `process.env.JWT_SECRET!`

### Step 2: db/index.ts — SQL 白名单 + 类型别名 + migration 错误处理

1. `updateProvider` 加白名单：`const ALLOWED_FIELDS = new Set(['name', 'api_type', 'base_url', 'api_key', 'is_active'])`，过滤 `Object.entries(fields)` 结果
2. `updateModelMapping` 加白名单：`const ALLOWED_FIELDS = new Set(['client_model', 'backend_model', 'provider_id', 'is_active'])`
3. 提取 `CountRow = { count: number }` 和 `AvgRow = { avg: number | null }` 类型别名，替代 `getStats` 中重复的断言
4. `initDatabase` 中 `readFileSync` 和 `db.exec` 包裹 try-catch，失败时 `console.error` 并重新抛出
5. `Provider` 接口新增 `api_key_preview?: string` 可选字段
6. `createProvider` / `updateProvider` 函数签名增加 `api_key_preview` 参数
7. 新增 migration 文件 `src/db/migrations/004_add_api_key_preview.sql`：`ALTER TABLE providers ADD COLUMN api_key_preview TEXT;`
8. `getAllProviders` 查询 `api_key_preview` 字段

### Step 3: middleware/auth.ts — 修复类型和安全

1. `unauthorizedReply(reply: any)` → `unauthorizedReply(reply: FastifyReply)`
2. `token !== options.apiKey` → 使用 `timingSafeEqual`：
   ```typescript
   import { timingSafeEqual } from "crypto";
   const tokenBuf = Buffer.from(token);
   const keyBuf = Buffer.from(options.apiKey);
   if (tokenBuf.length !== keyBuf.length || !timingSafeEqual(tokenBuf, keyBuf)) { ... }
   ```

### Step 4: middleware/admin-auth.ts — JWT 分离 + timing-safe + 空 catch

1. `AdminAuthOptions` 新增 `jwtSecret: string`，不再复用 `adminPassword`
2. `jwt.verify(token, options.jwtSecret)` 和 `jwt.sign({ role: "admin" }, options.jwtSecret, ...)`
3. `password !== options.adminPassword` → `timingSafeEqual`
4. 空 catch 块加 `request.log.debug({ err }, "invalid JWT token")`
5. `maxAge: 86400` → `TOKEN_EXPIRY_SECONDS = 86400` 常量
6. `process.env.NODE_ENV === "production"` → 从 config 获取或保持（auth 插件不接收 config，此处保留 env 判断可接受）

### Step 5: admin/routes.ts — 消除 any

1. `db: any` → `db: Database.Database`，import Database

### Step 6: admin/providers.ts — 消除 any + 预计算脱敏

1. `db: any` → `db: Database.Database`
2. `request.body as any` → 定义 `CreateProviderBody` 和 `UpdateProviderBody` 类型接口
3. `fields: any` → `Record<string, unknown>`（白名单在 db 层处理）
4. `maskApiKey` 函数删除；GET 路由直接返回 `api_key_preview`（无值时 fallback 为 `"****"`）
5. POST/PUT 路由在调用 `createProvider`/`updateProvider` 时传入计算好的 `api_key_preview`

### Step 7: admin/mappings.ts — 消除 any

1. `db: any` → `db: Database.Database`
2. `request.body as any` → 定义 `CreateMappingBody` 和 `UpdateMappingBody` 类型接口
3. `catch (err: any)` → `catch (err: unknown)` + `err instanceof Error ? err.message : String(err)`
4. `fields: any` → `Record<string, unknown>`

### Step 8: admin/logs.ts — 消除 any

1. `db: any` → `db: Database.Database`
2. `request.query as any` → 定义 `LogQueryParams` 类型接口

### Step 9: admin/stats.ts — 消除 any

1. `db: any` → `db: Database.Database`

### Step 10: index.ts — 传递 JWT_SECRET

1. `buildApp` 中 admin routes 注册时传入 `jwtSecret: config.JWT_SECRET`
2. auth middleware 仍用 `config.ROUTER_API_KEY`

### Step 11: 验证

1. `npm run build` — 编译通过
2. `npm test` — 全部测试通过
3. `npx eslint src/ --max-warnings=0` — lint 通过
4. 确认无 `any` 残留（排除测试文件）
5. 更新 `.env.example` 加入 `JWT_SECRET`
