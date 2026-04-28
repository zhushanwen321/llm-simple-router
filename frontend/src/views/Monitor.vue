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
              <TooltipProvider :delay-duration="300">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="ghost" size="icon-xs" class="shrink-0" @click.stop="copy(req.id)">
                      <CheckIcon v-if="copied" class="size-3 text-green-500" />
                      <CopyIcon v-else class="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>复制 ID</TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
              <TooltipProvider :delay-duration="300">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="ghost" size="icon-xs" class="shrink-0" @click.stop="copy(req.id)">
                      <CheckIcon v-if="copied" class="size-3 text-green-500" />
                      <CopyIcon v-else class="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>复制 ID</TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
              <span class="text-xs text-muted-foreground shrink-0">{{ duration(req) }}</span>
              <TooltipProvider :delay-duration="300">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button variant="ghost" size="icon-xs" class="shrink-0" @click.stop="copy(req.id)">
                      <CheckIcon v-if="copied" class="size-3 text-green-500" />
                      <CopyIcon v-else class="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>复制 ID</TooltipContent>
                </Tooltip>
              </TooltipProvider>
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

    <!-- Unified Request Detail Dialog -->
    <UnifiedRequestDialog
      v-model:open="requestDetailOpen"
      source="realtime"
      :request="selectedRequest"
      :stream-content="selectedRequest?.streamContent"
      :log-detail-data="logDetailData"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CheckIcon, CopyIcon } from 'lucide-vue-next'
import MonitorHeader from '@/components/monitor/MonitorHeader.vue'
import ConcurrencyPanel from '@/components/monitor/ConcurrencyPanel.vue'
import RuntimePanel from '@/components/monitor/RuntimePanel.vue'
import StatusCodePanel from '@/components/monitor/StatusCodePanel.vue'
import ProviderStatsTable from '@/components/monitor/ProviderStatsTable.vue'
import UnifiedRequestDialog from '@/components/request-detail/UnifiedRequestDialog.vue'
import { useMonitorSSE } from '@/composables/useMonitorSSE'
import { useMonitorData } from '@/composables/useMonitorData'
import { useClipboard } from '@/composables/useClipboard'
import { statusVariant, statusLabel } from '@/utils/status'

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
  logDetailData,
  handleSSEMessage,
  handleSSEOpen,
  handleSSEClose,
  loadInitialData,
} = useMonitorData()

// --- SSE lifecycle (onOpen/onClose 驱动 connected 状态) ---
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

const { copied, copy } = useClipboard()

// --- Helper functions ---

const MS_PER_SECOND = 1000
const now = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

function elapsed(startTime: number): string {
  return ((now.value - startTime) / MS_PER_SECOND).toFixed(1)
}

function duration(req: { completedAt?: number; startTime: number }): string {
  if (!req.completedAt) return '--'
  return ((req.completedAt - req.startTime) / MS_PER_SECOND).toFixed(1) + 's'
}

// --- Lifecycle ---

onMounted(async () => {
  await loadInitialData()
  connect()
  tickTimer = setInterval(() => { now.value = Date.now() }, MS_PER_SECOND)
})

onUnmounted(() => {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
})
</script>
