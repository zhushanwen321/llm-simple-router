# BG3 执行记录：查询路由改造

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `router/src/db/stats.ts` | Stats 接口 + getStats 函数路由 |
| `router/src/admin/usage.ts` | getDailyUsage 函数路由 + 新增 queryAggDailyUsage |
| `router/src/db/metrics.ts` | getMetricsSummary/getMetricsTimeseries/getClientTypeBreakdown 路由 |

## 改动详情

### stats.ts
- `Stats` 接口新增 `is_approximate: boolean` 字段
- `getStats` 内部根据 endTime 与 cutoffTime 关系路由：
  - endTime <= cutoffTime → `queryAggStats()`（全聚合表，is_approximate=true）
  - startTime >= cutoffTime → 明细表查询（is_approximate=false）
  - 跨越 → 明细段 + 聚合段合并（is_approximate=true）
- 合并逻辑：totalRequests/totalInputTokens/totalOutputTokens 求和，avg_tps 加权平均，successRate 只取明细段成功数

### usage.ts
- 新增 `queryAggDailyUsage()`：聚合表按 date 分组查询
- 新增 `mergeDailyUsageResults()`：两段结果按 date 合并（request_count/total_input_tokens/total_output_tokens 求和）
- `getDailyUsage` 三路路由同上模式

### metrics.ts
- 导入 `queryAggSummary`、`queryAggTimeseries`、`getMetricsDetailDays`
- 新增 `computeEffectiveTimeRange()`：当 startTime/endTime 未提供时从 period 推算
- 新增 4 个 merge 函数（模块私有，不导出）：
  - `mergeSummaryResults()`：按 (provider_id, backend_model, client_type) 分组，SUM 字段求和，avg_ttft_ms/cache_hit_rate 重新计算
  - `mergeTimeseriesResults()`：按 time_bucket 合并，avg_value 加权平均
  - `mergeBreakdownResults()`：按 client_type 键值求和
  - `queryAggClientTypeBreakdown()`：聚合表 client_type 分布查询
- `getMetricsSummary`：三路路由，跨越时明细段 SQL 用 effectiveStart→cutoffTime，聚合段用 queryAggSummary(cutoffTime→endTime)
- `getMetricsTimeseries`：同上模式
- `getClientTypeBreakdown`：同上模式

## 路由策略（统一模式）

```
cutoffTime = now - detailDays * 86400s

endTime <= cutoffTime  → 全量聚合表（最快）
startTime >= cutoffTime → 全量明细表（现有逻辑不变）
跨越分界线             → 明细段 + 聚合段 → merge 函数合并
```

## 验收

- [x] 所有 5 个函数签名不变
- [x] npx tsc --noEmit 通过（零错误）
- [x] 跨越分界线时 UNION 两表 + merge 正确
- [x] Stats 接口新增 is_approximate 字段，通过 db/index.ts re-export 自动流到 admin/stats.ts API
