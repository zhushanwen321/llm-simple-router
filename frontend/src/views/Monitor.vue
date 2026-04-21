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

    <!-- Middle: three-column layout -->
    <div class="grid grid-cols-3 gap-4 mb-6">
      <!-- 活跃请求 -->
      <Card>
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <CardTitle class="text-sm font-medium text-foreground">活跃请求</CardTitle>
            <Badge variant="secondary">{{ streamingRequests.length }}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea class="h-64">
            <div v-if="streamingRequests.length === 0" class="text-sm text-muted-foreground py-2">
              暂无活跃请求
            </div>
            <div
              v-for="req in streamingRequests"
              :key="req.id"
              class="flex items-center gap-2 py-2 px-2 rounded cursor-pointer hover:bg-muted/50 transition-colors"
              :class="{ 'bg-muted': selectedRequestId === req.id }"
              @click="selectRequest(req.id)"
            >
              <Badge :variant="statusVariant(req.status)" class="shrink-0">
                {{ statusLabel(req.status) }}
              </Badge>
              <span class="text-sm text-foreground truncate flex-1">{{ req.model }}</span>
              <Badge variant="outline" class="shrink-0 text-xs">{{ req.providerName }}</Badge>
              <span class="text-xs text-muted-foreground shrink-0">{{ elapsed(req.startTime) }}s</span>
              <Badge v-if="req.isStream" variant="outline" class="shrink-0 text-xs">SSE</Badge>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <!-- 队列请求 -->
      <Card>
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <CardTitle class="text-sm font-medium text-foreground">队列请求</CardTitle>
            <Badge variant="secondary">{{ queuedRequests.length }}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea class="h-64">
            <div v-if="queuedRequests.length === 0" class="text-sm text-muted-foreground py-2">
              暂无排队请求
            </div>
            <div
              v-for="req in queuedRequests"
              :key="req.id"
              class="flex items-center gap-2 py-2 px-2 rounded cursor-pointer hover:bg-muted/50 transition-colors"
              :class="{ 'bg-muted': selectedRequestId === req.id }"
              @click="selectRequest(req.id)"
            >
              <Badge variant="outline" class="shrink-0">
                排队
              </Badge>
              <span class="text-sm text-foreground truncate flex-1">{{ req.model }}</span>
              <Badge variant="outline" class="shrink-0 text-xs">{{ req.providerName }}</Badge>
              <span class="text-xs text-muted-foreground shrink-0">{{ elapsed(req.startTime) }}s</span>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <!-- 已完成 -->
      <Card>
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <CardTitle class="text-sm font-medium text-foreground">已完成</CardTitle>
            <Badge variant="secondary">{{ recentCompleted.length }}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea class="h-64">
            <div v-if="recentCompleted.length === 0" class="text-sm text-muted-foreground py-2">
              暂无已完成请求
            </div>
            <div
              v-for="req in recentCompleted"
              :key="req.id"
              class="flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer opacity-60 hover:opacity-80 hover:bg-muted/50 transition-colors"
              :class="{ 'bg-muted': selectedRequestId === req.id }"
              @click="selectRequest(req.id)"
            >
              <Badge :variant="statusVariant(req.status)" class="shrink-0">
                {{ statusLabel(req.status) }}
              </Badge>
              <span class="text-sm text-foreground truncate flex-1">{{ req.model }}</span>
              <Badge variant="outline" class="shrink-0 text-xs">{{ req.providerName }}</Badge>
              <Badge v-if="req.isStream" variant="outline" class="shrink-0 text-xs">SSE</Badge>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>

    <!-- Provider Stats Table -->
    <Card class="mb-4">
      <CardHeader>
        <CardTitle class="text-sm font-medium text-foreground">Provider 统计</CardTitle>
      </CardHeader>
      <CardContent>
        <ProviderStatsTable :stats="stats" />
      </CardContent>
    </Card>

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

    <!-- Request Detail Dialog -->
    <Dialog v-model:open="requestDetailOpen">
      <DialogScrollContent class="max-w-5xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>请求详情</DialogTitle>
        </DialogHeader>
        <div v-if="selectedRequest" class="flex gap-4 min-h-0">
          <!-- Left: metadata -->
          <div class="w-[260px] shrink-0 overflow-y-auto pr-2 border-r">
            <RequestDetailPanel :request="selectedRequest" @view-detail="openLogDetail" />
          </div>
          <!-- Right: response content with tabs -->
          <div class="flex-1 min-w-0 overflow-y-auto">
            <StreamResponseViewer
              :metrics="selectedRequest.streamMetrics ?? null"
              :is-stream="selectedRequest.isStream"
              :stream-content="selectedRequest.streamContent ?? undefined"
            />
          </div>
        </div>
        <div v-else class="text-sm text-muted-foreground py-4 text-center">
          点击请求查看详情
        </div>
      </DialogScrollContent>
    </Dialog>

    <!-- Log Detail Dialog -->
    <LogDetailDialog ref="logDetailDialog" v-model:open="detailDialogOpen" />
  </div>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import MonitorHeader from '@/components/monitor/MonitorHeader.vue'
