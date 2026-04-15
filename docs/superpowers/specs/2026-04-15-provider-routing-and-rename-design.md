# Provider 路由修复 & backend_service → provider 重命名

## 动机

两个问题需要一起解决：

1. **路由逻辑错误**：模型映射表 `model_mappings` 有 `backend_service_id` 字段关联具体供应商，但代理代码始终取 `backends[0]`（同类型第一个活跃后端），忽略了映射中指定的供应商。导致多供应商场景下请求无法路由到正确的 base_url / api_key。
2. **命名不一致**：`backend_service` 是实现细节命名，不如 `provider`（供应商）直观。

## 设计

### 1. 数据库迁移（新增 004）

```sql
-- 001_init.sql 中的定义
-- backend_services → providers
-- model_mappings.backend_service_id → provider_id
-- request_logs.backend_service_id → provider_id

ALTER TABLE backend_services RENAME TO providers;

ALTER TABLE model_mappings RENAME COLUMN backend_service_id TO provider_id;

ALTER TABLE request_logs RENAME COLUMN backend_service_id TO provider_id;
```

SQLite 3.25.0+ 支持 `RENAME COLUMN`，better-sqlite3 捆绑的版本满足要求。
SQLite 3.26.0+ 的 RENAME TABLE 会自动更新外键 schema 中的表名引用（`REFERENCES backend_services(id)` → `REFERENCES providers(id)`）。
better-sqlite3 默认 `PRAGMA foreign_keys = OFF`，迁移执行无额外限制。

### 2. 后端 TypeScript 重命名

#### `src/db/index.ts`

| 旧名 | 新名 |
|------|------|
| `BackendService` 接口 | `Provider` 接口 |
| `getActiveBackendServices()` | `getActiveProviders()` |
| `getBackendServiceById()` | `getProviderById()` |
| `getAllBackendServices()` | `getAllProviders()` |
| `createBackendService()` | `createProvider()` |
| `updateBackendService()` | `updateProvider()` |
| `deleteBackendService()` | `deleteProvider()` |
| `ModelMapping.backend_service_id` | `ModelMapping.provider_id` |
| `RequestLog.backend_service_id` | `RequestLog.provider_id` |
| `insertRequestLog` 中参数 | `provider_id` |

函数内部 SQL 语句中 `backend_services` → `providers`，`backend_service_id` → `provider_id`。

#### `src/proxy/openai.ts` & `src/proxy/anthropic.ts`

**重命名导入**：`BackendService` → `Provider`，函数名同步更新。

**路由逻辑修改**（核心改动，适用于 `POST /v1/chat/completions` 和 `POST /v1/messages`）：

```
之前:
  backends = getActiveBackendServices(db, "openai")
  backend = backends[0]                    // 总是取第一个
  mapping = getModelMapping(db, clientModel)
  if (mapping) body.model = mapping.backend_model
  apiKey = decrypt(backend.api_key, ...)

之后:
  mapping = getModelMapping(db, clientModel)
  if (!mapping) → 404 "Model '{clientModel}' is not configured"
  provider = getProviderById(db, mapping.provider_id)
  if (!provider || !provider.is_active) → 503 "Provider unavailable"
  if (provider.api_type !== "openai") → 500 "Provider type mismatch for this endpoint"
  body.model = mapping.backend_model
  apiKey = decrypt(provider.api_key, ...)
```

**`GET /v1/models` 端点（仅 openai.ts）**：此端点不涉及模型映射，仍需获取活跃 provider 列表。保留 `getActiveProviders(db, "openai")` 取第一个活跃 provider 的逻辑不变。

**`getActiveProviders` 保留**：重命名后保留此函数，仅供 `/v1/models` 端点使用。`POST` 请求路由不再调用它。

#### `src/admin/services.ts` → 重命名为 `src/admin/providers.ts`

- 导出函数名：`adminServiceRoutes` → `adminProviderRoutes`
- API 路径：`/admin/api/services` → `/admin/api/providers`
- 内部调用重命名同步

