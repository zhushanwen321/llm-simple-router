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
  avgTps: 0,
  totalTokens: 0,
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

// period 变化时也刷新 stats
watch(period, () => {
  loadStats()
})

async function loadStats() {
  try {
    const params: { period?: string; router_key_id?: string } = { period: period.value }
    if (dashboardKeyFilter.value !== 'all') params.router_key_id = dashboardKeyFilter.value
    const res = await api.getStats(params)
    stats.value = res.data
  } catch (e) {
    console.error('Failed to load stats:', e)
    stats.value = { totalRequests: 0, successRate: 0, avgTps: 0, totalTokens: 0 }
  }
}

onMounted(() => {
  loadStats()
})
</script>
