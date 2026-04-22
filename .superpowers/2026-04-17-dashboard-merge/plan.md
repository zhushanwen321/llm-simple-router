# 仪表盘合并性能指标 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/metrics` 性能指标页面合并到 `/` 仪表盘，删除独立路由。

**Architecture:** Dashboard.vue 同时调用原有 stats API 和 `useMetrics()` composable，通过统一密钥筛选 ref 联动两个数据源。图表从原 Metrics.vue 模板迁移，布局调整为 2x2 grid。

**Tech Stack:** Vue 3 + Chart.js + shadcn-vue + Tailwind CSS

**Spec:** `.superpowers/specs/2026-04-17-dashboard-merge-metrics.md`

---

## 文件变更清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 重写 | `frontend/src/views/Dashboard.vue` | 合并 stats + metrics |
| 修改 | `frontend/src/router/index.ts` | 删除 `/metrics` 路由 |
| 修改 | `frontend/src/components/layout/Sidebar.vue` | 删除导航项 + 清理 import |
| 删除 | `frontend/src/views/Metrics.vue` | 已合并，不再需要 |
| 保留 | `frontend/src/composables/useMetrics.ts` | 无需改动 |
| 保留 | `frontend/src/views/metrics-helpers.ts` | 无需改动 |

> 纯前端 UI 合并，无后端变更，无 TDD 必要。通过 dev server + 浏览器验证。

---

### Task 1: 重写 Dashboard.vue

**Files:**
- Rewrite: `frontend/src/views/Dashboard.vue`

- [ ] **Step 1: 替换 Dashboard.vue 全部内容**

关键设计决策：
- 统一 `dashboardKeyFilter` ref，通过 `watch` 同步到 `metrics.routerKeyFilter` 并触发 `loadStats()`
- 复用 `useMetrics()` 的 `routerKeys`（不再独立加载密钥列表）
- stats 区域无 loading 指示器（数据量小，加载快），图表区域用 metrics 的 `loading` 和 `noData`

```vue
<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <!-- 标题 + 控制栏 -->
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">仪表盘</h2>
      <div class="flex items-center gap-4">
        <div class="flex gap-1">
          <Button
            v-for="p in periods"
            :key="p.value"
            :variant="period === p.value ? 'default' : 'ghost'"
            size="sm"
            @click="period = p.value"
          >
            {{ p.label }}
          </Button>
        </div>
        <Select v-model="modelFilter">
          <SelectTrigger class="w-48">
            <SelectValue placeholder="全部模型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部模型</SelectItem>
            <SelectItem v-for="m in modelOptions" :key="m" :value="m">
              {{ m }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="dashboardKeyFilter">
          <SelectTrigger class="w-48">
            <SelectValue placeholder="全部密钥" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部密钥</SelectItem>
            <SelectItem v-for="rk in routerKeys" :key="rk.id" :value="rk.id">
              {{ rk.name }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent class="p-4">
          <p class="text-sm text-muted-foreground">总请求数</p>
          <p class="text-2xl font-bold text-foreground mt-1">{{ stats.totalRequests }}</p>
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
          <p class="text-sm text-muted-foreground">平均延迟</p>
          <p class="text-2xl font-bold text-foreground mt-1">{{ Math.round(stats.avgLatency) }}ms</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="p-4">
          <p class="text-sm text-muted-foreground">24h 请求数</p>
          <p class="text-2xl font-bold text-foreground mt-1">{{ stats.recentRequests }}</p>
        </CardContent>
      </Card>
    </div>

    <!-- 图表区域 -->
    <div v-if="loading" class="text-center text-muted-foreground py-20">加载中...</div>
    <div v-else-if="noData" class="text-center text-muted-foreground py-20">暂无数据</div>
    <template v-else>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <!-- Token 使用量 -->
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">Token 使用量</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-64">
              <Line v-if="tokensData" :data="tokensData" :options="stackedAreaOptions(tokensData.labels as string[])" />
            </div>
          </CardContent>
        </Card>

        <!-- 吞吐量 -->
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">吞吐量 (tokens/s)</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-64">
              <Line v-if="tpsData" :data="tpsData" :options="lineOptions('tokens/s', tpsData.labels as string[])" />
            </div>
          </CardContent>
        </Card>

        <!-- 首 Token 延迟 -->
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">首 Token 延迟 (TTFT)</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-64">
              <Line v-if="ttftData" :data="ttftData" :options="lineOptions('ms', ttftData.labels as string[])" />
            </div>
          </CardContent>
        </Card>

        <!-- 缓存命中率 -->
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">缓存命中率</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-64">
              <Line v-if="cacheRateData" :data="cacheRateData" :options="lineOptions('%', cacheRateData.labels as string[])" />
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 模型对比表 -->
      <Card>
        <CardHeader>
          <CardTitle class="text-sm font-medium text-foreground">模型对比</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模型</TableHead>
                <TableHead>请求数</TableHead>
                <TableHead>缓存命中率</TableHead>
                <TableHead>平均 TTFT</TableHead>
                <TableHead>平均 TPS</TableHead>
                <TableHead>输入 Tokens</TableHead>
                <TableHead>输出 Tokens</TableHead>
                <TableHead>缓存命中 Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in summaryRows" :key="row.backend_model">
                <TableCell class="font-medium">{{ row.backend_model }}</TableCell>
                <TableCell>{{ row.request_count }}</TableCell>
                <TableCell>
                  <Badge v-if="row.cache_hit_rate != null" :variant="row.cache_hit_rate >= 0.5 ? 'default' : 'secondary'">
                    {{ (row.cache_hit_rate * 100).toFixed(1) }}%
                  </Badge>
                  <span v-else class="text-muted-foreground">-</span>
                </TableCell>
                <TableCell>{{ row.avg_ttft_ms != null ? row.avg_ttft_ms.toFixed(0) + 'ms' : '-' }}</TableCell>
                <TableCell>{{ row.avg_tps != null ? row.avg_tps.toFixed(1) : '-' }}</TableCell>
                <TableCell>{{ row.total_input_tokens?.toLocaleString() ?? '-' }}</TableCell>
                <TableCell>{{ row.total_output_tokens?.toLocaleString() ?? '-' }}</TableCell>
                <TableCell>{{ row.total_cache_hit_tokens?.toLocaleString() ?? '-' }}</TableCell>
              </TableRow>
              <TableRow v-if="summaryRows.length === 0">
                <TableCell colspan="8" class="text-center text-muted-foreground">暂无数据</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { lineOptions, stackedAreaOptions } from './metrics-helpers'
import { useMetrics } from '@/composables/useMetrics'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const periods = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
]

// --- Stats 数据 ---
const stats = ref({
  totalRequests: 0,
  successRate: 0,
  avgLatency: 0,
  requestsByType: {} as Record<string, number>,
  recentRequests: 0,
})

// --- Metrics 数据（复用 composable） ---
const {
  period,
  modelFilter,
  routerKeyFilter: metricsKeyFilter,
  loading,
  routerKeys,
  modelOptions,
  ttftData,
  tpsData,
  tokensData,
  cacheRateData,
  summaryRows,
  noData,
} = useMetrics()

// --- 统一密钥筛选 ---
const dashboardKeyFilter = ref('all')

watch(dashboardKeyFilter, (v) => {
  metricsKeyFilter.value = v
  loadStats()
})

async function loadStats() {
  try {
    const params: { router_key_id?: string } = {}
    if (dashboardKeyFilter.value !== 'all') params.router_key_id = dashboardKeyFilter.value
    const res = await api.getStats(params)
    stats.value = res.data
  } catch (e) {
    console.error('Failed to load stats:', e)
    stats.value = { totalRequests: 0, successRate: 0, avgLatency: 0, requestsByType: {}, recentRequests: 0 }
  }
}

onMounted(() => {
  loadStats()
})
</script>
```

