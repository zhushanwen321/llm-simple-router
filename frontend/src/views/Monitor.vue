<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <!-- Page Header -->
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-lg font-semibold text-foreground">
        {{ t('monitor.title') }}
      </h2>
      <Badge :variant="connected ? 'default' : 'destructive'">
        {{ connected ? t('monitor.connected') : t('monitor.disconnected') }}
      </Badge>
    </div>

    <!-- Primary Strip: Active count + Provider concurrency -->
    <MonitorHeader
      :stats="stats"
      :active-count="activeRequests.length"
      :stream-count="streamCount"
      :queued-count="queuedRequests.length"
      :concurrency="concurrency"
    />

    <!-- Request Panel with Tabs -->
    <div class="bg-card ring-1 ring-foreground/10 rounded-lg overflow-hidden mb-3">
      <!-- Tab bar -->
      <div class="flex border-b border-border bg-background">
        <button
          v-for="tab in requestTabs"
          :key="tab.key"
          class="px-4 py-2 text-sm font-medium transition-colors relative"
          :class="[
            activeTab === tab.key
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          ]"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span class="ml-1.5 font-mono text-xs">({{ tab.count }})</span>
          <span
            v-if="activeTab === tab.key"
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
          />
        </button>
      </div>

      <!-- Table content -->
      <ScrollArea class="max-h-[380px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-2" />
              <TableHead>Model</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead class="w-12">Type</TableHead>
              <TableHead class="w-16 text-right">Elapsed</TableHead>
              <TableHead class="w-16 text-right">TPS</TableHead>
              <TableHead class="w-16 text-right">Output</TableHead>
              <TableHead class="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="currentRequests.length === 0">
              <TableRow>
                <TableCell colspan="8" class="text-center text-sm text-muted-foreground py-8">
                  {{ emptyMessage }}
                </TableCell>
              </TableRow>
            </template>
            <template v-for="req in currentRequests" :key="req.id">
              <TableRow
                class="cursor-pointer transition-colors"
                :class="[
                  selectedRequestId === req.id ? 'bg-muted' : 'hover:bg-muted/50',
                  activeTab === 'recent' ? 'opacity-60 hover:opacity-80' : '',
                ]"
                @click="selectRequest(req.id)"
              >
                <!-- Status dot -->
                <TableCell>
                  <span
                    class="inline-block size-2 rounded-full shrink-0"
                    :class="statusDotClass(req)"
                  />
                </TableCell>
                <TableCell class="text-sm truncate max-w-[200px]">
                  {{ req.model }}
                </TableCell>
                <TableCell class="font-mono text-xs text-muted-foreground">
                  {{ req.providerName }}
                </TableCell>
                <TableCell>
                  <Badge
                    v-if="req.isStream"
                    variant="secondary"
                    class="text-xs"
                  >
                    SSE
                  </Badge>
                  <Badge v-else variant="outline" class="text-xs">Sync</Badge>
                </TableCell>
                <TableCell class="text-right font-mono text-xs text-muted-foreground">
                  {{ rowElapsed(req) }}
                </TableCell>
                <TableCell class="text-right font-mono text-xs text-muted-foreground">
                  {{ rowTps(req) }}
                </TableCell>
                <TableCell class="text-right font-mono text-xs text-muted-foreground">
                  {{ rowOutputTokens(req) }}
                </TableCell>
                <TableCell>
                  <div class="flex items-center gap-0.5 justify-end" @click.stop>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          class="shrink-0"
                          @click.stop="copyId(req.id)"
                        >
                          <CheckIcon v-if="copiedId === req.id" class="size-3 text-success" />
                          <CopyIcon v-else class="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{{ t('monitor.copyId') }}</TooltipContent>
                    </Tooltip>
                    <Tooltip v-if="isKillable(req)">
                      <TooltipTrigger as-child>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          class="shrink-0 text-destructive hover:text-destructive"
                          @click.stop="openKillDialog(req.id)"
                        >
                          <XIcon class="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{{ t('monitor.kill') }}</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      class="shrink-0"
                      @click.stop="toggleRowExpand(req.id)"
                    >
                      <ChevronDownIcon
                        class="size-3 transition-transform"
                        :class="{ 'rotate-180': expandedRowId === req.id }"
                      />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>

              <!-- Expanded detail row -->
              <TableRow v-if="expandedRowId === req.id" class="bg-muted/30">
                <TableCell colspan="8" class="px-6 py-2">
                  <div class="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <span class="text-muted-foreground">Request ID:</span>
                      <span class="ml-1.5 font-mono">{{ req.id }}</span>
                    </div>
                    <div>
                      <span class="text-muted-foreground">Input Tokens:</span>
                      <span class="ml-1.5 font-mono">{{ req.streamMetrics?.inputTokens ?? '--' }}</span>
                    </div>
                    <div>
                      <span class="text-muted-foreground">Output Tokens:</span>
                      <span class="ml-1.5 font-mono">{{ req.streamMetrics?.outputTokens ?? '--' }}</span>
                    </div>
                    <div>
                      <span class="text-muted-foreground">Cache Tokens:</span>
                      <span class="ml-1.5 font-mono">{{ req.streamMetrics?.cacheReadTokens ?? '--' }}</span>
                    </div>
                    <div>
                      <span class="text-muted-foreground">TTFT:</span>
                      <span class="ml-1.5 font-mono">{{ req.streamMetrics?.ttftMs != null ? `${req.streamMetrics.ttftMs.toFixed(0)}ms` : '--' }}</span>
                    </div>
                    <div>
                      <span class="text-muted-foreground">Retry:</span>
                      <span class="ml-1.5 font-mono">{{ req.retryCount }}</span>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            </template>
          </TableBody>
        </Table>
      </ScrollArea>
    </div>

    <!-- Secondary Strip -->
    <div class="flex bg-card ring-1 ring-foreground/10 rounded-lg overflow-hidden mb-3 divide-x divide-border">
      <div class="flex-1 px-3 py-2">
        <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{{ t('monitor.completed') }}</div>
        <div class="text-[13px] font-mono font-semibold text-success">{{ stats?.successCount ?? 0 }}</div>
        <div class="text-[10px] font-mono text-muted-foreground">last 5h</div>
      </div>
      <div class="flex-1 px-3 py-2">
        <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{{ t('monitor.header.errorRate') }}</div>
        <div class="text-[13px] font-mono font-semibold" :class="errorRateClass">{{ errorRate }}%</div>
        <div class="text-[10px] font-mono text-muted-foreground">{{ stats?.errorCount ?? 0 }} / {{ stats?.totalRequests ?? 0 }}</div>
      </div>
      <div class="flex-1 px-3 py-2">
        <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{{ t('monitor.header.p50Latency') }}</div>
        <div class="text-[13px] font-mono font-semibold text-foreground">{{ p50Latency }}ms</div>
        <div class="text-[10px] font-mono text-muted-foreground">avg {{ stats?.avgLatencyMs?.toFixed(1) ?? '--' }}s</div>
      </div>
      <div class="flex-1 px-3 py-2">
        <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{{ t('monitor.header.retryRate') }}</div>
        <div class="text-[13px] font-mono font-semibold text-foreground">{{ retryRate }}%</div>
        <div class="text-[10px] font-mono text-muted-foreground">{{ stats?.retryCount ?? 0 }} / {{ stats?.totalRequests ?? 0 }}</div>
      </div>
      <div class="flex-1 px-3 py-2">
        <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{{ t('monitor.runtimePanel.uptime') }}</div>
        <div class="text-[13px] font-mono font-semibold text-foreground">{{ uptimeText }}</div>
        <div class="text-[10px] font-mono text-muted-foreground">{{ uptimeSinceText }}</div>
      </div>
    </div>

    <!-- Provider Stats (collapsible) -->
    <div class="mb-3">
      <Collapsible v-model:open="providerStatsOpen">
        <div class="flex items-center bg-card ring-1 ring-foreground/10 rounded-t-lg px-4 py-2">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" size="xs" class="gap-1">
              <ChevronRightIcon class="size-3 transition-transform" :class="{ 'rotate-90': providerStatsOpen }" />
              <span class="text-sm font-medium text-foreground">{{ t('monitor.providerStats') }}</span>
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div class="bg-card ring-1 ring-foreground/10 ring-t-0 rounded-b-lg px-4 py-3">
            <ProviderStatsTable :stats="stats" />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>

    <!-- Bottom Grid -->
    <div class="grid grid-cols-3 gap-px bg-border rounded-lg overflow-hidden">
      <div class="bg-card p-4">
        <h3 class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{{ t('monitor.statusCodeDistribution') }}</h3>
        <StatusCodePanel :by-status-code="stats?.byStatusCode ?? {}" />
      </div>
      <div class="bg-card p-4">
        <h3 class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{{ t('monitor.runtime') }}</h3>
        <RuntimePanel :runtime="runtime" />
      </div>
      <!-- Global Concurrency (compact summary) -->
      <div class="bg-card p-4">
        <h3 class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">{{ t('monitor.concurrency') }}</h3>
        <div class="flex items-baseline gap-1.5 mb-2">
          <span class="text-xl font-mono font-bold text-primary">{{ globalConcurrency.active }}</span>
          <span class="text-xs font-mono text-muted-foreground">/ {{ globalConcurrency.total }}</span>
          <span class="text-xs font-mono text-muted-foreground ml-auto">{{ globalConcurrency.pct }}%</span>
        </div>
        <div class="h-1 bg-foreground/10 rounded-full overflow-hidden mb-3">
          <div
            class="h-full rounded-full transition-all duration-300"
            :class="globalConcurrencyBarClass"
            :style="{ width: `${Math.min(100, globalConcurrency.pct)}%` }"
          />
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div>
            <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">P50</div>
            <div class="text-xs font-mono text-success">{{ p50Latency }}ms</div>
          </div>
          <div>
            <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">P99</div>
            <div class="text-xs font-mono text-warning">{{ p99Latency }}ms</div>
          </div>
          <div>
            <div class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">QPS</div>
            <div class="text-xs font-mono text-primary">{{ qps }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Unified Request Detail Dialog -->
    <UnifiedRequestDialog
      v-model:open="requestDetailOpen"
      source="realtime"
      :request="selectedRequest"
      :stream-content="selectedStreamContent"
      :log-detail-data="logDetailData"
    />

    <!-- Kill Confirmation Dialog -->
    <AlertDialog v-model:open="killDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('monitor.killConfirmTitle') }}</AlertDialogTitle>
          <AlertDialogDescription v-if="killTarget">
            {{ t('monitor.killConfirm', { model: killTarget.model, provider: killTarget.providerName }) }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('monitor.killCancel') }}</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            @click="executeKill"
          >
            {{ t('monitor.kill') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, XIcon } from 'lucide-vue-next'
import { api, getApiMessage } from '@/api/client'
import { toast } from 'vue-sonner'
import MonitorHeader from '@/components/monitor/MonitorHeader.vue'
import RuntimePanel from '@/components/monitor/RuntimePanel.vue'
import StatusCodePanel from '@/components/monitor/StatusCodePanel.vue'
import ProviderStatsTable from '@/components/monitor/ProviderStatsTable.vue'
import UnifiedRequestDialog from '@/components/request-detail/UnifiedRequestDialog.vue'
import { useMonitorSSE } from '@/composables/useMonitorSSE'
import { useMonitorData } from '@/composables/useMonitorData'
import { useClipboard } from '@/composables/useClipboard'
import type { ActiveRequest } from '@/types/monitor'

const { t } = useI18n()

// --- Data layer ---
const {
  activeRequests,
  recentCompleted,
  stats,
  concurrency,
  runtime,
  connected,
  streamCount,
  streamingRequests,
  queuedRequests,
  selectedRequestId,
  selectedRequest,
  requestDetailOpen,
  selectRequest,
  selectedStreamContent,
  logDetailData,
  handleSSEMessage,
  handleSSEOpen,
  handleSSEClose,
  loadInitialData,
} = useMonitorData()

// --- SSE lifecycle ---
const { connect } = useMonitorSSE(
  '/admin/api/monitor/stream',
  {
    request_start: handleSSEMessage,
    request_update: handleSSEMessage,
    request_complete: handleSSEMessage,
    concurrency_update: handleSSEMessage,
    stats_update: handleSSEMessage,
    runtime_update: handleSSEMessage,
    stream_content_update: handleSSEMessage,
  },
  { onOpen: handleSSEOpen, onClose: handleSSEClose },
)

// --- Tab state ---
type RequestTab = 'active' | 'queued' | 'recent'
const activeTab = ref<RequestTab>('active')

const requestTabs = computed(() => [
  { key: 'active' as RequestTab, label: t('monitor.activeRequests'), count: streamingRequests.value.length },
  { key: 'queued' as RequestTab, label: t('monitor.queuedRequests'), count: queuedRequests.value.length },
  { key: 'recent' as RequestTab, label: t('monitor.completed'), count: recentCompleted.value.length },
])

const TAB_DATA: Record<RequestTab, () => ActiveRequest[]> = {
  active: () => streamingRequests.value,
  queued: () => queuedRequests.value,
  recent: () => recentCompleted.value,
}

const TAB_EMPTY: Record<RequestTab, string> = {
  active: t('monitor.noActiveRequests'),
  queued: t('monitor.noQueuedRequests'),
  recent: t('monitor.noCompletedRequests'),
}

const currentRequests = computed(() => TAB_DATA[activeTab.value]())
const emptyMessage = computed(() => TAB_EMPTY[activeTab.value])

// --- Row expand ---
const expandedRowId = ref<string | null>(null)

function toggleRowExpand(id: string) {
  expandedRowId.value = expandedRowId.value === id ? null : id
}

// --- Clipboard ---
const { copy } = useClipboard()
const copiedId = ref<string | null>(null)
const COPY_FEEDBACK_MS = 2000

function copyId(id: string) {
  copy(id)
  copiedId.value = id
  setTimeout(() => {
    if (copiedId.value === id) copiedId.value = null
  }, COPY_FEEDBACK_MS)
}

// --- Kill request ---
const killDialogOpen = ref(false)
const killTargetId = ref<string | null>(null)
const killTarget = computed(() => {
  if (!killTargetId.value) return null
  return activeRequests.value.find((r) => r.id === killTargetId.value) ?? null
})

function openKillDialog(id: string) {
  killTargetId.value = id
  killDialogOpen.value = true
}

async function executeKill() {
  if (!killTargetId.value) return
  try {
    await api.killMonitorRequest(killTargetId.value)
    activeRequests.value = activeRequests.value.filter(
      (r) => r.id !== killTargetId.value,
    )
    toast.success(t('monitor.killSuccess'))
  } catch (e: unknown) {
    console.error('Monitor.killRequest:', e)
    toast.error(getApiMessage(e, t('monitor.killFailed')))
  }
  killDialogOpen.value = false
}

// --- Provider stats collapsible ---
const providerStatsOpen = ref(true)

// --- Secondary strip computed ---
const MS_PER_SECOND = 1000
const PERCENT_MULTIPLIER = 100
const ERROR_RATE_WARNING_THRESHOLD = 5
const ERROR_RATE_DANGER_THRESHOLD = 10

const errorRate = computed(() => {
  if (!stats.value || stats.value.totalRequests === 0) return '0.0'
  return ((stats.value.errorCount / stats.value.totalRequests) * PERCENT_MULTIPLIER).toFixed(1)
})

const errorRateClass = computed(() => {
  const rate = Number.parseFloat(errorRate.value)
  if (rate >= ERROR_RATE_DANGER_THRESHOLD) return 'text-danger'
  if (rate >= ERROR_RATE_WARNING_THRESHOLD) return 'text-warning'
  return 'text-foreground'
})

const retryRate = computed(() => {
  if (!stats.value || stats.value.totalRequests === 0) return '0.0'
  return ((stats.value.retryCount / stats.value.totalRequests) * PERCENT_MULTIPLIER).toFixed(1)
})

const p50Latency = computed(() => {
  if (!stats.value) return '--'
  return stats.value.p50LatencyMs.toFixed(0)
})

const p99Latency = computed(() => {
  if (!stats.value) return '--'
  return stats.value.p99LatencyMs.toFixed(0)
})

const qps = computed(() => {
  if (!stats.value || !runtime.value || runtime.value.uptimeMs === 0) return '--'
  const uptimeSec = runtime.value.uptimeMs / MS_PER_SECOND
  return (stats.value.totalRequests / uptimeSec).toFixed(1)
})

const PERCENT_BASE = 100
const CONCURRENCY_PCT_DANGER = 80
const CONCURRENCY_PCT_WARNING = 50

const globalConcurrency = computed(() => {
  const active = concurrency.value.reduce((sum, p) => sum + p.active, 0)
  const total = concurrency.value.reduce((sum, p) => sum + (p.adaptiveLimit ?? p.maxConcurrency), 0)
  const pct = total > 0 ? Math.round((active / total) * PERCENT_BASE) : 0
  return { active, total, pct }
})

const globalConcurrencyBarClass = computed(() => {
  const pct = globalConcurrency.value.pct
  if (pct >= CONCURRENCY_PCT_DANGER) return 'bg-danger'
  if (pct >= CONCURRENCY_PCT_WARNING) return 'bg-warning'
  return 'bg-primary'
})

const uptimeText = computed(() => {
  if (!runtime.value) return '--'
  return formatUptime(runtime.value.uptimeMs)
})

const uptimeSinceText = computed(() => {
  if (!runtime.value || !stats.value) return '--'
  return `${stats.value.totalRequests} req`
})

const MS_PER_HOUR = 3_600_000
const MS_PER_MINUTE = 60_000
const DAY_MS = 86_400_000

function formatUptime(ms: number): string {
  const days = Math.floor(ms / DAY_MS)
  const hours = Math.floor((ms % DAY_MS) / MS_PER_HOUR)
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// --- Elapsed / row helpers ---
const NOW_TICK_INTERVAL = 3000
const now = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

function startTick() {
  stopTick()
  tickTimer = setInterval(() => { now.value = Date.now() }, NOW_TICK_INTERVAL)
}

function stopTick() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
}

function handleMonitorVisibility() {
  if (document.hidden) { stopTick() } else { now.value = Date.now(); startTick() }
}

function rowElapsed(req: ActiveRequest): string {
  const end = req.completedAt ?? now.value
  return `${((end - req.startTime) / MS_PER_SECOND).toFixed(1)}s`
}

function rowTps(req: ActiveRequest): string {
  const tps = req.streamMetrics?.tokensPerSecond
  if (tps == null) return '--'
  return `${tps.toFixed(0)} t/s`
}

function rowOutputTokens(req: ActiveRequest): string {
  const tok = req.streamMetrics?.outputTokens
  if (tok == null) return '--'
  return `${tok}`
}

function statusDotClass(req: ActiveRequest): string {
  if (req.status === 'failed') return 'bg-danger'
  if (req.queued) return 'bg-warning'
  if (req.status === 'completed') return 'bg-success'
  return 'bg-primary'
}

function isKillable(req: ActiveRequest): boolean {
  return req.status === 'pending'
}

// --- Lifecycle ---
onMounted(async () => {
  await loadInitialData()
  connect()
  startTick()
  document.addEventListener('visibilitychange', handleMonitorVisibility)
})

onUnmounted(() => {
  stopTick()
  document.removeEventListener('visibilitychange', handleMonitorVisibility)
})
</script>
