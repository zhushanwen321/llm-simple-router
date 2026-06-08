# 前端设计方案 — Metrics 分层存储 + Dashboard 时间选择器重构

## 概述

本方案将前端变更拆分为 3 个 Task Group（FG1-FG3），覆盖 Dashboard 时间选择器重构、数据获取改造、Settings 保留策略扩展。

---

## FG1: Dashboard 时间选择器重构

**目标**：替换 `useDashboardTimeline`（基于 usage_windows）为新的 `useTimeSelector` composable，支持快速按钮 + 可视化活动图 + Custom 日期选择。

### 1.1 新建 composable：`useTimeSelector`

**文件**：`frontend/src/composables/useTimeSelector.ts`（新建）

**替代**：`frontend/src/composables/useDashboardTimeline.ts`（删除）

**接口签名**：

```typescript
type QuickRange = '5h' | '24h' | '7d' | '30d';

interface TimeSelection {
  startTime: string;   // ISO datetime
  endTime: string;     // ISO datetime
}

interface ActivityBucket {
  bucket_time: string;
  request_count: number;
}

interface UseTimeSelectorInput {
  selectedProvider: Ref<string>;
  t: (key: string) => string;
}

interface UseTimeSelectorReturn {
  // 快速按钮状态
  activeRange: Ref<QuickRange | 'custom' | null>;
  selectQuickRange: (range: QuickRange) => void;

  // 当前时间选区
  timeSelection: ComputedRef<TimeSelection>;
  timeRangeLabel: ComputedRef<string>;  // "Jun 1 14:00 ~ Jun 8 14:00"

  // Custom 日期选择
  showCustom: Ref<boolean>;
  toggleCustom: () => void;
  customStart: Ref<string>;  // date string "YYYY-MM-DD"
  customEnd: Ref<string>;    // date string "YYYY-MM-DD"
  applyCustom: () => void;
  customError: Ref<string>;

  // 活动图数据
  activityBuckets: Ref<ActivityBucket[]>;
  detailDays: Ref<number>;          // 从 GET /settings/metrics-detail-days 获取
  loadActivity: () => Promise<void>;

  // 可视化常量
  TOTAL_RANGE_DAYS: number;  // 30
  MAX_CUSTOM_DAYS: number;   // 90
}
```

**关键逻辑**：

- `selectQuickRange(range)` → 计算 `now - rangeDuration` → 设置 `activeRange` → 收起 Custom 行
- `applyCustom()` → 校验 start < end、≤ 90 天回溯、非未来 → 设置 `activeRange = 'custom'`
- `loadActivity()` → 调用 `GET /admin/api/metrics/activity?provider_id=xxx`，获取 `ActivityBucket[]`
- `detailDays` → 在 `onMounted` 时调用 `GET /admin/api/settings/metrics-detail-days` 获取，用于前端渲染聚合分界线

### 1.2 新建组件：`ActivityTimeline.vue`

**文件**：`frontend/src/components/dashboard/ActivityTimeline.vue`（新建）

**功能**：可视化活动图（30 天迷你柱状图 + 选区覆盖 + 聚合区域指示器）

**Props**：

```typescript
interface Props {
  buckets: ActivityBucket[];           // 活动数据
  selectionStart: number;              // 选区起始（ms timestamp）
  selectionEnd: number;                // 选区结束（ms timestamp）
  totalRangeDays: number;              // 总显示范围（30）
  detailDays: number;                  // 明细天数（用于渲染分界线）
  rangeStart: number;                  // 整个 track 的起始时间戳
}
```

**Events**：

```typescript
interface Emits {
  (e: 'update:selection', range: { start: number; end: number }): void;
}
```

**渲染要素**：
- 迷你柱状图：从 `buckets` 渲染绝对定位 div，高度 = request_count 归一化
- 选区覆盖层：半透明 primary 色矩形 + 左右拖拽 handle
- 聚合分界线：>detailDays 区域显示斜线阴影 + "AGGREGATED" 标签
- 刻度标签：每 3 天一个 tick + "now" 标记

### 1.3 修改组件：`Dashboard.vue`

**文件**：`frontend/src/views/Dashboard.vue`

**变更**：
- 移除 Zone 4（usage window timeline navigator）整段模板
- 新增 Zone 1（Visual Time Range Selector）模板，对应 demo-dashboard-v2.html 的 `.zone-time` 区域
- 模板包含：快速按钮行 + ActivityTimeline 组件 + Custom 日期输入行
- 从 `useDashboard` facade 解构新返回值（`activeRange`、`selectQuickRange`、`showCustom` 等）
- 移除 `timelineZoomOptions` 常量和相关 timeline 渲染代码

