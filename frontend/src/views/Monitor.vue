<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <!-- Header: connection status + overview stats -->
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">实时监控</h2>
      <div class="flex items-center gap-2">
        <Badge :variant="connected ? 'default' : 'destructive'">
          {{ connected ? '已连接' : '未连接' }}
        </Badge>
      </div>
    </div>

    <!-- Overview cards -->
    <MonitorHeader
      :stats="stats"
      :active-count="activeRequests.length"
      :stream-count="streamCount"
    />

    <!-- Middle: two-column layout -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      <!-- Left: Active request list -->
      <div class="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">活跃请求</CardTitle>
          </CardHeader>
          <CardContent>
            <ActiveRequestList
              :requests="activeRequests"
              :recent-completed="recentCompleted"
              :selected-id="selectedRequestId"
              @select="selectedRequestId = $event"
            />
          </CardContent>
        </Card>
      </div>

      <!-- Right: Request detail panel -->
      <div>
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">请求详情</CardTitle>
          </CardHeader>
          <CardContent>
            <RequestDetailPanel :request="selectedRequest" />
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Bottom panels: Concurrency + Status codes + Runtime -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card>
        <CardHeader>
          <CardTitle class="text-sm font-medium text-foreground">并发度</CardTitle>
        </CardHeader>
        <CardContent>
          <ConcurrencyPanel :providers="concurrency" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm font-medium text-foreground">状态码分布</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusCodePanel :by-status-code="stats?.byStatusCode ?? {}" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm font-medium text-foreground">运行时</CardTitle>
        </CardHeader>
        <CardContent>
          <RuntimePanel :runtime="runtime" />
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import MonitorHeader from '@/components/monitor/MonitorHeader.vue'
import ConcurrencyPanel from '@/components/monitor/ConcurrencyPanel.vue'
import RuntimePanel from '@/components/monitor/RuntimePanel.vue'
import StatusCodePanel from '@/components/monitor/StatusCodePanel.vue'
import ActiveRequestList from '@/components/monitor/ActiveRequestList.vue'
import RequestDetailPanel from '@/components/monitor/RequestDetailPanel.vue'

// --- Type definitions (matching backend src/monitor/types.ts) ---

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

interface ProviderConcurrencySnapshot {
  providerId: string
  providerName: string
  maxConcurrency: number
  active: number
  queued: number
  queueTimeoutMs: number
  maxQueueSize: number
}

interface ProviderStats {
  totalRequests: number
  successCount: number
  errorCount: number
  avgLatencyMs: number
  retryCount: number
  topErrors: Array<{ code: number; count: number }>
}

interface StatsSnapshot {
  totalRequests: number
  successCount: number
  errorCount: number
  retryCount: number
  failoverCount: number
  avgLatencyMs: number
  p50LatencyMs: number
  p99LatencyMs: number
  byProvider: Record<string, ProviderStats>
  byStatusCode: Record<number, number>
}

interface RuntimeMetrics {
  uptimeMs: number
  memoryUsage: NodeJS.MemoryUsage
  activeHandles: number
  activeRequests: number
  eventLoopDelayMs: number
}

// --- Reactive state ---

const RECENT_COMPLETED_MAX = 200

const activeRequests = ref<ActiveRequest[]>([])
const recentCompleted = ref<ActiveRequest[]>([])
const selectedRequestId = ref<string | null>(null)
const stats = ref<StatsSnapshot | null>(null)
const concurrency = ref<ProviderConcurrencySnapshot[]>([])
const runtime = ref<RuntimeMetrics | null>(null)
const connected = ref(false)

const streamCount = computed(() => activeRequests.value.filter((r) => r.isStream).length)

const selectedRequest = computed(() => {
  if (!selectedRequestId.value) return null
  return (
    activeRequests.value.find((r) => r.id === selectedRequestId.value) ??
    recentCompleted.value.find((r) => r.id === selectedRequestId.value) ??
    null
  )
})

// --- SSE connection ---

let eventSource: EventSource | null = null

function handleSSEMessage(event: MessageEvent) {
  let data: unknown
  try {
    data = JSON.parse(event.data)
  } catch {
    return
  }

  switch (event.type) {
    case 'request_start': {
      const req = data as ActiveRequest
      activeRequests.value.unshift(req)
      break
    }
    case 'request_update': {
      const updated = data as ActiveRequest[]
      activeRequests.value = updated
      break
    }
    case 'request_complete': {
      const completed = data as ActiveRequest
      activeRequests.value = activeRequests.value.filter((r) => r.id !== completed.id)
      recentCompleted.value.unshift(completed)
      if (recentCompleted.value.length > RECENT_COMPLETED_MAX) {
        recentCompleted.value.length = RECENT_COMPLETED_MAX
      }
      break
    }
    case 'concurrency_update': {
      concurrency.value = data as ProviderConcurrencySnapshot[]
      break
    }
    case 'stats_update': {
      stats.value = data as StatsSnapshot
      break
    }
    case 'runtime_update': {
      runtime.value = data as RuntimeMetrics
      break
    }
  }
}

function connectSSE() {
  eventSource = new EventSource('/admin/api/monitor/stream')

  eventSource.onopen = () => {
    connected.value = true
  }

  const eventTypes = [
    'request_start',
    'request_update',
    'request_complete',
    'concurrency_update',
    'stats_update',
    'runtime_update',
  ]
  for (const type of eventTypes) {
    eventSource.addEventListener(type, handleSSEMessage)
  }

  eventSource.onerror = () => {
    connected.value = false
    eventSource?.close()
    eventSource = null
  }
}

function disconnectSSE() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  connected.value = false
}

// --- Initial data loading ---

async function loadInitialData() {
  try {
    const [active, statsData, concurrencyData, runtimeData] = await Promise.allSettled([
      api.getMonitorActive(),
      api.getMonitorStats(),
      api.getMonitorConcurrency(),
      api.getMonitorRuntime(),
    ])

    if (active.status === 'fulfilled') {
      activeRequests.value = active.value as ActiveRequest[]
    }
    if (statsData.status === 'fulfilled') {
      stats.value = statsData.value as StatsSnapshot
    }
    if (concurrencyData.status === 'fulfilled') {
      concurrency.value = concurrencyData.value as ProviderConcurrencySnapshot[]
    }
    if (runtimeData.status === 'fulfilled') {
      runtime.value = runtimeData.value as RuntimeMetrics
    }
  } catch (e) {
    console.error('Failed to load initial monitor data:', e)
    stats.value = null
    concurrency.value = []
    runtime.value = null
  }
}

// --- Lifecycle ---

onMounted(async () => {
  await loadInitialData()
  connectSSE()
})

onUnmounted(() => {
  disconnectSSE()
})
</script>
