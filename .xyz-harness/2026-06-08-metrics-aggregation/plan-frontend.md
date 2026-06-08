# 前端实施计划 — Metrics 分层存储 + Dashboard 时间选择器重构

## 概述

前端变更拆分为 3 个 Task Group（FG1-FG3），覆盖 Dashboard 时间选择器重构、数据获取改造、Settings 保留策略扩展。

---

## FG1: Dashboard 时间选择器重构

**目标**：替换 `useDashboardTimeline`（基于 usage_windows）为新的 `useTimeSelector` composable，支持快速按钮 + 可视化活动图 + Custom 日期选择。

### FG1.1 新建 composable：`useTimeSelector`

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

interface UseTimeSelectorReturn {
  // 快速按钮
  activeRange: Ref<QuickRange | 'custom' | null>;
  selectQuickRange: (range: QuickRange) => void;

  // 时间选区
  timeSelection: ComputedRef<TimeSelection>;
  timeRangeLabel: ComputedRef<string>;

  // Custom 日期
  showCustom: Ref<boolean>;
  toggleCustom: () => void;
  customStart: Ref<string>;    // "YYYY-MM-DD"
  customEnd: Ref<string>;      // "YYYY-MM-DD"
  applyCustom: () => void;
  customError: Ref<string>;

  // 活动图
  activityBuckets: Ref<ActivityBucket[]>;
  detailDays: Ref<number>;
  loadActivity: () => Promise<void>;

  // 常量
  TOTAL_RANGE_DAYS: number;    // 30
  MAX_CUSTOM_DAYS: number;     // 90
}
```

**关键逻辑**：
- `selectQuickRange()` → 计算 now-rangeDuration → 收起 Custom 行
- `applyCustom()` → 校验 start < end、≤90 天回溯、非未来
- `loadActivity()` → `GET /admin/api/metrics/activity`
- `detailDays` → `GET /admin/api/settings/metrics-detail-days`（onMounted）

### FG1.2 新建组件：`ActivityTimeline.vue`

**文件**：`frontend/src/components/dashboard/ActivityTimeline.vue`（新建）

**Props**：

```typescript
{
  buckets: ActivityBucket[];          // 活动数据
  selectionStart: number;             // 选区起始 ms
  selectionEnd: number;               // 选区结束 ms
  totalRangeDays: number;             // 30
  detailDays: number;                 // 明细天数
  rangeStart: number;                 // track 起始时间戳
}
```

**Events**：

```typescript
{
  'update:selection': (range: { start: number; end: number }) => void;
}
```

**渲染要素**：迷你柱状图 + 选区覆盖（左右 handle 可拖拽）+ 聚合区域斜线阴影 + tick 标签

### FG1.3 修改 Dashboard.vue

**文件**：`frontend/src/views/Dashboard.vue`

- 移除 Zone 4（usage window timeline navigator）整段模板
- 新增 Zone 1（Visual Time Range Selector）：快速按钮行 + ActivityTimeline + Custom 日期输入行
- 移除 `timelineZoomOptions` 常量

### FG1.4 修改 useDashboard.ts

**文件**：`frontend/src/composables/useDashboard.ts`

- 替换 `useDashboardTimeline` → `useTimeSelector`
- watcher 改为监听 `activeRange`/`timeSelection`
- `watchKey` 中 `selectedWindowId` → `activeRange` + `timeSelection` JSON
- 移除 `loadPrevWindowStats()`
- 移除 `aggregateAllProviderInputTokens()`，provider token labels 改从 `getMetricsSummary()` 聚合
- 导出变更：移除 usageWindows/selectedWindowId/timelineWindows/timelineRange，新增 activeRange/timeSelection/timeRangeLabel/activityBuckets

### FG1.5 删除文件

| 文件 | 原因 |
|------|------|
| `frontend/src/composables/useDashboardTimeline.ts` | 被 useTimeSelector 完全替代 |

---

## FG2: Dashboard 筛选面板 + 数据获取改造

**目标**：改造 `useDashboardData` 以时间范围参数替代 usage window，统一筛选参数。

### FG2.1 修改 useDashboardData

**文件**：`frontend/src/composables/useDashboardData.ts`

**接口变更**：

```typescript
// 旧
interface DashboardDataInput {
  selectedProvider: Ref<string>;
  statsParams: ComputedRef<Record<string, string>>;
  cacheSummaryParams: ComputedRef<Record<string, string>>;
  tsParams: (metric: string, timeRange?: { startTime: string; endTime: string }) => ...;
  selectedWindow: ComputedRef<UsageWindowWithUsage | null>;
  watchKey: ComputedRef<string>;
  t: (key: string) => string;
}