import ConcurrencyPanel from '@/components/monitor/ConcurrencyPanel.vue'
import RuntimePanel from '@/components/monitor/RuntimePanel.vue'
import StatusCodePanel from '@/components/monitor/StatusCodePanel.vue'
import RequestDetailPanel from '@/components/monitor/RequestDetailPanel.vue'
import StreamResponseViewer from '@/components/monitor/StreamResponseViewer.vue'
import ProviderStatsTable from '@/components/monitor/ProviderStatsTable.vue'
import LogDetailDialog from '@/components/monitor/LogDetailDialog.vue'

import type {
  ActiveRequest,
  ProviderConcurrencySnapshot,
  StatsSnapshot,
  RuntimeMetrics,
} from '@/types/monitor'

// --- Reactive state ---

const RECENT_COMPLETED_MAX = 200

const activeRequests = ref<ActiveRequest[]>([])
const recentCompleted = ref<ActiveRequest[]>([])
const selectedRequestId = ref<string | null>(null)
const requestDetailOpen = ref(false)
const stats = ref<StatsSnapshot | null>(null)
const concurrency = ref<ProviderConcurrencySnapshot[]>([])
const runtime = ref<RuntimeMetrics | null>(null)
const connected = ref(false)

const streamCount = computed(() => activeRequests.value.filter((r) => r.isStream).length)

const streamingRequests = computed(() => activeRequests.value.filter((r) => !r.queued))
const queuedRequests = computed(() => activeRequests.value.filter((r) => r.queued === true))

function selectRequest(id: string) {
  selectedRequestId.value = id
  requestDetailOpen.value = true
}

const selectedRequest = computed(() => {
  if (!selectedRequestId.value) return null
  return (
    activeRequests.value.find((r) => r.id === selectedRequestId.value) ??
    recentCompleted.value.find((r) => r.id === selectedRequestId.value) ??
    null
  )
})

// --- Log detail dialog ---

const detailDialogOpen = ref(false)
const logDetailDialog = ref<InstanceType<typeof LogDetailDialog> | null>(null)

function openLogDetail(id: string) {
  requestDetailOpen.value = false
  detailDialogOpen.value = true
  logDetailDialog.value?.load(id)
}

// --- Helper functions ---

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
      // 防御 SSE 乱序：如果该请求已在 completed 中，不重复加入 active
      if (!recentCompleted.value.some((r) => r.id === req.id)) {
        activeRequests.value.unshift(req)
      }
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
    const [active, recent, statsData, concurrencyData, runtimeData] = await Promise.allSettled([
      api.getMonitorActive(),
      api.getMonitorRecent(),
      api.getMonitorStats(),
      api.getMonitorConcurrency(),
      api.getMonitorRuntime(),
    ])

    if (active.status === 'fulfilled') {
      activeRequests.value = active.value as ActiveRequest[]
    }
    if (recent.status === 'fulfilled') {
      recentCompleted.value = recent.value as ActiveRequest[]
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