- [ ] **Step 2: 验证编译通过**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/Dashboard.vue
git commit -m "feat: merge metrics charts into dashboard page"
```

---

### Task 2: 清理路由和导航

**Files:**
- Modify: `frontend/src/router/index.ts:24-28`
- Modify: `frontend/src/components/layout/Sidebar.vue:65`

- [ ] **Step 1: 删除 `/metrics` 路由**

在 `frontend/src/router/index.ts` 中删除：

```ts
    {
      path: '/metrics',
      name: 'metrics',
      component: () => import('@/views/Metrics.vue'),
      meta: { requiresAuth: true },
    },
```

- [ ] **Step 2: 删除侧边栏 metrics 导航项**

在 `frontend/src/components/layout/Sidebar.vue` 中：

1. 删除 `navItems` 数组中的 metrics 项：
```ts
  { path: '/metrics', label: '性能指标', icon: BarChart3 },
```

2. 检查 `BarChart3` 是否还有其他引用。如果没有，从 import 中删除。

- [ ] **Step 3: 验证编译通过**

Run: `cd frontend && npx vue-tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/router/index.ts frontend/src/components/layout/Sidebar.vue
git commit -m "refactor: remove /metrics route and sidebar nav item"
```

---

### Task 3: 删除 Metrics.vue

**Files:**
- Delete: `frontend/src/views/Metrics.vue`

- [ ] **Step 1: 删除文件**

```bash
rm frontend/src/views/Metrics.vue
```

- [ ] **Step 2: 全局搜索确认无遗漏引用**

```bash
grep -r "Metrics.vue\|metrics\.vue\|views/Metrics" frontend/src/
```

Expected: 无结果

- [ ] **Step 3: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete Metrics.vue (merged into Dashboard)"
```

---

### Task 4: 视觉验证

- [ ] **Step 1: 启动前后端 dev server**

```bash
# 后端
npm run dev

# 前端（另一个终端）
cd frontend && npm run dev
```

- [ ] **Step 2: 浏览器验证**

打开 `http://localhost:5173/admin/`，检查：

1. 页面标题显示"仪表盘"
2. 控制栏：周期按钮 + 模型筛选 + 密钥筛选 均可交互
3. 4 个统计卡片正常显示
4. 图表行1：Token 使用量（堆叠面积图）+ 吞吐量（折线图）并排
5. 图表行2：首 Token 延迟 + 缓存命中率 并排
6. 模型对比表在底部正常显示
7. 侧边栏无"性能指标"入口
8. 切换周期/模型/密钥后图表和统计卡片均更新

- [ ] **Step 3: 修复问题并提交**

如有问题，修复后 commit。如无问题，跳过。
