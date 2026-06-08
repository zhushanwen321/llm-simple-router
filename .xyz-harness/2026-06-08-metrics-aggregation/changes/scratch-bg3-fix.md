# BG3 Fix: metrics.ts 查询路由改造

## 修改文件

| 文件 | 变更 |
|------|------|
| `router/src/db/metrics.ts` | 新增路由逻辑 + merge 函数 + queryAggClientTypeBreakdown |
| `router/src/db/metrics-10min.ts` | 导出 `AGG_METRIC_EXPR` |

## 新增 imports (metrics.ts)

```typescript
import { MS_PER_SECOND, SECONDS_PER_DAY } from "../core/constants.js";
import { queryAggSummary, queryAggTimeseries, AGG_METRIC_EXPR, upsertAggBucket } from "./metrics-10min.js";
import { getMetricsDetailDays } from "./settings.js";
```

## 新增辅助函数

| 函数 | 用途 |
|------|------|
| `computeEffectiveTimeRange()` | 从 period 推算 startTime/endTime（未提供时用 now 推算） |
| `queryAggRouterKeyIdCondition()` | 构造 agg 表 COALESCE 条件，避免 router_key_id NULL 匹配问题 |
| `mergeSummaryResults()` | 按 provider_id+backend_model+client_type 聚合，加权平均 avg_ttft_ms |
| `mergeTimeseriesResults()` | 按 time_bucket 聚合，加权平均 avg_value |
| `mergeBreakdownResults()` | 按 client_type 叠加计数 |
| `queryAggClientTypeBreakdown()` | 查询 metrics_10min 表的 client_type 分布 |

## 三路路由模式（三个函数统一）

```
effectiveEnd <= cutoffTime → 全量走 agg 表
effectiveStart >= cutoffTime → 全量走 detail 表（原逻辑不变）
跨越分界线 → detail 段（[effectiveStart, cutoffTime)）+ agg 段（[cutoffTime, effectiveEnd)）→ merge 合并
```

## mergeSummaryResults 特殊处理

avg_ttft_ms 使用加权平均（按 request_count 加权），avg_tps 和 cache_hit_rate 基于合并后的 token 总量计算。合并前先保存旧的 request_count 用于加权。

## 验证结果

- `npx tsc --noEmit`: 零错误
- `npx eslint src/db/metrics.ts`: 零 warning（magic number 已用 MS_PER_SECOND / PERCENT 替代）
- `npx vitest run`: 1779 passed, 5 skipped, 2 pre-existing failures（migration count 断言，与本次改动无关）
- 函数签名完全不变
