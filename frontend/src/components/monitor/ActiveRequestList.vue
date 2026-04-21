<template>
  <div class="space-y-4">
    <!-- 活跃请求 -->
    <div>
      <h4 class="text-sm font-medium text-foreground mb-2">
        进行中
        <Badge variant="secondary" class="ml-1">{{ requests.length }}</Badge>
      </h4>
      <ScrollArea class="h-64">
        <div v-if="requests.length === 0" class="text-sm text-muted-foreground py-2">
          暂无活跃请求
        </div>
        <div
          v-for="req in requests"
          :key="req.id"
          class="flex items-center gap-2 py-2 px-2 rounded cursor-pointer hover:bg-muted/50 transition-colors"
          :class="{ 'bg-muted': selectedId === req.id }"
          @click="emit('select', req.id)"
        >
          <Badge :variant="statusVariant(req.status)" class="shrink-0">
            {{ statusLabel(req.status) }}
          </Badge>
          <span class="text-sm text-foreground truncate flex-1">{{ req.model }}</span>
          <span class="text-xs text-muted-foreground shrink-0">{{ req.providerName }}</span>
          <span class="text-xs text-muted-foreground shrink-0">{{ elapsed(req.startTime) }}s</span>
          <Badge v-if="req.isStream" variant="outline" class="shrink-0 text-xs">SSE</Badge>
        </div>
      </ScrollArea>
    </div>

    <!-- 最近完成 -->
    <div v-if="recentCompleted.length > 0">
      <h4 class="text-sm font-medium text-foreground mb-2">
        最近完成
        <Badge variant="secondary" class="ml-1">{{ recentCompleted.length }}</Badge>
      </h4>
      <ScrollArea class="h-48">
        <div
          v-for="req in recentCompleted"
          :key="req.id"
          class="flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer opacity-60 hover:opacity-80 hover:bg-muted/50 transition-colors"
          :class="{ 'bg-muted': selectedId === req.id }"
          @click="emit('select', req.id)"
        >
          <Badge :variant="statusVariant(req.status)" class="shrink-0">
            {{ statusLabel(req.status) }}
          </Badge>
          <span class="text-sm text-foreground truncate flex-1">{{ req.model }}</span>
          <span class="text-xs text-muted-foreground shrink-0">{{ req.providerName }}</span>
          <Badge v-if="req.isStream" variant="outline" class="shrink-0 text-xs">SSE</Badge>
        </div>
      </ScrollArea>
    </div>
  </div>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { ActiveRequest } from '@/types/monitor'

defineProps<{
  requests: ActiveRequest[]
  recentCompleted: ActiveRequest[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

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

function elapsed(startTime: number): string {
  return ((Date.now() - startTime) / 1000).toFixed(1)
}
</script>
