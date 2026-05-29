---
verdict: pass
---

# API Contract — Provider Multi-API-Type

## Admin API

### POST /admin/api/providers

#### Request Body (New Format)

**新格式（endpoints 数组）**:

```json
{
  "name": "my-provider",
  "endpoints": [
    {
      "api_type": "openai",
      "base_url": "https://api.openai.com",
      "upstream_path": null,
      "api_key": "sk-actual-key-123"
    },
    {
      "api_type": "anthropic",
      "base_url": "https://api.anthropic.com",
      "upstream_path": null,
      "api_key": null
    }
  ],
  "models": ["gpt-4o", "claude-3-5-sonnet"],
  "is_active": 1,
  "max_concurrency": 10,
  "queue_timeout_ms": 30000,
  "max_queue_size": 100,
  "adaptive_enabled": 0,
  "proxy_type": null,
  "proxy_url": null,
  "proxy_username": null,
  "proxy_password": null
}
```

**向后兼容格式（旧客户端，无 endpoints）**:

```json
{
  "name": "my-provider",
  "api_type": "openai",
  "base_url": "https://api.openai.com",
  "upstream_path": null,
  "api_key": "sk-actual-key-123",
  "models": ["gpt-4o"],
  "is_active": 1
}
```

**字段说明**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | Provider 名称，唯一 |
| `endpoints` | Endpoint[] | 条件（与旧字段二选一） | 端点数组，至少 1 个 |
| `endpoints[].api_type` | string | 是 | `"openai"` / `"openai-responses"` / `"anthropic"` |
| `endpoints[].base_url` | string | 是 | 合法 HTTP(S) URL |
| `endpoints[].upstream_path` | string \| null | 否 | 路径覆盖 |
| `endpoints[].api_key` | string \| null | 否 | null = 使用 provider 级共享 key |
| `api_type` | string | 条件 | 旧字段，有 endpoints 时忽略 |
| `base_url` | string | 条件 | 旧字段，有 endpoints 时忽略 |
| `api_key` | string | 条件 | 旧字段，有 endpoints 时忽略 |
| `upstream_path` | string | 否 | 旧字段，有 endpoints 时忽略 |
| `models` | array | 否 | 模型列表 |
| `is_active` | number | 否 | 默认 1 |
| `max_concurrency` | integer | 否 | 默认 0 |
| `queue_timeout_ms` | integer | 否 | 默认 0 |
| `max_queue_size` | integer | 否 | 默认 100 |
| `adaptive_enabled` | integer | 否 | 默认 0 |
| `proxy_type` | string \| null | 否 | `"http"` / `"socks5"` / null |
| `proxy_url` | string \| null | 否 | 代理 URL |
| `proxy_username` | string \| null | 否 | 代理用户名 |
| `proxy_password` | string \| null | 否 | 代理密码 |

**校验规则**:

| 规则 | HTTP Status | 错误信息 |
|------|-------------|---------|
| name 重复 | 409 | `Provider 名称 'xxx' 已存在` |
| name 非法字符 | 400 | `Provider 名称仅允许英文大小写字母、数字、横线和下划线` |
| endpoints 为空数组 | 400 | `endpoints 必须至少包含 1 个端点` |
| endpoints api_type 重复 | 400 | `endpoints 中 api_type 'xxx' 重复` |
| endpoints[].base_url 非法 URL | 400 | `endpoint[0].base_url 格式无效` |
| endpoints 和旧字段均缺失 | 400 | `缺少 endpoints 或 api_type/base_url/api_key` |

#### Response

