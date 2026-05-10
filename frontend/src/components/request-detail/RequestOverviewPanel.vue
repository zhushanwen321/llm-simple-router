<template>
  <div class="space-y-3">
    <!-- Toggle: structured / raw -->
    <div class="flex items-center justify-between">
      <span class="text-xs font-medium text-muted-foreground">{{ t('requestDetail.overviewTitle') }}</span>
      <Button size="sm" variant="outline" class="h-6 gap-1 text-xs" @click="showRaw = !showRaw">
        <component :is="showRaw ? FileText : FileJson" class="h-3 w-3" />
        {{ showRaw ? t('requestDetail.structured') : t('requestDetail.rawData') }}
      </Button>
    </div>

    <!-- Raw JSON view: upstream response metadata (headers + response body minus content) -->
    <ScrollArea v-if="showRaw" class="rounded-md border flex-1">
      <pre class="p-3 text-[11px] whitespace-pre-wrap break-words">{{ responseMetadataJson }}</pre>
    </ScrollArea>

    <!-- Structured view (below) -->
    <template v-if="!showRaw">

    <!-- Row 1: model @ provider -->
    <div class="flex items-baseline gap-1 min-w-0">
      <span class="font-mono text-[11px] font-semibold truncate min-w-0">{{ overview.model }}</span>
      <span class="text-[10px] text-muted-foreground flex-shrink-0">@ {{ overview.providerName || t('requestDetail.unknownProvider') }}</span>
    </div>

    <!-- Row 2: status + SSE + apiType -->
    <div class="flex items-center gap-1.5">
      <Badge v-if="statusColor === 'pending'" variant="outline" class="border-warning/30 bg-warning-light text-warning-dark">
        <span class="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
        {{ t('requestDetail.pending') }}
      </Badge>
      <Badge v-else-if="statusColor === 'error'" variant="outline" class="border-danger/30 bg-danger-light text-danger-dark">
        {{ overview.statusCode ?? t('requestDetail.failed') }}
      </Badge>
      <Badge v-else variant="outline" class="border-success/30 bg-success-light text-success-dark">
        <span class="w-1.5 h-1.5 rounded-full bg-success" />
        {{ t('requestDetail.completed') }}
      </Badge>

      <Badge variant="outline">{{ overview.isStream ? 'SSE' : t('requestDetail.nonStream') }}</Badge>
      <Badge variant="outline">{{ overview.apiType }}</Badge>
    </div>

    <!-- Row 3: session (conditional) -->
    <div v-if="overview.sessionId" class="flex items-center gap-1.5">
      <Badge variant="secondary" class="text-[10px]">Session</Badge>
      <span class="font-mono text-[11px] text-muted-foreground truncate">{{ overview.sessionId.slice(0, 8) }}</span>
    </div>

    <!-- Metrics grid -->
    <div class="grid grid-cols-2 gap-1.5">
      <div class="bg-muted/50 rounded-md px-2 py-1.5 min-w-0">
        <div class="text-[10px] text-muted-foreground">{{ t('requestDetail.latency') }}</div>
        <div class="text-sm font-semibold truncate">{{ latencyText }}</div>
      </div>
      <div class="bg-muted/50 rounded-md px-2 py-1.5 min-w-0">
        <div class="text-[10px] text-muted-foreground">{{ t('requestDetail.ttft') }}</div>
        <div class="text-sm font-semibold truncate">{{ overview.ttftMs != null ? `${overview.ttftMs}ms` : '--' }}</div>
      </div>
      <div class="bg-muted/50 rounded-md px-2 py-1.5 min-w-0">
        <div class="text-[10px] text-muted-foreground">{{ overview.inputTokensEstimated ? t('requestDetail.estInputTokens') : t('requestDetail.inputTokens') }}</div>
        <div class="text-sm font-semibold truncate">{{ overview.inputTokens != null ? overview.inputTokens : '--' }}</div>
      </div>
      <div class="bg-muted/50 rounded-md px-2 py-1.5 min-w-0">
        <div class="text-[10px] text-muted-foreground">{{ t('requestDetail.outputTokens') }}</div>
        <div class="text-sm font-semibold truncate" :class="isOutputPending ? 'diff-added' : ''">{{ outputTokenText }}</div>
      </div>
      <div class="bg-muted/50 rounded-md px-2 py-1.5 min-w-0">
        <div class="text-[10px] text-muted-foreground">{{ t('requestDetail.speed') }}</div>
        <div class="text-sm font-semibold truncate">{{ speedText }}</div>
      </div>
      <div class="bg-muted/50 rounded-md px-2 py-1.5 min-w-0">
        <div class="text-[10px] text-muted-foreground">{{ t('requestDetail.cacheRead') }}</div>
        <div class="text-sm font-semibold truncate">{{ overview.cacheReadTokens != null ? overview.cacheReadTokens : '--' }}</div>
      </div>
    </div>

    <!-- Cache source -->
    <div v-if="overview.cacheReadTokens != null && overview.cacheReadTokens > 0" class="rounded-md px-2 py-1.5 bg-muted/50">
      <div class="text-[10px] text-muted-foreground">{{ t('requestDetail.cacheSource') }}</div>
      <div
        v-if="overview.cacheReadTokensEstimated === 0"
        class="text-[11px] font-semibold text-success-dark"
      >
        {{ t('requestDetail.cacheSourceApi') }}
      </div>
      <div
        v-else
        class="text-[11px] font-semibold text-warning-dark"
      >
        {{ t('requestDetail.cacheSourceEstimated') }}
      </div>
    </div>

    <Separator />

    <!-- Attempt history -->
    <div class="space-y-1.5">
      <span class="text-[10px] text-muted-foreground uppercase tracking-wider">{{ t('requestDetail.attemptHistory') }}</span>
      <div v-if="overview.attempts.length === 0" class="text-[11px] text-muted-foreground">{{ t('requestDetail.noRetry') }}</div>
      <div
        v-for="(attempt, i) in overview.attempts"
        :key="i"
        class="flex items-center gap-1 text-[11px]"
      >
        <span class="text-muted-foreground">#{{ i + 1 }}</span>
        <span :class="isAttemptError(attempt.statusCode) ? 'diff-removed' : 'diff-added'">
          {{ attempt.statusCode ?? '--' }}
        </span>
        <span class="text-muted-foreground">{{ (attempt.latencyMs / MS_PER_SECOND).toFixed(1) }}s</span>
      </div>
    </div>

    <Separator />

    <!-- Metadata -->
    <div class="space-y-1">
      <div v-if="overview.clientType != null" class="flex items-center justify-between text-[11px]">
        <span class="text-muted-foreground">{{ t('requestDetail.clientType') }}</span>
        <span class="font-mono">{{ clientTypeLabel }}</span>
      </div>
      <div v-if="overview.statusCode != null" class="flex items-center justify-between text-[11px]">
        <span class="text-muted-foreground">{{ t('requestDetail.statusCodeLabel') }}</span>
        <span class="font-mono">{{ overview.statusCode }}</span>
      </div>
      <div v-if="overview.clientIp" class="flex items-center justify-between text-[11px]">
        <span class="text-muted-foreground">{{ t('requestDetail.clientIp') }}</span>
        <span class="font-mono truncate max-w-[160px]">{{ overview.clientIp }}</span>
      </div>
    </div>

    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UnifiedRequestOverview } from './types'
