---
verdict: "fail"
must_fix: 2
review_metrics:
  files_reviewed: 8
  issues_found: 7
  must_fix_count: 2
  low_count: 3
  info_count: 2
reviewer: robustness-expert
date: 2026-05-29
scope: Provider Multi-API-Type feature
---

# Robustness Review v1 — Provider Multi-API-Type

## 审查文件

| 文件 | 行数 | 角色 |
|------|------|------|
| `router/src/proxy/routing/resolve-endpoint.ts` | 53 | Endpoint 解析核心 |
| `router/src/db/providers.ts` | 140 | DB 层 + parseEndpoints |
| `router/src/admin/providers.ts` | 460+ | Admin CRUD API |
| `router/src/proxy/handler/failover-loop.ts` | 630+ | Failover 循环 |
| `router/src/proxy/log-helpers.ts` | 120+ | 日志辅助 |
| `router/src/db/logs.ts` | 300+ | 日志 DB 层 |
| `frontend/src/components/providers/EndpointEditor.vue` | 150 | Endpoint 编辑器组件 |
| `frontend/src/composables/useProviderForm.ts` | 300+ | 表单状态管理 |

---

## 六维度审查

### 1. 错误处理

#### MUST-FIX-1: resolveEndpoint 在 failover-loop 中缺少异常保护

**文件**: `failover-loop.ts:342`
**严重度**: MUST FIX

`resolveEndpoint()` 调用位于 `while(true)` 循环内，但在 `try { orchestrator.handle }` (line 434) **之前**。如果 `resolveEndpoint` 内部的 `parseEndpoints` (malformed JSON) 或 `decrypt` (corrupt key) 抛出异常，错误会：

1. 跳出 `while(true)` 循环，**没有 try-catch 保护**
2. 传播到 `executeFailoverLoop` 的调用方（Fastify 路由回调）
3. 由 Fastify 默认 error handler 发送 generic 500 — 无日志上下文，无 request_log 记录
4. 在多 target failover 场景下，**不会尝试下一个 target**（应 failover 而非直接崩溃）

**代码路径**:
```
resolveEndpoint(provider, clientApiType, encryptionKey)
  → parseEndpoints(provider.endpoints)       // malformed JSON → SyntaxError
  → decrypt(endpoint.api_key, encryptionKey)  // corrupt key → Error
```

**修复建议**: 将 `resolveEndpoint` 调用及后续 setup 代码纳入 try-catch。catch 中将当前 target 加入 `excludeTargets` 并 `continue`，与 `ProviderSwitchNeeded` 处理对称。如果所有 target 都失败，由现有的 `filterExcluded.length === 0` 分支兜底回复。

```typescript
// 建议结构
try {
  const resolvedEndpoint = resolveEndpoint(provider, clientApiType, encryptionKey);
  // ... buildTransportFn, format transforms ...
} catch (endpointError) {
  request.log.error({ err: endpointError, providerId: provider.id }, "resolveEndpoint failed");
  insertRejectedLog({ ...rCtx, statusCode: 502, errorMessage: String(endpointError) });
  excludeTargets.push(resolved);
  continue;  // failover to next target
}
```

#### MUST-FIX-2: parseEndpoints 不校验元素必要字段

**文件**: `providers.ts:61-72`
**严重度**: MUST FIX

`parseEndpoints` 只校验了"是对象"，没有验证 `api_type` 和 `base_url` 是否存在。恶意或损坏的数据可以写入 DB（如通过直接 SQL 操作），然后：

1. `resolveEndpoint` 中 `endpoints.find(ep => ep.api_type === clientApiType)` 可能永远不匹配
2. fallback 到 `endpoints[0]` 后，`endpoint.base_url` 可能为 undefined，导致 HTTP 请求发送到 undefined URL
3. `endpoint.api_type` 可能是非法值，导致 format registry 找不到对应的 adapter