**成功 (201)**:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**失败 — api_type 重复 (400)**:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "endpoints 中 api_type 'openai' 重复"
}
```

**失败 — name 重复 (409)**:

```json
{
  "code": "CONFLICT_NAME",
  "message": "Provider 名称 'my-provider' 已存在"
}
```

---

### PUT /admin/api/providers/:id

#### Request Body (New Format)

**完整更新（含 endpoints）**:

```json
{
  "name": "my-provider-updated",
  "endpoints": [
    {
      "api_type": "openai",
      "base_url": "https://api.openai.com",
      "upstream_path": "/custom/path",
      "api_key": "sk-new-key"
    },
    {
      "api_type": "openai-responses",
      "base_url": "https://api.openai.com",
      "upstream_path": null,
      "api_key": "sk-new-key"
    },
    {
      "api_type": "anthropic",
      "base_url": "https://api.anthropic.com",
      "upstream_path": null,
      "api_key": "sk-ant-key"
    }
  ]
}
```

**部分更新（仅更新 name）**:

```json
{
  "name": "new-name"
}
```

**部分更新（仅更新 endpoints）**:

```json
{
  "endpoints": [
    {
      "api_type": "openai",
      "base_url": "https://new-url.com",
      "api_key": "new-key"
    }
  ]
}
```

**向后兼容更新（旧字段，自动组装 endpoints）**:

```json
{
  "api_type": "openai",
  "base_url": "https://new-url.com",
  "api_key": "new-key"
}
```

**字段说明**: 与 POST 相同，所有字段可选（partial update）。`endpoints` 存在时覆盖整个数组。

**特殊行为**:
- 更新 `endpoints` 时同步更新旧字段（`api_type`/`base_url`/`api_key`/`upstream_path` = `endpoints[0]` 的值）
- 更新旧字段时，读取现有 `endpoints`，更新第一个 endpoint 的对应字段
- `api_key` 每次更新都会重新加密
- `is_active` 从 1→0 时触发级联禁用（映射组中引用此 provider 的 target 被移除）

#### Response

**成功 (200)**:

```json
{
  "success": true,
  "cascadedGroups": []
}
```

**Provider 不存在 (404)**:

```json
{
  "code": "NOT_FOUND",
  "message": "Provider not found"
}
```

**api_type 重复 (400)**:

```json
{
  "code": "VALIDATION_FAILED",
  "message": "endpoints 中 api_type 'openai' 重复"
}
```

---

### GET /admin/api/providers

#### Response (New Format)

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "my-provider",
    "api_type": "openai",
    "base_url": "https://api.openai.com",
    "upstream_path": null,
    "api_key": "sk-actual-key-123",
    "endpoints": [
      {
        "api_type": "openai",
        "base_url": "https://api.openai.com",
        "upstream_path": null,
        "api_key": "sk-actual-key-123"
      },
      {
        "api_type": "anthropic",
        "base_url": "https://api.anthropic.com",
        "upstream_path": null,
        "api_key": ""
      }
    ],
    "models": [
      {
        "name": "gpt-4o",
        "context_window": 128000,
        "patches": [],
        "capabilities": ["text", "image"]
      }
    ],
    "is_active": 1,
    "max_concurrency": 10,
    "queue_timeout_ms": 30000,
    "max_queue_size": 100,
    "adaptive_enabled": 0,
    "proxy_type": null,
    "proxy_url": null,
    "proxy_username": null,
    "proxy_password": null,
    "concurrency_status": {
      "active": 2,
      "queued": 0
    },
    "created_at": "2026-05-29T10:00:00.000Z",
    "updated_at": "2026-05-29T12:00:00.000Z"
  }
]
```

**字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `api_type` | string | **deprecated**，= `endpoints[0].api_type`，向后兼容 |
| `base_url` | string | **deprecated**，= `endpoints[0].base_url` |
| `upstream_path` | string \| null | **deprecated**，= `endpoints[0].upstream_path` |
| `api_key` | string | **deprecated**，= `endpoints[0].api_key`（解密后） |
| `endpoints` | Endpoint[] | **新增**，所有端点列表 |
| `endpoints[].api_key` | string | 解密后的明文；原为 null 时返回 `""` |

**关键行为**:
- 旧字段从 `endpoints[0]` 派生，保持向后兼容
- `endpoints[].api_key` 为 `null` 时返回空字符串 `""`（与旧字段 `api_key` 返回解密值的行为一致）
- 单 endpoint Provider：`endpoints` 数组只有 1 个元素，旧字段与它完全相同

---

### GET /admin/api/providers/:id

#### Response (New Format)

