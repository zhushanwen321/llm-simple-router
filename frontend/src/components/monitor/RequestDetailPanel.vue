<template>
  <div v-if="!request" class="text-sm text-muted-foreground py-4 text-center">
    点击请求查看详情
  </div>
  <div v-else class="space-y-3">
    <!-- Header -->
    <div class="flex items-center gap-2">
      <span class="font-medium text-foreground">{{ request.model }}</span>
      <Badge v-if="request.isStream" variant="outline" class="text-xs">SSE</Badge>
      <Badge :variant="statusVariant(request.status)">
        {{ statusLabel(request.status) }}
      </Badge>
    </div>
    <p class="text-xs text-muted-foreground font-mono">
      {{ request.id.slice(0, 8) }}
    </p>

    <!-- 指标网格 -->
    <div class="space-y-1.5 text-sm">
      <div class="flex justify-between">
        <span class="text-muted-foreground">API 类型</span>
        <span class="font-medium text-foreground">{{ request.apiType.toUpperCase() }}</span>
      </div>
      <Separator />
      <div class="flex justify-between">
        <span class="text-muted-foreground">Provider</span>
        <span class="font-medium text-foreground text-right max-w-[140px] truncate">{{ request.providerName }}</span>
      </div>
      <Separator />
      <div class="flex justify-between">
        <span class="text-muted-foreground">耗时</span>
        <span class="font-medium text-foreground">{{ elapsedText }}s</span>
      </div>
      <Separator />
      <div class="flex justify-between">
        <span class="text-muted-foreground">TTFT</span>
        <span class="font-medium text-foreground">
          {{ request.streamMetrics?.ttftMs != null ? `${request.streamMetrics.ttftMs.toFixed(0)}ms` : '--' }}
        </span>
      </div>
      <Separator />
      <div class="flex justify-between">
        <span class="text-muted-foreground">Input Tokens</span>
        <span class="font-medium text-foreground">{{ request.streamMetrics?.inputTokens ?? '--' }}</span>
      </div>
      <Separator />
      <div class="flex justify-between">
        <span class="text-muted-foreground">Output Tokens</span>
        <span class="font-medium text-foreground">
          {{ request.streamMetrics?.outputTokens != null ? request.streamMetrics.outputTokens : '--' }}
        </span>
      </div>
      <Separator />
      <div class="flex justify-between">
        <span class="text-muted-foreground">速度</span>
        <span class="font-medium text-foreground">{{ speedText }}</span>
      </div>
    </div>

    <!-- 状态标签 -->
    <div v-if="request.streamMetrics?.isComplete" class="flex items-center gap-1.5">
      <Badge variant="secondary">已完成</Badge>
      <Badge v-if="request.streamMetrics.stopReason" variant="outline">
        {{ request.streamMetrics.stopReason }}
      </Badge>
    </div>
    <div v-else-if="request.status === 'pending'" class="flex items-center gap-1.5">
      <Badge>进行中</Badge>
    </div>

    <!-- 尝试历史 -->
    <div v-if="request.attempts.length > 0">
      <p class="text-xs text-muted-foreground mb-1">尝试历史</p>
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

    <!-- 查看完整日志 -->
    <div v-if="request.status === 'completed' || request.status === 'failed'" class="pt-2">
      <Button variant="outline" size="sm" class="w-full" @click="$emit('viewDetail', request.id)">
        查看完整日志
      </Button>
    </div>
  </div>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { ActiveRequest } from '@/types/monitor'

const props = defineProps<{
  request: ActiveRequest | null
}>()

defineEmits<{
  viewDetail: [id: string]
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
