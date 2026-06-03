# Dashboard 重新设计

> 重构日期：2026-05-22 ~ 2026-05-23
> 分支：`feat-frontend-design`

## 设计定位

Dashboard 是管理后台的首屏，承担"系统健康一瞥"的核心职责。设计目标：

1. **5 秒内获取关键状态**：token 消耗趋势、成功率、当前负载
2. **供应商维度切换**：快速定位哪个 provider 消耗最多
3. **时间窗口导航**：通过 UsageWindow 时间线浏览历史数据

## 设计风格

遵循 DESIGN.md 的 "Operator's Console" 定位：

- **暗色优先**：深色背景、高对比文字
- **无装饰**：卡片无边框/阴影，靠背景色区分层次
- **数据即 Mono**：所有数字用 `font-mono`（JetBrains Mono）
- **单一强调色**：Circuit Teal（oklch hue 175）仅用于选中态和主操作
- **紧凑布局**：高信息密度，控件高度 30-32px

## 4-Zone 布局架构

```
┌─────────────────────────────────────────────────────────────────┐
│ Zone 1: Header                                                  │
│ [仪表盘]  [OpenAI ✓2.1M]  [Anthropic]  [DeepSeek]  [筛选 ▾]    │
├─────────────────────────────┬───────────────────────────────────┤
│ Zone 2: Metrics + Chart      │                                   │
│ ┌─────────────────────────┐ │ ┌───────────────────────────────┐ │
│ │ Input Tokens             │ │ │ Token Throughput (stacked)    │ │
│ │ 3.2M                     │ │ │ ▁▂▃▅▇▅▃▂▁▂▃▅▇               │ │
│ │ +12% vs prev             │ │ │ ── Input  ── Output          │ │
│ ├─────────────────────────┤ │ └───────────────────────────────┘ │
│ │ Output Tokens            │ │                                   │
│ │ 842K                     │ │                                   │
│ │ -5% vs prev              │ │                                   │
│ ├────────────┬────────────┤ │                                   │
│ │ Avg TPS    │ Cache Hit  │ │                                   │
│ │ 48.2 t/s   │ 73.5%      │ │                                   │
│ └────────────┴────────────┘ │                                   │
│ Requests 12,847 │ 99.2% │ 14:00~19:00                           │
├─────────────────────────────┴───────────────────────────────────┤
│ Zone 3: Secondary Charts                                         │
│ ┌───────────────────────────┐ ┌───────────────────────────────┐ │
│ │ Output Speed (TPS)        │ │ Cache Hit Rate                │ │
│ │ ▁▂▃▅▇▅▃▂                 │ │ ▁▂▃▅▇▅▃▂                     │ │
│ └───────────────────────────┘ └───────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ Zone 4: Timeline                                                 │
│ [14:00 ~ 19:00] [24h][3d][7d]           点击窗口查看详情         │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ ██▓▓▓▓▓▓▓▓▓▓██  ▓▓▓▓▓▓▓▓▓▓▓▓████                          ││
│ └──────────────────────────────────────────────────────────────┘│
│  Mon 5/22        Tue 5/23         Wed 5/24                      │
└─────────────────────────────────────────────────────────────────┘
```

### Zone 1: Header + Provider 切换

| 元素 | 实现 |
|------|------|
| 标题 | `text-base font-semibold`，固定 `shrink-0` |
| Provider 按钮 | `Button variant="default"｜"ghost" size="sm" h-[30px]`，水平滚动 |
| Token 标签 | 紧跟 provider 名，`font-mono text-[11px]`，显示格式如 `1.2M`、`842K` |
| 筛选 Popover | `Filter` 图标 + Badge 计数，含 Model/Key/ClientType 三个 Select |

### Zone 2: Metrics + Primary Chart

左侧指标卡片区 + 右侧堆叠面积图，`grid-cols-[1fr_1.2fr]` 布局。

**指标卡片层级：**

| 层级 | 内容 | 样式 |
|------|------|------|
| L1 主指标 | Input Tokens（青色）、Output Tokens（白色） | `text-[32px] font-mono font-bold`，带 delta 行 |
| L2 次指标 | Avg TPS、Cache Hit Rate | `text-lg font-mono font-semibold`，`grid-cols-2` |
| L3 行内指标 | Requests / Success Rate / Window | `text-[11px]` 标签 + `text-[13px]` 值，水平排列 |

**Delta 显示：**
- 正增长 `text-success`（绿色），负增长 `text-danger`（红色）
- 格式：`+12.3%` / `-5.2%`，后跟 `vs prev` 文本
- 无历史数据时显示"无历史数据"