### 1.4 修改 composable：`useDashboard.ts`

**文件**：`frontend/src/composables/useDashboard.ts`

**变更**：
- 移除 `useDashboardTimeline` 导入和实例化
- 新增 `useTimeSelector` 导入和实例化
- 移除 `watch([selectedProvider, timeline.timelineRange], ...)` watcher
- 新增 `watch([selectedProvider, timeSelector.activeRange], ...)` watcher，触发数据刷新
- 移除 `loadPrevWindowStats()` 函数（环比改为基于前一个同长度时段，或简化移除）
- `watchKey` computed 中 `selectedWindowId` → `activeRange` + `timeSelection`
- 移除 `usageWindows`、`selectedWindowId`、`timelineWindows`、`timelineRange` 等导出
- 新增 `activeRange`、`timeSelection`、`timeRangeLabel`、`activityBuckets` 等导出
- 移除 `aggregateAllProviderInputTokens()` 和 provider token label 基于 usageWindows 的计算
  → provider token labels 改为从 stats API 的 provider 维度汇总获取（已有 `MetricsSummaryRow`）

### 1.5 删除文件

| 文件 | 原因 |
|------|------|
| `frontend/src/composables/useDashboardTimeline.ts` | 被 `useTimeSelector.ts` 完全替代 |

---

## FG2: Dashboard 筛选面板 + 数据获取改造

**目标**：改造 `useDashboardData` 以新的时间范围参数（startTime/endTime）替代 usage window 模式，同时保持筛选功能。

### 2.1 修改 composable：`useDashboardData`

**文件**：`frontend/src/composables/useDashboardData.ts`

**接口变更**：

```typescript
// 旧接口
interface DashboardDataInput {
  selectedProvider: Ref<string>;
  statsParams: ComputedRef<Record<string, string>>;
  cacheSummaryParams: ComputedRef<Record<string, string>>;
  tsParams: (metric: string, timeRange?: { startTime: string; endTime: string }) => ...;
  selectedWindow: ComputedRef<UsageWindowWithUsage | null>;
  watchKey: ComputedRef<string>;
  t: (key: string) => string;
}

// 新接口
interface DashboardDataInput {
  selectedProvider: Ref<string>;
  filterParams: ComputedRef<Record<string, string>>;   // 合并后的筛选参数
  timeSelection: ComputedRef<{ startTime: string; endTime: string }>;
  watchKey: ComputedRef<string>;
  t: (key: string) => string;
}
```

**关键逻辑变更**：

- `refresh()` 中移除 `selectedWindow` 依赖，改为从 `timeSelection` 获取 startTime/endTime
- 所有 API 调用统一注入 `start_time` 和 `end_time` 参数（不再使用 `period: "window"`）
- `period` 参数保持 `"window"` 不变（后端根据 start_time/end_time 自动路由查询）
- 合并 `statsParams`、`cacheSummaryParams`、`tsParams` 为统一的 `filterParams`
- `tsParams()` 辅助函数改为从 `filterParams` + `timeSelection` 组合构建

### 2.2 修改 composable：`useDashboardFilters`

**文件**：`frontend/src/composables/useDashboardFilters.ts`

**变更**：

- 合并 `statsParams`、`cacheSummaryParams`、`tsParams` 为统一的 `filterParams`：
  ```typescript
  const filterParams = computed(() => {
    const p: Record<string, string> = {};
    if (selectedProvider.value) p.provider_id = selectedProvider.value;
    if (modelFilter.value !== 'all') p.backend_model = modelFilter.value;
    if (keyFilter.value !== 'all') p.router_key_id = keyFilter.value;
    if (clientType.value !== 'all') p.client_type = clientType.value;
    return p;
  });
  ```
- 移除 `buildBaseParams()`、`statsParams`、`cacheSummaryParams`、`tsParams` 导出
- 新增 `filterParams` 导出

### 2.3 修改 API client：`client.ts`

**文件**：`frontend/src/api/client.ts`

**变更**：

- 新增 API 方法：
  ```typescript
  getMetricsActivity: (params?: { router_key_id?: string; provider_id?: string }) =>
    request<ActivityResponse>('get', '/metrics/activity', undefined, { params }),
  ```

- `ActivityResponse` 类型定义：
  ```typescript
  interface ActivityBucket {
    bucket_time: string;
    request_count: number;
  }
  interface ActivityResponse {
    buckets: ActivityBucket[];
  }
  ```

