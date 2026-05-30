---
verdict: pass
must_fix: 0
review_metrics:
  files_reviewed: 14
  issues_found: 2
  must_fix_count: 0
  low_count: 1
  info_count: 1
---

# Integration Review — Provider Multi-API-Type

**Reviewer**: Integration Review (automated)
**Date**: 2026-05-29
**Spec**: `spec.md` (2026-05-29-provider-multi-api-type)
**Verdict**: **PASS** — 跨层数据流转完整、前后端格式一致、加密链路闭合、日志链路端到端贯通。

---

## 审查范围

| # | 文件 | 角色 |
|---|------|------|
| 1 | `router/src/proxy/routing/resolve-endpoint.ts` | 端点解析核心：parseEndpoints → match → decrypt → ResolvedEndpoint |
| 2 | `router/src/proxy/handler/failover-loop.ts` | resolveEndpoint 消费：try-catch 集成 + 日志传递 |
| 3 | `router/src/admin/providers.ts` | Admin API：endpoints 加密/解密/双写/TypeBox schema |
| 4 | `router/src/db/providers.ts` | parseEndpoints/serializeEndpoints + Provider 接口 + CRUD |
| 5 | `router/src/proxy/log-helpers.ts` | 日志桥梁：upstream_api_type/base_url 传递到 insertRequestLog |
| 6 | `router/src/db/logs.ts` | DB INSERT/SELECT：upstream_api_type/base_url 列完整覆盖 |
| 7 | `router/src/admin/logs.ts` | Admin 日志 API：GET 透传上游字段到前端 |
| 8 | `router/src/proxy/proxy-logging.ts` | logResilienceResult：diagnosticFields 统一传递 |
| 9 | `frontend/src/types/mapping.ts` | ProviderEndpoint 前端类型定义 |
| 10 | `frontend/src/api/client.ts` | ProviderPayload 类型：endpoints 数组格式 |
| 11 | `frontend/src/composables/useProviderForm.ts` | 表单 payload 构建 + openEdit 加载 |
| 12 | `frontend/src/composables/useQuickSetup.ts` | QuickSetup payload 构建：单 endpoint 包装 |
| 13 | `frontend/src/components/providers/EndpointEditor.vue` | 端点编辑器组件 |
| 14 | `frontend/src/views/Providers.vue` | 列表 + 表单集成 + getDisplayEndpoints |

---

## 链路验证

### 链路 1：Provider 创建 → DB 写入 → GET 读取 → 前端显示

**模拟数据**：`{ name: "multi-test", endpoints: [{ api_type: "openai", base_url: "https://api.openai.com", api_key: "sk-abc" }, { api_type: "anthropic", base_url: "https://api.anthropic.com", upstream_path: "/v1/messages", api_key: "sk-ant-xyz" }] }`

| 步骤 | 层 | 验证点 | 结果 |
|------|----|--------|------|
| 1. 前端构建 payload | `useProviderForm.buildPayload()` | `endpoints` 数组格式：`{ api_type, base_url, upstream_path?, api_key? }` | ✅ 与 `ProviderPayload.endpoints` 类型一致 |
| 2. TypeBox 校验 | `CreateProviderSchema` → `EndpointSchema` | `api_type` 为 literal union，`base_url` minLength 1，`upstream_path`/`api_key` optional | ✅ schema 覆盖所有字段 |
| 3. 业务校验 | `validateAndEncryptEndpoints()` | api_type 唯一性 + base_url URL 格式 + api_key 加密 | ✅ 加密后 api_key 为密文字符串 |
| 4. 双写 | `handleCreateProvider()` | `endpoints` 序列化 + `api_type/base_url/upstream_path/api_key` 同步到 provider 级旧字段 | ✅ `endpoints[0]` 字段正确同步 |
| 5. DB 写入 | `createProvider()` | INSERT 语句包含 `endpoints` 列 | ✅ PROVIDER_FIELDS 包含 "endpoints" |
| 6. GET 解密 | `GET /admin/api/providers` | `parseEndpoints(s.endpoints).map(ep => ...)` + decrypt api_key | ✅ null api_key → `""` 空字符串 |
| 7. 前端加载 | `useProviderForm.openEdit()` | `endpoints: p.endpoints.map(ep => ({ ... }))` | ✅ 字段名完全匹配 |
| 8. 前端展示 | `Providers.vue getDisplayEndpoints()` | `p.endpoints && p.endpoints.length > 0` → 返回 endpoints 数组，否则 fallback 到 provider 级字段 | ✅ 列表 Badge 展示正确 |

