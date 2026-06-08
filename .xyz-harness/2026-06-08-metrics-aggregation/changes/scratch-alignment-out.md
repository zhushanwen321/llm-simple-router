# API 对齐审查结果

## 审查范围

逐一比对 `plan-api-contract.md`（后端契约）与 `plan-frontend.md`（前端设计）中所有 API 调用点。

---

## 新增端点对齐检查

### 1. GET /admin/api/settings/metrics-detail-days

| 维度 | 后端契约 | 前端调用（FG2.4） | 结果 |
|------|---------|-------------------|------|
| 路由 | `GET /admin/api/settings/metrics-detail-days` | `request('get', '/settings/metrics-detail-days')` | ✅ 一致 |
| 请求参数 | 无 | 无 | ✅ 一致 |
| 响应类型 | `{ days: number }` | `{ days: number }` | ✅ 一致 |

### 2. PUT /admin/api/settings/metrics-detail-days

| 维度 | 后端契约 | 前端调用（FG2.4） | 结果 |
|------|---------|-------------------|------|
| 路由 | `PUT /admin/api/settings/metrics-detail-days` | `request('put', '/settings/metrics-detail-days', { days })` | ✅ 一致 |
| 请求体 | `{ days: number }` | `{ days: number }` | ✅ 一致 |
| 响应类型 | `{ days: number }` | `{ days: number }` | ✅ 一致 |
| 错误码 400 | days 非整数 1-30 / days > log_retention_days | `useLogRetention.validationError` 前端预校验 + 后端兜底 | ✅ 一致 |

### 3. GET /admin/api/metrics/activity

| 维度 | 后端契约 | 前端调用（FG2.3） | 结果 |
|------|---------|-------------------|------|
| 路由 | `GET /admin/api/metrics/activity` | `request('get', '/metrics/activity', undefined, { params })` | ✅ 一致 |
| Query 参数 | `{ router_key_id?: string; provider_id?: string }` | `params?: { router_key_id?: string; provider_id?: string }` | ✅ 一致 |
| 响应类型 | `{ buckets: ActivityBucket[] }` | `ActivityResponse = { buckets: ActivityBucket[] }` | ✅ 一致 |
| ActivityBucket | `{ bucket_time: string; request_count: number }` | `{ bucket_time: string; request_count: number }` | ✅ 一致 |
| 空数据 | `{ buckets: [] }` | 前端 plan 未显式处理空数组渲染（FG1.2 组件 Props 接受 `ActivityBucket[]`，空数组应显示空白） | ⚠️ 轻微，非契约问题 |

---

## 现有端点对齐检查

后端契约明确声明以下端点 **请求参数和响应格式均不变**，仅内部查询路由改变：

| 端点 | 前端 plan 描述 | 对齐状态 |
|------|---------------|---------|
| `GET /admin/api/metrics/summary` | FG2.2 统一 filterParams，注入 start_time/end_time | ✅ 参数名不变 |
| `GET /admin/api/metrics/timeseries` | 同上，fillTimeseries 保持 period + timeRange 传入 | ✅ 参数名不变 |
| `GET /admin/api/stats` | 同上 | ✅ 参数名不变 |
| `GET /admin/api/usage/windows` | 前端不再调用 | ✅ 向后兼容（表保留） |

---

## 类型定义共享检查

| 类型 | 后端契约定义 | 前端 plan 定义位置 | 一致性 |
|------|------------|-------------------|--------|
| `MetricsDetailDaysResponse` | `{ days: number }` | FG2.3 settings-api.ts + FG1.1 useTimeSelector | ✅ |
| `ActivityBucket` | `{ bucket_time: string; request_count: number }` | FG1.1 useTimeSelector + FG2.3 client.ts | ✅ |
| `ActivityResponse` | `{ buckets: ActivityBucket[] }` | FG2.3 client.ts | ✅ |

---

## 调用链完整性

### useTimeSelector 调用链

```
useTimeSelector.loadActivity()
  → api.getMetricsActivity(params)         ← 匹配 GET /admin/api/metrics/activity
  → api params: { router_key_id?, provider_id? }  ← 匹配后端 Query 参数
useTimeSelector mounted
  → getMetricsDetailDays()                 ← 匹配 GET /admin/api/settings/metrics-detail-days
```

FG2.5 说明 "provider 切换 → 重新加载 activity"，即 `loadActivity()` 需要感知当前 selectedProvider 并传入 `provider_id`。plan 中 `loadActivity()` 签名为无参 `() => Promise<void>`，内部通过闭包或 ref 获取 provider——这是实现细节，不影响 API 契约对齐。

### useLogRetention 调用链

```
loadMetricsDetail()
  → getMetricsDetailDays()                 ← 匹配 GET /admin/api/settings/metrics-detail-days
saveBoth()
  → setLogRetention(days)                  ← 现有 API，不变
  → setMetricsDetailDays(days)             ← 匹配 PUT /admin/api/settings/metrics-detail-days
```

并行调用两个 PUT（Promise.allSettled），校验 `metricsDetailDays ≤ retentionDays` 与后端错误码 `days > log_retention_days → 400` 双重保障。✅

---

## 结论

**无需修改 `plan-frontend.md`。**

所有前端 API 调用与后端契约完全对齐：
- 3 个新增端点的路由、请求参数、响应类型一一对应
- 现有端点的参数格式保持不变，前端仅改变参数来源（从 usage window → timeSelection）
- 共享类型定义在两份文档中完全一致
- 前端校验逻辑（metricsDetailDays ≤ retentionDays）与后端错误码（400）形成双重保障
