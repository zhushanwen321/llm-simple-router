<template>
  <div v-if="!request" class="text-sm text-muted-foreground py-4 text-center">
    点击请求查看详情
  </div>
  <div v-else class="space-y-4">
    <!-- Header -->
    <div class="flex items-center gap-2">
      <span class="font-medium text-foreground">{{ request.model }}</span>
      <Badge :variant="statusVariant(request.status)">
        {{ statusLabel(request.status) }}
      </Badge>
      <span class="text-xs text-muted-foreground font-mono">
        {{ request.id.slice(0, 8) }}
      </span>
    </div>

    <!-- 指标网格 -->
    <div class="grid grid-cols-2 gap-2 text-sm">
      <div>
        <p class="text-muted-foreground">API 类型</p>
        <p class="font-medium text-foreground">{{ request.apiType.toUpperCase() }}</p>
      </div>
      <div>
        <p class="text-muted-foreground">Provider</p>
        <p class="font-medium text-foreground">{{ request.providerName }}</p>
      </div>
      <div>
        <p class="text-muted-foreground">耗时</p>
        <p class="font-medium text-foreground">{{ elapsedText }}s</p>
      </div>
      <div>
        <p class="text-muted-foreground">TTFT</p>
        <p class="font-medium text-foreground">
          {{ request.streamMetrics?.ttftMs != null ? `${request.streamMetrics.ttftMs.toFixed(0)}ms` : '--' }}
        </p>
      </div>
      <div>
        <p class="text-muted-foreground">Output Tokens</p>
        <p class="font-medium text-foreground">
          {{ request.streamMetrics?.outputTokens != null ? request.streamMetrics.outputTokens : '--' }}
        </p>
      </div>
      <div>
        <p class="text-muted-foreground">速度</p>
        <p class="font-medium text-foreground">{{ speedText }}</p>
      </div>
    </div>

    <!-- 尝试历史 -->
    <div v-if="request.attempts.length > 0">
      <p class="text-sm text-muted-foreground mb-1">尝试历史</p>
      <div class="space-y-1">
        <div
          v-for="(attempt, i) in request.attempts"
          :key="i"
          class="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1"
        >
          <span class="text-muted-foreground w-4">#{{ i + 1 }}</span>
          <span :class="attempt.statusCode && attempt.statusCode < 400 ? 'text-green-600' : 'text-red-500'">
            {{ attempt.statusCode ?? 'N/A' }}
          </span>
          <span class="text-muted-foreground">{{ attempt.latencyMs.toFixed(0) }}ms</span>
          <span v-if="attempt.error" class="text-red-500 truncate">{{ attempt.error }}</span>
        </div>
      </div>
    </div>

    <!-- 客户端 IP -->
    <div v-if="request.clientIp" class="text-xs text-muted-foreground">
      IP: {{ request.clientIp }}
    </div>
  </div>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'

interface AttemptSnapshot {
  statusCode: number | null
  error: string | null
  latencyMs: number
  providerId: string
}

interface StreamMetricsSnapshot {
  inputTokens: number | null
  outputTokens: number | null
  ttftMs: number | null
  stopReason: string | null
  isComplete: boolean
}

interface ActiveRequest {
  id: string
  apiType: 'openai' | 'anthropic'
  model: string
  providerId: string
  providerName: string
  isStream: boolean
  startTime: number
  status: 'pending' | 'completed' | 'failed'
  retryCount: number
  attempts: AttemptSnapshot[]
  streamMetrics?: StreamMetricsSnapshot
  clientIp?: string
  completedAt?: number
}

const props = defineProps<{
  request: ActiveRequest | null
}>()

const elapsedText = computed(() => {
  if (!props.request) return '--'
  const end = props.request.completedAt ?? Date.now()
  return ((end - props.request.startTime) / 1000).toFixed(1)
})

const speedText = computed(() => {
  if (!props.request?.streamMetrics) return '--'
  const sm = props.request.streamMetrics
  if (sm.outputTokens == null || sm.ttftMs == null) return '--'
  const elapsedSec = (props.request.completedAt ?? Date.now()) - props.request.startTime
  if (elapsedSec <= 0) return '--'
  const tps = (sm.outputTokens / (elapsedSec / 1000)).toFixed(1)
  return `${tps} tok/s`
})

function statusVariant(status: string): 'default' | 'destructive' | 'secondary' | 'outline' {
  switch (status) {
    case 'pending': return 'default'
    case 'failed': return 'destructive'
    case 'completed': return 'secondary'
    default: return 'outline'
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending': return '进行中'
    case 'failed': return '失败'
    case 'completed': return '完成'
    default: return status
  }
}
</script>