**当前代码**:
```typescript
for (const item of parsed) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`Invalid endpoints JSON: contains non-object element`);
  }
  // 缺少: api_type 是否为合法值? base_url 是否存在?
}
return parsed as ProviderEndpoint[];  // 盲断言
```

**修复建议**:
```typescript
const VALID_API_TYPES = new Set(["openai", "openai-responses", "anthropic"]);
for (const item of parsed) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`Invalid endpoints JSON: contains non-object element`);
  }
  const obj = item as Record<string, unknown>;
  if (!VALID_API_TYPES.has(obj.api_type as string)) {
    throw new Error(`Invalid endpoint: api_type '${String(obj.api_type)}' is not valid (provider endpoints)`);
  }
  if (typeof obj.base_url !== "string" || !obj.base_url) {
    throw new Error(`Invalid endpoint: base_url is required (provider endpoints)`);
  }
}
```

### 2. 异常安全

#### LOW-1: resolveEndpoint 对 provider.api_key 为 null 的情况不防御

**文件**: `resolve-endpoint.ts:17,38`
**严重度**: LOW

Legacy 路径（endpoints 为空）和 endpoint fallback 路径中，`provider.api_key` 可能为 null/undefined（虽然 admin API 校验了必填，但 DB 直接操作可以写入 null）。

```typescript
const rawKey = provider.api_key;          // 可能为 null
const decryptedKey = decrypt(rawKey, encryptionKey);  // decrypt(null, key) 会抛异常
```

**修复建议**: 加防御检查：
```typescript
const rawKey = provider.api_key;
if (!rawKey) throw new Error(`Provider '${provider.id}' has no api_key configured`);
```

### 3. 日志

#### LOW-2: parseEndpoints 错误消息缺少 provider 上下文

**文件**: `providers.ts:65,68`
**严重度**: LOW

`parseEndpoints` 函数签名只接收 `endpointsJson`，没有 `providerId`。抛出的错误消息是：
```
Invalid endpoints JSON: not an array
Invalid endpoints JSON: contains non-object element
```

排查时无法定位是哪个 provider 的 endpoints 有问题。

**修复建议**: 在 `resolveEndpoint` 的调用层（而非 parseEndpoints 内部）catch 异常并添加 provider 上下文：
```typescript
try {
  const endpoints = parseEndpoints(provider.endpoints);
} catch (e) {
  throw new Error(`Provider '${provider.id}' (${provider.name}): ${(e as Error).message}`);
}
```

#### LOW-3: failover-loop 中 resolveEndpoint 异常不写 request_log

**文件**: `failover-loop.ts:342`
**严重度**: LOW（与 MUST-FIX-1 同根因）

当 `resolveEndpoint` 抛出异常时，没有 `insertRequestLog` 或 `insertRejectedLog` 调用。请求日志丢失，无法在管理后台看到失败记录。这与同循环中其他错误路径（如 provider 不可用、信号量超时）都写日志的做法不一致。

### 4. Fail-fast

**Admin API 校验** ✅ 完整

`validateAndEncryptEndpoints` 函数在写入 DB 前校验：
- 重复 api_type → 拒绝
- base_url 必须是合法 HTTP(S) URL → 拒绝
- TypeBox schema `EndpointSchema` 限制 api_type 为三个合法值

`CreateProviderSchema` 和 `UpdateProviderSchema` 的 `endpoints` 字段使用 `Type.Array(EndpointSchema, { minItems: 1 })` 确保至少一个元素。

**前端校验** ✅ 完整

`useProviderForm.validate()` 校验：
- 每个 endpoint 的 base_url 非空
- api_type 不重复
- zod schema 验证 name 格式

### 5. 测试友好

#### INFO-1: resolveEndpoint 是纯函数，易于单元测试

`resolveEndpoint` 接收 `Provider` 对象和字符串参数，无隐式依赖。可以构造 mock Provider 对象直接测试各种场景（空 endpoints、部分匹配、全部匹配、legacy fallback）。

`parseEndpoints` 也是纯函数，适合用 QuickCheck/property-based testing 覆盖边界情况。

### 6. 调试友好