import { MS_PER_SECOND, HTTP_ERROR_THRESHOLD } from './types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileJson, FileText } from 'lucide-vue-next'
import { Separator } from '@/components/ui/separator'
import { extractResponseMetadata } from './upstream-merge'

const { t } = useI18n()

const JSON_INDENT = 2

const props = defineProps<{ overview: UnifiedRequestOverview }>()

const showRaw = ref(false)

const clientTypeLabel = computed(() => {
  const ct = props.overview.clientType
  if (ct === 'claude-code') return 'Claude Code'
  if (ct === 'pi') return 'Pi'
  return 'Unknown'
})

const responseMetadataJson = computed(() => {
  const result = extractResponseMetadata(
    props.overview.upstreamResponse,
    props.overview.responseBody,
  )
  return result || JSON.stringify({
    latencyMs: props.overview.latencyMs,
    ttftMs: props.overview.ttftMs,
    inputTokens: props.overview.inputTokens,
    outputTokens: props.overview.outputTokens,
    tokensPerSecond: props.overview.tokensPerSecond,
    cacheReadTokens: props.overview.cacheReadTokens,
    cacheWriteTokens: props.overview.cacheWriteTokens,
    stopReason: props.overview.stopReason,
    statusCode: props.overview.statusCode,
  }, null, JSON_INDENT)
})

const statusColor = computed(() => {
  if (props.overview.status === 'pending') return 'pending'
  const code = props.overview.statusCode
  if (props.overview.status === 'failed' || (code != null && code >= HTTP_ERROR_THRESHOLD)) return 'error'
  return 'success'
})

const isOutputPending = computed(
  () => props.overview.status === 'pending' && props.overview.outputTokens != null,
)

const outputTokenText = computed(() => {
  const val = props.overview.outputTokens
  if (val == null) return '--'
  return isOutputPending.value ? `+${val}` : `${val}`
})

const latencyText = computed(() => {
  if (props.overview.status === 'pending' && props.overview.latencyMs == null) return '...'
  if (props.overview.latencyMs == null) return '--'
  return `${(props.overview.latencyMs / MS_PER_SECOND).toFixed(1)}s`
})

const speedText = computed(() => {
  if (props.overview.tokensPerSecond != null) {
    return `${props.overview.tokensPerSecond.toFixed(1)}`
  }
  const { outputTokens, latencyMs } = props.overview
  if (outputTokens && latencyMs) {
    return `${((outputTokens / latencyMs) * MS_PER_SECOND).toFixed(1)}`
  }
  return '--'
})

function isAttemptError(statusCode: number | null): boolean {
  return statusCode != null && statusCode >= HTTP_ERROR_THRESHOLD
}
</script>
