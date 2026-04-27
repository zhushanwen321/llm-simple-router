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
      <template v-if="periodTab === 'custom'">
        <Input type="datetime-local" v-model="customStart" class="w-44" />
        <span>~</span>
        <Input type="datetime-local" v-model="customEnd" class="w-44" />
      </template>
      <span v-else>⏱ {{ timeRangeText }}</span>
    </div>

    <!-- 模型 + 密钥筛选 -->
    <div class="flex items-center gap-3 mb-4">
      <Select v-model="modelFilter">
        <SelectTrigger class="w-44">
          <SelectValue placeholder="全部模型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部模型</SelectItem>
          <SelectItem v-for="m in modelOptions" :key="m" :value="m">{{ m }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="keyFilter">
        <SelectTrigger class="w-48">
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
