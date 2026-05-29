---
verdict: pass
---

# Backend Design — Provider Multi-API-Type

## §1 数据模型变更

### 1.1 ProviderEndpoint 类型定义

**文件**: `router/src/core/types.ts`（新增）

```typescript
export interface ProviderEndpoint {
  api_type: "openai" | "openai-responses" | "anthropic";
  base_url: string;
  upstream_path?: string | null;
  api_key?: string | null;  // null = fallback 到 provider.api_key
}
```

**约束规则**:
- `api_type` 必填，只允许上述三种值
- `base_url` 必填，必须为合法 HTTP(S) URL
- `upstream_path` 可选，覆盖默认路径
- `api_key` 可选，`null`/`undefined` 时 fallback 到 Provider 级 `api_key`

**数据来源**: Provider DB 行的 `endpoints` JSON 字段（TEXT），经 `parseEndpoints()` 解析得到。

### 1.2 ResolvedEndpoint 类型定义

**文件**: `router/src/core/types.ts`（新增）

```typescript
export interface ResolvedEndpoint {
  api_type: "openai" | "openai-responses" | "anthropic";  // 实际上游 api_type
  base_url: string;
  upstream_path: string | null;
  api_key: string;            // 已解密的最终 key（永远不会是 null）
  needs_transform: boolean;   // 是否需要 FormatRegistry 格式转换
}
```

**语义**: `resolveEndpoint()` 的输出，所有下游消费者（patch/plugin/transport/log）只消费此对象。

### 1.3 resolveEndpoint() 函数签名和行为表

**文件**: `router/src/proxy/routing/resolve-endpoint.ts`（新增文件，从 `router/src/db/providers.ts` import `parseEndpoints`）

```typescript
export function resolveEndpoint(
  provider: Provider,
  clientApiType: "openai" | "openai-responses" | "anthropic",
  encryptionKey: string,
): ResolvedEndpoint
```

**行为表**:

| # | endpoints 内容 | clientApiType | 匹配逻辑 | 输出 api_type | needs_transform |
|---|---------------|---------------|----------|---------------|-----------------|
| 1 | `[{api_type: "openai", base_url: "url-a", api_key: null}]` | "openai" | 精确匹配 | "openai" | `false` |
| 2 | `[{api_type: "anthropic", base_url: "url-b", api_key: null}]` | "openai" | 无匹配，用第一个 | "anthropic" | `true` |
| 3 | `[{api_type: "openai", ...}, {api_type: "anthropic", ...}]` | "openai" | 精确匹配 | "openai" | `false` |
| 4 | `[{api_type: "openai", ...}, {api_type: "anthropic", ...}]` | "anthropic" | 精确匹配 | "anthropic" | `false` |
| 5 | `[{api_type: "openai", ...}, {api_type: "openai-responses", ...}]` | "openai-responses" | 精确匹配 | "openai-responses" | `false` |
| 6 | `[{api_type: "openai", ...}]` | "openai-responses" | 无匹配，用第一个 | "openai" | `true` |
| 7 | `[{api_type: "openai", base_url: "url-a", api_key: "enc_key_a"}]` | "openai" | 精确匹配，有独立 key | "openai" | `false`，api_key=解密(enc_key_a) |
| 8 | `[{api_type: "anthropic", base_url: "url-b", api_key: null}]` | "openai" | 无匹配，api_key=null | "anthropic" | `true`，api_key=解密(provider.api_key) |
| 9 | `[]` (空数组) | any | throw Error | — | `throw new Error('Provider has no endpoints')` |

**实现伪代码**:

```
resolveEndpoint(provider, clientApiType, encryptionKey):
  endpoints = parseEndpoints(provider.endpoints)
  if endpoints.length === 0:
    // throw Error：Provider 必须有至少一个 endpoint
    throw new Error(`Provider ${provider.id} has no endpoints`)
  
  matched = endpoints.find(ep => ep.api_type === clientApiType)
  if matched:
    endpoint = matched
    needs_transform = false
  else:
    endpoint = endpoints[0]
    needs_transform = endpoint.api_type !== clientApiType
  
  rawKey = endpoint.api_key ?? provider.api_key
  decryptedKey = decrypt(rawKey, encryptionKey)
  
  return {
    api_type: endpoint.api_type,
    base_url: endpoint.base_url,
    upstream_path: endpoint.upstream_path ?? null,
    api_key: decryptedKey,
    needs_transform,
  }
```

