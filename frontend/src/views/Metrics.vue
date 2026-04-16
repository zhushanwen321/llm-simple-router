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
              <Line v-if="ttftData" :data="ttftData" :options="lineOptions('ms', ttftData.labels as string[])" />
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
              <Line v-if="tpsData" :data="tpsData" :options="lineOptions('tokens/s', tpsData.labels as string[])" />
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
              <Line v-if="tokensData" :data="tokensData" :options="stackedAreaOptions(tokensData.labels as string[])" />
            </div>
          </CardContent>
        </Card>

        <!-- 缓存命中率 -->
        <Card class="lg:col-span-2">
          <CardHeader>
            <CardTitle class="text-sm font-medium text-gray-700">缓存命中率</CardTitle>
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
          <CardTitle class="text-sm font-medium text-gray-700">模型对比</CardTitle>
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
                  <span v-else class="text-gray-400">-</span>
                </TableCell>
                <TableCell>{{ row.avg_ttft_ms != null ? row.avg_ttft_ms.toFixed(0) + 'ms' : '-' }}</TableCell>
                <TableCell>{{ row.avg_tps != null ? row.avg_tps.toFixed(1) : '-' }}</TableCell>
                <TableCell>{{ row.total_input_tokens?.toLocaleString() ?? '-' }}</TableCell>
                <TableCell>{{ row.total_output_tokens?.toLocaleString() ?? '-' }}</TableCell>
                <TableCell>{{ row.total_cache_hit_tokens?.toLocaleString() ?? '-' }}</TableCell>
              </TableRow>
              <TableRow v-if="summaryRows.length === 0">
                <TableCell colspan="8" class="text-center text-gray-400">暂无数据</TableCell>
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
  Tooltip,
  Legend,
  Filler,
  type ChartData,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { fillTimeseries, lineOptions, stackedAreaOptions } from './metrics-helpers'

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
const cacheRateData = ref<ChartData<'line'> | null>(null)

interface SummaryRow {
  backend_model: string
  request_count: number
  avg_ttft_ms: number | null
  avg_tps: number | null
  total_input_tokens: number | null
  total_output_tokens: number | null
  total_cache_hit_tokens: number | null
  cache_hit_rate: number | null
}
const summaryRows = ref<SummaryRow[]>([])

const noData = computed(() => {
  const hasChart = ttftData.value || tpsData.value || tokensData.value || cacheRateData.value
  return !hasChart && summaryRows.value.length === 0
})

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

function toDataset(label: string, color: string, bgColor: string, filled: boolean, data: { labels: string[]; values: number[] }) {
  return {
    labels: data.labels,
    datasets: [{
      label,
      data: data.values,
      borderColor: color,
      backgroundColor: bgColor,
      fill: filled,
      tension: 0.4,
      pointRadius: 0,
    }],
  }
}

async function fetchMetrics() {
  loading.value = true
  try {
    const [ttftRes, tpsRes, inputTokensRes, outputTokensRes, cacheHitTokensRes, cacheRateRes, summaryRes] = await Promise.allSettled([
      api.getMetricsTimeseries(buildTimeseriesParams('ttft')),
      api.getMetricsTimeseries(buildTimeseriesParams('tps')),
      api.getMetricsTimeseries(buildTimeseriesParams('input_tokens')),
      api.getMetricsTimeseries(buildTimeseriesParams('output_tokens')),
      api.getMetricsTimeseries(buildTimeseriesParams('cache_hit_tokens')),
      api.getMetricsTimeseries(buildTimeseriesParams('cache_rate')),
      api.getMetricsSummary(buildSummaryParams()),
    ])

    const fulfilled = <T>(r: PromiseSettledResult<T>): r is PromiseFulfilledResult<T> => r.status === 'fulfilled'
    const p = period.value

    const ttftOk = fulfilled(ttftRes) ? ttftRes.value.data : null
    const tpsOk = fulfilled(tpsRes) ? tpsRes.value.data : null
    const inputTokensOk = fulfilled(inputTokensRes) ? inputTokensRes.value.data : null
    const outputTokensOk = fulfilled(outputTokensRes) ? outputTokensRes.value.data : null
    const cacheHitTokensOk = fulfilled(cacheHitTokensRes) ? cacheHitTokensRes.value.data : null
    const cacheRateOk = fulfilled(cacheRateRes) ? cacheRateRes.value.data : null
    const summaryOk = fulfilled(summaryRes) ? summaryRes.value.data : null

    const emptyAxis = fillTimeseries([], p)
    const ttftFilled = ttftOk?.length ? fillTimeseries(ttftOk, p) : emptyAxis
    const tpsFilled = tpsOk?.length ? fillTimeseries(tpsOk, p) : emptyAxis
    const inputTokensFilled = inputTokensOk?.length ? fillTimeseries(inputTokensOk, p) : emptyAxis
    const outputTokensFilled = outputTokensOk?.length ? fillTimeseries(outputTokensOk, p) : emptyAxis
    const cacheHitTokensFilled = cacheHitTokensOk?.length ? fillTimeseries(cacheHitTokensOk, p) : emptyAxis
    const cacheRateFilled = cacheRateOk?.length ? fillTimeseries(cacheRateOk, p) : emptyAxis

    const hasAny = ttftOk?.length || tpsOk?.length || inputTokensOk?.length || outputTokensOk?.length || cacheHitTokensOk?.length || cacheRateOk?.length

    ttftData.value = hasAny ? toDataset('TTFT (ms)', '#3b82f6', 'rgba(59,130,246,0.1)', false, ttftFilled) : null
    tpsData.value = hasAny ? toDataset('TPS', '#8b5cf6', 'rgba(139,92,246,0.1)', false, tpsFilled) : null
    tokensData.value = hasAny ? {
      labels: inputTokensFilled.labels,
      datasets: [
        { label: 'Input Tokens', data: inputTokensFilled.values, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.3)', fill: true, tension: 0.4, pointRadius: 0 },
        { label: 'Output Tokens', data: outputTokensFilled.values, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.3)', fill: true, tension: 0.4, pointRadius: 0 },
        { label: 'Cache Hit Tokens', data: cacheHitTokensFilled.values, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.3)', fill: true, tension: 0.4, pointRadius: 0 },
      ],
    } : null
    const PERCENT_MULTIPLIER = 100
    cacheRateData.value = hasAny ? toDataset('Cache Hit Rate', '#f59e0b', 'rgba(245,158,11,0.1)', false, {
      labels: cacheRateFilled.labels,
      values: cacheRateFilled.values.map((v) => v * PERCENT_MULTIPLIER),
    }) : null

    summaryRows.value = Array.isArray(summaryOk) ? summaryOk : []
    modelOptions.value = [...new Set(summaryRows.value.map((r: SummaryRow) => r.backend_model))]
  } catch (e) {
    console.error('Failed to load metrics:', e)
    toast.error('加载性能指标失败')
  } finally {
    loading.value = false
  }
}

let filterTimer: ReturnType<typeof setTimeout> | null = null
watch([period, modelFilter, routerKeyFilter], () => {
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(() => fetchMetrics(), 300) // eslint-disable-line no-magic-numbers
})

async function loadRouterKeys() {
  try {
    const res = await api.getRouterKeys()
    routerKeys.value = res.data
  } catch (e) {
    console.error('Failed to load router keys:', e)
    toast.error('加载密钥列表失败')
  }
}

onMounted(() => {
  loadRouterKeys()
  fetchMetrics()
})
</script>
