# 分组 1: Dashboard

## 审查结论

有差异 -- feat 分支对 Dashboard 进行了重大重构和功能增强，整体架构从"单体 composable + 时间段选卡"变更为"分拆 composable + 时间线窗口导航器"。

## 差异详情

### 文件: Dashboard.vue

#### 差异 1 -- 功能缺失: 时间段选卡 (periodTab)
- **main**: 页面顶部有 4 个时间段选择按钮：`window`（近 5 小时）、`weekly`（周）、`monthly`（月）、`custom`（自定义日期范围）。用户可切换时间粒度查看统计。
- **feat**: 完全移除时间段选卡 UI。数据始终以 `period: "window"` 请求。
- **影响评估**: 高。用户无法再按周/月/自定义时间段查看 Dashboard 数据，所有统计仅在窗口模式下显示。需确认这是有意移除还是遗漏。

#### 差异 2 -- 功能缺失: 自定义日期范围
- **main**: 当选择 `custom` 时间段时，显示两个 `datetime-local` Input 用于选择开始和结束时间。数据请求使用 `toIsoStart()`/`toIsoEnd()` 转换后传入 `start_time`/`end_time` 参数。
- **feat**: 完全移除自定义日期范围 UI。`useDashboardFilters.ts` 中的 `tsParams` 虽然保留了 `timeRange` 参数（由时间线窗口传递），但用户无法手动输入任意日期。
- **影响评估**: 高。用户无法自定义日期范围查看历史数据。时间线窗口导航器只能选择已有的 24h/3d/7d 范围内的特定窗口。

#### 差异 3 -- 功能变更: Provider 排序依据
- **main**: `sortedProviders` 按 `output_tokens` 降序排列。通过 `loadProviderOutputTokens()` 单独调用 `api.getMetricsSummary()` 获取每个 provider 的 output token 总量。
- **feat**: `sortedProviders` 按 **所有窗口聚合的 `input_tokens`** 降序排列。通过 `aggregateAllProviderInputTokens()` 从 `usageWindows` 中计算。
- **影响评估**: 中。排序依据从 output tokens 变为 input tokens，provider 按钮组显示顺序会不同。

#### 差异 4 -- 新增功能: 时间线窗口导航器
- **feat**: 页面底部新增完整的时间线可视化区域，包含：
  - Zoom 按钮组（24h / 3d / 7d）控制时间范围
  - 颜色强度条显示各 provider 的窗口使用量（按 output_tokens 分级着色）
  - Tooltip 显示窗口时间段 + output token 量
  - 点击窗口可切换统计数据范围
  - Day labels 显示日期标签
- **main**: 无此功能。
- **影响评估**: 高。核心新增功能，完全改变了数据时间范围的选择方式。

#### 差异 5 -- 新增功能: 环比数据 (Delta)
- **feat**: 两个大型 token 卡牌下方显示与上一个窗口的环比变化百分比（`deltaValues`）。通过 `loadPrevWindowStats()` 获取前一个窗口的统计数据并计算变化率。正值绿色、负值红色。
- **main**: 无此功能。
- **影响评估**: 中。有用的新增数据分析功能。

#### 差异 6 -- 新增功能: Provider Token 标签
- **feat**: 每个 provider 按钮右侧显示该 provider 的聚合 input token 量（如 "1.2M"），通过 `formatProviderTokenLabel()` 格式化。
- **main**: 无此功能。
- **影响评估**: 低。辅助信息展示，不影响核心功能。

#### 差异 7 -- 新增功能: 堆叠面积图 (Token Throughput)
- **feat**: 右侧图表使用堆叠面积图（`tokenThroughputChartData`）同时展示 input 和 output tokens，替代 main 中分开的两个折线图。
- **main**: 三列独立折线图（TPS、Input Tokens、Output Tokens）。
- **影响评估**: 低。视觉呈现不同，但底层数据相同。feat 的 `useDashboardData` 仍然返回 `inputTokensChartData` 和 `outputTokensChartData`，只是模板中未使用。

#### 差异 8 -- UI 重构: Filter 控件
- **main**: 模型、密钥、客户端类型三个 Select 以行内形式排列在时间段选卡下方。
- **feat**: 三个 Select 移入 Popover 弹窗，由带 Badge 计数的 Filter 按钮触发。`activeFilterCount` 计算活跃筛选数量。
- **影响评估**: 低。纯 UI 重构，不影响功能。

#### 差异 9 -- UI 重构: 指标卡牌布局
- **main**: 6 等分 Card 网格（`grid-cols-6`），所有指标使用统一卡片样式。
- **feat**: 重新设计为：
  - 两个大型 input/output token 卡牌（突出显示）
  - 两个小卡牌（TPS + Cache Hit）
  - 行内三级指标（Requests / Success Rate / Window Range）
- **影响评估**: 低。纯视觉重构，数据内容一致。

#### 差异 10 -- UI 重构: Loading 状态
- **main**: 加载时显示 "Loading..." 文字。
- **feat**: 加载时显示 Skeleton 占位块（模拟卡牌和图表布局）。
- **影响评估**: 低。纯 UI 改进。