**边界条件**:
- `endpoints` 为空 → throw Error（Provider 必须有至少一个 endpoint）
- `api_key` 为 `null` → 解密 `provider.api_key`（共享兜底 key）
- 同 `provider.id` 的重复调用 → 调用方（failover-loop）已有 `decryptedApiKeys` Map 缓存
- 加密 key 为空 → 抛出错误（上游已有 `!encryptionKey` 检查）

### 1.4 parseEndpoints() / serializeEndpoints() 工具函数

**文件**: `router/src/db/providers.ts`（新增函数）

```typescript
/** 解析 endpoints JSON 文本为类型安全的数组 */
export function parseEndpoints(endpointsJson: string | null | undefined): ProviderEndpoint[]
```

**行为**:
- `null` / `undefined` / `""` → 返回 `[]`
- 有效 JSON 数组 → 类型断言后返回
- 非法 JSON → throw Error（Provider 数据损坏不应静默忽略）

```typescript
/** 将 endpoints 数组序列化为 JSON 文本（用于 DB 写入） */
export function serializeEndpoints(endpoints: ProviderEndpoint[]): string
```

**行为**: `JSON.stringify(endpoints)`，保证返回有效 JSON 字符串。

## §2 DB 迁移设计

### 2.1 Migration 051 SQL

**文件**: `router/src/db/migrations/051_provider_endpoints.sql`

```sql
-- 051: Add endpoints column to providers, migrate existing data to endpoints JSON
-- endpoints: JSON array of {api_type, base_url, upstream_path, api_key}
-- After migration, endpoints is always non-NULL and is the single source of truth.

-- Step 1: Add column (idempotent — SQLite ignores if column exists in newer versions,
-- but we use a conditional check pattern)
ALTER TABLE providers ADD COLUMN endpoints TEXT DEFAULT NULL;

-- Step 2: Migrate existing providers where endpoints IS NULL
-- Only process rows that haven't been migrated yet
UPDATE providers
SET endpoints = json_array(
    json_object(
      'api_type', api_type,
      'base_url', base_url,
      'upstream_path', CASE WHEN upstream_path IS NULL THEN json('null') ELSE json(upstream_path) END,
      'api_key', CASE WHEN api_key IS NULL THEN json('null') ELSE api_key END
    )
  )
)
WHERE endpoints IS NULL
  AND api_type IS NOT NULL
  AND base_url IS NOT NULL;
```

**关键设计决策**:
- `api_key` 写入时**不重新加密**——它已经是密文（`encrypt()` 后的结果），直接原样搬入 endpoints JSON
- `upstream_path` 为 NULL 时写入 JSON `null`
- 只处理 `endpoints IS NULL` 的行，幂等

### 2.2 数据转换逻辑

**源字段** → **目标 endpoints JSON** 映射:

| 旧字段 | endpoints 字段 | 转换 |
|--------|---------------|------|
| `api_type` | `api_type` | 直接复制 |
| `base_url` | `base_url` | 直接复制 |
| `upstream_path` | `upstream_path` | NULL → `null`，有值 → 原值 |
| `api_key` | `api_key` | 直接复制（已是密文） |

**示例**:
- 迁移前: `api_type="openai", base_url="https://api.openai.com", upstream_path=NULL, api_key="enc:iv:tag:ct"`
- 迁移后: `endpoints='[{"api_type":"openai","base_url":"https://api.openai.com","upstream_path":null,"api_key":"enc:iv:tag:ct"}]'`

### 2.3 幂等保护

1. **ALTER TABLE**: SQLite 不支持 `IF NOT EXISTS` 对 ALTER TABLE，但重复执行会报错——由应用层 `initDatabase()` 的 `PRAGMA table_info` 检测已有列跳过
2. **UPDATE WHERE**: `WHERE endpoints IS NULL` 确保只迁移一次
3. **应用层保护**: `parseEndpoints()` 对 `null` 返回空数组 `[]`，`resolveEndpoint()` 对空数组 throw（Provider 必须有 endpoint）