**Token Throughput 堆叠面积图：**
- 双数据集：Input（teal）+ Output（green），`fill: "origin"` + `stacked: true`
- 图例：`position: "top", align: "start"`，小圆点样式（`usePointStyle: true, pointStyle: "circle", boxWidth: 8`）

### Zone 3: Secondary Charts

两个简化折线图并排（`grid-cols-2`），高 140px。

**关键样式决策：底部图表使用 `miniLineOptions`**：
- Y 轴完全隐藏（`display: false`），不显示刻度数字
- X 轴只显示少量 tick（5 个均匀分布）
- 无图例（`legend: { display: false }`）
- 保留 tooltip 交互

**为什么不显示 Y 轴刻度：** 底部图表的作用是展示趋势形态，精确数值由 tooltip 提供。Y 轴刻度在暗色主题下视觉噪声太大。

### Zone 4: Timeline Navigator

基于真实 `UsageWindow` 数据的时间线，而非固定时间分桶。

**数据流：**
```
后端 UsageWindowTracker → GET /usage/windows?start_time&end_time
→ useDashboard.timelineWindows (合并重叠窗口)
→ Dashboard.vue 渲染定位的色块
```

**窗口合并算法（`mergeTimelineWindows`）：**
- 同一 provider 同一时段可能有多个 `router_key_id` 窗口（start_time 差几秒）
- 按 `(provider_id)` 分组，合并时间重叠或相邻（gap ≤ 60s）的窗口
- 扩展 end_time 到最晚，聚合 request_count / total_input_tokens / total_output_tokens
- 提取为模块级函数以避免 `useDashboard` 超过 300 行 ESLint 限制

**时间线渲染：**

| 参数 | 说明 |
|------|------|
| 锚点 | `now`（当前时间），向回看 `timelineDurationMs` |
| 缩放级别 | 24h（默认）、3d、7d，通过 `timelineRange` ref 切换 |
| 色块颜色 | 4 级强度梯度，基于 `total_output_tokens`：<3M / <1.5M / <500K / 默认 |
| 选中态 | `ring-2 ring-primary ring-inset brightness-130 z-[2]` |
| Tooltip | `MM/DD HH:MM-HH:MM | XXX out` 格式 |
| 日期标签 | 每天一个标签，position 0 处不偏移，其余 `-translate-x-1/2` 居中 |

**色块定位算法：**
```typescript
// 左边界 = max(window.start_time, timelineStart) 相对于 timelineDuration 的百分比
// 宽度 = (visEnd - visStart) / timelineDuration * 100%
// visEnd = min(window.end_time, now)
// 色块限制在 [0%, 100%] 范围内
```

## 样式踩坑记录

### 1. `ring-foreground/10` 在 Tailwind + CSS 变量环境下不工作

**现象：** 卡片出现青色边框，而非预期的微弱白色边框。

**根因：** Tailwind v3 对 CSS 变量格式的颜色（如 `var(--foreground)`）无法正确应用 opacity modifier（`/10`）。当 opacity modifier 无法解析时，Tailwind fallback 到 `--tw-ring-color` 默认值，即 `--ring` 变量（oklch(0.78 0.10 175) = 青色）。

**解决方案：** 移除 `ring-1 ring-foreground/10`。卡片靠 `bg-card` 背景色差异与页面背景区分，不加任何边框。这恰好符合 DESIGN.md 的 Flat-By-Default 规则。

**教训：** 在 shadcn-vue + Tailwind 体系中，避免对 CSS 变量颜色使用 opacity modifier（`/10`、`/50` 等）。如果需要半透明效果：
- 用 `border-white/5` 这种直接指定颜色 + opacity 的写法
- 或在 CSS 变量定义中直接包含 alpha 通道（如 `oklch(1 0 0 / 5%)`）

### 2. Chart `:key` 绑定导致双次渲染

**现象：** 切换时间范围时，图表闪烁两次。

**根因：** `:key="selectedWindowId"` 导致 Vue 在 window ID 变化时销毁并重建 Chart.js canvas。第 1 次渲染用旧数据（新 canvas），第 2 次渲染用新数据（data prop 更新）。

**解决方案：** 移除 `:key`。vue-chartjs 内部通过 watch `data` 和 `options` prop 的变化，调用 `chart.update()` 原地更新。不需要强制重建 canvas。

### 3. `loading.value = true` 导致 skeleton 闪烁

