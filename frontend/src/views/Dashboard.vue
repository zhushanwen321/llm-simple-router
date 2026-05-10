<template>
  <div class="p-6">
    <!-- 顶部：provider 按钮组 -->
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">{{ t('dashboard.title') }}</h2>
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
          <SelectValue :placeholder="t('common.allModels')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t('common.allModels') }}</SelectItem>
          <SelectItem v-for="m in modelOptions" :key="m" :value="m">{{ m }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="keyFilter">
        <SelectTrigger class="w-48">
          <SelectValue :placeholder="t('common.allKeys')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t('common.allKeys') }}</SelectItem>
          <SelectItem v-for="rk in keyOptions" :key="rk.id" :value="rk.id">{{ rk.name }}</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="clientType">
        <SelectTrigger class="w-40">
          <SelectValue :placeholder="t('dashboard.clientType.all')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t('dashboard.clientType.all') }}</SelectItem>
          <SelectItem value="claude-code">{{ t('dashboard.clientType.claude-code') }}</SelectItem>
          <SelectItem value="pi">{{ t('dashboard.clientType.pi') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- 数据区 -->
    <div v-if="loading" class="text-center text-muted-foreground py-20">{{ t('common.loading') }}</div>
    <template v-else>
      <!-- 指标卡片 6 卡一行 -->
      <div class="grid grid-cols-6 gap-3 mb-6">
        <Card>
          <CardContent class="p-4">
            <p class="text-sm text-muted-foreground">{{ t('dashboard.stats.totalRequests') }}</p>
            <p class="text-2xl font-bold text-foreground mt-1">{{ stats.totalRequests.toLocaleString() }}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-sm text-muted-foreground">{{ t('dashboard.stats.successRate') }}</p>
            <p class="text-2xl font-bold text-success mt-1">{{ (stats.successRate * 100).toFixed(1) }}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-sm text-muted-foreground">{{ t('dashboard.stats.tokenOutputSpeed') }}</p>
            <p class="text-2xl font-bold text-foreground mt-1">{{ stats.avgTps.toFixed(1) }} <span class="text-sm font-normal text-muted-foreground">t/s</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-sm text-muted-foreground">{{ t('dashboard.stats.tokenInputTotal') }}</p>
            <p class="text-2xl font-bold text-foreground mt-1">{{ stats.totalInputTokens.toLocaleString() }}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-sm text-muted-foreground">{{ t('dashboard.stats.tokenOutputTotal') }}</p>
            <p class="text-2xl font-bold text-foreground mt-1">{{ stats.totalOutputTokens.toLocaleString() }}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-4">
            <p class="text-sm text-muted-foreground">{{ t('dashboard.stats.cacheHitRate') }}</p>
            <p class="text-2xl font-bold text-primary mt-1">
              <template v-if="stats.totalInputTokens > 0">
                {{ cacheHitRate.toFixed(1) }}%
              </template>
              <template v-else>
                <span class="text-base font-normal text-muted-foreground">{{ t('dashboard.noCacheData') }}</span>
              </template>
            </p>
          </CardContent>
        </Card>
      </div>

      <!-- 3 个 chart -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">{{ t('dashboard.charts.tokenOutputSpeed') }}</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-56">
              <Line v-if="tpsChartData" :key="'tps-' + periodTab + '-' + selectedProvider" :data="tpsChartData" :options="chartOptions(tpsChartData.labels as string[])" />
              <div v-else class="flex items-center justify-center h-full text-muted-foreground text-sm">{{ t('common.noData') }}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">{{ t('dashboard.charts.tokenInputTotal') }}</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-56">
              <Line v-if="inputTokensChartData" :key="'input-' + periodTab + '-' + selectedProvider" :data="inputTokensChartData" :options="chartOptions(inputTokensChartData.labels as string[])" />
              <div v-else class="flex items-center justify-center h-full text-muted-foreground text-sm">{{ t('common.noData') }}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">{{ t('dashboard.charts.tokenOutputTotal') }}</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-56">
              <Line v-if="outputTokensChartData" :key="'output-' + periodTab + '-' + selectedProvider" :data="outputTokensChartData" :options="chartOptions(outputTokensChartData.labels as string[])" />
              <div v-else class="flex items-center justify-center h-full text-muted-foreground text-sm">{{ t('common.noData') }}</div>
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
  Tooltip as ChartTooltip,
  Legend,
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { lineOptions } from './metrics-helpers'
import { useDashboard } from '@/composables/useDashboard'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ChartTooltip, Legend)

const {
  sortedProviders, selectedProvider,
  periodTab, customStart, customEnd,
  modelFilter, keyFilter, clientType, modelOptions, keyOptions,
  timeRangeText,
  stats, loading,
  cacheHitRate,
  tpsChartData, inputTokensChartData, outputTokensChartData,
} = useDashboard()

const { t } = useI18n()

const periodTabs = computed(() => [
  { label: t('dashboard.period.last5Hours'), value: 'window' as const },
  { label: t('dashboard.period.weekly'), value: 'weekly' as const },
  { label: t('dashboard.period.monthly'), value: 'monthly' as const },
  { label: t('dashboard.period.custom'), value: 'custom' as const },
])

function chartOptions(labels: string[]): ReturnType<typeof lineOptions> {
  return lineOptions('', labels)
}
</script>