### 2.4 request_logs 新增列

单独迁移文件 `052_add_upstream_log_fields.sql`（与 051 分离，职责单一）:

```sql
-- Step 3: Add upstream tracking columns to request_logs
ALTER TABLE request_logs ADD COLUMN upstream_api_type TEXT DEFAULT NULL;
ALTER TABLE request_logs ADD COLUMN upstream_base_url TEXT DEFAULT NULL;
```

## §3 Admin API 变更

### 3.1 Schema 变更（endpoints 数组）

**文件**: `router/src/admin/providers.ts`

**新增 Schema**:

```typescript
const EndpointSchema = Type.Object({
  api_type: Type.Union([
    Type.Literal("openai"),
    Type.Literal("openai-responses"),
    Type.Literal("anthropic"),
  ]),
  base_url: Type.String({ minLength: 1 }),
  upstream_path: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  api_key: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
});

const CreateProviderSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  endpoints: Type.Array(EndpointSchema, { minItems: 1 }),
  // 兼容旧客户端：单 endpoint 简写
  api_type: Type.Optional(Type.Union([
    Type.Literal("openai"),
    Type.Literal("openai-responses"),
    Type.Literal("anthropic"),
  ])),
  base_url: Type.Optional(Type.String({ minLength: 1 })),
  upstream_path: Type.Optional(Type.String({ minLength: 1 })),
  api_key: Type.Optional(Type.String({ minLength: 1 })),
  models: Type.Optional(Type.Array(/* ...保持不变 */)),
  is_active: Type.Optional(Type.Number()),
  max_concurrency: Type.Optional(Type.Integer({ minimum: 0 })),
  queue_timeout_ms: Type.Optional(Type.Integer({ minimum: 0 })),
  max_queue_size: Type.Optional(Type.Integer({ minimum: 1 })),
  adaptive_enabled: Type.Optional(Type.Integer({ minimum: 0, maximum: 1 })),
  proxy_type: Type.Optional(Type.Union([Type.Literal("http"), Type.Literal("socks5"), Type.Null()])),
  proxy_url: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  proxy_username: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  proxy_password: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
```

**校验规则**:
1. `endpoints` 至少 1 个元素（`minItems: 1`）
2. 同一 Provider 内 `api_type` 不允许重复 → 应用层校验
3. 每个 endpoint 的 `base_url` 必须为合法 HTTP(S) URL → 应用层校验
4. 旧字段（`api_type`/`base_url`/`api_key`/`upstream_path`）与 `endpoints` 互斥：有 `endpoints` 时忽略旧字段，无 `endpoints` 时自动组装为 `[{api_type, base_url, ...}]`（向后兼容）

### 3.2 Create/Update 处理逻辑（endpoints 加密）

**文件**: `router/src/admin/providers.ts`

**Create Provider 处理流程**:

```
POST /admin/api/providers
  → 校验 name 唯一性
  → 如果有 endpoints 数组:
      → 校验 api_type 不重复
      → 校验每个 base_url 为合法 URL
      → 对每个 endpoint: api_key 非null则 encrypt(key)
      → 构建 provider.api_type = endpoints[0].api_type（兼容旧查询）
      → 构建 provider.base_url = endpoints[0].base_url（兼容旧查询）
      → 构建 provider.api_key = encrypt(共享key or endpoints[0].api_key)（兼容旧查询）
      → 构建 provider.upstream_path = endpoints[0].upstream_path（兼容旧查询）
      → serializeEndpoints(endpoints) → DB endpoints 字段
  → 如果无 endpoints 但有旧字段:
      → 自动组装 endpoints = [{api_type, base_url, upstream_path, api_key}]
      → 同上加密+写入
  → INSERT INTO providers (含 endpoints 字段)
```

**Update Provider 处理流程**:

```
PUT /admin/api/providers/:id
  → 如果 body 含 endpoints:
      → 校验 api_type 不重复
      → 校验 base_url
      → 加密 endpoint api_key
      → 同步更新旧字段（api_type/base_url/api_key/upstream_path = endpoints[0] 的值）
      → UPDATE providers SET endpoints=..., api_type=..., base_url=..., ...
  → 如果 body 无 endpoints 但有旧字段:
      → 读取现有 endpoints，更新第一个 endpoint 的对应字段
      → 或直接组装新的 endpoints
```

