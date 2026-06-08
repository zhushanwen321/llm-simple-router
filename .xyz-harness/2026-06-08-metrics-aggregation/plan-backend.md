# Metrics 分层存储 — 后端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development or executing-plans to implement this plan task-by-task.

**Goal:** 将 request_metrics 拆分为明细表 + 聚合表，Dashboard 查询根据时间范围自动分流。

**Architecture:** 新建 `metrics_10min` 聚合表，`insertMetrics()` 双写（同步 UPSERT），Dashboard 查询函数根据 `metrics_detail_days` 配置自动路由到明细表或聚合表。log-cleaner 扩展清理过期明细行。

**Tech Stack:** SQLite (better-sqlite3)、Fastify、TypeScript

---

## Task 列表

### BG1: DB 迁移 + 聚合表写入

**Files:**
- Create: `router/src/db/migrations/055_metrics_10min.sql`
- Create: `router/src/db/metrics-10min.ts`
- Modify: `router/src/db/metrics.ts`
- Modify: `router/src/db/settings.ts`
- Modify: `router/src/db/index.ts`
- Modify: `router/src/admin/settings.ts`

#### 接口签名变更

**新增模块（`router/src/db/metrics-10min.ts`）：**

所有聚合表相关函数独立放在此文件中（数据归属原则）：
- `upsertAggBucket(db, entry)` — 双写 UPSERT
- `queryAggSummary(db, ...)` — 聚合表 summary 查询
- `queryAggTimeseries(db, ...)` — 聚合表 timeseries 查询
- `queryAggStats(db, ...)` — 聚合表 stats 查询
- `queryAggActivity(db, ...)` — 活动图数据查询

`router_key_id` NULL/'' 转换在此文件中集中处理：
- 写入时：`COALESCE(router_key_id, '')` → 聚合表存空字符串
- 读取时：`CASE WHEN router_key_id = '' THEN NULL ELSE router_key_id END` → 返回 NULL
- UNION 合并时：明细表侧也做 `COALESCE(router_key_id, '')` 以对齐

**新增类型（`router/src/db/metrics-10min.ts`）：**

```typescript
export interface Metrics10minRow {
  bucket_time: string;          // 桶起始时间 YYYY-MM-DD HH:MM:SS
  router_key_id: string;        // COALESCE 原 NULL → ''
  provider_id: string;
  backend_model: string;
  client_type: string;
  api_type: string;
  request_count: number;
  sum_input_tokens: number;
  sum_output_tokens: number;
  sum_cache_read_tokens: number;
  sum_cache_creation_tokens: number;
  sum_total_duration_ms: number;
  sum_ttft_ms: number;
  sum_thinking_tokens: number;
  sum_text_tokens: number;
  sum_tool_use_tokens: number;
  sum_thinking_duration_ms: number;
  sum_text_duration_ms: number;
  sum_tool_use_duration_ms: number;
}
```

**新增函数（`router/src/db/metrics.ts`）：**

```typescript
export function upsertMetrics10min(db: Database.Database, m: MetricsInsert): void
```

**修改函数（`router/src/db/metrics.ts`）：**

```typescript
// 现有签名不变，内部追加 upsertMetrics10min 调用
export function insertMetrics(db: Database.Database, m: MetricsInsert): string
```

#### 迁移 SQL 骨架（`055_metrics_10min.sql`）

```sql
CREATE TABLE IF NOT EXISTS metrics_10min (
  bucket_time TEXT NOT NULL,
  router_key_id TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL,
  backend_model TEXT NOT NULL,
  client_type TEXT NOT NULL DEFAULT 'unknown',
  api_type TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  sum_input_tokens INTEGER NOT NULL DEFAULT 0,
  sum_output_tokens INTEGER NOT NULL DEFAULT 0,
  sum_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  sum_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  sum_total_duration_ms INTEGER NOT NULL DEFAULT 0,
  sum_ttft_ms REAL NOT NULL DEFAULT 0,
  sum_thinking_tokens INTEGER NOT NULL DEFAULT 0,
  sum_text_tokens INTEGER NOT NULL DEFAULT 0,
  sum_tool_use_tokens INTEGER NOT NULL DEFAULT 0,
  sum_thinking_duration_ms INTEGER NOT NULL DEFAULT 0,
  sum_text_duration_ms INTEGER NOT NULL DEFAULT 0,
  sum_tool_use_duration_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)
);

CREATE INDEX IF NOT EXISTS idx_metrics_10min_time
  ON metrics_10min(bucket_time);
```

