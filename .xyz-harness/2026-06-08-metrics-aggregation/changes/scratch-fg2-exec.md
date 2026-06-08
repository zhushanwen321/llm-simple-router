# FG2 执行记录：Dashboard 数据获取 + 筛选改造

## 修改文件

### 1. `frontend/src/composables/useDashboardFilters.ts`
- 移除 `buildBaseParams()`、`statsParams`、`cacheSummaryParams`、`tsParams`
- 新增统一 `filterParams: ComputedRef<Record<string, string>>`，合并所有筛选维度（provider_id、backend_model、router_key_id、client_type）
- 新增 `ComputedRef` 类型导入

### 2. `frontend/src/composables/useDashboardData.ts`
- 接口 `DashboardDataInput` 简化：移除 `statsParams`/`cacheSummaryParams`/`tsParams`/`selectedWindow`，改为 `filterParams` + `timeSelection`（`ComputedRef<{ startTime: string; endTime: string }>`）
- 新增 `buildApiParams()`（合并 filterParams + period + start_time/end_time）和 `buildTsParams(metric)`（为 timeseries API 构造结构化参数）
- `refresh()` 不再从 `selectedWindow` 读取时间范围，统一从 `timeSelection.value` 获取
- `buildTsParams` 返回结构化对象（匹配 `api.getMetricsTimeseries` 签名），避免 `Record<string, string>` 不兼容问题

### 3. `frontend/src/composables/useDashboard.ts`
- 移除 `selectedWindowFromTime` 适配器代码（不再需要合成 `UsageWindowWithUsage`）
- 新增 `timeSelectionForData` computed：将 `TimeSelection`（Date 对象）转为 ISO 字符串
- `useDashboardData` 调用参数改为 `filterParams: filters.filterParams` + `timeSelection: timeSelectionForData`
- 新增 `TimeSelection` 类型导入

## 验收结果
- `useDashboardData.ts` 不再依赖 `selectedWindow` ✓
- `useDashboardFilters.ts` 输出统一的 `filterParams` ✓
- `cd frontend && npx vue-tsc -b --noEmit` 通过（零错误）✓
