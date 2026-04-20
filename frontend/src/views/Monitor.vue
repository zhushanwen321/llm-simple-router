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

    <!-- MonitorHeader will go here -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card v-for="n in 4" :key="n">
        <CardContent class="p-4">
          <p class="text-sm text-muted-foreground">--</p>
          <p class="text-2xl font-bold text-foreground mt-1">--</p>
        </CardContent>
      </Card>
    </div>

    <!-- Middle: two-column layout -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      <!-- Left: Active request list -->
      <div class="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle class="text-sm font-medium text-foreground">
              活跃请求
              <Badge variant="secondary" class="ml-2">{{ activeRequests.length }}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <!-- ActiveRequestList will go here -->
            <p class="text-sm text-muted-foreground">
              {{ activeRequests.length > 0 ? `${activeRequests.length} 个活跃请求` : '暂无活跃请求' }}
            </p>
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
            <!-- RequestDetailPanel will go here -->
            <p class="text-sm text-muted-foreground">
              {{ selectedRequestId ? `选中: ${selectedRequestId}` : '点击请求查看详情' }}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- Bottom: Provider stats table -->
    <Card>
      <CardHeader>
        <CardTitle class="text-sm font-medium text-foreground">服务提供方状态</CardTitle>
      </CardHeader>
      <CardContent>
        <!-- ProviderStatsTable will go here -->
        <p class="text-sm text-muted-foreground">
          {{ concurrency.length > 0 ? `${concurrency.length} 个服务提供方` : '暂无并发数据' }}
        </p>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
    // Initial load failure is non-critical; SSE will push updates once connected
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
