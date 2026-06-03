# R2 审查报告: Dashboard.vue

**审查范围**: feat-frontend-design vs main 分支，Dashboard 页面功能对比  
**审查日期**: 2026-05-25  
**审查焦点**: 功能性 bug 和遗漏（忽略样式微调）

---

## 架构变更概述

feat 分支对 Dashboard 做了重大架构重构：

| 维度 | main 分支 | feat 分支 |
|------|-----------|-----------|
| 时间粒度 | periodTab: window/weekly/monthly/custom | 废弃 periodTab，改为 timelineRange (24h/3d/7d) + usage window 选择 |
| 图表数量 | 3 个独立 Line 图 (TPS, Input Tokens, Output Tokens) | 2 个图: 堆叠面积图 (input+output) + 精简 TPS 图 |
| Provider 排序 | 按 providerOutputTokens (从 metrics summary API 聚合) | 按 aggregateAllProviderInputTokens (从 usageWindows 聚合) |
| 环比数据 | 无 | 新增 deltaValues（与前一个 window 对比） |
| 时间线导航 | 无 | 新增 timeline window navigator 组件 |
| 空状态处理 | 仅 loading/error | 新增 providers.length === 0 的空状态引导 |
| Skeleton | 无 | 新增 Skeleton 加载态 |
| chart helpers | lineOptions | 新增 stackedAreaOptions + miniLineOptions |

---

## 审查结果

### 无关键功能性 Bug (Critical)

后端端点、API 调用参数、数据字段使用均正确对应。

---

### 中等问题 (Medium)

#### M1: `client_type` 筛选只影响 cache summary，不影响 stats/图表数据

**严重程度**: 低（与 main 分支行为一致，非回归）

**分析**:
- `statsParams` 不含 `client_type`，`tsParams` 也不含 `client_type`
- 只有 `cacheSummaryParams` 包含 `client_type`
- 用户选择了 client_type 筛选后，stats 卡片的"请求数"/"成功率"以及 TPS/吞吐量图表不会按 client_type 过滤
- 只有"缓存命中率"会受 client_type 影响
- **结论**: 这是 main 分支已有的行为，非 feat 引入的回归。但用户可能预期所有数据都受筛选影响

#### M2: `inputTokensChartData` 和 `outputTokensChartData` 从 useDashboard 导出但未在模板中使用

**严重程度**: 代码整洁性

**分析**:
- `useDashboard.ts` 返回 `inputTokensChartData` 和 `outputTokensChartData`
- 但 `Dashboard.vue` 模板中只使用了 `tokenThroughputChartData`（合并了 input+output 的堆叠面积图）
- 这两个 ref 在 composable 内部仍被赋值（refresh 函数中），造成不必要的 API 数据处理
- **建议**: 如果确认不再需要独立图表，可以移除这两个 ref 的赋值逻辑和导出

---

### 低风险问题 (Low)

#### L1: `period: "window"` 始终硬编码在 tsParams 和 statsParams 中

**分析**: feat 分支的 `buildBaseParams()` 和 `tsParams()` 始终发送 `period: "window"`。后端在收到 `start_time/end_time` 时会忽略 `period` 参数，所以不会造成功能错误。但语义上不太清晰——如果将来后端逻辑变更，可能产生意外行为。

#### L2: `clientTypeBreakdown` 数据获取但未在视图中使用

**分析**: `useDashboardData` 从 `getMetricsSummary` API 获取 `client_type_breakdown` 数据并赋值到 `clientTypeBreakdown` ref，但 Dashboard.vue 模板中没有渲染这部分数据。与 main 分支行为一致，非回归。

#### L3: `windowTimeRange` 与 `timeRangeText` 并存

**分析**: `windowTimeRange` 显示选中窗口的时间范围（在 Zone 4 inline metrics 中使用），`timeRangeText` 显示 stats 返回的时间范围（未在模板中使用，已正确被 `windowTimeRange` 替代）。`timeRangeText` 仍从 composable 返回但未在模板中引用，是冗余导出。

---

### 功能变更确认（非 bug，记录用途）

#### F1: 废弃 weekly/monthly/custom 时间粒度

main 分支支持 4 种时间粒度（window/weekly/monthly/custom），feat 分支完全移除了这些选项，改为 timeline zoom (24h/3d/7d) + window 选择。

**影响**: 用户不再能查看"本周"/"本月"的汇总统计，也不能自定义时间范围。这是有意的设计变更，不是 bug。

#### F2: 图表合并

3 个独立图表合并为 2 个（堆叠面积 + TPS mini 图）。数据本身仍然完整获取（input/output 分别调用 API），只是展示方式改变。

#### F3: Provider 排序基准从 output tokens 改为 input tokens

main 分支通过额外调用 `getMetricsSummary` 获取 per-provider output tokens 进行排序。feat 分支改为从 `usageWindows` 数据中聚合 input tokens 排序，减少了一次 API 调用。

---

## 结论

**Dashboard.vue 无功能性 bug**。feat 分支的重构在 API 调用、参数传递、后端端点对应关系上均正确。

主要改进点（非 bug）：
1. `inputTokensChartData` / `outputTokensChartData` 可以清理（不再需要独立图表数据）
2. `timeRangeText` 可以从 composable 返回值中移除（模板未使用）
3. `clientTypeBreakdown` 如果确认不需要展示，可以停止获取