**QuickSetup 路径**：`buildProviderPayload()` 构造 `endpoints: [{ api_type, base_url, upstream_path?, api_key }]` → 与主路径格式一致。✅

### 链路 2：代理请求 → resolveEndpoint → transport → 日志 → 前端日志

**模拟数据**：Client 发送 `openai-responses` 请求，Provider 只有 `openai` endpoint

| 步骤 | 层 | 验证点 | 结果 |
|------|----|--------|------|
| 1. failover 循环 | `buildIterationSetup()` L257 | `resolveEndpoint(provider, clientApiType, encryptionKey)` | ✅ clientApiType 传入 |
| 2. 端点解析 | `resolveEndpoint()` | 无精确匹配 → fallback 到 endpoints[0]，`needs_transform = true` | ✅ 返回 ResolvedEndpoint |
| 3. api_key 解密 | `resolveEndpoint()` L39-40 | `endpoint.api_key ?? provider.api_key` → decrypt | ✅ fallback 到共享 key |
| 4. 格式转换决策 | `buildIterationSetup()` → `resolveUpstreamPath()` | `needs_transform=true` → `formatRegistry.transformRequest()` | ✅ 使用 resolvedEndpoint.api_type |
| 5. transport | `buildTransportFn({ resolvedBaseUrl })` | 使用 `resolvedEndpoint.base_url` | ✅ 不读取 provider 旧字段 |
| 6. 日志-正常完成 | `logResilienceResult()` | `diagnosticFields: { upstream_api_type, upstream_base_url }` | ✅ 从 params 透传 |
| 7. 日志-rejected | `insertRejectedLog()` | `upstream_api_type/base_url` 参数 | ✅ 字段传递到 insertRequestLog |
| 8. 日志-ProviderSwitchNeeded | `processResilienceResult()` catch 块 | `logResilienceResult(... upstreamApiType: resolvedEndpoint.api_type, upstreamBaseUrl: resolvedEndpoint.base_url)` | ✅ 3 条 catch 路径均传递 |
| 9. 日志-未知异常 | catch 块 insertRequestLog | `upstream_api_type: resolvedEndpoint.api_type, upstream_base_url: resolvedEndpoint.base_url` | ✅ 直接传递 |
| 10. DB INSERT | `rawInsertRequestLog()` | 30 个参数位，含 upstream_api_type + upstream_base_url | ✅ 列数量匹配参数数量 |
| 11. DB SELECT 列表 | `LOG_LIST_SELECT` | `rl.upstream_api_type, rl.upstream_base_url` | ✅ 查询包含两列 |
| 12. DB SELECT 详情 | `getRequestLogById()` | `rl.upstream_api_type, rl.upstream_base_url` | ✅ 查询包含两列 |
| 13. Admin API 透传 | `admin/logs.ts` GET | 直接 reply.send(row)，row 包含 upstream_api_type/base_url | ✅ 无字段过滤 |
| 14. 前端类型 | `logs/types.ts LogEntry` | `upstream_api_type?: string \| null; upstream_base_url?: string \| null` | ✅ 可选字段 |
| 15. 前端列表展示 | `LogTableRow.vue` L146-147 | `v-if="log.upstream_api_type && log.upstream_api_type !== log.api_type"` → `→ {{ log.upstream_api_type }}` | ✅ 条件展示（仅格式不同时显示） |
| 16. 前端详情展示 | `RequestOverviewPanel.vue` L241-263 | upstreamApiType + upstreamBaseUrl 双字段展示 | ✅ 包含 URL 展示 |

