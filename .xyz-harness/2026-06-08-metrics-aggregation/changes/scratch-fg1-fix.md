# FG1 Facade 重构修复报告

## 总结

完成 FG1 剩余的 facade 重构：把 `useDashboard.ts` / `Dashboard.vue` 从旧的 `useDashboardTimeline`（基于 usage windows）迁移到新的 `useTimeSelector`（基于快速范围 + custom + 活动图）。`useDashboardData.ts` 的接口签名保持不变，通过 facade 内部合成 `selectedWindow` 的方式桥接。

## 验收标准

| 标准 | 结果 |
|------|------|
| `useDashboard.ts` 不再引用 `useDashboardTimeline` | ✅ |
| `Dashboard.vue` 模板编译无错误 | ✅ |
| `cd frontend && npx vue-tsc -b --noEmit` 通过 | ✅ EXIT 0 |
| `cd frontend && npx eslint <files> --max-warnings=0` 通过 | ✅ EXIT 0 |
| `cd frontend && npx vitest run` 全部测试通过 | ✅ 22/22 |
| `usageWindows`/`selectedWindowId`/`providerInputTokens` 逻辑保留 | ✅（provider token 排序） |
| `useDashboardData.ts` 接口签名不变 | ✅（通过 facade 合成 `selectedWindow`） |

## 修改文件清单

| 文件 | 变更类型 | 行数变化 |
|------|----------|---------|
| `frontend/src/composables/useDashboard.ts` | 重构（facade） | 重写 |
| `frontend/src/views/Dashboard.vue` | 重构（Zone 4 替换） | Zone 4 替换 |
| `frontend/src/composables/useTimeSelector.ts` | 增强（+1 方法）+ lint 修复 | +30 行 |
| `frontend/src/components/dashboard/ActivityTimeline.vue` | lint 修复 | +13 行（命名常量） |
| `frontend/src/i18n/locales/zh-CN/dashboard.json` | 新增 timeSelector 键 | +25 行 |
| `frontend/src/i18n/locales/en/dashboard.json` | 新增 timeSelector 键 | +25 行 |

## 关键设计决策

### 1. 双数据源策略

保留 `getUsageWindows` 调用（驱动 `providerInputTokens` → `providerTokenLabels` → `sortedProviders` 排序），同时新增 `useTimeSelector` 驱动时间选择和图表数据。两者解耦。

```typescript
// usageWindows 仍由 getUsageWindows 加载（provider token 排序）
async function loadUsageWindows() { ... }

// 时间选区由 useTimeSelector 管理（图表数据 / Zone 4 选择器）
const timeSelector = useTimeSelector({ selectedProvider, t });
```

### 2. 桥接 `useDashboardData`（保持接口签名）

`useDashboardData` 仍要求 `selectedWindow: ComputedRef<UsageWindowWithUsage | null>` 参数，内部从 `selectedWindow.value.window.start_time/end_time` 提取时间范围。为了不改 useDashboardData 的签名，facade 内部合成一个镜像 `timeSelection` 的 `UsageWindowWithUsage` 形状：

```typescript
const selectedWindowFromTime = computed<UsageWindowWithUsage | null>(() => {
  const sel = timeSelector.timeSelection.value;
  if (!sel) return null;
  return {
    window: {
      id: `time-selector-${sel.source}`,
      router_key_id: null,
      provider_id: selectedProvider.value || null,
      provider_name: null,
      start_time: sel.startTime.toISOString(),
      end_time: sel.endTime.toISOString(),
      created_at: new Date().toISOString(),
    },
    usage: { request_count: 0, total_input_tokens: 0, total_output_tokens: 0 },
  };
});
```

useDashboardData 的 refresh 逻辑保持不变，body 里读 `selectedWindow.value.window.start_time` 自动获得新时间范围。

### 3. 重新设计 `loadPrevWindowStats`（同比逻辑）

旧的 `loadPrevWindowStats` 通过 `timelineWindows` 数组找相邻 window。新设计没有 window 概念，改用「等长前移」算法：

