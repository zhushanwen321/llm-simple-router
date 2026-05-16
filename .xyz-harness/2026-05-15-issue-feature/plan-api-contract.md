# API 合约：映射原因追踪 (Mapping Reason Tracking)

## 概述

本需求不新增 API 端点、不修改 API 签名。映射原因通过已有数据结构传递：

- **实时场景**：SSE 事件（`request_start`/`request_update`/`request_complete`）中的 `ActiveRequest.mappingReason`
- **历史场景**：`request_logs.pipeline_snapshot` JSON 中的 routing stage `mapping_reason` 字段

---

## SSE 事件合约

### ActiveRequest 新增字段

```typescript
interface ActiveRequest {
  // ... 现有字段不变 ...
  /** 映射原因（6 种枚举值，可选） */
  mappingReason?: "direct_format" | "group_base_rule" | "group_schedule" 
         | "fallback_provider" | "overflow_redirect" | "failover_retry";
}
```

### 事件时序

| 事件 | mappingReason 状态 | 说明 |
|------|-------------------|------|
| `request_start` | `undefined` | 请求刚入队，映射尚未完成 |
| `request_update` | 已填充 | 每 5s 定时推送或 queued 状态变化时推送 |
| `request_complete` | 已填充 | 请求完成时推送 |
| `stream_content_update` | 不包含 | 此事件只推送 `{ id, totalChars, streamMetrics }` |

### 示例

```json
// request_update 事件
event: request_update
data: [{"id":"abc","apiType":"openai","model":"gpt-4","providerId":"p1",
  "providerName":"OpenAI","isStream":true,"queued":false,"startTime":1715769600000,
  "status":"pending","retryCount":0,"attempts":[],
  "mappingReason":"group_schedule"}]
```

---

## pipeline_snapshot 合约

### routing stage 新增字段

```typescript
type StageRecord = 
  | { stage: "routing"; client_model: string; backend_model: string; 
    provider_id: string; strategy: string; mapping_reason?: string }
  // ... 其他 variant 不变
```

### 示例

```json
[
  {"stage":"routing","client_model":"gpt-4","backend_model":"gpt-4o","provider_id":"openai-1","strategy":"failover","mapping_reason":"group_schedule"},
  {"stage":"overflow","triggered":true,"redirect_to":"gpt-4o-mini","redirect_provider":"openai-2"},
  {"stage":"provider_patch","types":["deepseek"]}
]
```

### overflow 双记录策略

当 overflow 触发时：
- routing stage 的 `mapping_reason` 记录**原始原因**（如 `group_schedule`）
- overflow stage 的 `triggered` 为 `true`
- `ActiveRequest.mappingReason` 记录**最终原因** `overflow_redirect`

前端从 pipeline_snapshot 解析时：先检查 overflow stage.triggered，如为 true 则覆盖为 `overflow_redirect`。

---

## Admin API 无变更

日志详情 API 已返回 `pipeline_snapshot` 完整 JSON：

```
GET /admin/api/logs/:id → { ..., pipeline_snapshot: "[...]", ... }
```

前端从 `pipeline_snapshot` JSON 解析 routing stage 的 `mapping_reason` 字段即可。

---

## 错误处理

### 无映射（resolveMapping 返回 null）

此时不产生 `ResolveResult`，自然无 `mappingReason`。请求被拒绝（404/502），不写入 pipeline_snapshot routing stage。

### 历史数据（无 mapping_reason 字段）

pipeline_snapshot routing stage 的 `mapping_reason` 为 optional。历史日志 JSON 中不存在此字段，前端防御性处理：返回 undefined，不渲染 Badge。

---

## 不在范围内的 API 变更

| 项目 | 说明 |
|------|------|
| 新增 DB 列 | 复用 `pipeline_snapshot` JSON 列 |
| 修改日志列表 API | 映射原因只在详情页展示，不在列表 API 返回 |
| 新增 SSE 事件类型 | 复用已有的 `request_update`/`request_complete` 事件 |