**现象：** 每次数据刷新时图表区域先显示 skeleton 再显示图表。

**根因：** `refresh()` 函数在每次调用时都设 `loading.value = true`，触发模板从 chart 切到 skeleton。

**解决方案：** 只在首次加载时显示 skeleton：
```typescript
loading.value = !stats.value.totalRequests && !stats.value.totalInputTokens;
```
后续刷新静默更新数据，不切换 skeleton。

### 4. Timeline 窗口重叠

**现象：** 3d/7d 缩放下，时间线上同一位置出现多个色块重叠。

**根因：** 后端 `UsageWindowTracker` 按 `(router_key_id, provider_id)` 创建窗口。同一 provider 同一时段可能有 `null`、`key1`、`key2` 三个窗口，start_time 差几秒。之前的精确匹配去重（`provider_id:start_time`）无效。

**解决方案：** `mergeTimelineWindows()` 函数按时间重叠合并：同一 provider 的窗口如果 start_time 间隔 ≤ 60s，合并为一个色块。

## 数据流

```
Dashboard.vue
├── useDashboard() composable
│   ├── providers / selectedProvider / sortedProviders
│   ├── providerTokenLabels (重叠时间匹配)
│   ├── usageWindows → timelineWindows (mergeTimelineWindows)
│   ├── selectedWindowId → selectedWindow
│   ├── timelineRange (24h | 3d | 7d)
│   ├── filters (model / key / clientType)
│   ├── useDashboardData()
│   │   ├── stats / cacheHitRate / deltaValues
│   │   ├── tpsChartData / tokenThroughputChartData
│   │   ├── inputTokensChartData / outputTokensChartData
│   │   └── refresh() → Promise.allSettled([stats, tps, input, output, summary])
│   └── useDashboardFilters()
│       ├── modelFilter / keyFilter / clientType
│       └── modelOptions / keyOptions
├── metrics-helpers.ts
│   ├── fillTimeseries() → { labels, values }
│   ├── stackedAreaOptions() → ChartOptions (legend top, stacked)
│   └── miniLineOptions() → ChartOptions (no Y-axis, no legend)
└── token-format.ts
    ├── formatTokenCompact() → "3.2M", "842K", "127"
    └── formatProviderTokenLabel() → "1.2M out"
```

## API 依赖

| 端点 | 参数 | 返回 | 用途 |
|------|------|------|------|
| `GET /admin/api/providers` | — | `Provider[]` | Zone 1 供应商按钮 |
| `GET /admin/api/usage/windows` | `start_time`, `end_time`, `provider_id` | `UsageWindowWithUsage[]` | Zone 4 时间线 + 窗口选择 |
| `GET /admin/api/stats` | `period=window`, `start_time`, `end_time`, `provider_id`, ... | `StatsResponse` | Zone 2 指标卡片 |
| `GET /admin/api/metrics/timeseries` | `period=window`, `metric`, `start_time`, `end_time` | `TimeseriesRawRow[]` | Zone 2/3 图表 |
| `GET /admin/api/metrics/summary` | `period=window`, `start_time`, `end_time` | `MetricsSummaryResponse` | Zone 2 缓存命中率 |

## 文件清单

| 文件 | 行数 | 角色 |
|------|------|------|
| `frontend/src/views/Dashboard.vue` | ~560 | 视图层：模板 + timeline 渲染逻辑 |
| `frontend/src/composables/useDashboard.ts` | ~750 | 逻辑层：`useDashboard` + `useDashboardData` + `useDashboardFilters` + `mergeTimelineWindows` |
| `frontend/src/views/metrics-helpers.ts` | ~190 | 工具层：`fillTimeseries` + `lineOptions` + `stackedAreaOptions` + `miniLineOptions` |
| `frontend/src/utils/token-format.ts` | ~40 | 格式化：`formatTokenCompact` + `formatProviderTokenLabel` |
| `frontend/src/styles/design-tokens.ts` | ~35 | Chart.js 颜色常量 |
| `frontend/src/i18n/locales/zh-CN/dashboard.json` | ~50 | 中文翻译 |
| `frontend/src/i18n/locales/en/dashboard.json` | ~50 | 英文翻译 |
| `router/src/admin/usage.ts` | ~120 | 后端：usage windows API |
| `router/src/db/usage-windows.ts` | ~150 | 后端：DB 查询 |
| `router/src/proxy/routing/usage-window-tracker.ts` | ~200 | 后端：窗口创建与管理 |
| `docs/designs/demo-dashboard.html` | ~700 | HTML 设计 demo（静态） |