```typescript
async function loadPrevWindowStats() {
  const sel = timeSelector.timeSelection.value;
  const dur = sel.endTime.getTime() - sel.startTime.getTime();
  if (dur <= 0) { prevWindowStats.value = null; return; }
  // prev = 与当前选区等长、紧邻其前的范围
  const prevEnd = new Date(sel.startTime.getTime());
  const prevStart = new Date(prevEnd.getTime() - dur);
  // ... fetch stats
}
```

覆盖所有范围（5h / 24h / 7d / 30d / custom）。

### 4. 同步触发刷新

watcher 改用 `timeSelector.timeSelection`（ComputedRef<TimeSelection>）作为触发源：

```typescript
watch(
  [selectedProvider, timeSelector.timeSelection],
  async () => {
    if (!initialized.value) return;
    skipNextFilterRefresh = true;
    await Promise.allSettled([
      loadUsageWindows(),
      timeSelector.loadActivity(),
    ]);
    await data.refresh();
    await loadPrevWindowStats();
  },
);
```

`watchKey` 同步用 `timeSelection` 替代 `timelineRange` / `selectedWindowId`，缓存指纹保持完整。

### 5. Zone 4 模板替换

旧 Zone 4（usage window 时间轴导航器）→ 新 Zone 4（Visual Time Range Selector）：

| 旧元素 | 新元素 |
|--------|--------|
| `usageWindows` 列表 | `activityBuckets` 活动图 |
| `timelineWindows` 渲染的方块 | `ActivityTimeline` 组件 |
| `timelineRange` (24h/3d/7d) | `quickRangeOptions` (5h/24h/7d/30d) + Custom |
| `getWindowStyle/Width/formatWindowTooltip` | 由 `ActivityTimeline.vue` 内部处理 |
| `timelineDayLabels` 日标签 | 由 `ActivityTimeline.vue` 内部处理 |
| `selectedWindowId` 点击切换 | `setCustomRange()` 7-day centered 选择 |
| 无 Custom 模式 | `<Input type="date">` 双日期 + Apply 按钮 + 错误提示 |

Zone 2 / Zone 3 保持不变。Zone 2 内联 tertiary metrics 继续用 `windowTimeRange`，值由 `formatTimeShort` 格式化（保持旧格式 `MM/DD HH:MM ~ MM/DD HH:MM`）。

### 6. 新增 `setCustomRange` 方法

`useTimeSelector` 新增 `setCustomRange(start, end)` 方法，供 ActivityTimeline 点击事件使用。绕过 `applyCustom` 的表单输入校验（因为点击事件已经保证范围有效），但仍夹紧到允许范围（min/max custom days、不晚于今天、不早于 30 天前）。

```typescript
function setCustomRange(start: Date, end: Date) {
  const clampedEnd = new Date(Math.min(end.getTime(), Date.now()));
  const minStart = rangeStart.value.getTime();
  const clampedStart = new Date(Math.max(start.getTime(), minStart));
  if (clampedStart.getTime() >= clampedEnd.getTime()) return;
  const span = clampedEnd.getTime() - clampedStart.getTime();
  if (span < MIN_CUSTOM_MS || span > MAX_CUSTOM_MS) return;
  selectionFromCustom.value = { start: clampedStart, end: clampedEnd };
  activeRange.value = "custom";
  showCustom.value = false;
  customError.value = "";
}
```

## i18n 新增键

`dashboard.timeSelector.*` （zh-CN + en）：

| 键 | 用途 |
|----|------|
| `timeSelector.quick.5h` / `24h` / `7d` / `30d` | 快速范围按钮标签 |
| `timeSelector.custom` | Custom 按钮 |
| `timeSelector.startDate` / `endDate` | 自定义日期输入框 label |
| `timeSelector.apply` | Apply 按钮 |
| `timeSelector.hint` | 提示文案（点击活动柱 / 选快速范围） |
| `timeSelector.customError.format` / `order` / `tooShort` / `tooLong` / `future` / `tooOld` | 自定义范围校验错误提示 |

## 暴露字段（useDashboard return）

### 新增（任务要求）

