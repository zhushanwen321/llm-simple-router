# 仪表盘重做设计文档

日期：2026-04-27

## 目标

重做仪表盘页面，整体功能按时间粒度（5 小时窗口、本周、本月、自定义区间）+ provider 维度计算请求次数和 token 数据。页面名字不变（仪表盘）。

## 页面布局

```
┌──────────────────────────────────────────────────────────────────┐
│ 仪表盘                  [provider-1] [provider-2] [provider-3]  │  ← provider 按钮组
├──────────────────────────────────────────────────────────────────┤
│ [最近5小时]  [本周]  [本月]  [自定义]                           │  ← 时间 tab
├──────────────────────────────────────────────────────────────────┤
│ ⏱ 2026-04-27 02:00 ~ 2026-04-27 07:00                           │  ← 时间范围
│                                                                  │
│ [全部模型 ▼]    [全部密钥 ▼]                                    │  ← 模型+密钥筛选
│                                                                  │
│ ┌─────────────┐ ┌──────────┐ ┌──────────────┐ ┌────────────┐ ┌────────────┐ │
│ │ 总请求数     │ │ 成功率    │ │Token 输出速度 │ │Token 输入量 │ │Token 输出量 │ │  ← 5 卡片一行
│ │ 1,234        │ │ 98.5%    │ │ xxx t/s       │ │ xxx           │ │ xxx         │ │
│ └─────────────┘ └──────────┘ └──────────────┘ └────────────┘ └────────────┘ │
│                                                                  │
│ ┌──────────────────────────────────────────┐  Token 输出速度    │
│ │ chart: tokens/s over time                │                    │
│ └──────────────────────────────────────────┘                    │
│ ┌──────────────────────────────────────────┐  Token 输入总量    │
│ │ chart: input tokens over time            │                    │
│ └──────────────────────────────────────────┘                    │
│ ┌──────────────────────────────────────────┐  Token 输出总量    │
│ │ chart: output tokens over time           │                    │
│ └──────────────────────────────────────────┘                    │
└──────────────────────────────────────────────────────────────────┘
```

### 交互规则

- **provider 按钮组**：显示所有活跃 provider，默认按当前选中 tab 对应周期内的 output token 数降序排列，默认选中第一个（output token 最多）的 provider
- **tab 切换**：切换 5h/周/月/自定义时，所有下方数据（时间范围、指标卡片、图表）重新加载
- **provider 切换**：点击不同 provider，所有下方数据刷新为该 provider 的数据
- **模型/密钥筛选**：在 provider 基础上进一步过滤。默认"全部模型"和"全部密钥"
- **自定义 tab**：展开日期范围选择器（datetime-local），用户自选起止时间，不是"全部时间"

## 干掉的内容

- 现有"套餐用量追踪"卡片及其子组件：ProviderWindowTabs、ProviderDailyTabs、DailyUsageTable
- 模型对比表
- 旧统计卡片区域和旧图表区域
- useUsage composable
- 旧 useMetrics composable（替换为新 useDashboard）

## 后端改动

### `getStats` 拆字段

文件: `src/db/stats.ts`

现有返回：
```ts
interface Stats {
  totalRequests: number;
  successRate: number;
  avgTps: number;
  totalTokens: number;
}
```

改为：
```ts
interface Stats {
  totalRequests: number;
  successRate: number;
  avgTps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}
```

SQL 中 `total_tokens` 拆为 `SUM(rm.input_tokens)` 和 `SUM(rm.output_tokens)`，不加在一起。

同时 `getStats` 增加 `providerId?: string` 参数，支持 provider 级过滤。

文件: `src/admin/stats.ts`

StatsQuerySchema 增加 `provider_id: Type.Optional(Type.String())`。

### Timeseries API（不需要改动）

现有 `/admin/api/metrics/timeseries` 已支持 `provider_id` 过滤参数，分别传 `metric=tps`、`metric=input_tokens`、`metric=output_tokens` 即可。

## 前端改动

### 数据层：新 `useDashboard` composable

文件: `frontend/src/composables/useDashboard.ts`

```ts
useDashboard() => {
  // --- 状态 ---
  providers: Provider[]              // 所有活跃 provider
  selectedProvider: string           // 当前选中 provider id
  periodTab: 'window'|'weekly'|'monthly'|'custom'
  customRange: { start: string, end: string }  // 自定义模式下的日期范围
  modelFilter: string                // 'all' | 具体模型名
  keyFilter: string                  // 'all' | 具体密钥 id

  // --- 排序 ---
  sortedProviders: Provider[]        // 按 output token 降序后

  // --- 派生 ---
  timeRangeText: string              // "yyyy-MM-dd HH:mm ~ yyyy-MM-dd HH:mm"
  apiParams: { period?, start_time?, end_time?, provider_id, router_key_id?, backend_model? }

  // --- 数据 ---
  stats: { totalRequests, successRate, avgTps, totalInputTokens, totalOutputTokens }
  tpsChartData, inputTokensChartData, outputTokensChartData  // ChartData<"line">
  loading: boolean

  // --- 方法 ---
  selectProvider(id: string)
  setPeriodTab(tab)
  setCustomRange(start, end)
  setModelFilter(v), setKeyFilter(v)
  refresh()                          // 刷新所有数据（stats + charts）
}
```

### 页面：重写 `Dashboard.vue`

`Dashboard.vue` 完全重写，按上述布局渲染。

不再引入子组件（ProviderWindowTabs / ProviderDailyTabs / DailyUsageTable / 模型对比表）。

### 删除文件

- `frontend/src/composables/useUsage.ts` — 替换为 useDashboard
- `frontend/src/composables/useMetrics.ts` — 包含旧 dashboard 逻辑，不再使用
- `frontend/src/components/dashboard/ProviderWindowTabs.vue` — 不再需要
- `frontend/src/components/dashboard/ProviderDailyTabs.vue` — 不再需要
- `frontend/src/components/dashboard/DailyUsageTable.vue` — 不再需要
- `frontend/src/components/dashboard/WindowTable.vue` — 不再需要

### 图表样式

3 个 chart 使用 chart.js + vue-chartjs：
- chart area 高度约 200px
- 使用与现有一致的 `lineOptions` 或自定义
- 颜色使用 design-tokens 中的 CHART_COLORS

## 错误处理

- 每个 API 请求失败用 toast 提示错误信息
- 图表请求失败时对应 chart 不渲染（保持上一次数据或显示空状态）
- 所有 API 请求用 `Promise.allSettled` 并行执行