#### 差异 11 -- UI 重构: 空 Provider 状态
- **feat**: 当 `providers.length === 0` 且未加载中时，显示空状态提示和"前往 Provider 管理"链接。
- **main**: 无此状态处理，provider 为空时页面可能空白或报错。
- **影响评估**: 低。边缘情况处理改进。

---

### 文件: useDashboard.ts (composable)

#### 差异 12 -- 代码重构: 文件拆分
- **main**: 单一文件 `useDashboard.ts`，包含 `useDashboardFilters`、`useDashboardData`、`useDashboard` 三个函数，约 380 行。
- **feat**: 拆分为 4 个文件：
  - `useDashboard.ts`（facade, ~200 行）
  - `useDashboardFilters.ts`（筛选逻辑, ~115 行）
  - `useDashboardData.ts`（数据获取, ~175 行）
  - `useDashboardTimeline.ts`（时间线, ~210 行）
- **影响评估**: 低。架构改进，不影响功能。

#### 差异 13 -- 功能缺失: periodTab / customStart / customEnd
- **main**: `useDashboard()` 导出 `periodTab`、`customStart`、`customEnd` 三个 ref。
- **feat**: 这三个 ref 被移除。对应功能由 `timelineRange` 和 `selectedWindowId` 替代。
- **影响评估**: 高。与模板对应的功能移除一致。

#### 差异 14 -- 功能变更: 数据加载行为
- **main**: 每次 `refresh()` 都设置 `loading = true`，强制显示 loading 状态。
- **feat**: 只在首次加载时（`!stats.value.totalRequests && !stats.value.totalInputTokens`）显示 loading，后续静默刷新避免闪烁。
- **影响评估**: 低。用户体验改进，数据加载逻辑无差异。

#### 差异 15 -- 功能变更: 缓存策略
- **main**: `useDashboardData` 中有 `CACHE_TTL = 5000`，但由于 watchKey 变化后立即触发 debounce watch，且每次 `loading = true`，缓存实际上依赖于 watchKey 去重。缓存条件中未检查 `lastRefreshKey !== key`。
- **feat**: `useDashboardData` 明确实现了 `lastRefreshKey` + `lastRefreshTime` 缓存，相同 watchKey 的 5s 内重复请求被跳过。
- **影响评估**: 低。缓存逻辑更明确，功能一致。

#### 差异 16 -- 功能变更: Retry 逻辑
- **main**: `retry()` 仅重新加载 provider、filter 选项、provider output tokens，再自动选择和刷新。
- **feat**: `retry()` 除上述步骤外，还额外调用 `filters.loadFilterOptions()`（之前已调用）和 `timeline.loadUsageWindows()`。
- **影响评估**: 低。错误恢复逻辑增强。

#### 差异 17 -- 功能变更: 生命周期初始化
- **main**: `onMounted` 中加载 providers → filter options → provider output tokens → auto select → refresh。
- **feat**: `onMounted` 中加载 providers → usage windows → filter options → auto select provider → auto select window → refresh → load prev window stats。多了时间线窗口加载和环比数据加载。
- **影响评估**: 低。与新增时间线功能对应的必要调整。

---

### 文件: useDashboardFilters.ts (feat 新增)

功能等价于 main `useDashboard.ts` 中的内联 `useDashboardFilters()`，但有以下差异：

#### 差异 18 -- 功能变更: period 参数
- **main**: `statsParams` 根据 `periodTab` 动态设置，`custom` 模式使用 `start_time`/`end_time`，非 custom 模式使用 `period`。
- **feat**: `buildBaseParams()` 始终返回 `{ period: "window" }`，不再根据时间粒度切换。
- **影响评估**: 高。API 调用参数变化，后端返回数据范围不同。

#### 差异 19 -- 功能变更: tsParams 签名
- **main**: `tsParams(metric: string)` 返回 `TimeseriesParamsResult`，内部引用 `periodTab` 计算 period/start_time/end_time。
- **feat**: `tsParams(metric: string, timeRange?: { startTime: string; endTime: string })` 接受可选 timeRange 参数，不依赖 periodTab，period 始终为 "window"。
- **影响评估**: 中。接口签名变化，调用方需适配。

#### 差异 20 -- 功能变更: keyOptions 映射
- **main**: `keyOptions.value = keys.value`（直接使用 API 返回的完整 RouterKey 对象数组）。
- **feat**: `keyOptions.value = keys.value.map((k) => ({ id: k.id, name: k.name }))`（提取 id 和 name）。
- **影响评估**: 低。数据结构更明确，不影响功能。

#### 差异 21 -- 新增功能: buildBaseParams helper
- **feat**: 提取 `buildBaseParams()` 辅助函数构建基础参数，减少 `statsParams` 和 `cacheSummaryParams` 中的重复代码。
- **main**: 直接在每个 computed 中内联构建参数。
- **影响评估**: 无。纯重构。

---

### 文件: useDashboardData.ts (feat 新增)

功能等价于 main `useDashboard.ts` 中的内联 `useDashboardData()`，但有以下差异：