```typescript
// Time selector (new — replaces old timeline window navigator)
activeRange, timeSelection, timeRangeLabel,
showCustom, customStart, customEnd, customError,
activityBuckets, detailDays, rangeStart, totalRangeDays,
selectQuickRange, toggleCustom, applyCustom, setCustomRange,
```

### 保留（向后兼容）

```typescript
// Provider
providers, selectedProvider, sortedProviders, providerTokenLabels,
// Usage windows (kept for provider token sort; not driving time selection)
usageWindows, selectedWindowId,
// Alias for Zone 2 inline tertiary metrics (MM/DD HH:MM format)
windowTimeRange,
// Filters
modelFilter, keyFilter, clientType, modelOptions, keyOptions,
// Data
stats, loading, loadError, cacheHitRate, clientTypeBreakdown,
tpsChartData, inputTokensChartData, outputTokensChartData, tokenThroughputChartData,
timeRangeText,
// Comparison
prevWindowStats, deltaValues,
// Actions
retry,
```

### 移除（被新设计替代）

- `selectedWindow` (computed from usageWindows) — 不再被 useDashboardData 使用
- `timelineWindows` — 旧 timeline 渲染
- `timelineRange` — 旧 zoom 选项
- `getWindowStyle` / `getWindowWidth` / `formatWindowTooltip` / `timelineDayLabels` — 旧 timeline 渲染辅助

## Lint 修复（顺手清理）

`useTimeSelector.ts` 和 `ActivityTimeline.vue`（pre-existing 文件）有 9 + 15 个 `no-magic-numbers` 警告。提取为命名常量后通过 `eslint --max-warnings=0`：

| 文件 | 修复内容 |
|------|---------|
| `useTimeSelector.ts` | 提取 `HOURS_IN_5H` / `DAYS_IN_7D` / `DAYS_IN_30D` / `MONTHS_PER_YEAR` / `DAYS_PER_MONTH_MAX` / `END_OF_DAY_HOUR/MINUTE/SECOND/MS` |
| `ActivityTimeline.vue` | 提取 `PERCENT_MAX` / `CLICK_SELECTION_HALF_DAYS` / `INTENSITY_HIGH/MID/LOW` / `OPACITY_HIGHLIGHTED/DIMMED` / `PAD_WIDTH` |

## 禁止事项检查

| 规则 | 状态 |
|------|------|
| 禁止原生 HTML 表单/交互元素 | ✅ 全部用 shadcn-vue 组件（`Input` / `Button` / `Select`） |
| 禁止 TODO/FIXME/placeholder | ✅ 无 |
| 禁止 `// eslint-disable` | ✅ 无 |
| 禁止 emoji | ✅ 全部用 `lucide-vue-next`（`Filter`） |
| 禁止魔数 | ✅ lint 0 warnings |

## 验证

```bash
# vue-tsc
cd /Users/zhushanwen/Code/llm-simple-router-workspace/fix-request-log-tables/frontend
./node_modules/.bin/vue-tsc -b --noEmit --force
# EXIT: 0

# eslint
/Users/zhushanwen/Code/llm-simple-router-workspace/fix-request-log-tables/node_modules/.bin/eslint \
  src/composables/useDashboard.ts \
  src/composables/useTimeSelector.ts \
  src/views/Dashboard.vue \
  src/components/dashboard/ActivityTimeline.vue \
  --max-warnings=0
# EXIT: 0

# vitest
/Users/zhushanwen/Code/llm-simple-router-workspace/fix-request-log-tables/node_modules/.bin/vitest run
# Test Files  2 passed (2)
# Tests  22 passed (22)
```

## 未来改进（不在本次范围）

1. `useTimeSelector` 的 `rangeStart` 写死为 `new Date(now - 30 days)`，未来可从 `getMetricsDetailDays()` 设置动态读取（FG3 范畴）
2. `loadPrevWindowStats` 对 30d + provider 切换的极端组合可能返回空数据；当前 `deltaValues` 的 `prev === 0` 分支已处理
3. `useDashboardData` 内部仍依赖 `selectedWindow: ComputedRef<UsageWindowWithUsage | null>` 的「伪合成」参数，FG2 阶段会改为直接接受 `timeSelection`，届时可以彻底移除 facade 内部的合成代码