- 现有 API 方法（`getStats`、`getMetricsSummary`、`getMetricsTimeseries`）**签名不变**
- 保留 `getUsageWindows`（向后兼容，但前端不再调用）
- 移除前端对 `UsageWindowWithUsage` 类型的直接依赖（仅保留类型定义以备向后兼容）

### 2.4 新增 API：`settings-api.ts`

**文件**：`frontend/src/api/settings-api.ts`

**新增**：

```typescript
export function getMetricsDetailDays() {
  return request<{ days: number }>('get', '/settings/metrics-detail-days');
}

export function setMetricsDetailDays(days: number) {
  return request<{ days: number }>('put', '/settings/metrics-detail-days', { days });
}
```

### 2.5 修改 composable：`useDashboard.ts`（watcher 重构）

**文件**：`frontend/src/composables/useDashboard.ts`

**变更**：

- `watchKey` 改为依赖 `timeSelection` 而非 `selectedWindowId`
- watcher 逻辑简化：
  - provider 切换 → 重新加载 activity + 刷新数据
  - 时间选区变化 → 刷新数据（debounced）
  - 筛选变化 → 刷新数据（debounced）
- `onMounted` 初始化流程：
  1. `loadProviders()`
  2. `loadActivity()` + `loadFilterOptions()` + `detailDays` 加载
  3. `autoSelectProviderIfNeeded()`
  4. `selectQuickRange('24h')`（默认选 24h）
  5. `data.refresh()`

---

## FG3: Settings 保留策略 Card 改造

**目标**：将 Settings 页面的 Log Retention Card 改为双栏布局，新增 `metrics_detail_days` 配置。

### 3.1 修改 composable：`useLogRetention.ts`

**文件**：`frontend/src/composables/useLogRetention.ts`

**变更**：扩展为同时管理 log_retention_days 和 metrics_detail_days。

```typescript
interface UseLogRetentionReturn {
  // Log Retention（已有）
  retentionDays: Ref<number>;
  retentionSaving: Ref<boolean>;
  saveRetention: () => Promise<void>;
  loadRetention: () => Promise<void>;

  // Metrics Detail（新增）
  metricsDetailDays: Ref<number>;
  metricsDetailSaving: Ref<boolean>;
  loadMetricsDetail: () => Promise<void>;

  // 统一保存
  saveBoth: () => Promise<void>;
  validationError: ComputedRef<string>;  // metrics_detail_days > retention_days 时报错
}
```

**关键逻辑**：
- `loadMetricsDetail()` → `getMetricsDetailDays()` → `metricsDetailDays.value = result.days`
- `saveBoth()` → 先校验 `metricsDetailDays ≤ retentionDays`，通过后并行调用 `setLogRetention` + `setMetricsDetailDays`
- `validationError` → 当 `metricsDetailDays > retentionDays` 时返回错误消息

### 3.2 修改组件：`Settings.vue`

**文件**：`frontend/src/views/Settings.vue`

**变更**：

Log Retention Card 模板重构为双栏布局：

```
┌────────────────────────────────────────────────────┐
│  Data Retention                                    │
│  Control how long request logs and metrics...      │
├──────────────────┬──┬─────────────────────────────┤
│ Request Logs     │  │ Metrics Detail               │
│ [30] days        │  │ [7]  days detail             │
│ Complete request │  │ 7d full-resolution metrics.  │
│ /response logs...│  │ Beyond this, data is         │
│                  │  │ aggregated into 10-min...    │
├──────────────────┴──┴─────────────────────────────┤
│ [====detail====][===aggregated===]                 │
│ now              7d detail         30d total       │
├────────────────────────────────────────────────────┤
│                           [Reset] [Save Changes]   │
└────────────────────────────────────────────────────┘
```

- 左栏：Request Logs 保留天数（现有 `log_retention_days`，不变）
- 右栏：Metrics Detail 保留天数（新增 `metrics_detail_days`）
- 底部可视化条：实色 = detail 期，半透明 = aggregated 期
- 一个 Save 按钮保存两项
- 校验错误时在对应输入框下方显示 FormMessage

**具体模板变更**：
- Card 内部从单栏 `flex items-end gap-4` 改为 `grid grid-cols-2 gap-6`
- 新增 Metrics Detail 输入区域（Label + Input + hint）
- 新增可视化 bar（参考 demo-settings-retention.html 的 `.retention-bar` 实现）
- Save 按钮调用 `saveBoth()` 而非 `saveRetention()`

### 3.3 新增常量

**文件**：`frontend/src/views/Settings.vue`

