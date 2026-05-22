<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="flex items-stretch bg-primary/10 rounded-lg overflow-hidden mb-3">
    <!-- Left: Active count + stream/sync breakdown + queue badge -->
    <div class="flex flex-col justify-center px-5 py-3 min-w-[180px]">
      <span class="text-2xl font-bold text-primary font-mono">
        {{ activeCount }}
      </span>
      <span class="text-xs text-muted-foreground mt-0.5">
        {{ t('monitor.header.streamNonStream', { stream: streamCount, nonStream: activeCount - streamCount }) }}
      </span>
      <Badge
        v-if="queuedCount > 0"
        variant="outline"
        class="mt-1.5 w-fit text-warning border-warning/40 bg-warning/10 text-xs"
      >
        {{ queuedCount }} {{ t('monitor.queued') }}
      </Badge>
    </div>

    <!-- Right: Provider concurrency bars -->
    <div class="flex-1 border-l border-border/50 px-4 py-3 space-y-1.5">
      <div v-if="concurrency.length === 0" class="text-xs text-muted-foreground py-2">
        {{ t('monitor.concurrencyPanel.noData') }}
      </div>
      <div
        v-for="provider in concurrency"
        :key="provider.providerId"
        class="flex items-center gap-3"
      >
        <span class="text-xs text-muted-foreground truncate w-28 shrink-0" :title="provider.providerName">
          {{ provider.providerName }}
        </span>
        <div class="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div
            v-if="effectiveLimit(provider) > 0"
            class="h-full rounded-full transition-all duration-300"
            :class="barClass(provider.active, effectiveLimit(provider))"
            :style="{ width: `${Math.min(100, (provider.active / effectiveLimit(provider)) * 100)}%` }"
          />
        </div>
        <span class="text-xs font-mono text-muted-foreground shrink-0 w-16 text-right">
          <template v-if="provider.adaptiveEnabled">
            {{ provider.active }}/{{ provider.adaptiveLimit ?? provider.maxConcurrency }}
          </template>
          <template v-else-if="provider.maxConcurrency === 0">
            {{ t('monitor.concurrencyPanel.unlimited') }}
          </template>
          <template v-else>
            {{ provider.active }}/{{ provider.maxConcurrency }}
          </template>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import type { StatsSnapshot, ProviderConcurrencySnapshot } from '@/types/monitor'

const { t } = useI18n()

defineProps<{
  stats: StatsSnapshot | null
  activeCount: number
  streamCount: number
  queuedCount: number
  concurrency: ProviderConcurrencySnapshot[]
}>()

function effectiveLimit(provider: ProviderConcurrencySnapshot): number {
  return provider.adaptiveLimit ?? provider.maxConcurrency
}

function barClass(active: number, max: number): string {
  const CONCURRENCY_WARNING_THRESHOLD = 0.5
  const CONCURRENCY_DANGER_THRESHOLD = 0.8
  const ratio = max > 0 ? active / max : 0
  if (ratio >= CONCURRENCY_DANGER_THRESHOLD) return 'bg-danger'
  if (ratio >= CONCURRENCY_WARNING_THRESHOLD) return 'bg-warning'
  return 'bg-primary'
}
</script>