**加密细节**:
- endpoint 级 `api_key` 使用与 provider 级相同的 `encrypt(text, encryptionKey)`
- `api_key` 为 `null`/空时跳过加密，存储为 `null`
- 解密使用同一个 `encryptionKey`（来自 DB settings 表）

### 3.3 Get 响应格式（endpoints 解密）

**GET /admin/api/providers** 和 **GET /admin/api/providers/:id** 响应新增字段:

```typescript
{
  id: string;
  name: string;
  // 旧字段保留（deprecated 但向后兼容）
  api_type: string;           // = endpoints[0].api_type
  base_url: string;           // = endpoints[0].base_url
  upstream_path: string | null; // = endpoints[0].upstream_path
  api_key: string;            // = endpoints[0].api_key（解密后）
  // 新字段
  endpoints: Array<{
    api_type: string;
    base_url: string;
    upstream_path: string | null;
    api_key: string;          // 解密后的明文，null 时为空字符串 ""
  }>;
  // ... 其他字段不变
}
```

**解密流程**: 遍历 `endpoints`，每个 endpoint 的 `api_key` 如果非 null 则 `decrypt()`，否则返回 `""`。

### 3.4 PROVIDER_FIELDS 白名单更新

**文件**: `router/src/db/providers.ts`

```typescript
const PROVIDER_FIELDS = new Set([
  "name", "api_type", "base_url", "upstream_path", "api_key", "api_key_preview",
  "models", "is_active", "max_concurrency", "queue_timeout_ms", "max_queue_size",
  "adaptive_enabled", "proxy_type", "proxy_url", "proxy_username", "proxy_password",
  "endpoints",  // 新增
]);
```

**createProvider() 函数签名变更**:

```typescript
export function createProvider(
  db: Database.Database,
  provider: {
    name: string;
    api_type: "openai" | "openai-responses" | "anthropic";
    base_url: string;
    upstream_path?: string | null;
    api_key: string;
    api_key_preview?: string;
    models?: string;
    is_active?: number;
    max_concurrency?: number;
    queue_timeout_ms?: number;
    max_queue_size?: number;
    adaptive_enabled?: number;
    proxy_type?: string | null;
    proxy_url?: string | null;
    proxy_username?: string | null;
    proxy_password?: string | null;
    endpoints?: string;  // 新增：序列化后的 JSON 字符串
  },
): string
```

INSERT 语句追加 `endpoints` 列。

## §4 代理层适配

### 4.1 failover-loop.ts 改造（resolveEndpoint 集成）

**文件**: `router/src/proxy/handler/failover-loop.ts`

**影响点**（精确行号基于当前代码）:

| 行号 | 当前代码 | 改造后 |
|------|---------|--------|
| L342 | `provider.api_type as ApiType` | `resolvedEndpoint.api_type as ApiType` |
| L342 | `provider.upstream_path ?? undefined` | `resolvedEndpoint.upstream_path ?? undefined` |
| L359 | `base_url: provider.base_url` | `base_url: resolvedEndpoint.base_url` |
| L360 | `api_type: provider.api_type` | `api_type: resolvedEndpoint.api_type` |
| L373 | `decrypt(provider.api_key, encryptionKey)` | 改用 `resolvedEndpoint.api_key`（已解密） |
| L382 | `buildUpstreamUrl(provider.base_url, ...)` | `buildUpstreamUrl(resolvedEndpoint.base_url, ...)` |
| L389 | `provider.api_type` | `resolvedEndpoint.api_type` |
| L398 | `provider.api_type` | `resolvedEndpoint.api_type` |
| L400 | `provider.api_type` | `resolvedEndpoint.api_type` |
| L405 | `provider.api_type` | `resolvedEndpoint.api_type` |
| L407 | `base_url: provider.base_url, api_type: provider.api_type` | `base_url: resolvedEndpoint.base_url, api_type: resolvedEndpoint.api_type` |
| L104 | `targetApiType: provider.api_type` | `targetApiType: resolvedEndpoint.api_type` |
| L105 | `provider: { ..., base_url: provider.base_url, api_type: provider.api_type }` | `provider: { ..., base_url: resolvedEndpoint.base_url, api_type: resolvedEndpoint.api_type }` |

