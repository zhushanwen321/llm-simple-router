# Metrics 分层存储 — API 契约

## 新增 API 端点

### GET /admin/api/settings/metrics-detail-days

获取 Metrics 明细保留天数配置。

**请求参数：** 无

**响应：**
```typescript
interface MetricsDetailDaysResponse {
  days: number;  // 1-30，默认 7
}
```

---

### PUT /admin/api/settings/metrics-detail-days

设置 Metrics 明细保留天数。

**请求体：**
```typescript
interface MetricsDetailDaysRequest {
  days: number;  // 整数，1-30
}
```

**响应：**
```typescript
interface MetricsDetailDaysResponse {
  days: number;
}
```

**错误码：**
| 条件 | HTTP | message |
|------|------|---------|
| days 非整数或不在 1-30 | 400 | `"days must be integer 1-30"` |
| days > log_retention_days | 400 | `"metrics_detail_days must not exceed log_retention_days"` |

---

### GET /admin/api/metrics/activity

获取 30 天范围的请求密度数据（供前端活动图使用）。

**请求参数（Query）：**
```typescript
interface ActivityQuery {
  router_key_id?: string;
  provider_id?: string;
}
```

**响应：**
```typescript
interface ActivityResponse {
  buckets: ActivityBucket[];
}

interface ActivityBucket {
  bucket_time: string;      // ISO 8601 格式
  request_count: number;
}
```

**说明：** 返回 `metrics_10min` 中最近 30 天的聚合数据。聚合表为空时返回 `{ buckets: [] }`。

---

## 现有 API 变更说明

以下端点的 **请求参数和响应格式均不变**，仅内部查询路由逻辑改变：

| 端点 | 变更类型 |
|------|---------|
| `GET /admin/api/metrics/summary` | 内部路由：根据时间范围分流到明细表/聚合表 |
| `GET /admin/api/metrics/timeseries` | 同上 |
| `GET /admin/api/stats` | 同上 |
| `GET /admin/api/usage/weekly` | 同上 |
| `GET /admin/api/usage/monthly` | 同上 |

**向后兼容保证：** 响应 JSON 结构、字段名、字段类型均保持不变。

**唯一新增字段：** `GET /admin/api/stats` 响应增加 `is_approximate: boolean` 字段。当查询范围 > detail_days 时为 `true`（数据来自聚合表，success_rate 为近似值），≤ detail_days 时为 `false`。前端据此在成功率指标旁显示“≈”标记。

---

## 前后端共享类型定义

```typescript
// --- Settings 相关 ---

interface MetricsDetailDaysResponse {
  days: number;
}

// --- Activity 活动图 ---

interface ActivityBucket {
  bucket_time: string;
  request_count: number;
}

interface ActivityResponse {
  buckets: ActivityBucket[];
}

// --- 查询路由相关（前端无需感知，仅供内部理解） ---

/**
 * 查询路由决策因子：
 * - detailDays = GET /admin/api/settings/metrics-detail-days → days
 * - cutoffTime = now - detailDays days
 * - startTime >= cutoffTime → 明细表
 * - endTime <= cutoffTime → 聚合表
 * - 跨越 → UNION 两表
 * 前端不需要关心此逻辑，只需传递 startTime/endTime 或 period 参数。
 */
```

---

## metrics_detail_days 配置生命周期

```
Settings UI (PUT) → settings 表 (key='metrics_detail_days')
                        ↓
                  getMetricsDetailDays(db) ← 查询路由函数读取
                        ↓
                  log-cleaner 定时读取 → DELETE request_metrics WHERE created_at < cutoff
```

| 阶段 | 读取方 | 缓存 |
|------|--------|------|
| Dashboard 查询路由 | `getMetricsDetailDays(db)` | 直接读 settings 表（SQLite 主键查询 < 0.01ms，无需 TTL 缓存） |
| Log-cleaner 清理 | `getMetricsDetailDays(db)` | 每次 cleanup 重新读取 |
| Settings API | `getMetricsDetailDays(db)` / `setMetricsDetailDays(db, n)` | 写入后立即生效（无缓存） |
