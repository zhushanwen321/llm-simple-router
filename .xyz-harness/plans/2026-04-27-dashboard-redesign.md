# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Dashboard page: provider tabs at top, period tabs below, per-provider stats (totalRequests, successRate, avgTps, totalInputTokens, totalOutputTokens) + 3 charts (tps / input_tokens / output_tokens timeseries).

**Architecture:** One composable (`useDashboard`) manages all state + API calls. A single-page `Dashboard.vue` renders everything inline — no sub-components. Backend `getStats` splits `totalTokens` into `totalInputTokens` + `totalOutputTokens`.

**Tech Stack:** Vue 3 + TypeScript + Vite + Chart.js + shadcn-vue

---

## File Structure

**Backend:**
- Modify: `src/db/stats.ts` — split `totalTokens` into `totalInputTokens` + `totalOutputTokens` in `getStats()`
- Modify: `src/admin/stats.ts` — add `provider_id` to query schema (already done in earlier step)

**Frontend:**
- Create: `frontend/src/composables/useDashboard.ts` — new composable
- Rewrite: `frontend/src/views/Dashboard.vue` — complete rewrite
- Keep: `frontend/src/views/metrics-helpers.ts` — needed for `fillTimeseries`, `lineOptions`
- Delete: `frontend/src/composables/useMetrics.ts`
- Delete: `frontend/src/composables/useUsage.ts`
- Delete: `frontend/src/components/dashboard/ProviderWindowTabs.vue`
- Delete: `frontend/src/components/dashboard/ProviderDailyTabs.vue`
- Delete: `frontend/src/components/dashboard/DailyUsageTable.vue`
- Delete: `frontend/src/components/dashboard/WindowTable.vue`

---

### Task 1: Split `totalTokens` in backend `getStats`

**Files:**
- Modify: `src/db/stats.ts:1-61`
- Modify: `src/admin/stats.ts:1-40` (already partially done — verify)

- [ ] **Step 1: Update `Stats` interface in `src/db/stats.ts`**

Replace the `Stats` interface and `StatsRow` interface:

```typescript
export interface Stats {
  totalRequests: number;
  successRate: number;
  avgTps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface StatsRow {
  total_requests: number;
  success_count: number;
  avg_tps: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
}
```

- [ ] **Step 2: Update the SQL query in `getStats`**

In `src/db/stats.ts`, replace the SQL query and return statement:

```typescript
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_requests,
      SUM(CASE WHEN rm.status_code >= 200 AND rm.status_code < 300 THEN 1 ELSE 0 END) AS success_count,
      AVG(rm.tokens_per_second) AS avg_tps,
      COALESCE(SUM(rm.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(rm.output_tokens), 0) AS total_output_tokens
    FROM request_metrics rm
    WHERE ${where}
  `).get(...params) as StatsRow;

  const total = row?.total_requests ?? 0;
  return {
    totalRequests: total,
    successRate: total > 0 ? (row?.success_count ?? 0) / total : 0,
    avgTps: row?.avg_tps ?? 0,
    totalInputTokens: row?.total_input_tokens ?? 0,
    totalOutputTokens: row?.total_output_tokens ?? 0,
  };
```

- [ ] **Step 3: Verify `src/admin/stats.ts` already has `provider_id` in schema**

Confirm `StatsQuerySchema` includes:
```typescript
provider_id: Type.Optional(Type.String()),
```

And the handler passes `query.provider_id` to `getStats()`. If not, the edit was made in a previous step — verify it's present.

- [ ] **Step 4: Update test `tests/stats-independent.test.ts`**

The test references `stats.totalTokens` which no longer exists. Replace occurrences:

```typescript
// In test at line 53:
expect(stats.totalInputTokens).toBe(200);
expect(stats.totalOutputTokens).toBe(100);
// (instead of expect(stats.totalTokens).toBe(300))

// In test at line 63:
expect(stats.totalInputTokens).toBe(200);
expect(stats.totalOutputTokens).toBe(100);
```

And update the test at line 182 in `tests/admin-logs.test.ts`:

```typescript
expect(stats.totalInputTokens).toBe(0);
expect(stats.totalOutputTokens).toBe(0);
// (instead of expect(stats.totalTokens).toBe(0))
```

- [ ] **Step 5: Run tests to verify**

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace/optimize-usage-calc
npm test -- tests/stats-independent.test.ts tests/admin-logs.test.ts -v
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/db/stats.ts src/admin/stats.ts tests/stats-independent.test.ts tests/admin-logs.test.ts
git commit -m "feat: split totalTokens into totalInputTokens + totalOutputTokens in getStats"
```

