# Dashboard Redesign — Infrastructure Scan

## 1. Project Structure

### Views & Helpers

```
frontend/src/views/
├── Dashboard.vue          # Main dashboard page
├── Monitor.vue            # Real-time monitoring (pattern reference)
├── Logs.vue               # Request logs (filter pattern reference)
├── metrics-helpers.ts     # Chart.js options factories + timeseries fill
└── ... (other pages)
```

### Components Used by Dashboard

```
frontend/src/components/
├── ui/button/             # <Button> — provider filter tabs
├── ui/card/               # <Card>, <CardHeader>, <CardContent>, <CardTitle> — stat cards
├── ui/input/              # <Input> — custom date range
├── ui/select/             # <Select>, <SelectTrigger>, <SelectContent>, <SelectItem>, <SelectValue> — filters
└── (no dedicated chart components — <Line> from vue-chartjs used directly in Dashboard.vue)
```

### Composables

```
frontend/src/composables/
├── useDashboard.ts        # Primary — all dashboard state + data fetching
├── useTheme.ts            # isDark, toggleTheme, watchTheme() for chart re-render
├── useClipboard.ts        # shared copy utility
├── useMonitorData.ts      # Monitor pattern reference
├── useMonitorSSE.ts       # SSE pattern reference
├── useLogFilters.ts       # Filter pattern reference
├── useLogs.ts             # Logs pattern reference
└── ...
```

### Styles

```
frontend/src/styles/
├── design-tokens.ts       # CHART_COLORS (oklch), STATUS_COLORS, ROLE_COLORS, SSE_COLORS
├── tokens.css             # CSS custom properties
└── components.css         # Component-level styles
```

### Types

```
frontend/src/types/
├── mapping.ts             # Provider, ProviderSummary, ModelInfo, MappingGroup, etc.
├── models.ts              # RetryRule, RouterKey
├── monitor.ts             # ActiveRequest, StreamMetricsSnapshot, StatsSnapshot, etc.
├── concurrency.ts         # ConcurrencyMode
└── schedule.ts            # Schedule, SchedulePayload
```

---

## 2. API Surface

### API Client Methods (used by Dashboard)

| Method | Endpoint | Params | Response Type |
|--------|----------|--------|---------------|
| `api.getProviders()` | `GET /providers` | — | `Provider[]` |
| `api.getStats(params)` | `GET /stats` | period, start/end_time, router_key_id, provider_id, backend_model | `StatsResponse` |
| `api.getMetricsSummary(params)` | `GET /metrics/summary` | period, provider_id, backend_model, router_key_id, client_type, start/end_time | `MetricsSummaryResponse` |
| `api.getMetricsTimeseries(params)` | `GET /metrics/timeseries` | period, metric, provider_id, backend_model, router_key_id, start/end_time | `TimeseriesRawRow[]` |
| `api.getAvailableModels()` | `GET /models/available` | — | `string[]` |
| `api.getRouterKeys()` | `GET /router-keys` | — | `RouterKeyPublic[]` |

### Response Types (in `api/client.ts`, NOT in `types/`)

```typescript
interface StatsResponse {
  totalRequests: number;
  successRate: number;
  avgTps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  startTime: string;
  endTime: string;
}

interface MetricsSummaryResponse {
  rows: MetricsSummaryRow[];
  client_type_breakdown: Record<string, number>;
  cache_hit_rate: number;
}

interface MetricsSummaryRow {
  provider_id: string;
  provider_name: string;
  backend_model: string;
  request_count: number;
  avg_ttft_ms: number | null;
  avg_tps: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_hit_tokens: number;
  cache_hit_rate: number | null;
}

interface TimeseriesRawRow {
  time_bucket: string;
  avg_value: number | null;
  count: number;
}
```

### Composable Exports

**`useDashboard()`** returns:

| Binding | Type | Purpose |
|---------|------|---------|
| `providers` | `Ref<Provider[]>` | All providers from API |
| `selectedProvider` | `Ref<string>` | Current provider filter |
| `sortedProviders` | `ComputedRef<Provider[]>` | Sorted by output tokens desc |
| `periodTab` | `Ref<"window"\|"weekly"\|"monthly"\|"custom">` | Time period selection |
| `customStart` / `customEnd` | `Ref<string>` | Custom range inputs |
| `modelFilter` / `keyFilter` / `clientType` | `Ref<string>` | Cascade filters |
| `modelOptions` / `keyOptions` | `ComputedRef<string[]>` | Filter dropdown options |
| `timeRangeText` | `ComputedRef<string>` | Human-readable range label |
| `stats` | `Ref<DashboardStats>` | 6 metric cards source |
| `loading` / `loadError` | `Ref<boolean>` / `Ref<string \| null>` | Loading state |
| `cacheHitRate` | `ComputedRef<number>` | Computed from summary |
| `tpsChartData` | `Ref<ChartData<"line"> \| null>` | Chart 1 data |
| `inputTokensChartData` | `Ref<ChartData<"line"> \| null>` | Chart 2 data |
| `outputTokensChartData` | `Ref<ChartData<"line"> \| null>` | Chart 3 data |
| `retry` | `() => void` | Manual refresh |

**`metrics-helpers.ts`** exports:

| Function | Signature | Purpose |
|----------|-----------|---------|
| `fillTimeseries` | `(raw: TimeseriesRawRow[], periodStr: string, timeRange?: {startTime: string; endTime: string}) => {labels: string[]; values: number[]}` | Fill gaps in time buckets |
| `lineOptions` | `(unit: string, labels: string[]) => ChartOptions<"line">` | Standard line chart options (auto dark/light) |
| `stackedAreaOptions` | `(labels: string[]) => ChartOptions<"line">` | Stacked area chart options (registered but unused) |

**`design-tokens.ts`** exports:

| Constant | Type | Used By |
|----------|------|---------|
| `CHART_COLORS` | `{teal, tealFill, tealFillLight, indigo, indigoFill, green, amber, amberFill}` | useDashboard chart data |
| `STATUS_COLORS` | `{success, danger, warning, info} × {bg, text}` | Badge/status display |
| `ROLE_COLORS` | `{user, assistant, tool, thinking}` | Log viewer |
| `SSE_COLORS` | `Record<string, string>` | Log viewer SSE events |

---

## 3. Type Definitions

### Dashboard-specific (in `composables/useDashboard.ts`)

```typescript
export interface DashboardStats {
  totalRequests: number;
  successRate: number;
  avgTps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  startTime: string | null;
  endTime: string | null;
}
```

### Shared Types (in `types/mapping.ts`)

| Type | Key Fields |
|------|------------|
| `Provider` | id, name, api_type, base_url, models (ModelInfo[]), max_concurrency, is_active, ... |
| `ModelInfo` | name, context_window, capabilities, patches, stream_timeout_ms |
| `MappingGroup` | id, client_model, rule (JSON string), is_active |

### Monitor Types (in `types/monitor.ts`) — for reference if sharing patterns

| Type | Key Fields |
|------|------------|
| `StatsSnapshot` | totalRequests, successCount, errorCount, avgLatencyMs, p50/p99, byProvider, byStatusCode |
| `ActiveRequest` | id, apiType, model, providerId, isStream, startTime, status, attempts, streamMetrics |
| `ProviderConcurrencySnapshot` | providerId, maxConcurrency, active, queued, adaptiveEnabled, adaptiveLimit |
| `StreamMetricsSnapshot` | inputTokens, outputTokens, ttftMs, tokensPerSecond, two-phase TPS breakdown |

---

## 4. Patterns in Use

### State Management

- **No Pinia/Vuex** — all state via composable `ref`/`computed`/`shallowRef`
- Pattern: `useXxx()` composable holds all state + fetch logic → View only binds
- Dashboard uses two nested composables: `useDashboardFilters()` + `useDashboardData()`

### Data Fetching

- **Debounce**: 300ms watch debounce on filter changes (`DEBOUNCE_MS = 300`)
- **Cache TTL**: 5s dedup (`CACHE_TTL = 5000`)
- **Parallel**: 5 concurrent `Promise.allSettled` calls (stats, tps, input, output, summary)
- **Auto-select**: Top provider auto-selected by output token volume