**核心改造流程**:

```
// 在 provider 查询后、resolveUpstreamPath 之前，插入:
const resolvedEndpoint = resolveEndpoint(provider, clientApiType, encryptionKey);

// 后续所有 provider.api_type/base_url/upstream_path/api_key 替换为 resolvedEndpoint.*
// provider.api_key 的解密由 resolveEndpoint 内部完成，不再单独 decrypt

// needsTransform 来自 resolvedEndpoint.needs_transform，而非 formatRegistry.needsTransform()
// 但仍需调 resolveUpstreamPath 做格式转换（body transform）
```

**关键变更: resolveUpstreamPath 函数签名不变**，但传入的参数改为 `resolvedEndpoint.api_type`。`needsTransform` 判断可以简化：如果 `resolvedEndpoint.needs_transform === false`，跳过格式转换；否则走现有逻辑。

**decrypt 缓存改造**: 现有 `decryptedApiKeys` Map 按 `provider.id` 缓存。改造后不再需要——`resolveEndpoint()` 每次调用时解密。但可以在 `resolveEndpoint` 层面做缓存（按 `provider.id + clientApiType` 为 key），避免重复解密。

### 4.2 patch 层适配

**文件**: `router/src/proxy/patch/index.ts`

当前 `applyProviderPatches` 接收的参数:

```typescript
interface PatchInput {
  base_url: string;
  api_type: string;
  models: ModelEntry[];
}
```

**改造**: 参数类型不变，调用方（failover-loop.ts）传入 `resolvedEndpoint.base_url` 和 `resolvedEndpoint.api_type` 即可。patch 层本身无需修改。

**影响点**:
- `provider-patches.ts` (L25-26): 调用方改为传 `resolvedEndpoint.*`
- `patch/index.ts` 内部代码不改——只消费 `{ base_url, api_type, models }`

### 4.3 transport-fn.ts 适配

**文件**: `router/src/proxy/transport/transport-fn.ts`

当前 `TransportFnParams` 接收 `provider` 和 `apiKey` 分开传入。`provider` 仅用于:
- L76: `p.provider.base_url` → 代理 agent 选择
- L108: `p.provider.id` → matcher 校验

**改造方案**: `TransportFnParams` 不变。调用方（failover-loop.ts）传入完整的 `provider` 对象（用于 id 和 proxy 配置），`apiKey` 传入 `resolvedEndpoint.api_key`。

Transport 层不需要感知 endpoints 概念——它只消费 `{ base_url, api_key, api_type }` 参数，这些由 `buildTransportFn` 闭包捕获。

### 4.4 plugin 层适配

**文件**: `router/src/proxy/hooks/builtin/plugin-request.ts`、`provider-patches.ts`

当前 Plugin 上下文中的 `ProviderInfo`:

```typescript
interface ProviderInfo {
  id: string;
  name: string;
  base_url: string;
  api_type: string;
}
```

**改造**: `ProviderInfo` 接口不变。调用方构造时使用 `resolvedEndpoint.base_url` 和 `resolvedEndpoint.api_type`。Plugin 层无需修改。

**影响点**:
- `plugin-request.ts` L33-38: 构造 `ProviderInfo` 时改用 `resolvedEndpoint.*`
- `provider-patches.ts` L25-26: 同上
- `plugin-types.ts` L95: `m.apiType && m.apiType !== provider.api_type` → 不改，过滤逻辑基于传入的 ProviderInfo

### 4.5 plugin-bridge.ts 适配（如有）

**文件**: `router/src/proxy/transform/plugin-bridge.ts`

检查是否存在 provider 字段直接访问 → 如有，同样替换为 `resolvedEndpoint.*`。

## §5 日志增强

### 5.1 request_logs 新字段

**Migration 052 独立文件 `052_add_upstream_log_fields.sql`**:
- `upstream_api_type TEXT DEFAULT NULL` — 实际发送给上游的 api_type
- `upstream_base_url TEXT DEFAULT NULL` — 实际使用的 base_url

### 5.2 insertSuccessLog / insertRejectedLog 传参变更