---

### Task 2: Create `useDashboard` composable

**Files:**
- Create: `frontend/src/composables/useDashboard.ts`

- [ ] **Step 1: Write the composable**

```typescript
import { ref, computed, watch, onMounted } from 'vue'
import type { ChartData } from 'chart.js'
import { api, getApiMessage } from '@/api/client'
import { toast } from 'vue-sonner'
import { fillTimeseries, lineOptions } from '@/views/metrics-helpers'
import { CHART_COLORS } from '@/styles/design-tokens'
import { formatTimeShort } from '@/utils/format'
import type { Provider } from '@/types/mapping'

export interface DashboardStats {
  totalRequests: number
  successRate: number
  avgTps: number
  totalInputTokens: number
  totalOutputTokens: number
}

function toIsoStart(dateStr: string): string {
  if (dateStr.includes('T')) return `${dateStr}:00.000Z`
  return `${dateStr}T00:00:00.000Z`
}

function toIsoEnd(dateStr: string): string {
  if (dateStr.includes('T')) return `${dateStr}:59.999Z`
  return `${dateStr}T23:59:59.999Z`
}

export function useDashboard() {
  // --- Provider list and selection ---
  const providers = ref<Provider[]>([])
  const selectedProvider = ref('')

  const sortedProviders = computed(() =>
    [...providers.value].sort((a, b) => {
      const aOut = providerOutputTokens.value[a.id] ?? 0
      const bOut = providerOutputTokens.value[b.id] ?? 0
      return bOut - aOut
    }),
  )

  // --- Period tab ---
  const periodTab = ref<'window' | 'weekly' | 'monthly' | 'custom'>('window')
  const customStart = ref('')
  const customEnd = ref('')

  // --- Filters ---
  const modelFilter = ref('all')
  const keyFilter = ref('all')
  const modelOptions = ref<string[]>([])
  const keyOptions = ref<{ id: string; name: string }[]>([])

  // --- Time range text ---
  const timeRangeText = computed(() => {
    const start = apiStartTime.value
    const end = apiEndTime.value
    if (!start || !end) return '—'
    try {
      return `${formatTimeShort(start)} ~ ${formatTimeShort(end)}`
    } catch {
      return '—'
    }
  })

  // --- API params ---
  const apiStartTime = computed(() => {
    if (periodTab.value === 'custom' && customStart.value) {
      return toIsoStart(customStart.value)
    }
    return undefined
  })
  const apiEndTime = computed(() => {
    if (periodTab.value === 'custom' && customEnd.value) {
      return toIsoEnd(customEnd.value)
    }
    return undefined
  })

  const statsParams = computed(() => {
    const p: Record<string, string> = {}
    if (periodTab.value !== 'custom') {
      p.period = periodTab.value
    } else if (apiStartTime.value && apiEndTime.value) {
      p.start_time = apiStartTime.value
      p.end_time = apiEndTime.value
    }
    if (selectedProvider.value) p.provider_id = selectedProvider.value
    if (keyFilter.value !== 'all') p.router_key_id = keyFilter.value
    return p
  })

  const timeseriesPeriod = computed(() => {
    if (periodTab.value === 'custom' && apiStartTime.value && apiEndTime.value) {
      return 'monthly'
    }
    return periodTab.value as 'window' | 'weekly' | 'monthly'
  })

  function tsParams(metric: string): Record<string, string> {
    const p: Record<string, string> = { metric }
    if (periodTab.value !== 'custom') {
      p.period = periodTab.value
    } else if (apiStartTime.value && apiEndTime.value) {
      p.start_time = apiStartTime.value
      p.end_time = apiEndTime.value
    }
    if (selectedProvider.value) p.provider_id = selectedProvider.value
    if (modelFilter.value !== 'all') p.backend_model = modelFilter.value
    if (keyFilter.value !== 'all') p.router_key_id = keyFilter.value
    return p
  }

  // --- Data state ---
  const stats = ref<DashboardStats>({
    totalRequests: 0, successRate: 0, avgTps: 0,
    totalInputTokens: 0, totalOutputTokens: 0,
  })
  const tpsChartData = ref<ChartData<'line'> | null>(null)
  const inputTokensChartData = ref<ChartData<'line'> | null>(null)
  const outputTokensChartData = ref<ChartData<'line'> | null>(null)
  const loading = ref(false)

  // --- Per-provider output tokens (for sorting) ---
  const providerOutputTokens = ref<Record<string, number>>({})

  function toChartData(timeseries: { labels: string[]; values: number[] }, label: string, color: string, unit: string): ChartData<'line'> {
    return {
      labels: timeseries.labels,
      datasets: [{
        label,
        data: timeseries.values,
        borderColor: color,
        backgroundColor: color.replace(')', ' / 0.1)'),
        fill: false,
        tension: 0.4,
        pointRadius: 0,
      }],
    }
  }

  // --- Fetch providers ---
  async function loadProviders() {
    try {
      providers.value = await api.getProviders()
    } catch (e: unknown) {
      console.error('Failed to load providers:', e)
      toast.error(getApiMessage(e, '加载供应商列表失败'))
    }
  }

  // --- Fetch model/keys options ---
  async function loadFilterOptions() {
    try {
      const [models, keys] = await Promise.allSettled([
        api.getAvailableModels(),
        api.getRouterKeys(),
      ])
      if (models.status === 'fulfilled') modelOptions.value = models.value
      if (keys.status === 'fulfilled') keyOptions.value = keys.value
    } catch (e: unknown) {
      console.error('Failed to load options:', e)
    }
  }

  // --- Fetch provider output tokens for sorting ---
  async function loadProviderOutputTokens() {
    if (periodTab.value === 'custom' && !(apiStartTime.value && apiEndTime.value)) return
    try {
      const results = await Promise.allSettled(
        providers.value.map(async (p) => {
          const p2: Record<string, string> = {}
          if (periodTab.value !== 'custom') {
            p2.period = periodTab.value
          } else if (apiStartTime.value && apiEndTime.value) {
            p2.start_time = apiStartTime.value
            p2.end_time = apiEndTime.value
          }
          p2.provider_id = p.id
          const stat = await api.getStats(p2)
          return { id: p.id, outputTokens: stat.totalOutputTokens }
        }),
      )
      const map: Record<string, number> = {}
      for (const r of results) {
        if (r.status === 'fulfilled') map[r.value.id] = r.value.outputTokens
      }
      providerOutputTokens.value = map
      if (Object.keys(map).length > 0 && !selectedProvider.value) {
        const top = sortedProviders.value[0]
        if (top) selectedProvider.value = top.id
      }
    } catch (e: unknown) {
      console.error('Failed to load output tokens:', e)
    }
  }

  // --- Fetch stats + timeseries ---
  async function refresh() {
    if (!selectedProvider.value) return
    if (periodTab.value === 'custom' && !(apiStartTime.value && apiEndTime.value)) return
    loading.value = true
    try {
      const [statsRes, tpsRes, inputRes, outputRes] = await Promise.allSettled([
        api.getStats(statsParams.value),
        api.getMetricsTimeseries(tsParams('tps')),
        api.getMetricsTimeseries(tsParams('input_tokens')),
        api.getMetricsTimeseries(tsParams('output_tokens')),
      ])

      const fulfilled = <T>(r: PromiseSettledResult<T>): r is PromiseFulfilledResult<T> => r.status === 'fulfilled'

      if (fulfilled(statsRes)) stats.value = statsRes.value

      const p = timeseriesPeriod.value
      const emptyAxis = fillTimeseries([], p)

      if (fulfilled(tpsRes) && tpsRes.value.length > 0) {
        const filled = fillTimeseries(tpsRes.value, p)
        tpsChartData.value = toChartData(filled, 'Token 输出速度 (t/s)', CHART_COLORS.indigo, 't/s')
      } else {
        tpsChartData.value = null
      }

      if (fulfilled(inputRes) && inputRes.value.length > 0) {
        const filled = fillTimeseries(inputRes.value, p)
        inputTokensChartData.value = toChartData(filled, 'Token 输入总量', CHART_COLORS.teal, 'tokens')
      } else {
        inputTokensChartData.value = null
      }

      if (fulfilled(outputRes) && outputRes.value.length > 0) {
        const filled = fillTimeseries(outputRes.value, p)
        outputTokensChartData.value = toChartData(filled, 'Token 输出总量', CHART_COLORS.green, 'tokens')
      } else {
        outputTokensChartData.value = null
      }
    } catch (e: unknown) {
      console.error('Failed to load dashboard:', e)
      toast.error(getApiMessage(e, '加载仪表盘数据失败'))
    } finally {
      loading.value = false
    }
  }

  // --- Watchers ---
  watch(periodTab, () => {
    if (periodTab.value !== 'custom') {
      customStart.value = ''
      customEnd.value = ''
    }
  })

  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  watch([selectedProvider, periodTab, modelFilter, keyFilter], () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => refresh(), 300)
  })

  // Custom date range: trigger refresh on both start and end filled
  watch([customStart, customEnd], () => {
    if (periodTab.value === 'custom' && customStart.value && customEnd.value) {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => refresh(), 300)
    }
  })

  onMounted(async () => {
    await loadProviders()
    await loadFilterOptions()
    if (providers.value.length > 0) {
      await loadProviderOutputTokens()
      // selectedProvider is set inside loadProviderOutputTokens
    }
    await refresh()
  })

  return {
    providers, selectedProvider, sortedProviders,
    periodTab, customStart, customEnd,
    modelFilter, keyFilter, modelOptions, keyOptions,
    timeRangeText,
    stats, loading,
    tpsChartData, inputTokensChartData, outputTokensChartData,
    timeseriesPeriod,
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace/optimize-usage-calc/frontend
npx vue-tsc --noEmit
```

