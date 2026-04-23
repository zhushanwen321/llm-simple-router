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
        <div class="flex items-center gap-1">
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
            <SelectItem v-for="m in filteredModelOptions" :key="m" :value="m">
              {{ m }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="dashboardKeyFilter">
          <SelectTrigger class="w-32 truncate">
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

    <!-- 图表区域 -->
    <div v-if="loading" class="text-center text-muted-foreground py-20">加载中...</div>
    <div v-else-if="noData" class="text-center text-muted-foreground py-20">暂无数据</div>
    <template v-else>
      <!-- 套餐用量追踪 -->
      <Card class="mb-6">
        <CardHeader>
          <CardTitle class="text-sm font-medium text-foreground">套餐用量追踪</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="usageError" class="text-sm text-destructive mb-3">{{ usageError }}</div>
          <Tabs v-model="usageTab">
            <TabsList>
              <TabsTrigger value="windows">5小时窗口</TabsTrigger>
              <TabsTrigger value="weekly">本周</TabsTrigger>
              <TabsTrigger value="monthly">本月</TabsTrigger>
            </TabsList>
            <TabsContent value="windows">
              <div v-if="usageLoading" class="text-center text-muted-foreground py-8">加载中...</div>
              <div v-else-if="windowsData.length === 0" class="text-center text-muted-foreground py-8">暂无窗口数据</div>
              <template v-else>
                <div class="grid grid-cols-3 gap-4 mt-4 mb-4">
                  <div class="rounded-md border p-3">
                    <p class="text-sm text-muted-foreground">今日窗口</p>
                    <p class="text-xl font-bold text-foreground">{{ windowsData.length }}</p>
                  </div>
                  <div class="rounded-md border p-3">
                    <p class="text-sm text-muted-foreground">总请求数</p>
                    <p class="text-xl font-bold text-foreground">{{ totalWindowRequests }}</p>
                  </div>
                  <div class="rounded-md border p-3">
                    <p class="text-sm text-muted-foreground">总 Token</p>
                    <p class="text-xl font-bold text-foreground">{{ totalWindowTokens }}</p>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>开始时间</TableHead>
                      <TableHead>结束时间</TableHead>
                      <TableHead>请求数</TableHead>
                      <TableHead>输入 Tokens</TableHead>
                      <TableHead>输出 Tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="item in windowsData" :key="item.window.id">
                      <TableCell class="text-sm">{{ formatUsageTime(item.window.start_time) }}</TableCell>
                      <TableCell class="text-sm">{{ formatUsageTime(item.window.end_time) }}</TableCell>
                      <TableCell>{{ item.usage.request_count }}</TableCell>
                      <TableCell>{{ item.usage.total_input_tokens.toLocaleString() }}</TableCell>
                      <TableCell>{{ item.usage.total_output_tokens.toLocaleString() }}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </template>
            </TabsContent>
            <TabsContent value="weekly">
              <DailyUsageTable :data="weeklyData" :loading="usageLoading" empty-text="暂无周数据" total-label="周总请求" token-label="周总 Token" />
            </TabsContent>
            <TabsContent value="monthly">
              <DailyUsageTable :data="monthlyData" :loading="usageLoading" empty-text="暂无月数据" total-label="月总请求" token-label="月总 Token" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
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
              <TableRow v-for="row in summaryRows" :key="row.backend_model">
                <TableCell class="font-medium">{{ row.backend_model }}</TableCell>
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
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CircleHelp } from 'lucide-vue-next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { lineOptions, stackedAreaOptions } from './metrics-helpers'
import { useMetrics } from '@/composables/useMetrics'
import { useUsage } from '@/composables/useUsage'
import DailyUsageTable from '@/components/dashboard/DailyUsageTable.vue'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, ChartTooltip, Legend, Filler)

const periods = [
  { label: '1h', value: '1h' },
  { label: '5h', value: '5h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
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

// period / dateRange 变化时也刷新 stats
watch([period, dateRange], () => {
  loadStats()
}, { deep: true })

async function loadStats() {
  try {
    const params: { period?: string; router_key_id?: string } = { period: period.value }
    if (dashboardKeyFilter.value !== 'all') params.router_key_id = dashboardKeyFilter.value
    const res = await api.getStats(params)
    stats.value = res
  } catch (e) {
    console.error('Failed to load stats:', e)
    toast.error('加载统计数据失败')
    stats.value = { totalRequests: 0, successRate: 0, avgTps: 0, totalTokens: 0 }
  }
}

onMounted(() => {
  loadStats()
  fetchUsage()
})

// --- 套餐用量追踪 ---
const { usageTab, windowsData, weeklyData, monthlyData, usageLoading, usageError, fetchUsage } = useUsage(dashboardKeyFilter)

const totalWindowRequests = computed(() =>
  windowsData.value.reduce((sum, w) => sum + w.usage.request_count, 0),
)
const totalWindowTokens = computed(() => {
  const total = windowsData.value.reduce((sum, w) => sum + w.usage.total_input_tokens + w.usage.total_output_tokens, 0)
  return total.toLocaleString()
})

function formatUsageTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>