#### UPSERT 语句

```sql
INSERT INTO metrics_10min (
  bucket_time, router_key_id, provider_id, backend_model, client_type, api_type,
  request_count, sum_input_tokens, sum_output_tokens, sum_cache_read_tokens,
  sum_cache_creation_tokens, sum_total_duration_ms, sum_ttft_ms,
  sum_thinking_tokens, sum_text_tokens, sum_tool_use_tokens,
  sum_thinking_duration_ms, sum_text_duration_ms, sum_tool_use_duration_ms
) VALUES (
  datetime(floor(unixepoch() / 600) * 600, 'unixepoch'),
  COALESCE(?, ''),
  ?, ?, ?, ?,
  1, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?
)
ON CONFLICT (bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)
DO UPDATE SET
  request_count = request_count + 1,
  sum_input_tokens = sum_input_tokens + excluded.sum_input_tokens,
  sum_output_tokens = sum_output_tokens + excluded.sum_output_tokens,
  sum_cache_read_tokens = sum_cache_read_tokens + excluded.sum_cache_read_tokens,
  sum_cache_creation_tokens = sum_cache_creation_tokens + excluded.sum_cache_creation_tokens,
  sum_total_duration_ms = sum_total_duration_ms + excluded.sum_total_duration_ms,
  sum_ttft_ms = sum_ttft_ms + excluded.sum_ttft_ms,
  sum_thinking_tokens = sum_thinking_tokens + excluded.sum_thinking_tokens,
  sum_text_tokens = sum_text_tokens + excluded.sum_text_tokens,
  sum_tool_use_tokens = sum_tool_use_tokens + excluded.sum_tool_use_tokens,
  sum_thinking_duration_ms = sum_thinking_duration_ms + excluded.sum_thinking_duration_ms,
  sum_text_duration_ms = sum_text_duration_ms + excluded.sum_text_duration_ms,
  sum_tool_use_duration_ms = sum_tool_use_duration_ms + excluded.sum_tool_use_duration_ms;
```

#### `db/index.ts` 修改

导出新增的 `Metrics10minRow` 类型。

---

### BG2: Settings + Log-cleaner 扩展

**Files:**
- Modify: `router/src/db/settings.ts`
- Modify: `router/src/db/log-cleaner.ts`
- Modify: `router/src/admin/settings.ts`

#### 接口签名变更

**新增函数（`router/src/db/settings.ts`）：**

```typescript
export function getMetricsDetailDays(db: Database.Database): number
// 默认 7，范围 1-30

export function setMetricsDetailDays(db: Database.Database, days: number): void
// 写入 settings 表 key = 'metrics_detail_days'
```

**修改函数（`router/src/db/log-cleaner.ts`）：**

```typescript
// 现有签名不变
export function runLogCleanup(db: Database.Database): number
// 内部追加：读取 metrics_detail_days → DELETE request_metrics WHERE created_at < cutoff → PRAGMA incremental_vacuum
// 返回值为 logDeleted + toolErrorDeleted + metricsDeleted 总和
```

**新增辅助函数（`router/src/db/log-cleaner.ts`）：**

```typescript
export function deleteMetricsBefore(db: Database.Database, beforeDate: string): number
// DELETE FROM request_metrics WHERE created_at < ?
```

**新增 API 端点（`router/src/admin/settings.ts`）：**

```typescript
// GET /admin/api/settings/metrics-detail-days → { days: number }
// PUT /admin/api/settings/metrics-detail-days → { days: number }
//   校验：整数、1 ≤ days ≤ 30、days ≤ log_retention_days
```

---

### BG3: 查询路由改造

**Files:**
- Modify: `router/src/db/metrics.ts`
- Modify: `router/src/db/stats.ts`
- Modify: `router/src/admin/usage.ts`

#### 查询路由策略

所有受影响函数的改造方案统一遵循以下模式：

1. 从 `settings.getMetricsDetailDays(db)` 读取 `detailDays`
   - 缓存策略：与 `getLogRetentionDays()` 一致，直接读 settings 表（SQLite 主键查询 < 0.01ms，无需缓存）
   - Settings API 写入后立即生效（下次查询自动读新值）
2. 计算分界线 `cutoffTime = now - detailDays days`
3. 根据 `startTime`/`endTime` 与 `cutoffTime` 的关系决定查询目标：
   - `endTime <= cutoffTime`：只查 `metrics_10min`
   - `startTime >= cutoffTime`：只查 `request_metrics`（现有逻辑不变）
   - 跨越分界线：SQL UNION 两表