#### INFO-2: 日志字段 upstream_api_type 和 upstream_base_url 提供良好上下文

`logResilienceResult` 和 `insertRequestLog` 都传入了 `upstream_api_type` 和 `upstream_base_url`（来自 `resolvedEndpoint`），可以在日志中区分实际使用的 endpoint。这是一个好的设计决策。

---

## 特别关注项

### resolveEndpoint 空数组/非法 JSON 处理

- **空数组**: `endpoints.length === 0` 时 fallback 到 provider 级字段 ✅
- **null/undefined endpoints**: `parseEndpoints(null)` → `[]` → legacy fallback ✅
- **malformed JSON**: `parseEndpoints("{bad")` → `JSON.parse` 抛 SyntaxError → **未捕获** ❌ (MUST-FIX-1)
- **合法 JSON 但缺字段**: `parseEndpoints('[{"api_type":"openai"}]')` → 通过校验但 base_url 为 undefined → **静默通过** ❌ (MUST-FIX-2)

### Admin API endpoints 校验完整性

- TypeBox schema 确保结构正确 ✅
- `validateAndEncryptEndpoints` 确保 URL 合法、无重复 api_type ✅
- 第一个 endpoint 的 api_key 必填（或 fallback body.api_key）✅
- 后续 endpoint 的 api_key 可选（fallback 到 provider.api_key）✅

### failover-loop 中 resolveEndpoint 异常响应处理

**当前**: 异常传播出 while 循环 → Fastify 默认 500 → **客户端不会挂起**（Fastify 兜底），但：
- 无结构化日志
- 无 request_log 记录
- failover 不继续（应该尝试下一个 target）

**期望**: catch 异常 → 排除当前 target → continue 循环 → 全部排空后返回错误响应

### 前端 EndpointEditor 空状态处理

- `modelValue` 为空数组时，v-for 不渲染任何卡片，只显示"添加"按钮和提示文字 ✅
- 只有一个 endpoint 时删除按钮 disabled（`modelValue.length <= 1`）✅
- 所有 api_type 都已使用时添加按钮 disabled ✅
- 新增 endpoint 默认使用第一个可用的 api_type ✅

### 迁移 051 幂等性

```sql
ALTER TABLE providers ADD COLUMN endpoints TEXT DEFAULT NULL;
UPDATE providers SET endpoints = ... WHERE endpoints IS NULL AND api_type IS NOT NULL AND base_url IS NOT NULL;
```

- `ALTER TABLE ADD COLUMN`: 重复执行会报 "duplicate column" 错误。但 SQLite 迁移框架（`initDatabase`）通过 tracking 表确保每条迁移只执行一次，所以实际不会重复执行 ✅
- `UPDATE ... WHERE endpoints IS NULL`: 幂等。首次执行后 endpoints 非空，后续执行不影响 ✅
- `WHERE` 条件正确排除了 api_type/base_url 为 NULL 的异常数据 ✅

---

## 汇总

| ID | 严重度 | 文件 | 问题 |
|----|--------|------|------|
| MUST-FIX-1 | MUST | failover-loop.ts:342 | resolveEndpoint 无 try-catch 保护，异常导致 failover 中断、无日志 |
| MUST-FIX-2 | MUST | providers.ts:61-72 | parseEndpoints 不校验 api_type/base_url 必填字段 |
| LOW-1 | LOW | resolve-endpoint.ts:17,38 | provider.api_key 为 null 时 decrypt 会抛异常 |
| LOW-2 | LOW | providers.ts:65,68 | parseEndpoints 错误消息缺少 provider 上下文 |
| LOW-3 | LOW | failover-loop.ts:342 | resolveEndpoint 异常路径不写 request_log |
| INFO-1 | INFO | resolve-endpoint.ts | 纯函数设计，测试友好 |
| INFO-2 | INFO | log-helpers, logs | upstream_api_type/base_url 字段提供良好调试上下文 |

**Verdict: FAIL** — 2 个 MUST FIX 需修复后重新审查。
