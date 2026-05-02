<template>
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    <!-- 活跃请求 -->
    <Card>
      <CardContent class="p-4">
        <p class="text-sm text-muted-foreground">{{ t('monitor.header.activeRequests') }}</p>
        <p class="text-2xl font-bold text-foreground mt-1">{{ activeCount }}</p>
        <p class="text-xs text-muted-foreground mt-1">
          {{ t('monitor.header.streamNonStream', { stream: streamCount, nonStream: activeCount - streamCount }) }}
        </p>
      </CardContent>
    </Card>

    <!-- 错误率 -->
    <Card>
      <CardContent class="p-4">
        <p class="text-sm text-muted-foreground">{{ t('monitor.header.errorRate') }}</p>
        <p class="text-2xl font-bold text-foreground mt-1">{{ errorRate }}%</p>
        <p class="text-xs text-muted-foreground mt-1">
          {{ stats?.errorCount ?? 0 }} / {{ stats?.totalRequests ?? 0 }}
        </p>
      </CardContent>
    </Card>

    <!-- P50 延迟 -->
    <Card>
      <CardContent class="p-4">
        <p class="text-sm text-muted-foreground">{{ t('monitor.header.p50Latency') }}</p>
        <p class="text-2xl font-bold text-foreground mt-1">{{ p50Latency }}ms</p>
        <p class="text-xs text-muted-foreground mt-1">
          {{ t('monitor.header.avgLatency', { value: stats?.avgLatencyMs?.toFixed(0) ?? '--' }) }}
        </p>
      </CardContent>
    </Card>

    <!-- 重试率 -->
    <Card>
      <CardContent class="p-4">
        <p class="text-sm text-muted-foreground">{{ t('monitor.header.retryRate') }}</p>
        <p class="text-2xl font-bold text-foreground mt-1">{{ retryRate }}%</p>
        <p class="text-xs text-muted-foreground mt-1">
          {{ stats?.retryCount ?? 0 }} / {{ stats?.totalRequests ?? 0 }}
        </p>
      </CardContent>
    </Card>
  </div>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Card, CardContent } from '@/components/ui/card'
import type { StatsSnapshot } from '@/types/monitor'

const { t } = useI18n()

const props = defineProps<{
  stats: StatsSnapshot | null
  activeCount: number
  streamCount: number
}>()

const errorRate = computed(() => {
  if (!props.stats || props.stats.totalRequests === 0) return '0.0'
  return ((props.stats.errorCount / props.stats.totalRequests) * 100).toFixed(1)
})

const retryRate = computed(() => {
  if (!props.stats || props.stats.totalRequests === 0) return '0.0'
  return ((props.stats.retryCount / props.stats.totalRequests) * 100).toFixed(1)
})

const p50Latency = computed(() => {
  if (!props.stats) return '--'
  return props.stats.p50LatencyMs.toFixed(0)
})
</script>