### Chart.js Integration

- `ChartJS.register(...)` at module scope in `<script setup>`
- `vue-chartjs` `<Line>` component, key-bound to force re-render on provider/period change
- Colors from `CHART_COLORS` (oklch — Chart.js can't use CSS variables)
- Theme reactivity via `watchTheme(() => refresh())` in `onMounted`
- Dark/light mode detected at render time by `isDarkMode()` in `metrics-helpers.ts`

### Filter Pattern

- Period tab (window/weekly/monthly/custom) → date range computation
- Provider filter → cascading model/key filter options
- `apiStartTime`/`apiEndTime` computed from period + custom dates
- `statsParams`/`cacheSummaryParams`/`tsParams()` build query params

---

## 5. Dependencies

### Chart-related

| Package | Version | Usage |
|---------|---------|-------|
| `chart.js` | `^4.5.1` | Core chart engine + types (CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend) |
| `vue-chartjs` | `^5.3.3` | `<Line>` Vue wrapper component |

### UI Components (shadcn-vue, used in Dashboard)

| Component | Usage in Dashboard |
|-----------|-------------------|
| `Button` | Provider tab selector, period tabs |
| `Card` / `CardHeader` / `CardContent` / `CardTitle` | 6 stat metric cards |
| `Input` | Custom date range start/end |
| `Select` / `SelectTrigger` / `SelectContent` / `SelectItem` / `SelectValue` | Model, key, client type filters |

### Other Key Dependencies

| Package | Version | Usage |
|---------|---------|-------|
| `vue` | `^3.5.32` | Composition API |
| `@vueuse/core` | `^14.2.1` | Utility composables |
| `axios` | `^1.15.0` | API client |
| `vue-i18n` | `^11.4.0` | Internationalization |
| `vue-sonner` | `^2.0.9` | Toast notifications |
| `lucide-vue-next` | `^1.0.0` | Icon library |
| `date-fns` | `^4.1.0` | Date formatting |
| `@tanstack/vue-table` | `^8.21.3` | Table component (used in Logs, not Dashboard) |
| `radix-vue` | `^1.9.17` | shadcn-vue underlying primitives |
| `reka-ui` | `^2.9.6` | shadcn-vue v2 primitives |

---

## 6. Cross-Page Pattern Reference

### Monitor.vue

- **Data source**: SSE real-time push (6 event types), initial REST load
- **Composables**: `useMonitorSSE()` + `useMonitorData()`
- **Components**: `MonitorHeader`, `ConcurrencyPanel`, `ProviderStatsTable`, `RuntimePanel`, `StatusCodePanel`
- **No Chart.js** — uses Badge/Card/Table for data display
- **Key pattern**: `shallowRef` for large arrays (ActiveRequest[]), SSE reconnect with diff sync

### Logs.vue

- **Data source**: REST polling with 300ms debounce on filter changes
- **Composables**: `useLogs()` + `useLogFilters()` + `useLogRetention()`
- **Components**: `LogTableRow`, `UnifiedRequestDialog`, standard Table/Pagination
- **Key pattern**: `expandedRows` Set<string> for expand/collapse, lazy child loading, paginated with smart page numbers

### Shared Patterns Across All Pages

| Pattern | Dashboard | Monitor | Logs |
|---------|-----------|---------|------|
| State management | `useDashboard()` | `useMonitorData()` | `useLogs()` + `useLogFilters()` |
| Error handling | `toast.error(getApiMessage(e, t('...')))` | Same | Same |
| Loading state | `loading` ref | `connected` ref | `loading` ref |
| i18n | `useI18n()` | `useI18n()` | `useI18n()` |
| Theme | `watchTheme()` for charts | N/A | N/A |
| Filter debounce | 300ms | N/A (SSE) | 300ms |
| Parallel requests | `Promise.allSettled` × 5 | `Promise.allSettled` × 5 (initial) | Sequential |
