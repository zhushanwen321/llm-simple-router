<template>
  <div v-if="!isStream || !metrics" class="text-sm text-muted-foreground py-2 text-center">
    非流式请求
  </div>
  <div v-else class="space-y-2">
    <p class="text-xs text-muted-foreground">流式指标</p>
    <div class="grid grid-cols-2 gap-2 text-sm">
      <div class="bg-muted/50 rounded px-2 py-1.5">
        <p class="text-xs text-muted-foreground">Input Tokens</p>
        <p class="font-medium text-foreground">{{ metrics.inputTokens ?? '--' }}</p>
      </div>
      <div class="bg-muted/50 rounded px-2 py-1.5">
        <p class="text-xs text-muted-foreground">Output Tokens</p>
        <p class="font-medium text-foreground">{{ metrics.outputTokens ?? '--' }}</p>
      </div>
      <div class="bg-muted/50 rounded px-2 py-1.5">
        <p class="text-xs text-muted-foreground">TTFT</p>
        <p class="font-medium text-foreground">
          {{ metrics.ttftMs != null ? `${metrics.ttftMs.toFixed(0)}ms` : '--' }}
        </p>
      </div>
      <div class="bg-muted/50 rounded px-2 py-1.5">
        <p class="text-xs text-muted-foreground">状态</p>
        <div class="flex items-center gap-1.5 mt-0.5">
          <Badge :variant="metrics.isComplete ? 'secondary' : 'default'">
            {{ metrics.isComplete ? '已完成' : '进行中' }}
          </Badge>
          <Badge v-if="metrics.stopReason" variant="outline">
            {{ metrics.stopReason }}
          </Badge>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Badge } from '@/components/ui/badge'

interface StreamMetricsSnapshot {
  inputTokens: number | null
  outputTokens: number | null
  ttftMs: number | null
  stopReason: string | null
  isComplete: boolean
}

defineProps<{
  metrics: StreamMetricsSnapshot | null
  isStream: boolean
}>()
</script>