```typescript
const METRICS_DETAIL_MIN = 1;
const METRICS_DETAIL_MAX = 30;
const DEFAULT_METRICS_DETAIL_DAYS = 7;
```

---

## 组件树结构

### 新增组件

| 组件 | 路径 | 职责 |
|------|------|------|
| `ActivityTimeline.vue` | `frontend/src/components/dashboard/` | 可视化活动图（迷你柱状图 + 选区 + 聚合区域） |

### 新增 composable

| Composable | 路径 | 职责 |
|------------|------|------|
| `useTimeSelector` | `frontend/src/composables/` | 快速按钮 + Custom 日期 + 活动图数据管理 |

### 删除 composable

| Composable | 原因 |
|------------|------|
| `useDashboardTimeline` | 被 `useTimeSelector` 替代 |

### 组件依赖关系（Dashboard 页面）

```
Dashboard.vue
├── useDashboard (facade)
│   ├── useTimeSelector ← 新增
│   │   ├── api.getMetricsActivity()     ← 新增 API
│   │   └── getMetricsDetailDays()       ← 新增 API
│   ├── useDashboardFilters (改造)
│   │   └── filterParams (合并输出)
│   └── useDashboardData (改造)
│       ├── api.getStats()
│       ├── api.getMetricsTimeseries()
│       └── api.getMetricsSummary()
├── ActivityTimeline.vue ← 新增组件
└── (现有: Button, Popover, Select, Badge, Card, Line chart...)
```

### 组件依赖关系（Settings 页面）

```
Settings.vue
├── useLogRetention (扩展)
│   ├── api.getLogRetention()
│   ├── api.setLogRetention()
│   ├── getMetricsDetailDays()    ← 新增
│   └── setMetricsDetailDays()    ← 新增
└── (现有: Card, Input, Label, Button, Progress...)
```

---

## API 对接点

### 新增 API 调用

| 前端调用点 | API 端点 | 用途 |
|-----------|----------|------|
| `useTimeSelector.loadActivity()` | `GET /admin/api/metrics/activity` | 获取 30 天活动图数据 |
| `useTimeSelector` mounted | `GET /admin/api/settings/metrics-detail-days` | 获取聚合分界线天数 |
| `useLogRetention.loadMetricsDetail()` | `GET /admin/api/settings/metrics-detail-days` | Settings 页加载 metrics 保留天数 |
| `useLogRetention.saveBoth()` | `PUT /admin/api/settings/metrics-detail-days` | Settings 页保存 metrics 保留天数 |

### 现有 API 调用变更

| API 端点 | 变更 |
|---------|------|
| `GET /admin/api/stats` | 参数不变，start_time/end_time 从时间选择器直接传入（不再依赖 usage window） |
| `GET /admin/api/metrics/summary` | 同上 |
| `GET /admin/api/metrics/timeseries` | 同上 |
| `GET /admin/api/usage/windows` | 前端不再调用，API 保留向后兼容 |

### API 参数传递方式

旧方式（usage window）：
```
statsParams: { period: "window", start_time: window.start_time, end_time: window.end_time, provider_id: "xxx" }
```

新方式（时间选择器）：
```
params: { period: "window", start_time: timeSelection.startTime, end_time: timeSelection.endTime, provider_id: "xxx", ...filters }
```

关键区别：`start_time`/`end_time` 来源从 `UsageWindowWithUsage.window` 改为 `useTimeSelector.timeSelection`，参数结构不变。

---

## 迁移风险与注意事项

1. **`fillTimeseries` 兼容性**：`metrics-helpers.ts` 中的 `fillTimeseries()` 接受 `period: "window"` + `timeRange`，新逻辑保持一致传入，无需修改。

2. **Provider Token Labels**：旧逻辑从 `usageWindows` 聚合 provider input tokens。移除 usageWindows 后需改为从 `getMetricsSummary()` 的 `MetricsSummaryRow` 中聚合（该 API 已返回 `total_input_tokens` 按 provider 分组）。

3. **环比数据（delta）**：旧逻辑通过 "前一个 window" 获取环比。改为时间选器后，环比可简化为 "同长度前一时段"（如选 7d，环比 = 前一个 7d）或直接移除（spec 未要求保留 delta）。

4. **i18n**：新增的 UI 文案（Custom、Apply、AGGREGATED、Metrics Detail 等）需在 locale JSON 中补充对应 key。

5. **`TIMELINE_INTENSITY_COLORS`**：`design-tokens.ts` 中此常量仍可用于 ActivityTimeline 的活动柱颜色，无需删除。
