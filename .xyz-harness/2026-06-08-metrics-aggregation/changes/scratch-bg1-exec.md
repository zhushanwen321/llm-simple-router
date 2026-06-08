# BG1 执行记录

## 执行摘要

6 个 Task 全部完成，`npx tsc --noEmit` 零错误通过。

## 文件变更清单

### 新建文件（2 个）

| 文件 | 说明 |
|------|------|
| `router/src/db/migrations/055_metrics_10min.sql` | metrics_10min 聚合表 CREATE TABLE + 索引 |
| `router/src/db/metrics-10min.ts` | Metrics10minRow 类型、upsertAggBucket、queryAggActivity、queryAggSummary、queryAggTimeseries、queryAggStats |

### 修改文件（4 个）

| 文件 | 变更 |
|------|------|
| `router/src/db/metrics.ts` | import upsertAggBucket；insertMetrics 双写调用（try-catch）；新增 deleteMetricsBefore 函数 |
| `router/src/db/settings.ts` | 新增 getMetricsDetailDays / setMetricsDetailDays（复用 getSetting/setSetting） |
| `router/src/db/index.ts` | 新增 Metrics10minRow type re-export；新增 deleteMetricsBefore 函数 re-export |
| `router/src/admin/settings.ts` | 新增 GET/PUT /admin/api/settings/metrics-detail-days 端点（含校验） |

## 各 Task 执行详情

### Task 1: 迁移 SQL

`055_metrics_10min.sql` — CREATE TABLE + PRIMARY KEY（6 列联合）+ bucket_time 索引。命名风格与 054 一致。

### Task 2: metrics-10min.ts

- `Metrics10minRow` 类型：完整覆盖 19 列
- `upsertAggBucket(db, entry)`：18 参数 UPSERT，bucket_time 用 `datetime(floor(unixepoch() / 600) * 600, 'unixepoch')` 计算
- entry 类型兼容 MetricsInsert（接受 `non_thinking_duration_ms`，映射到 `sum_text_duration_ms`；`sum_tool_use_duration_ms` 写 0，因 MetricsInsert 不提供细分）
- `queryAggActivity`：最近 30 天活动图，支持 router_key_id/provider_id 可选过滤
- `queryAggSummary`：镜像 getMetricsSummary 签名，查 metrics_10min 表，LEFT JOIN providers
- `queryAggTimeseries`：镜像 getMetricsTimeseries 签名，METRIC_EXPR 按聚合表字段重写（SUM/计数语义）
- `queryAggStats`：镜像 getStats 签名（startTime/endTime/routerKeyId/providerId/backendModel）
- 所有语句使用 getCachedStmt 缓存

### Task 3: metrics.ts 双写

- import `upsertAggBucket` from `./metrics-10min.js`
- `insertMetrics()` 在 `rawInsertMetrics()` 后、`return id` 前调用 `upsertAggBucket(db, m)`，外层 try-catch
- 新增 `deleteMetricsBefore(db, beforeDate)` — DELETE FROM request_metrics WHERE created_at < ?

### Task 4: settings.ts

- 新增 `DEFAULT_METRICS_DETAIL_DAYS = 7`
- `getMetricsDetailDays(db)` — 复用 getSetting 模式
- `setMetricsDetailDays(db, days)` — 复用 setSetting 模式

### Task 5: index.ts re-export

- 新增 `deleteMetricsBefore` 函数 re-export
- 新增 `Metrics10minRow` 类型 re-export

### Task 6: admin/settings.ts 端点

- `GET /admin/api/settings/metrics-detail-days` → `{ days }`
- `PUT /admin/api/settings/metrics-detail-days` → 校验（整数 1-30）+ 不超过 log_retention_days

## 验收自检

| 验收标准 | 状态 |
|---------|------|
| 055_metrics_10min.sql 存在且 CREATE TABLE 正确 | PASS |
| metrics-10min.ts 编译无错误，导出 Metrics10minRow + 所有函数 | PASS |
| metrics.ts insertMetrics 返回前调用 upsertAggBucket（try-catch） | PASS |
| settings.ts 新增 getMetricsDetailDays / setMetricsDetailDays | PASS |
| index.ts 导出 Metrics10minRow | PASS |
| admin/settings.ts 注册两个新端点 | PASS |
| npx tsc --noEmit 通过 | PASS |
