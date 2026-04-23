import { ref, computed } from 'vue'
import { api } from '@/api/client'
import type {
  ActiveRequest,
  ProviderConcurrencySnapshot,
  StatsSnapshot,
  RuntimeMetrics,
} from '@/types/monitor'

const RECENT_COMPLETED_MAX = 200

/**
 * 监控页数据层：初始加载 + SSE 事件驱动状态更新 + 非流式响应体按需加载。
 * 所有响应式状态均由此 composable 持有，UI 组件只做绑定。
 */
export function useMonitorData() {
  const activeRequests = ref<ActiveRequest[]>([])
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

  // --- Non-stream body loading ---

  const nonStreamBody = ref<string | undefined>(undefined)
  const nonStreamBodyLoading = ref(false)
  const loadVersion = ref(0)

  async function loadNonStreamBody(requestId: string) {
    const version = ++loadVersion.value
    const req = activeRequests.value.find((r) => r.id === requestId) ??
      recentCompleted.value.find((r) => r.id === requestId)
    if (!req || req.isStream || req.status === 'pending') {
      nonStreamBody.value = undefined
      return
    }
    nonStreamBodyLoading.value = true
    nonStreamBody.value = undefined
    try {
      const log = await api.getLogDetail(requestId) as { upstream_response?: string }
      if (version !== loadVersion.value) return
      // 从 upstream_response 提取 body（兼容 {statusCode, headers, body} 包装格式）
      const raw = log.upstream_response
      if (!raw) { nonStreamBody.value = undefined }
      else {
        try {
          const parsed = JSON.parse(raw)
          nonStreamBody.value = (typeof parsed.body === 'string' ? parsed.body : raw) ?? undefined
        } catch { nonStreamBody.value = raw }
      }
    } catch (e) {
      if (version !== loadVersion.value) return
      console.warn('Failed to load non-stream body:', e)
      nonStreamBody.value = undefined
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
    loadNonStreamBody(id)
  }

  const selectedRequest = computed(() => {
    if (!selectedRequestId.value) return null
    return (
      activeRequests.value.find((r) => r.id === selectedRequestId.value) ??
      recentCompleted.value.find((r) => r.id === selectedRequestId.value) ??
      null
    )
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
    // Non-stream body
    nonStreamBody,
    nonStreamBodyLoading,
    // SSE handlers (for useMonitorSSE)
    handleSSEMessage,
    handleSSEOpen,
    handleSSEClose,
    // Lifecycle
    loadInitialData,
  }
}