**文件**: `router/src/proxy/log-helpers.ts`

**RequestLogParams 接口新增字段**:

```typescript
export interface RequestLogParams extends LogRetryMeta {
  // ... 现有字段不变
  upstream_api_type?: string | null;     // 新增
  upstream_base_url?: string | null;     // 新增
}
```

**RejectedLogParams 接口新增字段**:

```typescript
export interface RejectedLogParams extends LogRetryMeta {
  // ... 现有字段不变
  upstream_api_type?: string | null;     // 新增
  upstream_base_url?: string | null;     // 新增
}
```

### 5.3 log-helpers.ts 改造

**insertSuccessLog** 改造:
- 解构新增 `upstream_api_type` 和 `upstream_base_url`
- 传入 `insertRequestLog()` 的对象新增这两个字段

**insertRejectedLog** 改造:
- 同上

**RequestLogInsert 接口新增**:

```typescript
export interface RequestLogInsert {
  // ... 现有字段
  upstream_api_type?: string | null;     // 新增
  upstream_base_url?: string | null;     // 新增
}
```

**rawInsertRequestLog** 改造:
- INSERT 语句新增两列
- VALUES 新增两个参数

### 5.4 failover-loop.ts 传参改造

调用 `logResilienceResult` / `insertRejectedLog` 时，从 `resolvedEndpoint` 取值:

```typescript
upstream_api_type: resolvedEndpoint.api_type,
upstream_base_url: resolvedEndpoint.base_url,
```

### 5.5 数据消费者检查

新增字段 `upstream_api_type` / `upstream_base_url` 的消费点:

| 消费者 | 文件 | 用途 |
|--------|------|------|
| DB 写入 | `db/logs.ts` `rawInsertRequestLog()` | INSERT 到 request_logs |
| DB 读取 | `db/logs.ts` `LOG_LIST_SELECT` | 日志列表查询（可选展示） |
| Admin API | `admin/logs.ts` | 日志详情返回（需追加字段） |
| 前端展示 | `frontend/src/.../Logs.vue` | 请求详情显示（前端 task） |
| SSE 实时监控 | `monitor/request-tracker.ts` | 不需要——实时监控不关心 upstream 类型 |

## §6 接口签名表

### Module: resolve-endpoint (routing 层)

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| resolveEndpoint | `(provider: Provider, clientApiType: ApiType, encryptionKey: string) → ResolvedEndpoint` | `ResolvedEndpoint` | 空 endpoints → throw Error | FR-2 |

### Module: providers (DB 层)

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| parseEndpoints | `(endpointsJson: string \| null \| undefined) → ProviderEndpoint[]` | `ProviderEndpoint[]` | null → `[]`，非法 JSON → throw | FR-1 |
| serializeEndpoints | `(endpoints: ProviderEndpoint[]) → string` | `string` | 空数组 → `"[]"` | FR-1 |
| createProvider | `(db, provider: {..., endpoints?: string}) → string` | `string` (id) | endpoints 为 undefined → 从旧字段组装 | FR-3, FR-4 |
| updateProvider | `(db, id, fields) → void` | void | 含 endpoints 时更新 | FR-4 |

### Module: providers (Admin API 层)

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| POST /admin/api/providers | `(body: CreateProviderSchema) → {id}` | `{id: string}` | endpoints api_type 重复 → 400 | FR-4, AC-5, AC-6 |
| PUT /admin/api/providers/:id | `(id, body: UpdateProviderSchema) → {success}` | `{success: boolean}` | 同上 | FR-4 |
| GET /admin/api/providers | `() → ProviderResponse[]` | `ProviderResponse[]` | endpoints 中 api_key 解密 | FR-4, AC-4 |

### Module: log-helpers

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| insertSuccessLog | `(db, params: RequestLogParams) → void` | void | upstream_api_type 可选 | FR-5, AC-7 |
| insertRejectedLog | `(params: RejectedLogParams) → void` | void | upstream_api_type 可选 | FR-5 |

### Module: db/logs

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| rawInsertRequestLog | `(db, log: RequestLogInsert, ctx?) → void` | void | 新增 upstream_api_type/base_url 列 | FR-5 |
| insertRequestLog | `(db, log: RequestLogInsert, ctx?) → void` | void | 同上 | FR-5 |