#### `getMetricsSummary()` 改造（`router/src/db/metrics.ts`）

**签名不变**（内部路由）。

**聚合表 SQL（纯聚合段）：**

```sql
SELECT
  m.provider_id, COALESCE(p.name, m.provider_id) AS provider_name,
  m.backend_model, m.client_type,
  SUM(m.request_count) AS request_count,
  CASE WHEN SUM(m.request_count) > 0 THEN SUM(m.sum_ttft_ms) / SUM(m.request_count) ELSE NULL END AS avg_ttft_ms,
  NULL AS p50_ttft_ms, NULL AS p95_ttft_ms,
  CASE WHEN SUM(m.sum_total_duration_ms) > 0
    THEN CAST(SUM(m.sum_output_tokens) AS REAL) * 1000.0 / SUM(m.sum_total_duration_ms)
    ELSE NULL END AS avg_tps,
  SUM(m.sum_input_tokens) AS total_input_tokens,
  SUM(m.sum_output_tokens) AS total_output_tokens,
  SUM(m.sum_cache_read_tokens) AS total_cache_hit_tokens,
  CASE WHEN SUM(m.sum_input_tokens) > 0
    THEN SUM(m.sum_cache_read_tokens) * 100.0 / SUM(m.sum_input_tokens)
    ELSE NULL END AS cache_hit_rate
FROM metrics_10min m
LEFT JOIN providers p ON p.id = m.provider_id
WHERE {conditions}
GROUP BY m.provider_id, m.backend_model, m.client_type
```

**跨越分界线时**：两段 SQL 各自 SELECT 同构列 → `UNION ALL` → 外层再 GROUP BY 合并。

#### `getMetricsTimeseries()` 改造（`router/src/db/metrics.ts`）

**签名不变**。

**聚合表段**：`metrics_10min` 的 `bucket_time` 本身就是 10 分钟桶，直接作为 `time_bucket` 返回。对于 `avg_value` 的计算：
- `ttft`：`SUM(sum_ttft_ms) / SUM(request_count)`
- `tps`/`total_tps`：`SUM(sum_output_tokens) * 1000.0 / SUM(sum_total_duration_ms)`
- `text_tps`：`SUM(sum_text_tokens) * 1000.0 / NULLIF(SUM(sum_text_duration_ms), 0)`
- `thinking_tps`：`SUM(sum_thinking_tokens) * 1000.0 / NULLIF(SUM(sum_thinking_duration_ms), 0)`
- `tokens`：`SUM(sum_output_tokens)`
- `request_count`：`SUM(request_count)`
- `cache_rate`：`SUM(sum_cache_read_tokens) / NULLIF(SUM(sum_input_tokens), 0)`

明细段保持现有逻辑。跨越时两段合并后按 `time_bucket` 排序。

#### `getClientTypeBreakdown()` 改造（`router/src/db/metrics.ts`）

**签名不变**。

聚合表段：
```sql
SELECT m.client_type, SUM(m.request_count) AS cnt
FROM metrics_10min m
WHERE {conditions}
GROUP BY m.client_type
```

跨越时两段按 `client_type` 合并求和。

#### `getStats()` 改造（`router/src/db/stats.ts`）

**签名不变**。

聚合表段：
```sql
SELECT
  SUM(m.request_count) AS total_requests,
  SUM(m.request_count) AS success_count,
  -- 聚合段无 status_code，success_rate 为近似值。前端需处理此情况
  CASE WHEN SUM(m.sum_total_duration_ms) > 0
    THEN CAST(SUM(m.sum_output_tokens) AS REAL) * 1000.0 / SUM(m.sum_total_duration_ms)
    ELSE NULL END AS avg_tps,
  SUM(m.sum_input_tokens) AS total_input_tokens,
  SUM(m.sum_output_tokens) AS total_output_tokens
FROM metrics_10min m
WHERE {conditions}
```

**注意**：聚合表未保留 `status_code`，聚合段默认 `success_rate = 1.0`。跨越分界线时，明细段提供精确值，聚合段近似。

**前端感知**：API 响应增加 `is_approximate: boolean` 字段。当查询范围 >detail_days 时为 `true`，前端在成功率指标旁显示 "≈" 标记或 tooltip 提示“聚合数据为近似值”。明细段查询时为 `false`。

#### `getDailyUsage()` 改造（`router/src/admin/usage.ts`）

**签名不变**。