### 链路 3：加密/解密完整性

| 场景 | 写入路径 | 读取路径 | 结果 |
|------|---------|---------|------|
| endpoint 有独立 api_key | `validateAndEncryptEndpoints()` → `encrypt(e.api_key)` | `resolveEndpoint()` → `endpoint.api_key ?? provider.api_key` → `decrypt(rawKey)` | ✅ 密文写入，明文使用 |
| endpoint api_key = null | 写入 JSON `api_key: null` | `resolveEndpoint()` → `null ?? provider.api_key` → decrypt 共享 key | ✅ fallback 正确 |
| 旧 provider 无 endpoints | migration 051 → `api_key` 拷贝（已是密文） | `resolveEndpoint()` legacy 路径 → `decrypt(provider.api_key)` | ✅ 密文直接搬入 |
| Admin GET 展示 | — | `parseEndpoints(s.endpoints).map(ep => ({ api_key: ep.api_key ? decrypt(...) : "" }))` | ✅ null → "" |
| Admin Update endpoints | `validateAndEncryptEndpoints()` → encrypt | 读取时 decrypt | ✅ 写入加密/读取解密对称 |

### 链路 4：resolveEndpoint 异常集成

| 路径 | 异常处理 | 结果 |
|------|---------|------|
| `buildIterationSetup()` 内 resolveEndpoint 抛异常 | 外层 try-catch (L764-817) 捕获 → `insertRejectedLog()` → `excludeTargets.push()` → `continue` | ✅ failover 到下一个 target |
| `encryptionKey` 为 null | 提前检查 (L242-247) → `rejectAndReply()` | ✅ 不进入 resolveEndpoint |
| `parseEndpoints()` 解析失败 | resolveEndpoint 内部 parseEndpoints 抛异常 → 被 failover loop try-catch 捕获 | ✅ |
| `decrypt()` 解密失败 | resolveEndpoint 内 decrypt 抛异常 → 同上 | ✅ |

---

## 前后端格式一致性矩阵

| 字段 | Backend 类型 | Frontend 类型 | Admin API 序列化 | 一致 |
|------|-------------|--------------|-----------------|------|
| `ProviderEndpoint.api_type` | `ApiType` (= "openai" \| "openai-responses" \| "anthropic") | `"openai" \| "openai-responses" \| "anthropic"` | ✅ 字符串直传 | ✅ |
| `ProviderEndpoint.base_url` | `string` | `string` | ✅ 字符串直传 | ✅ |
| `ProviderEndpoint.upstream_path` | `string \| null \| undefined` | `string \| null \| undefined` | ✅ null 直传 | ✅ |
| `ProviderEndpoint.api_key` | `string \| null \| undefined` | `string \| null \| undefined` | ✅ null → `""` 在 GET 中 | ✅ |
| `endpoints` 数组元素顺序 | 按用户配置顺序 | 同上 | ✅ JSON 序列化保持顺序 | ✅ |
| TypeBox `EndpointSchema` | — | — | api_type literal union + base_url minLength 1 + optional fields | ✅ 与 TypeScript 类型匹配 |

---

## 日志字段消费者完整性

| 字段 | DB 写入 | DB SELECT 列表 | DB SELECT 详情 | Admin API | 前端类型 | 前端列表 | 前端详情 |
|------|---------|---------------|---------------|-----------|---------|---------|---------|
| `upstream_api_type` | ✅ rawInsertRequestLog | ✅ LOG_LIST_SELECT | ✅ getRequestLogById | ✅ 直传 | ✅ LogEntry | ✅ LogTableRow | ✅ RequestOverviewPanel |
| `upstream_base_url` | ✅ rawInsertRequestLog | ✅ LOG_LIST_SELECT | ✅ getRequestLogById | ✅ 直传 | ✅ LogEntry | — (不展示) | ✅ RequestOverviewPanel |

`upstream_base_url` 在列表页不展示，仅在详情页展示 — 这是合理的，列表页空间有限，URL 信息在详情页查看。✅

---

## Issues Found