### Module: failover-loop

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| executeFailoverLoop | `(ctx, errors, deps, upstreamPath, adapter) → Promise<FastifyReply>` | `FastifyReply` | resolveEndpoint 集成 | FR-2 |
| resolveUpstreamPath | `(formatRegistry, body, clientApiType, providerApiType, upstreamPath, defaultPath, model) → {...}` | `{body, effectiveApiType, effectiveUpstreamPath, needsTransform}` | 无变化 | — |
| applyPluginAdjustments | `(pluginRegistry, body, clientApiType, provider) → {headers}` | `{headers}` | provider 参数改为 ResolvedEndpoint 字段 | — |

### Data: ProviderEndpoint

| Field | Type | Description |
|-------|------|-------------|
| api_type | `"openai" \| "openai-responses" \| "anthropic"` | API 协议类型 |
| base_url | `string` | 上游基础 URL |
| upstream_path | `string \| null` | 可选路径覆盖 |
| api_key | `string \| null` | 独立密钥（密文），null 时 fallback |

### Data: ResolvedEndpoint

| Field | Type | Description |
|-------|------|-------------|
| api_type | `string` | 实际上游 API 类型 |
| base_url | `string` | 实际上游基础 URL |
| upstream_path | `string \| null` | 实际路径覆盖 |
| api_key | `string` | 已解密密钥（永不为 null） |
| needs_transform | `boolean` | 是否需要格式转换 |

## §7 AC 覆盖矩阵

| Spec AC | Backend Method / Data Flow | 影响文件 | Task |
|---------|---------------------------|---------|------|
| AC-1: 单 endpoint 向后兼容 | `resolveEndpoint()` — 精确匹配 endpoints[0]，`needs_transform=false` | failover-loop.ts, resolve-endpoint.ts | Task 1 (types), Task 2 (migration), Task 3 (resolveEndpoint) |
| AC-2: 多 endpoint 精确匹配 (openai+anthropic) | `resolveEndpoint()` — 按 clientApiType 查找匹配 | resolve-endpoint.ts | Task 3 |
| AC-2b: 含 openai-responses 匹配 | `resolveEndpoint()` — 支持 "openai-responses" 值 | resolve-endpoint.ts, admin/providers.ts (schema) | Task 3 |
| AC-3: 无匹配时格式转换降级 | `resolveEndpoint()` — fallback endpoints[0]，`needs_transform=true` | resolve-endpoint.ts, failover-loop.ts | Task 3 |
| AC-3b: openai-responses → openai 降级 | `resolveEndpoint()` + FormatRegistry 现有逻辑 | resolve-endpoint.ts | Task 3 |
| AC-4: endpoint 独立 api_key + 加密 | admin/providers.ts `encrypt()` per endpoint, `resolveEndpoint()` 解密 | admin/providers.ts, resolve-endpoint.ts | Task 4 (admin API) |
| AC-5: DB 迁移正向流程 | migration 051 SQL + `initDatabase()` 自动执行 | 051_provider_endpoints.sql | Task 2 |
| AC-5: 创建正向流程 | POST /admin/api/providers — endpoints 加密写入 | admin/providers.ts | Task 4 |
| AC-6: api_type 唯一性校验 | POST/PUT handler — 应用层校验 api_type 去重 | admin/providers.ts | Task 4 |
| AC-7: 日志记录上下游 api_type | `insertSuccessLog` / `insertRejectedLog` 新增字段传递 | log-helpers.ts, db/logs.ts, failover-loop.ts | Task 5 (日志) |
| AC-10: upstream_path 覆盖 | `resolveEndpoint()` → `resolvedEndpoint.upstream_path` → `resolveUpstreamPath()` | failover-loop.ts | Task 3 |

### 数据流链