// 新
interface DashboardDataInput {
  selectedProvider: Ref<string>;
  filterParams: ComputedRef<Record<string, string>>;    // 合并筛选
  timeSelection: ComputedRef<{ startTime: string; endTime: string }>;
  watchKey: ComputedRef<string>;
  t: (key: string) => string;
}
```

**关键变更**：
- `refresh()` 从 `timeSelection` 获取 startTime/endTime（不依赖 selectedWindow）
- 所有 API 调用统一注入 `start_time`/`end_time`
- 合并 statsParams/cacheSummaryParams/tsParams 为 filterParams

### FG2.2 修改 useDashboardFilters

**文件**：`frontend/src/composables/useDashboardFilters.ts`

- 合并 `statsParams` + `cacheSummaryParams` + `tsParams` → 统一 `filterParams`
- 移除 `buildBaseParams()`、`tsParams()` 辅助函数
- 导出变更：移除 statsParams/cacheSummaryParams/tsParams，新增 filterParams

### FG2.3 修改 API client

**文件**：`frontend/src/api/client.ts`

新增方法：

```typescript
getMetricsActivity: (params?: { router_key_id?: string; provider_id?: string }) =>
  request<ActivityResponse>('get', '/metrics/activity', undefined, { params }),
```

新增类型：

```typescript
interface ActivityBucket { bucket_time: string; request_count: number; }
interface ActivityResponse { buckets: ActivityBucket[]; }
```

现有 API 方法签名不变。保留 `getUsageWindows`（向后兼容）。

### FG2.4 修改 settings-api.ts

**文件**：`frontend/src/api/settings-api.ts`

新增：

```typescript
export function getMetricsDetailDays() {
  return request<{ days: number }>('get', '/settings/metrics-detail-days');
}
export function setMetricsDetailDays(days: number) {
  return request<{ days: number }>('put', '/settings/metrics-detail-days', { days });
}
```

### FG2.5 修改 useDashboard.ts（watcher 重构）

- `watchKey` 依赖 `timeSelection` 而非 `selectedWindowId`
- provider 切换 → 重新加载 activity + 刷新数据
- 时间选区变化 → 刷新数据（debounced）
- `onMounted` 流程：loadProviders → loadActivity + loadFilterOptions + detailDays → selectQuickRange('24h') → refresh

---

## FG3: Settings 保留策略 Card 改造

**目标**：Log Retention Card 改双栏布局，新增 metrics_detail_days 配置。

### FG3.1 扩展 useLogRetention

**文件**：`frontend/src/composables/useLogRetention.ts`

新增返回值：

```typescript
interface UseLogRetentionReturn {
  // 已有
  retentionDays: Ref<number>;
  retentionSaving: Ref<boolean>;
  saveRetention: () => Promise<void>;
  loadRetention: () => Promise<void>;