#### `src/admin/mappings.ts`

- `backend_service_id` → `provider_id`（字段名、校验消息）
- 导入 `getProviderById` 替换 `getBackendServiceById`

#### `src/admin/routes.ts`

- 导入路径 `./services.js` → `./providers.js`
- `adminServiceRoutes` → `adminProviderRoutes`

### 3. 前端重命名

#### `frontend/src/views/Services.vue` → `Providers.vue`

- 页面标题：`后端服务` → `供应商`
- 变量名 `services` → `providers`，`loadServices` → `loadProviders`
- API 调用：`api.getServices()` → `api.getProviders()` 等

#### `frontend/src/views/ModelMappings.vue`

- 表头 `关联服务` → `关联供应商`
- `getServiceName()` → `getProviderName()`
- `servicesList` → `providersList`
- `form.backend_service_id` → `form.provider_id`
- API 调用同步更新

#### `frontend/src/api/client.ts`

```typescript
// 旧
getServices, createService, updateService, deleteService
// 新
getProviders, createProvider, updateProvider, deleteProvider
```

URL 路径 `/services` → `/providers`。

#### `frontend/src/router/index.ts`

- 路由路径：`/admin/services` → `/admin/providers`
- 组件导入：`Services.vue` → `Providers.vue`

#### `frontend/src/components/layout/Sidebar.vue`

- 路径：`/admin/services` → `/admin/providers`
- 标签：`后端服务` → `供应商`

### 4. 测试更新

以下测试文件中所有 `backend_service` / `BackendService` / `services` 相关引用同步更新：

- `tests/db.test.ts`
- `tests/openai-proxy.test.ts`
- `tests/anthropic-proxy.test.ts`
- `tests/models-proxy.test.ts`
- `tests/logging.test.ts`
- `tests/integration.test.ts`
- `tests/admin-services.test.ts` → 重命名为 `tests/admin-providers.test.ts`
- `tests/admin-mappings.test.ts`
- `tests/admin-logs.test.ts`

代理测试新增用例：
- 无映射时返回 404
- 映射指向的 provider 不存在时返回 503
- 映射指向的 provider 已禁用时返回 503
- 映射指向的 provider api_type 不匹配时返回 500（使用 openaiError/anthropicError 格式，error type 为 `server_error`）

### 5. 不改的部分

- `src/db/migrations/001_init.sql` — 迁移文件保持原样（已执行过）
- `tests/config.test.ts`、`tests/crypto.test.ts` — 不涉及 backend_service 引用
- `src/index.ts` — 只需更新导入名称

## 改动范围汇总

| 层 | 文件 | 改动类型 |
|----|------|---------|
| DB | `src/db/migrations/004_rename_to_providers.sql` | 新增 |
| DB | `src/db/index.ts` | 重命名 + 路由逻辑 |
| Proxy | `src/proxy/openai.ts` | 路由逻辑 + 重命名 |
| Proxy | `src/proxy/anthropic.ts` | 路由逻辑 + 重命名 |
| Admin | `src/admin/services.ts` → `providers.ts` | 文件重命名 + 重命名 |
| Admin | `src/admin/mappings.ts` | 字段重命名 |
| Admin | `src/admin/routes.ts` | 导入更新 |
| Admin | `src/admin/logs.ts` | 字段重命名（SQL 中 backend_service_id → provider_id） |
| Admin | `src/admin/stats.ts` | 字段重命名（如有引用） |
| Entry | `src/index.ts` | 导入更新 |
| Frontend | `views/Services.vue` → `Providers.vue` | 文件重命名 + 重命名 |
| Frontend | `views/ModelMappings.vue` | 字段重命名 |
| Frontend | `api/client.ts` | API 路径重命名 |
| Frontend | `router/index.ts` | 路由路径重命名 |
| Frontend | `components/layout/Sidebar.vue` | 标签 + 路径 |
| Tests | 8 个测试文件 | 同步重命名 + 新增用例 |