#### 差异 22 -- 功能变更: 参数接口
- **main**: 接受 9 个独立参数（`selectedProvider, periodTab, providers, apiStartTime, apiEndTime, statsParams, cacheSummaryParams, timeseriesPeriod, tsParams, watchKey, t`）。
- **feat**: 接受结构化 `DashboardDataInput` 接口对象（`selectedProvider, statsParams, cacheSummaryParams, tsParams, selectedWindow, watchKey, t`）。
- **影响评估**: 低。参数传递方式变化，功能等价。

#### 差异 23 -- 功能变更: fillTimeseries period 参数
- **main**: `fillTimeseries(tpsRes.value, period, timeRange)` 中 period 由 `timeseriesPeriod` 动态计算（window/weekly/monthly）。
- **feat**: 始终使用 `"window"` 作为 period。
- **影响评估**: 中。`fillTimeseries` 的行为取决于 period 参数，不同 period 可能产生不同的时间粒度填充。

#### 差异 24 -- 新增功能: tokenThroughputChartData
- **feat**: 新增 `toThroughputChartData()` 函数，将 input 和 output tokens 合并为堆叠面积图数据，使用 `CHART_COLORS.tealFill`/`CHART_COLORS.greenFill` 作为填充色。
- **main**: 无此功能。
- **影响评估**: 低。新增图表类型。

#### 差异 25 -- 功能变更: windowTimeRange 传递
- **feat**: `refresh()` 从 `selectedWindow.value` 提取时间范围，传递给 `finalStatsParams`、`finalCacheSummaryParams` 的 `start_time`/`end_time`。
- **main**: 时间范围由 `periodTab` + `customStart`/`customEnd` 控制。
- **影响评估**: 中。时间范围的数据源不同，但最终传递给 API 的参数结构一致。

#### 差异 26 -- 功能变更: loadError 管理
- **main**: `loadError` 定义在 `useDashboardData` 内部，同时管理 provider 加载错误。
- **feat**: `loadError` 在 `useDashboardData` 内部定义，但由 facade 的 `loadProviders()` 外部设置（通过 `data.loadError.value = true`）。
- **影响评估**: 低。错误状态管理方式变化，功能等价。

---

### 文件: useDashboardTimeline.ts (feat 全新文件)

#### 新增功能
- **TimelineRange**: 枚举类型 `"24h" | "3d" | "7d"`
- **loadUsageWindows()**: 根据 timelineRange 计算时间范围，调用 `api.getUsageWindows(range)` 获取窗口数据
- **autoSelectLatestWindow()**: 自动选择最新的时间窗口
- **mergeTimelineWindows()**: 合并相邻或重叠的同一 provider 窗口（gap ≤ 60s），聚合 usage 数据
- **getWindowStyle()**: 根据 output_tokens 量级映射到 4 级颜色强度（`TIMELINE_INTENSITY_COLORS`）
- **timelineDayLabels**: 生成时间线底部的日期标签
- **windowTimeRange**: 格式化选中窗口的时间范围文本

所有数据通过 `api.getUsageWindows()` 获取（API 端点调用类型为 `UsageWindowWithUsage`），这是一个 main 分支中未使用的 API。

---

## 新增文件说明

| 文件 | 说明 |
|------|------|
| `useDashboardData.ts` | 从 main 的 `useDashboard.ts` 中拆分出的数据获取逻辑。管理 stats/cache 数据、Chart.js 图表数据构建、Promise.allSettled 并行请求、缓存去重。新增 `tokenThroughputChartData` 堆叠面积图、conditionalloading 行为。 |
| `useDashboardFilters.ts` | 从 main 的 `useDashboard.ts` 中拆分出的筛选逻辑。管理 modelFilter/keyFilter/clientType、构建 API 请求参数（statsParams/cacheSummaryParams/tsParams）、加载筛选选项。差异：period 参数固定为 "window"。 |
| `useDashboardTimeline.ts` | 全新 composable。管理时间线窗口导航器的全部逻辑：窗口加载、合并、自动选择、渲染样式计算、tooltip 格式化。 |

## 移除文件说明

无文件被移除。main 中 Dashboard 相关的所有文件在 feat 中都存在对应文件，逻辑已被重构到新的拆分 composable 中。

---

## 关键风险项

1. **periodTab 功能完全移除（差异 1、2、13、18）**: 用户无法再按周/月/自定义时间段查看统计。如果此功能在被用户依赖，则构成回归。需确认是否为有意的功能裁剪。

2. **API 参数 period 固定为 "window"（差异 18、23）**: main 分支根据 periodTab 传递不同的 period 值（"window"/"weekly"/"monthly"），feat 始终固定为 "window"。后端 API 对 period 参数的处理可能导致返回不同粒度的数据。需验证后端是否在 window 模式下返回与 weekly/monthly 不同的数据结构。

3. **Provider 排序依据变更（差异 3）**: 从 output tokens 变为 input tokens。如果用户习惯了按 output 排序的 provider 列表，可能产生困惑。

4. **inputTokensChartData / outputTokensChartData 在模板中未使用**: `useDashboardData` 返回了这两个 chart data，但 `Dashboard.vue` 模板中未使用它们。需确认是否应该清理死代码，或是否计划在其他地方使用。