  // 新增
  metricsDetailDays: Ref<number>;
  metricsDetailSaving: Ref<boolean>;
  loadMetricsDetail: () => Promise<void>;
  saveBoth: () => Promise<void>;
  validationError: ComputedRef<string>;  // metrics > log 时报错
}
```

**关键逻辑**：
- `saveBoth()` → 校验 metricsDetailDays ≤ retentionDays → 并行调用两个 PUT API
- `validationError` → 实时校验

### FG3.2 修改 Settings.vue

**文件**：`frontend/src/views/Settings.vue`

Log Retention Card 重构为双栏布局：

```
┌──────────────────────────────────────────────┐
│  Data Retention                              │
├──────────────┬──┬───────────────────────────┤
│ Request Logs │  │ Metrics Detail             │
│ [30] days    │  │ [7] days detail            │
│ hint text    │  │ hint text                  │
├──────────────┴──┴───────────────────────────┤
│ [==detail==][==aggregated==]                 │
│ now       7d detail      30d total          │
├──────────────────────────────────────────────┤
│                          [Reset] [Save]      │
└──────────────────────────────────────────────┘
```

- `grid grid-cols-2 gap-6` 双栏
- 底部可视化 bar（实色 detail + 半透明 aggregated）
- Save 按钮调用 `saveBoth()`
- 新增常量：`METRICS_DETAIL_MIN=1`、`METRICS_DETAIL_MAX=30`

---

## 组件树结构

### 新增

| 组件/Composable | 路径 | 职责 |
|----------------|------|------|
| `ActivityTimeline.vue` | `frontend/src/components/dashboard/` | 可视化活动图 |
| `useTimeSelector` | `frontend/src/composables/` | 时间选择器状态管理 |

### 删除

| Composable | 原因 |
|------------|------|
| `useDashboardTimeline` | 被 useTimeSelector 替代 |

### Dashboard 依赖树

```
Dashboard.vue
├── useDashboard (facade)
│   ├── useTimeSelector ← 新增
│   │   ├── api.getMetricsActivity()      ← 新增
│   │   └── getMetricsDetailDays()        ← 新增
│   ├── useDashboardFilters (改造: filterParams)
│   └── useDashboardData (改造: timeSelection)
│       ├── api.getStats()
│       ├── api.getMetricsTimeseries()
│       └── api.getMetricsSummary()
└── ActivityTimeline.vue ← 新增
```

### Settings 依赖树

```
Settings.vue
└── useLogRetention (扩展)
    ├── api.getLogRetention() / setLogRetention()
    ├── getMetricsDetailDays()               ← 新增
    └── setMetricsDetailDays()               ← 新增
```

---

## API 对接点

### 新增调用

| 前端调用点 | API 端点 | 用途 |
|-----------|----------|------|
| `useTimeSelector.loadActivity()` | `GET /admin/api/metrics/activity` | 活动图数据 |
| `useTimeSelector` mounted | `GET /admin/api/settings/metrics-detail-days` | 聚合分界线天数 |
| `useLogRetention.loadMetricsDetail()` | `GET /admin/api/settings/metrics-detail-days` | Settings 加载 |
| `useLogRetention.saveBoth()` | `PUT /admin/api/settings/metrics-detail-days` | Settings 保存 |

### 现有调用（参数不变，来源改变）

| API | 变更 |
|-----|------|
| `GET /admin/api/stats` | start_time/end_time 从 timeSelection 传入 |
| `GET /admin/api/metrics/summary` | 同上 |
| `GET /admin/api/metrics/timeseries` | 同上 |
| `GET /admin/api/usage/windows` | 前端不再调用 |

---

## 注意事项

1. **`fillTimeseries` 无需修改**：`metrics-helpers.ts` 保持 `period: "window"` + `timeRange` 传入方式
2. **Provider Token Labels**：改为从 `getMetricsSummary()` 的 `MetricsSummaryRow` 聚合（已返回 `total_input_tokens` 按 provider）
3. **环比（delta）**：简化为同长度前一时段计算，或移除（spec 未要求）
4. **i18n**：新增 Custom/Apply/AGGREGATED/Metrics Detail 等 key
5. **`TIMELINE_INTENSITY_COLORS`**：保留，复用于 ActivityTimeline 活动柱着色