### LOW-1: Admin GET endpoints 返回 `api_key: ""` 空字符串丢失 fallback 语义

**文件**: `router/src/admin/providers.ts` L369-373

```typescript
endpoints: parseEndpoints(s.endpoints).map(ep => ({
  ...
  api_key: ep.api_key ? decrypt(ep.api_key, encryptionKey) : "",
})),
```

当 endpoint 的 `api_key` 为 `null`（表示 fallback 到 provider 共享 key），GET 返回 `""` 空字符串。前端 `EndpointEditor.vue` 的 `api_key` 输入框显示为空（与 BLR LOW-2 一致）。

**影响**: 前端无法区分 "endpoint 无独立 key（fallback 到共享 key）" 和 "endpoint 有空 key"。编辑已有 provider 时，如果 endpoint 本身没有独立 key，用户看到空输入框可能误以为没有配置 key。但 `sharedKey` prop 会显示 placeholder 提示。

**风险**: 低。实际使用中，endpoint api_key 为 null 时使用共享 key，功能不受影响。

### INFO-1: QuickSetup 始终发送单 endpoint 数组

**文件**: `frontend/src/composables/useQuickSetup.ts` `buildProviderPayload()`

QuickSetup 流程始终构造 `endpoints: [{ api_type, base_url, upstream_path, api_key }]` 单元素数组。这意味着即使用户只配置了旧格式字段，后端也会收到 endpoints 数组。

**影响**: 功能正确 — 后端 `handleCreateProvider()` 优先处理 `body.endpoints`，与旧格式代码路径兼容。QuickSetup 的单 endpoint 场景正好是 endpoints 的典型使用方式。无需修改。

---

## 跨层风险点检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| resolveEndpoint 输出被所有下游消费 | ✅ | failover-loop.ts 中 resolvedEndpoint.api_type/base_url/api_key/upstream_path/needs_transform 均被使用 |
| 日志路径完整覆盖（成功/失败/retry/failover/异常） | ✅ | 5 条日志路径均传递 upstream_api_type/base_url |
| 加密/解密对称性 | ✅ | validateAndEncryptEndpoints() encrypt → resolveEndpoint() decrypt → Admin GET decrypt |
| DB migration 幂等 | ✅ | WHERE endpoints IS NULL 保证只处理一次 |
| 旧 provider 向后兼容 | ✅ | parseEndpoints(null/undefined/"") → [] → legacy 路径使用 provider 级字段 |
| 前端类型与后端 schema 对齐 | ✅ | ProviderEndpoint 前后端字段名和类型完全一致 |
| Admin PUT 更新 endpoints 双写 | ✅ | 更新 endpoints 时同步更新 api_type/base_url/upstream_path/api_key |
| EndpointEditor 防重复 api_type | ✅ | usedApiTypes computed + availableApiTypes 过滤 |
| failover 循环中 resolveEndpoint 异常安全 | ✅ | 外层 try-catch 捕获，写入 rejected log 后 continue |

---

## Summary

Provider Multi-API-Type 功能的跨层集成实现完整且正确：

1. **数据链路**：前端 payload → Admin API 校验+加密 → DB 存储 → Admin GET 解密 → 前端展示，全链路字段名和类型一致
2. **加密链路**：写入路径 `validateAndEncryptEndpoints()` 加密，读取路径 `resolveEndpoint()` 解密，Admin GET 解密展示，三方对称
3. **日志链路**：`resolveEndpoint` → `failover-loop` 5 条日志路径 → `log-helpers` → `db/logs` INSERT/SELECT → Admin API → 前端列表+详情，端到端贯通
4. **异常安全**：resolveEndpoint 在 failover 循环中被 try-catch 包裹，异常时 failover 到下一个 target
5. **向后兼容**：旧 provider 无 endpoints → legacy 路径使用 provider 级字段，migration 051 幂等迁移

2 个 issue 均为 LOW/INFO 级别，不影响功能正确性和生产安全性。建议在后续 PR 中可选修复 LOW-1（Admin GET 返回 null 而非空字符串，保留 fallback 语义）。