聚合表段：
```sql
SELECT
  date(m.bucket_time) AS date,
  SUM(m.request_count) AS request_count,
  SUM(m.sum_input_tokens) AS total_input_tokens,
  SUM(m.sum_output_tokens) AS total_output_tokens
FROM metrics_10min m
WHERE {conditions}
GROUP BY date(m.bucket_time)
ORDER BY date ASC
```

跨越时两段 UNION ALL 后外层 GROUP BY date 合并。

---

### BG4: 活动图数据端点

**Files:**
- Modify: `router/src/admin/metrics.ts`

#### 新增端点

```typescript
// GET /admin/api/metrics/activity
// Query: { router_key_id?: string, provider_id?: string }
// Response: { buckets: Array<{ bucket_time: string, request_count: number }> }
```

从 `metrics_10min` 读取最近 30 天的请求密度数据，按桶聚合（每天的桶合并为单个数字或保留 10 分钟粒度供前端迷你柱状图使用）。

```sql
SELECT bucket_time, SUM(request_count) AS request_count
FROM metrics_10min
WHERE bucket_time >= datetime('now', '-30 days')
  AND ({filter_conditions})
GROUP BY bucket_time
ORDER BY bucket_time ASC
```

---

## DB 迁移细节

### `055_metrics_10min.sql`

| 项目 | 说明 |
|------|------|
| 建表 | `metrics_10min`，使用 ROWID 模式（8K 行量级下空间差异可忽略，二级索引更灵活） |
| 主键 | `(bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)` |
| 索引 | `idx_metrics_10min_time` ON `(bucket_time)` |
| `router_key_id` 处理 | COALESCE 原始 NULL → 空字符串存储，读取时 `NULLIF(router_key_id, '')` 转回 NULL |

### 历史数据回填（不做）

Spec 未要求回填历史数据。`metrics_10min` 从迁移执行后的新写入开始积累。聚合表为空时，活动图显示 "No data yet"。

---

## insertMetrics 双写改造点

**文件**：`router/src/db/metrics.ts` → `insertMetrics()`

**改造点**：

1. 在 `rawInsertMetrics()` 之后、`return id` 之前，调用 `upsertMetrics10min(db, m)`
2. `upsertMetrics10min()` 内部使用 `getCachedStmt()` 缓存 UPSERT 语句（性能）
3. 参数映射：`MetricsInsert` 的各 nullable 字段用 `?? 0` 转为数字参与聚合累加
4. `router_key_id` 为 NULL 时传入 `COALESCE(?, '')` → 传入 `null`，SQL 层处理

**异常处理**：UPSERT 失败时 `console.error('upsertMetrics10min:', e)` 记录错误日志，不静默吞异常。聚合表是辅助查询通道，写入失败不抛出（不影响主请求流程），但必须有日志以便排查数据偏差。

**性能影响**：单次 UPSERT 在 SQLite WAL 模式下 < 0.1ms。与现有 INSERT 合并在同一个事件循环 tick 中，不引入异步。

---

## log-cleaner 扩展点

**文件**：`router/src/db/log-cleaner.ts`

**扩展点**：

1. `runLogCleanup()` 中追加 `deleteMetricsBefore()` 调用
2. 读取 `getMetricsDetailDays(db)` 获取保留天数
3. 计算 cutoff：`new Date(Date.now() - detailDays * MS_PER_DAY).toISOString()`
4. 调用 `deleteMetricsBefore(db, cutoff)` → 返回删除行数
5. 删除后执行 `db.pragma("incremental_vacuum")` 回收空间
6. 返回值合并：`logDeleted + toolErrorDeleted + metricsDeleted`
7. `detailDays <= 0` 时跳过 metrics 清理（与 log retention 一致）

**新增函数**：`deleteMetricsBefore(db, beforeDate)` 放在 `metrics.ts` 中（数据归属），`log-cleaner.ts` 调用。

---

## Settings API 新增端点

| 方法 | 路径 | 请求体 | 响应 | 校验 |
|------|------|--------|------|------|
| GET | `/admin/api/settings/metrics-detail-days` | — | `{ days: number }` | — |
| PUT | `/admin/api/settings/metrics-detail-days` | `{ days: number }` | `{ days: number }` | 整数、1-30、≤ log_retention_days |

**错误响应**（PUT 校验失败）：
- `days` 非整数或不在 1-30 范围：400 `"days must be integer 1-30"`
- `days > log_retention_days`：400 `"metrics_detail_days must not exceed log_retention_days"`
