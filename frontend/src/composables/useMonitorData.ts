import { ref, shallowRef, triggerRef, computed, watch } from 'vue'
import { api } from '@/api/client'
import type {
  ActiveRequest,
  ProviderConcurrencySnapshot,
  StatsSnapshot,
  RuntimeMetrics,
  StreamContentSnapshot,
  StreamMetricsSnapshot,
} from '@/types/monitor'

const RECENT_COMPLETED_MAX = 200

/**
 * 监控页数据层：初始加载 + SSE 事件驱动状态更新 + 非流式响应体按需加载。
 * 所有响应式状态均由此 composable 持有，UI 组件只做绑定。
 */
export function useMonitorData() {
  const activeRequests = shallowRef<ActiveRequest[]>([])
  const recentCompleted = ref<ActiveRequest[]>([])
  const stats = ref<StatsSnapshot | null>(null)
  const concurrency = ref<ProviderConcurrencySnapshot[]>([])
  const runtime = ref<RuntimeMetrics | null>(null)
  const connected = ref(false)

  const streamCount = computed(() => activeRequests.value.filter((r) => r.isStream).length)
  const streamingRequests = computed(() => activeRequests.value.filter((r) => !r.queued))
  const queuedRequests = computed(() => activeRequests.value.filter((r) => r.queued === true))

  // --- SSE event handlers ---

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
        if (!recentCompleted.value.some((r) => r.id === req.id)) {
          activeRequests.value.unshift(req)
        }
        break
      }
      case 'request_update': {
        activeRequests.value = data as ActiveRequest[]
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
      case 'stream_content_update': {
        const updates = data as Array<{ id: string; streamContent: StreamContentSnapshot | null; streamMetrics: StreamMetricsSnapshot | null }>
        for (const update of updates) {
          const req = activeRequests.value.find((r) => r.id === update.id)
          if (req) {
            if (update.streamContent) req.streamContent = update.streamContent
            if (update.streamMetrics) req.streamMetrics = update.streamMetrics
          }
        }
        triggerRef(activeRequests)
        break
      }
      case 'runtime_update': {
        runtime.value = data as RuntimeMetrics
        break
      }
    }
  }

  function handleSSEOpen() {
    connected.value = true
  }

  function handleSSEClose() {
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

      if (active.status === 'fulfilled') activeRequests.value = active.value
      if (recent.status === 'fulfilled') recentCompleted.value = recent.value
      if (statsData.status === 'fulfilled') stats.value = statsData.value
      if (concurrencyData.status === 'fulfilled') concurrency.value = concurrencyData.value
      if (runtimeData.status === 'fulfilled') runtime.value = runtimeData.value
    } catch (e) {
      console.error('Failed to load initial monitor data:', e)
      stats.value = null
      concurrency.value = []
      runtime.value = null
    }
  }

  // --- Log detail loading (non-stream body + request diff data) ---

  const logDetailData = ref<{ responseBody?: string; clientRequest?: string; upstreamRequest?: string } | null>(null)
  const nonStreamBodyLoading = ref(false)
  const loadVersion = ref(0)

  async function loadLogDetail(requestId: string) {
    const version = ++loadVersion.value
    const req = activeRequests.value.find((r) => r.id === requestId) ??
      recentCompleted.value.find((r) => r.id === requestId)
    if (!req) {
      logDetailData.value = null
      return
    }
    logDetailData.value = null

    nonStreamBodyLoading.value = true
    try {
      // Pending 请求：从 tracker 内存获取 clientRequest（日志尚未写入 DB）
      if (req.status === 'pending') {
        try {
          const trackerReq = await api.getMonitorRequest(requestId)
          if (version !== loadVersion.value) return
          logDetailData.value = {
            clientRequest: trackerReq.clientRequest ?? undefined,
            upstreamRequest: trackerReq.upstreamRequest ?? undefined,
          }
        } catch (e: unknown) {
          // 仅在 tracker 中请求不存在(404)时回退到 DB 查询
          const status = (e as { response?: { status?: number } })?.response?.status
          if (status !== 404) throw e // eslint-disable-line no-magic-numbers
          if (version !== loadVersion.value) return
          const log = await api.getLogDetail(requestId)
          if (version !== loadVersion.value) return
          logDetailData.value = log.client_request
            ? { clientRequest: log.client_request }
            : null
        }
        return
      }

      // 已完成请求：从 DB 获取完整日志
      const log = await api.getLogDetail(requestId)
      if (version !== loadVersion.value) return
      // 从 upstream_response 提取 body（兼容 {statusCode, headers, body} 包装格式）
      let responseBody: string | undefined
      if (!req.isStream) {
        const raw = log.upstream_response
        if (raw) {
          try {
            const parsed = JSON.parse(raw)
            responseBody = (typeof parsed.body === 'string' ? parsed.body : raw) ?? undefined
          } catch { responseBody = raw }
        }
      }
      logDetailData.value = {
        responseBody,
        clientRequest: log.client_request ?? undefined,
        upstreamRequest: log.upstream_request ?? undefined,
      }
    } catch (e) {
      if (version !== loadVersion.value) return
      console.warn('Failed to load log detail:', e)
      logDetailData.value = null
    } finally {
      if (version === loadVersion.value) {
        nonStreamBodyLoading.value = false
      }
    }
  }

  // --- Request selection ---

  const selectedRequestId = ref<string | null>(null)
  const requestDetailOpen = ref(false)

  function selectRequest(id: string) {
    selectedRequestId.value = id
    requestDetailOpen.value = true
    loadLogDetail(id)
  }

  const selectedRequest = computed(() => {
    if (!selectedRequestId.value) return null
    return (
      activeRequests.value.find((r) => r.id === selectedRequestId.value) ??
      recentCompleted.value.find((r) => r.id === selectedRequestId.value) ??
      null
    )
  })

  // 请求从 pending 变为 completed 时，自动重新加载日志详情
  watch(() => selectedRequest.value?.status, (newStatus, oldStatus) => {
    if (oldStatus === 'pending' && (newStatus === 'completed' || newStatus === 'failed')) {
      loadLogDetail(selectedRequestId.value!)
    }
  })

  return {
    // State
    activeRequests,
    recentCompleted,
    stats,
    concurrency,
    runtime,
    connected,
    streamCount,
    streamingRequests,
    queuedRequests,
    // Selection
    selectedRequestId,
    selectedRequest,
    requestDetailOpen,
    selectRequest,
    // Log detail data
    logDetailData,
    nonStreamBodyLoading,
    // SSE handlers (for useMonitorSSE)
    handleSSEMessage,
    handleSSEOpen,
    handleSSEClose,
    // Lifecycle
    loadInitialData,
  }
}
