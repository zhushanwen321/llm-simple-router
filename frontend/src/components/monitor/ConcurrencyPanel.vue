<template>
  <div class="space-y-3">
    <div v-if="providers.length === 0" class="text-sm text-muted-foreground">
      暂无并发数据
    </div>
    <div
      v-for="provider in providers"
      :key="provider.providerId"
      class="space-y-1"
    >
      <div class="flex items-center justify-between text-sm">
        <span class="font-medium text-foreground">{{ provider.providerName }}</span>
        <span class="text-muted-foreground">
          <template v-if="provider.adaptiveEnabled">
            {{ provider.active }} / {{ provider.adaptiveLimit ?? provider.maxConcurrency }}
            <span class="text-xs">(自适应)</span>
          </template>
          <template v-else-if="provider.maxConcurrency === 0">未限制</template>
          <template v-else>{{ provider.active }} / {{ provider.maxConcurrency }}</template>
        </span>
      </div>

      <!-- 进度条 -->
      <div v-if="provider.maxConcurrency > 0" class="h-2 bg-muted rounded-full overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-300"
          :class="barColor(provider.active, effectiveLimit(provider))"
          :style="{ width: `${Math.min(100, (provider.active / effectiveLimit(provider)) * 100)}%` }"
        />
      </div>

      <!-- 队列信息 -->
      <div v-if="provider.maxConcurrency > 0" class="flex gap-3 text-xs text-muted-foreground">
        <span>排队: {{ provider.queued }}</span>
        <span>队列上限: {{ provider.adaptiveLimit ?? provider.maxQueueSize }}</span>
      </div>
    </div>
  </div>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import type { ProviderConcurrencySnapshot } from '@/types/monitor'

defineProps<{
  providers: ProviderConcurrencySnapshot[]
}>()

function effectiveLimit(provider: ProviderConcurrencySnapshot): number {
  return provider.adaptiveLimit ?? provider.maxConcurrency
}

function barColor(active: number, max: number): string {
  const ratio = active / max
  if (ratio >= 1) return 'bg-red-500'
  if (ratio >= 0.8) return 'bg-orange-500'
  if (ratio >= 0.5) return 'bg-yellow-500'
  return 'bg-green-500'
}
</script>