与 GET /admin/api/providers 返回数组中的单个元素结构完全相同。

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "my-provider",
  "api_type": "openai",
  "base_url": "https://api.openai.com",
  "upstream_path": null,
  "api_key": "sk-actual-key-123",
  "endpoints": [
    {
      "api_type": "openai",
      "base_url": "https://api.openai.com",
      "upstream_path": null,
      "api_key": "sk-actual-key-123"
    }
  ],
  "models": [...],
  "is_active": 1,
  "max_concurrency": 10,
  "queue_timeout_ms": 30000,
  "max_queue_size": 100,
  "adaptive_enabled": 0,
  "proxy_type": null,
  "proxy_url": null,
  "proxy_username": null,
  "proxy_password": null,
  "concurrency_status": { "active": 0, "queued": 0 },
  "created_at": "2026-05-29T10:00:00.000Z",
  "updated_at": "2026-05-29T12:00:00.000Z"
}
```

**Provider 不存在 (404)**:

```json
{
  "code": "NOT_FOUND",
  "message": "Provider not found"
}
```

---

## Internal API (新增)

### resolveEndpoint()

#### Signature

```typescript
function resolveEndpoint(
  provider: Provider,
  clientApiType: "openai" | "openai-responses" | "anthropic",
  encryptionKey: string,
): ResolvedEndpoint
```

#### Parameters

| 参数 | 类型 | 说明 |
|------|------|------|
| `provider` | `Provider` | 完整 Provider DB 行（含 `endpoints` 字段） |
| `clientApiType` | `ApiType` | 客户端请求的 API 类型（来自 `ctx.apiType`） |
| `encryptionKey` | `string` | AES-256-GCM 解密密钥（来自 `getSetting(db, "encryption_key")`） |

#### Returns

```typescript
interface ResolvedEndpoint {
  api_type: "openai" | "openai-responses" | "anthropic";
  base_url: string;
  upstream_path: string | null;
  api_key: string;            // 已解密，永不为 null
  needs_transform: boolean;
}
```

#### Error Cases

| 场景 | 行为 | 触发条件 |
|------|------|---------|
| endpoints 为空 | throw Error `Provider has no endpoints` | 数据异常（迁移未执行或被手动清空） |
| api_key 解密失败 | 抛出 `Error`（`decrypt` 内部 `throw`） | 加密数据损坏或密钥错误 |
| encryptionKey 为空 | 上层（failover-loop）已有 `!encryptionKey` 检查，返回 502 | 配置缺失 |

#### 调用点

| 调用方 | 文件 | 上下文 |
|--------|------|--------|
| `executeFailoverLoop` | `proxy/handler/failover-loop.ts` | 每次请求（failover 迭代内） |

#### 调用链

```
executeFailoverLoop()
  → getProviderById(db, target.provider_id)
  → resolveEndpoint(provider, clientApiType, encryptionKey)  ← 新增
  → resolveUpstreamPath(..., resolvedEndpoint.api_type, resolvedEndpoint.upstream_path, ...)
  → applyPluginAdjustments(..., resolvedEndpoint.api_type, {base_url: resolvedEndpoint.base_url, api_type: resolvedEndpoint.api_type})
  → applyProviderPatches({base_url: resolvedEndpoint.base_url, api_type: resolvedEndpoint.api_type, models: ...})
  → buildTransportFn({provider, apiKey: resolvedEndpoint.api_key, apiType: resolvedEndpoint.api_type, ...})
  → logResilienceResult(..., upstream_api_type: resolvedEndpoint.api_type, upstream_base_url: resolvedEndpoint.base_url)
```

---

### parseEndpoints()

#### Signature

```typescript
function parseEndpoints(
  endpointsJson: string | null | undefined,
): ProviderEndpoint[]
```

#### Parameters

| 参数 | 类型 | 说明 |
|------|------|------|
| `endpointsJson` | `string \| null \| undefined` | DB 中 `providers.endpoints` 列的原始 JSON 文本 |

#### Returns

`ProviderEndpoint[]` — 解析后的端点数组。

#### Error Cases

| 输入 | 输出 | 说明 |
|------|------|------|
| `null` | `[]` | 迁移未执行或字段为空 |
| `undefined` | `[]` | Provider 对象无此字段 |
| `""` | `[]` | 空字符串 |
| `"[]"` | `[]` | 空数组 |
| 非法 JSON | throw Error | Provider 数据损坏，不应静默忽略 |

#### 调用点

| 调用方 | 文件 | 上下文 |
|--------|------|--------|
| `resolveEndpoint` | `db/providers.ts` | 解析 provider 的 endpoints |
| `GET /admin/api/providers` handler | `admin/providers.ts` | 解密 endpoints 中 api_key |
| `PUT /admin/api/providers/:id` handler | `admin/providers.ts` | 旧字段更新时读取现有 endpoints |

---

### serializeEndpoints()

#### Signature

```typescript
function serializeEndpoints(
  endpoints: ProviderEndpoint[],
): string
```

#### Parameters

| 参数 | 类型 | 说明 |
|------|------|------|
| `endpoints` | `ProviderEndpoint[]` | 端点数组（api_key 此时可能已加密） |

#### Returns

`string` — JSON 字符串，用于写入 DB。

#### 调用点

| 调用方 | 文件 | 上下文 |
|--------|------|--------|
| `POST /admin/api/providers` handler | `admin/providers.ts` | 创建 Provider 时序列化 |
| `PUT /admin/api/providers/:id` handler | `admin/providers.ts` | 更新 Provider 时序列化 |

---

### endpoints 加密流程

**写入（Create/Update）**:

```
前端提交 endpoints: [{api_type: "openai", api_key: "sk-plain-key"}]
  → Admin handler 遍历:
    if endpoint.api_key !== null:
      endpoint.api_key = encrypt(endpoint.api_key, encryptionKey)
  → serializeEndpoints(endpoints) → DB
```

**读取（Get）**:

```
DB 返回 endpoints: '[{"api_type":"openai","api_key":"enc:iv:tag:ct"}]'
  → parseEndpoints(provider.endpoints)
  → 遍历:
    if endpoint.api_key !== null:
      endpoint.api_key = decrypt(endpoint.api_key, encryptionKey)
    else:
      endpoint.api_key = ""  // null → 空字符串，表示 fallback 到共享 key
```

**运行时（resolveEndpoint）**:

```
resolveEndpoint(provider, clientApiType, encryptionKey)
  → parseEndpoints(provider.endpoints)
  → 匹配 endpoint
  → rawKey = endpoint.api_key ?? provider.api_key
  → decrypt(rawKey, encryptionKey)
```
