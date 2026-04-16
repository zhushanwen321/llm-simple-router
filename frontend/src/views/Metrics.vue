<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <h2 class="text-lg font-semibold text-gray-900 mb-4">性能指标</h2>

    <!-- 控制栏 -->
    <div class="flex items-center gap-4 mb-6">
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
      <Select v-model="routerKeyFilter">
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

    <!-- 加载 & 空状态 -->
    <div v-if="loading" class="text-center text-gray-400 py-20">加载中...</div>
    <div v-else-if="noData" class="text-center text-gray-400 py-20">暂无数据</div>

    <!-- 图表区域 -->
    <template v-else>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <!-- TTFT -->
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-gray-700">首 Token 延迟 (TTFT)</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-64">
              <Line v-if="ttftData" :data="ttftData" :options="lineOptions('ms')" />
            </div>
          </CardContent>
        </Card>

        <!-- 吞吐量 -->
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-gray-700">吞吐量 (tokens/s)</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-64">
              <Line v-if="tpsData" :data="tpsData" :options="lineOptions('tokens/s')" />
            </div>
          </CardContent>
        </Card>

        <!-- Token 使用量 -->
        <Card class="lg:col-span-2">
          <CardHeader>
            <CardTitle class="text-sm font-medium text-gray-700">Token 使用量</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-64">
              <Line v-if="tokensData" :data="tokensData" :options="stackedAreaOptions()" />
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- 模型对比表 -->
      <Card>
        <CardHeader>
          <CardTitle class="text-sm font-medium text-gray-700">模型对比</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>模型</TableHead>
                <TableHead>请求数</TableHead>
                <TableHead>成功率</TableHead>
                <TableHead>平均 TTFT</TableHead>
                <TableHead>平均 TPS</TableHead>
                <TableHead>输入 Tokens</TableHead>
                <TableHead>输出 Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in summaryRows" :key="row.backend_model">
                <TableCell class="font-medium">{{ row.backend_model }}</TableCell>
                <TableCell>{{ row.request_count }}</TableCell>
                <TableCell>
                  <Badge :variant="row.success_rate >= 0.95 ? 'default' : 'destructive'">
                    {{ (row.success_rate * 100).toFixed(1) }}%
                  </Badge>
                </TableCell>
                <TableCell>{{ row.avg_ttft != null ? row.avg_ttft.toFixed(0) + 'ms' : '-' }}</TableCell>
                <TableCell>{{ row.avg_tps != null ? row.avg_tps.toFixed(1) : '-' }}</TableCell>
                <TableCell>{{ row.total_input_tokens?.toLocaleString() ?? '-' }}</TableCell>
                <TableCell>{{ row.total_output_tokens?.toLocaleString() ?? '-' }}</TableCell>
              </TableRow>
              <TableRow v-if="summaryRows.length === 0">
                <TableCell colspan="7" class="text-center text-gray-400">暂无数据</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </template>
  </div>
</template>

<script setup lang="ts">
/* eslint-disable max-lines */
import { ref, computed, watch, onMounted } from 'vue'
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
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const periods = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
]

const period = ref('24h')
const modelFilter = ref('all')
const routerKeyFilter = ref('all')
const loading = ref(false)
const routerKeys = ref<{ id: string; name: string }[]>([])
const modelOptions = ref<string[]>([])

const ttftData = ref<ChartData<'line'> | null>(null)
const tpsData = ref<ChartData<'line'> | null>(null)
const tokensData = ref<ChartData<'line'> | null>(null)

interface SummaryRow {
  backend_model: string
  request_count: number
  success_rate: number
  avg_ttft: number | null
  avg_tps: number | null
  total_input_tokens: number | null
  total_output_tokens: number | null
}
const summaryRows = ref<SummaryRow[]>([])

const noData = computed(
  () => !ttftData.value && !tpsData.value && !tokensData.value && summaryRows.value.length === 0,
)

function lineOptions(unit: string): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: { label: (ctx) => `${ctx.parsed.y} ${unit}` },
      },
    },
    scales: {
      x: { display: true, grid: { display: false } },
      y: { display: true, beginAtZero: true },
    },
  }
}

