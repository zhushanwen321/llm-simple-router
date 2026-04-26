<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <!-- 筛选栏 -->
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
        <div v-if="period === 'custom'" class="flex items-center gap-1">
          <Input type="datetime-local" v-model="dateRange.start" class="w-44" />
          <span class="text-muted-foreground text-sm">-</span>
          <Input type="datetime-local" v-model="dateRange.end" class="w-44" />
          <Button v-if="dateRange.start || dateRange.end" variant="ghost" size="sm" @click="clearDateRange">清除</Button>
          <span v-if="dateRangeError" class="text-xs text-destructive whitespace-nowrap">{{ dateRangeError }}</span>
        </div>
        <Select v-model="providerFilter">
          <SelectTrigger class="w-28 truncate">
            <SelectValue placeholder="全部供应商" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部供应商</SelectItem>
            <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="modelFilter">
          <SelectTrigger class="w-32 truncate">
            <SelectValue placeholder="全部模型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部模型</SelectItem>
            <SelectItem v-for="m in filteredModelOptions" :key="m" :value="m">{{ m }}</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="dashboardKeyFilter">
          <SelectTrigger class="w-32 truncate">
            <SelectValue placeholder="全部密钥" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部密钥</SelectItem>
            <SelectItem v-for="rk in routerKeys" :key="rk.id" :value="rk.id">{{ rk.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <!-- 套餐用量追踪（第一行） -->
    <Card v-if="period !== 'custom'" class="mb-6">
      <CardHeader>
        <CardTitle class="text-sm font-medium text-foreground">套餐用量追踪</CardTitle>
      </CardHeader>
      <CardContent>
        <div v-if="usageError" class="text-sm text-destructive mb-3">{{ usageError }}</div>
        <ProviderWindowTabs v-else-if="period === 'window'" :windows-data="windowsData" :loading="usageLoading" />
        <DailyUsageTable v-else-if="period === 'weekly'"
          :data="weeklyData" :loading="usageLoading" empty-text="暂无周数据" total-label="周总请求" token-label="周总 Token" />
        <DailyUsageTable v-else-if="period === 'monthly'"
          :data="monthlyData" :loading="usageLoading" empty-text="暂无月数据" total-label="月总请求" token-label="月总 Token" />
      </CardContent>
    </Card>

    <!-- 统计 + 图表三栏 -->
    <div v-if="loading" class="text-center text-muted-foreground py-20">加载中...</div>
    <div v-else-if="noData" class="text-center text-muted-foreground py-20">暂无数据</div>
    <template v-else>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <!-- 统计卡片 2x2 -->
        <div class="grid grid-cols-2 gap-3">
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
              <p class="text-sm text-muted-foreground">平均吞吐量</p>
              <p class="text-2xl font-bold text-foreground mt-1">{{ stats.avgTps.toFixed(1) }} <span class="text-sm font-normal text-muted-foreground">tokens/s</span></p>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="p-4">
              <p class="text-sm text-muted-foreground">Token 使用总量</p>
              <p class="text-2xl font-bold text-foreground mt-1">{{ stats.totalTokens.toLocaleString() }}</p>
            </CardContent>
          </Card>
        </div>

        <!-- Token 使用量曲线 -->
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

        <!-- 吞吐量曲线 -->
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
                <TableHead>平均 TPS</TableHead>
                <TableHead>
                  <span class="inline-flex items-center gap-1">输入 Tokens
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child><CircleHelp class="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                        <TooltipContent><p>部分请求不返回 token 用量，此指标可能偏低</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </span>
                </TableHead>
                <TableHead>输出 Tokens</TableHead>
                <TableHead>
                  <span class="inline-flex items-center gap-1">缓存命中 Tokens
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child><CircleHelp class="h-3.5 w-3.5 text-muted-foreground cursor-help" /></TooltipTrigger>
                        <TooltipContent><p>仅支持 prompt cache 的模型返回此指标，其他模型为 0</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in summaryRows" :key="row.provider_id + row.backend_model">
                <TableCell class="font-medium">{{ row.provider_name }}@{{ row.backend_model }}</TableCell>
                <TableCell>{{ row.request_count }}</TableCell>
                <TableCell>{{ row.avg_tps != null ? row.avg_tps.toFixed(1) : '-' }}</TableCell>
                <TableCell>{{ row.total_input_tokens?.toLocaleString() ?? '-' }}</TableCell>
                <TableCell>{{ row.total_output_tokens?.toLocaleString() ?? '-' }}</TableCell>
                <TableCell>{{ row.total_cache_hit_tokens?.toLocaleString() ?? '-' }}</TableCell>
              </TableRow>
              <TableRow v-if="summaryRows.length === 0">
                <TableCell colspan="6" class="text-center text-muted-foreground">暂无数据</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { api, getApiMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CircleHelp } from 'lucide-vue-next'
import { lineOptions, stackedAreaOptions } from './metrics-helpers'
import { useMetrics } from '@/composables/useMetrics'
import { useUsage } from '@/composables/useUsage'
import DailyUsageTable from '@/components/dashboard/DailyUsageTable.vue'
import ProviderWindowTabs from '@/components/dashboard/ProviderWindowTabs.vue'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, ChartTooltip, Legend, Filler)

const periods = [
  { label: '5小时窗口', value: 'window' },
  { label: '本周', value: 'weekly' },
  { label: '本月', value: 'monthly' },
  { label: '自定义', value: 'custom' },
]

// --- Stats 数据 ---
const stats = ref({
  totalRequests: 0,
  successRate: 0,
  avgTps: 0,
  totalTokens: 0,
})

// --- Metrics 数据（复用 composable） ---
const {
  period,
  modelFilter,
  routerKeyFilter: metricsKeyFilter,
  providerFilter,
  dateRange,
  dateRangeError,
  loading,
  routerKeys,
  filteredModelOptions,
  providers,
  tpsData,
  tokensData,
  summaryRows,
  noData,
  clearDateRange,
} = useMetrics()

// --- 统一密钥筛选 ---
const dashboardKeyFilter = ref('all')

watch(dashboardKeyFilter, (v) => {
  metricsKeyFilter.value = v
  loadStats()
})

// period 切换时：非 custom 清空日期范围，刷新 stats
watch(period, (v) => {
  if (v !== 'custom') {
    dateRange.value = { start: '', end: '' }
  }
  loadStats()
})

// dateRange 变化时刷新 stats（仅 custom 模式）
watch(dateRange, () => {
  if (period.value === 'custom') {
    loadStats()
  }
}, { deep: true })

function toIsoStart(dateStr: string): string {
  if (dateStr.includes('T')) return `${dateStr}:00.000Z`
  return `${dateStr}T00:00:00.000Z`
}

function toIsoEnd(dateStr: string): string {
  if (dateStr.includes('T')) return `${dateStr}:59.999Z`
  return `${dateStr}T23:59:59.999Z`
}

const hasDateRange = computed(() => dateRange.value.start && dateRange.value.end && dateRange.value.start < dateRange.value.end)

async function loadStats() {
  try {
    const params: Record<string, string> = {}
    if (period.value === 'custom' && hasDateRange.value) {
      params.start_time = toIsoStart(dateRange.value.start)
      params.end_time = toIsoEnd(dateRange.value.end)
    } else if (period.value !== 'custom') {
      params.period = period.value
    } else {
      return // custom 但没选日期，不请求
    }
    if (dashboardKeyFilter.value !== 'all') params.router_key_id = dashboardKeyFilter.value
    const res = await api.getStats(params)
    stats.value = res
  } catch (e: unknown) {
    console.error('Failed to load stats:', e)
    toast.error(getApiMessage(e, '加载统计数据失败'))
    stats.value = { totalRequests: 0, successRate: 0, avgTps: 0, totalTokens: 0 }
  }
}

// --- 套餐用量追踪 ---
const { windowsData, weeklyData, monthlyData, usageLoading, usageError, fetchUsage } = useUsage(dashboardKeyFilter, period)

onMounted(() => {
  loadStats()
  fetchUsage()
})
</script>
