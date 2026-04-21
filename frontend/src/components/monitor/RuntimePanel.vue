<template>
  <div v-if="!runtime" class="text-sm text-muted-foreground">暂无运行时数据</div>
  <div v-else class="grid grid-cols-2 gap-3 text-sm">
    <!-- 运行时间 -->
    <div>
      <p class="text-muted-foreground">运行时间</p>
      <p class="font-medium text-foreground">{{ formatUptime(runtime.uptimeMs) }}</p>
    </div>

    <!-- 内存 RSS -->
    <div>
      <p class="text-muted-foreground">内存 RSS</p>
      <p class="font-medium text-foreground">{{ formatBytes(runtime.memoryUsage.rss) }}</p>
    </div>

    <!-- Heap 使用率 -->
    <div class="col-span-2">
      <div class="flex items-center justify-between">
        <p class="text-muted-foreground">Heap 使用</p>
        <p class="text-muted-foreground">
          {{ formatBytes(runtime.memoryUsage.heapUsed) }} / {{ formatBytes(runtime.memoryUsage.heapTotal) }}
        </p>
      </div>
      <div class="h-2 bg-muted rounded-full overflow-hidden mt-1">
        <div
          class="h-full bg-blue-500 rounded-full transition-all duration-300"
          :style="{ width: `${heapPercent}%` }"
        />
      </div>
    </div>

    <!-- Active handles -->
    <div>
      <p class="text-muted-foreground">Active Handles</p>
      <p class="font-medium text-foreground">{{ runtime.activeHandles }}</p>
    </div>

    <!-- Active requests -->
    <div>
      <p class="text-muted-foreground">Active Requests</p>
      <p class="font-medium text-foreground">{{ runtime.activeRequests }}</p>
    </div>

    <!-- Event loop delay -->
    <div class="col-span-2">
      <p class="text-muted-foreground">Event Loop 延迟</p>
      <p class="font-medium text-foreground">{{ runtime.eventLoopDelayMs.toFixed(2) }}ms</p>
    </div>
  </div>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { computed } from 'vue'
import type { RuntimeMetrics } from '@/types/monitor'

const props = defineProps<{
  runtime: RuntimeMetrics | null
}>()

const heapPercent = computed(() => {
  if (!props.runtime || props.runtime.memoryUsage.heapTotal === 0) return 0
  return Math.min(100, (props.runtime.memoryUsage.heapUsed / props.runtime.memoryUsage.heapTotal) * 100)
})

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}h ${minutes}m ${seconds}s`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
</script>