function stackedAreaOptions(): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom' } },
    scales: {
      x: { stacked: true, grid: { display: false } },
      y: { stacked: true, beginAtZero: true },
    },
  }
}

function buildTimeseriesParams(metric: string) {
  const params: { period: string; metric: string; backend_model?: string; router_key_id?: string } = { period: period.value, metric }
  if (modelFilter.value !== 'all') params.backend_model = modelFilter.value
  if (routerKeyFilter.value !== 'all') params.router_key_id = routerKeyFilter.value
  return params
}

function buildSummaryParams() {
  const params: { period: string; backend_model?: string; router_key_id?: string } = { period: period.value }
  if (modelFilter.value !== 'all') params.backend_model = modelFilter.value
  if (routerKeyFilter.value !== 'all') params.router_key_id = routerKeyFilter.value
  return params
}

async function fetchMetrics() {
  loading.value = true
  try {
    const [ttftRes, tpsRes, tokensRes, summaryRes] = await Promise.allSettled([
      api.getMetricsTimeseries(buildTimeseriesParams('ttft')),
      api.getMetricsTimeseries(buildTimeseriesParams('tps')),
      api.getMetricsTimeseries(buildTimeseriesParams('tokens')),
      api.getMetricsSummary(buildSummaryParams()),
    ])

    const fulfilled = <T>(r: PromiseSettledResult<T>): r is PromiseFulfilledResult<T> => r.status === 'fulfilled'
    const ttftOk = fulfilled(ttftRes) ? ttftRes.value : null
    const tpsOk = fulfilled(tpsRes) ? tpsRes.value : null
    const tokensOk = fulfilled(tokensRes) ? tokensRes.value : null
    const summaryOk = fulfilled(summaryRes) ? summaryRes.value : null

    interface TimeseriesResponse { data?: { timestamps?: string[]; values?: number[] } }
    const toLabels = (d: TimeseriesResponse | null) => (d?.data?.timestamps ?? []).map((t: string) => {
      const date = new Date(t)
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    })

    ttftData.value = ttftOk ? {
      labels: toLabels(ttftOk),
      datasets: [{
        label: 'TTFT (ms)',
        data: ttftOk.data?.values ?? [],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.1)',
        fill: false,
        tension: 0.3,
      }],
    } : null

    tpsData.value = tpsOk ? {
      labels: toLabels(tpsOk),
      datasets: [{
        label: 'TPS',
        data: tpsOk.data?.values ?? [],
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139,92,246,0.1)',
        fill: false,
        tension: 0.3,
      }],
    } : null

    const tokenLabels = tokensOk ? toLabels(tokensOk) : []
    const td = tokensOk?.data
    tokensData.value = {
      labels: tokenLabels,
      datasets: [
        {
          label: '输入 Tokens',
          data: td?.input_tokens ?? [],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.3)',
          fill: true,
          tension: 0.3,
        },
        {
          label: '输出 Tokens',
          data: td?.output_tokens ?? [],
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139,92,246,0.3)',
          fill: true,
          tension: 0.3,
        },
        {
          label: '缓存命中 Tokens',
          data: td?.cache_hit_tokens ?? [],
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.3)',
          fill: true,
          tension: 0.3,
        },
      ],
    }

    summaryRows.value = summaryOk?.data?.models ?? []
    const models: string[] = (summaryOk?.data?.models ?? []).map((m: SummaryRow) => m.backend_model)
    modelOptions.value = [...new Set(models)]
  } catch (e) {
    console.error('Failed to load metrics:', e)
    loading.value = false
  } finally {
    loading.value = false
  }
}

watch([period, modelFilter, routerKeyFilter], () => fetchMetrics())

async function loadRouterKeys() {
  try {
    const res = await api.getRouterKeys()
    routerKeys.value = res.data
  // eslint-disable-next-line taste/no-silent-catch
  } catch (e) {
    console.error('Failed to load router keys:', e)
  }
}

onMounted(() => {
  loadRouterKeys()
  fetchMetrics()
})
</script>