Expected: No errors (may fail before Dashboard.vue is updated — ok for now).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/composables/useDashboard.ts
git commit -m "feat: add useDashboard composable"
```

---

### Task 3: Rewrite `Dashboard.vue`

**Files:**
- Rewrite: `frontend/src/views/Dashboard.vue`

- [ ] **Step 1: Replace entire Dashboard.vue**

Write the complete file:

```vue
<template>
  <div class="p-6">
    <!-- 顶部：provider 按钮组 -->
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">仪表盘</h2>
      <div class="flex gap-1">
        <Button
          v-for="p in sortedProviders"
          :key="p.id"
          :variant="selectedProvider === p.id ? 'default' : 'ghost'"
          size="sm"
          @click="selectedProvider = p.id"
        >
          {{ p.name }}
        </Button>
      </div>
    </div>

    <!-- 时间粒度 tab -->
    <div class="flex gap-1 mb-4">
      <Button
        v-for="t in periodTabs"
        :key="t.value"
        :variant="periodTab === t.value ? 'default' : 'ghost'"
        size="sm"
        @click="periodTab = t.value"
      >
        {{ t.label }}
      </Button>
    </div>

    <!-- 时间范围 -->
    <div class="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
      <span v-if="periodTab === 'custom'" class="flex items-center gap-1">
        <Input type="datetime-local" v-model="customStart" class="w-44" />
        <span>~</span>
        <Input type="datetime-local" v-model="customEnd" class="w-44" />
      </span>
      <span v-else>⏱ {{ timeRangeText }}</span>
    </div>

    <!-- 模型 + 密钥筛选 -->
    <div class="flex items-center gap-3 mb-4">
      <Select v-model="modelFilter">
        <SelectTrigger class="w-32">
          <SelectValue placeholder="全部模型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部模型</SelectItem>
          <SelectItem v-for="m in modelOptions" :key="m" :value="m">{{ m }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="keyFilter">
        <SelectTrigger class="w-36">
          <SelectValue placeholder="全部密钥" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部密钥</SelectItem>
          <SelectItem v-for="rk in keyOptions" :key="rk.id" :value="rk.id">{{ rk.name }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- 数据区 -->
    <div v-if="loading" class="text-center text-muted-foreground py-20">加载中...</div>
    <template v-else>
      <!-- 指标卡片 5 卡一行 -->
      <div class="grid grid-cols-5 gap-3 mb-6">
        <Card>
          <CardContent class="p-4">
            <p class="text-sm text-muted-foreground">总请求数</p>
            <p class="text-2xl font-bold text-foreground mt-1">{{ stats.totalRequests.toLocaleString() }}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-sm text-muted-foreground">成功率</p>
            <p class="text-2xl font-bold text-success mt-1">{{ (stats.successRate * 100).toFixed(1) }}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-sm text-muted-foreground">Token 输出速度</p>
            <p class="text-2xl font-bold text-foreground mt-1">{{ stats.avgTps.toFixed(1) }} <span class="text-sm font-normal text-muted-foreground">t/s</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-sm text-muted-foreground">Token 输入总量</p>
            <p class="text-2xl font-bold text-foreground mt-1">{{ stats.totalInputTokens.toLocaleString() }}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-sm text-muted-foreground">Token 输出总量</p>
            <p class="text-2xl font-bold text-foreground mt-1">{{ stats.totalOutputTokens.toLocaleString() }}</p>
          </CardContent>
        </Card>
      </div>

      <!-- 3 个 chart -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">Token 输出速度</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-56">
              <Line v-if="tpsChartData" :data="tpsChartData" :options="chartOptions(tpsChartData.labels as string[])" />
              <div v-else class="flex items-center justify-center h-full text-muted-foreground text-sm">暂无数据</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">Token 输入总量</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-56">
              <Line v-if="inputTokensChartData" :data="inputTokensChartData" :options="chartOptions(inputTokensChartData.labels as string[])" />
              <div v-else class="flex items-center justify-center h-full text-muted-foreground text-sm">暂无数据</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">Token 输出总量</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-56">
              <Line v-if="outputTokensChartData" :data="outputTokensChartData" :options="chartOptions(outputTokensChartData.labels as string[])" />
              <div v-else class="flex items-center justify-center h-full text-muted-foreground text-sm">暂无数据</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { lineOptions } from './metrics-helpers'
import { useDashboard } from '@/composables/useDashboard'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, ChartTooltip, Legend)

const {
  sortedProviders, selectedProvider,
  periodTab, customStart, customEnd,
  modelFilter, keyFilter, modelOptions, keyOptions,
  timeRangeText,
  stats, loading,
  tpsChartData, inputTokensChartData, outputTokensChartData,
} = useDashboard()

const periodTabs = [
  { label: '最近5小时', value: 'window' },
  { label: '本周', value: 'weekly' },
  { label: '本月', value: 'monthly' },
  { label: '自定义', value: 'custom' },
] as const

function chartOptions(labels: string[]): ReturnType<typeof lineOptions> {
  return lineOptions('', labels)
}
</script>
```

- [ ] **Step 2: Verify no compilation errors**

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace/optimize-usage-calc/frontend
npx vue-tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/Dashboard.vue
git commit -m "feat: rewrite Dashboard.vue with provider tabs and per-provider stats+charts"
```

---

### Task 4: Cleanup — remove unused files

**Files to delete:**
- `frontend/src/composables/useMetrics.ts`
- `frontend/src/composables/useUsage.ts`
- `frontend/src/components/dashboard/ProviderWindowTabs.vue`
- `frontend/src/components/dashboard/ProviderDailyTabs.vue`
- `frontend/src/components/dashboard/DailyUsageTable.vue`
- `frontend/src/components/dashboard/WindowTable.vue`

- [ ] **Step 1: Delete the files**

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace/optimize-usage-calc
rm frontend/src/composables/useMetrics.ts
rm frontend/src/composables/useUsage.ts
rm frontend/src/components/dashboard/ProviderWindowTabs.vue
rm frontend/src/components/dashboard/ProviderDailyTabs.vue
rm frontend/src/components/dashboard/DailyUsageTable.vue
rm frontend/src/components/dashboard/WindowTable.vue
```

- [ ] **Step 2: Verify no compilation errors due to missing imports**

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace/optimize-usage-calc/frontend
npx vue-tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git rm frontend/src/composables/useMetrics.ts
git rm frontend/src/composables/useUsage.ts
git rm frontend/src/components/dashboard/ProviderWindowTabs.vue
git rm frontend/src/components/dashboard/ProviderDailyTabs.vue
git rm frontend/src/components/dashboard/DailyUsageTable.vue
git rm frontend/src/components/dashboard/WindowTable.vue
git commit -m "chore: remove unused dashboard components and composables"
```

---

### Task 5: End-to-end verification

- [ ] **Step 1: Full frontend type check**

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace/optimize-usage-calc/frontend
npx vue-tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Backend type check**

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace/optimize-usage-calc
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run backend tests**

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace/optimize-usage-calc
npm test
```

Expected: All tests pass (particularly `tests/stats-independent.test.ts` and `tests/admin-logs.test.ts`).

- [ ] **Step 4: Restart frontend dev server and verify visually**

```bash
kill $(lsof -ti:5173) 2>/dev/null; sleep 1
cd /Users/zhushanwen/Code/llm-simple-router-workspace/optimize-usage-calc/frontend
npm run dev
```

Open http://localhost:5173/admin/ and verify:
1. Provider buttons shown at top, sorted by output tokens
2. Period tabs switch correctly (5h/weekly/monthly/custom)
3. Time range displayed correctly
4. Model/key filter dropdowns work
5. Stats cards show correct numbers
6. Charts render with data

- [ ] **Step 5: Commit final verify**

```bash
git commit -m "chore: end-to-end verification after dashboard redesign" --allow-empty
```