**主请求流（改造后）**:
```
failover-loop.ts
  → getProviderById(db, resolved.provider_id)
  → resolveEndpoint(provider, clientApiType, encryptionKey)  ← 新增
    → parseEndpoints(provider.endpoints)
    → 匹配 / fallback
    → decrypt(api_key)
  → resolveUpstreamPath(formatRegistry, body, clientApiType, resolvedEndpoint.api_type, ...)
  → applyPluginAdjustments(..., resolvedEndpoint.api_type, resolvedEndpoint.base_url)
  → applyProviderPatches({base_url: resolvedEndpoint.base_url, api_type: resolvedEndpoint.api_type, ...})
  → buildTransportFn({provider, apiKey: resolvedEndpoint.api_key, apiType: resolvedEndpoint.api_type, ...})
  → logResilienceResult(..., upstream_api_type: resolvedEndpoint.api_type, upstream_base_url: resolvedEndpoint.base_url)
```

**Admin Create Provider 流**:
```
POST /admin/api/providers
  → 校验 endpoints (去重、URL)
  → 遍历 endpoints: api_key 非null → encrypt()
  → 同步旧字段 (api_type/base_url/api_key/upstream_path = endpoints[0])
  → serializeEndpoints(endpoints)
  → createProvider(db, {..., endpoints: serialized})
```

**Admin Get Provider 流**:
```
GET /admin/api/providers
  → getAllProviders(db)
  → 遍历 providers:
    → parseEndpoints(provider.endpoints)
    → 遍历 endpoints: api_key 非null → decrypt()
    → 返回 {endpoints: decryptedEndpoints, ...}
```

## §8 影响文件完整列表

| 文件 | 变更类型 | 改动说明 |
|------|---------|---------|
| `router/src/core/types.ts` | modify | 新增 `ProviderEndpoint`, `ResolvedEndpoint` 类型 |
| `router/src/db/providers.ts` | modify | 新增 `parseEndpoints()`, `serializeEndpoints()`；`PROVIDER_FIELDS` 加 `endpoints`；`Provider` interface 加 `endpoints` |
| `router/src/db/migrations/051_provider_endpoints.sql` | create | ALTER TABLE + endpoints 数据迁移 |
| `router/src/db/migrations/052_add_upstream_log_fields.sql` | create | request_logs 新增 upstream_api_type + upstream_base_url 列 |
| `router/src/db/logs.ts` | modify | `RequestLogInsert` 新增字段；`rawInsertRequestLog` INSERT 语句扩展 |
| `router/src/admin/providers.ts` | modify | Schema 新增 `endpoints`；Create/Update 处理逻辑改造；Get 解密 endpoints；api_type 去重校验 |
| `router/src/proxy/handler/failover-loop.ts` | modify | 集成 `resolveEndpoint()`，替换所有 `provider.api_type/base_url/upstream_path/api_key` 直接访问 |
| `router/src/proxy/log-helpers.ts` | modify | `RequestLogParams` / `RejectedLogParams` 新增字段；传递到 `insertRequestLog` |
| `router/src/proxy/hooks/builtin/plugin-request.ts` | modify | 构造 `ProviderInfo` 时使用 `resolvedEndpoint.*` |
| `router/src/proxy/hooks/builtin/provider-patches.ts` | modify | 同上 |
| `router/src/proxy/transport/transport-fn.ts` | 无代码变更 | 调用方传参已变，但接口不变 |

## §9 非功能性设计

### 稳定性

- 迁移幂等（`WHERE endpoints IS NULL`），重复执行安全
- `resolveEndpoint()` 对空 endpoints 直接 throw，不会静默降级
- 旧字段同步更新（`endpoints[0]` → 旧字段），确保任何未改造的旧代码路径仍可工作

### 数据一致性

- endpoints 写入时同步更新旧字段，保持双写一致性
- api_key 加密/解密使用同一 `encryptionKey`，不存在密钥不匹配风险
- SQLite 单写者模型，无并发写入冲突

### 性能

- `parseEndpoints()` 单次 `JSON.parse`，Provider 数量 < 50，性能影响可忽略
- `resolveEndpoint()` 每次请求调用一次，O(n) 遍历（n ≤ 3），无性能问题
- `resolveEndpoint()` 内部 `decrypt()` 调用可由调用方 `decryptedApiKeys` Map 缓存

### 业务安全

- endpoint api_key 使用与 provider api_key 相同的 AES-256-GCM 加密
- Admin API 返回前解密，DB 存储始终为密文
- api_type 白名单限制（`openai`/`openai-responses`/`anthropic`），不允许注入任意值
