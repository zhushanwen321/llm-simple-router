import {
  ref,
  shallowRef,
  triggerRef,
  computed,
  watch,
  onUnmounted,
  type Ref,
  type ShallowRef,
} from "vue";
import { api } from "@/api/client";
import { useMonitorSSE } from "./useMonitorSSE";
import type {
  ActiveRequest,
  ProviderConcurrencySnapshot,
  StatsSnapshot,
  RuntimeMetrics,
  StreamContentSnapshot,
  StreamMetricsSnapshot,
} from "@/types/monitor";

const RECENT_COMPLETED_MAX = 200;
const HTTP_NOT_FOUND = 404;
const STREAM_POLL_INTERVAL_MS = 500;

/**
 * SSE 重连后与后端活跃请求列表做增量 diff，清除幽灵请求并补充遗漏请求。
 * 提取为纯函数便于测试，减少 useMonitorData 函数体行数。
 */
async function syncActiveOnSSEReconnect(
  activeRequests: { value: ActiveRequest[] },
  getActive: () => Promise<ActiveRequest[]>,
): Promise<void> {
  try {
    const merged = diffActiveRequests(activeRequests.value, await getActive());
    if (merged !== activeRequests.value) activeRequests.value = merged;
  } catch (e: unknown) {
    // 防御性同步失败：触发响应式刷新，SSE 推送间隔会自动纠正
    console.error("useMonitorData.syncActiveOnSSEReconnect failed:", e);
    activeRequests.value = [...activeRequests.value];
  }
}

function diffActiveRequests(
  local: ActiveRequest[],
  remote: ActiveRequest[],
): ActiveRequest[] {
  const remoteIds = new Set(remote.map((r) => r.id));
  const localIds = new Set(local.map((r) => r.id));
  const ghosts = local.filter((r) => !remoteIds.has(r.id));
  const missing = remote.filter((r) => !localIds.has(r.id));
  if (ghosts.length === 0 && missing.length === 0) return local;
  const kept = local.filter((r) => remoteIds.has(r.id));
  return [...missing, ...kept];
}

// ─── 提取的模块级函数（减少 useMonitorData 函数体行数） ───

function handleSSEMessageImpl(
  event: MessageEvent,
  deps: {
    recentCompleted: Ref<ActiveRequest[]>;
    activeRequests: ShallowRef<ActiveRequest[]>;
    concurrency: Ref<ProviderConcurrencySnapshot[]>;
    stats: Ref<StatsSnapshot | null>;
    runtime: Ref<RuntimeMetrics | null>;
  },
): void {
  let data: unknown;
  try {
    data = JSON.parse(event.data);
  } catch {
    /* 非 JSON 数据，跳过 */ return;
  }

  switch (event.type) {
    case "request_start": {
      const req = data as ActiveRequest;
      if (!deps.recentCompleted.value.some((r) => r.id === req.id)) {
        deps.activeRequests.value.unshift(req);
        triggerRef(deps.activeRequests);
      }
      break;
    }
    case "request_update": {
      deps.activeRequests.value = data as ActiveRequest[];
      break;
    }
    case "request_complete": {
      const completed = data as ActiveRequest;
      deps.activeRequests.value = deps.activeRequests.value.filter(
        (r) => r.id !== completed.id,
      );
      deps.recentCompleted.value.unshift(completed);
      if (deps.recentCompleted.value.length > RECENT_COMPLETED_MAX) {
        deps.recentCompleted.value.length = RECENT_COMPLETED_MAX;
      }
      break;
    }
    case "concurrency_update": {
      deps.concurrency.value = data as ProviderConcurrencySnapshot[];
      break;
    }
    case "stats_update": {
      deps.stats.value = data as StatsSnapshot;
      break;
    }
    case "stream_content_update": {
      // 后端已改为轻量推送：只含 id + totalChars + streamMetrics（不含 streamContent）
      const updates = data as Array<{
        id: string;
        totalChars: number;
        streamMetrics: StreamMetricsSnapshot | null;
      }>;
      for (const update of updates) {
        const req = deps.activeRequests.value.find((r) => r.id === update.id);
        if (req) {
          req.streamTotalChars = update.totalChars;
          if (update.streamMetrics) req.streamMetrics = update.streamMetrics;
        }
      }
      triggerRef(deps.activeRequests);
      break;
    }
    case "runtime_update": {
      deps.runtime.value = data as RuntimeMetrics;
      break;
    }
  }
}

async function loadInitialDataImpl(
  activeRequests: ShallowRef<ActiveRequest[]>,
  recentCompleted: Ref<ActiveRequest[]>,
  stats: Ref<StatsSnapshot | null>,
  concurrency: Ref<ProviderConcurrencySnapshot[]>,
  runtime: Ref<RuntimeMetrics | null>,
): Promise<void> {
  try {
    const init = await api.getMonitorInit();
    if (init.active) activeRequests.value = init.active;
    if (init.recent) recentCompleted.value = init.recent;
    if (init.stats) stats.value = init.stats;
    if (init.concurrency) concurrency.value = init.concurrency;
    if (init.runtime) runtime.value = init.runtime;
  } catch (e) {
    console.error("Failed to load initial monitor data:", e);
    stats.value = null;
    concurrency.value = [];
    runtime.value = null;
  }
}

/**
 * 监控页数据层：初始加载 + SSE 事件驱动状态更新 + 非流式响应体按需加载。
 * 所有响应式状态均由此 composable 持有，UI 组件只做绑定。
 */
export function useMonitorData() {
  const activeRequests = shallowRef<ActiveRequest[]>([]);
  const recentCompleted = ref<ActiveRequest[]>([]);
  const stats = ref<StatsSnapshot | null>(null);
  const concurrency = ref<ProviderConcurrencySnapshot[]>([]);
  const runtime = ref<RuntimeMetrics | null>(null);
  const connected = ref(false);
  let sseConnectedOnce = false;

  const streamCount = computed(
    () => activeRequests.value.filter((r) => r.isStream).length,
  );
  const streamingRequests = computed(() =>
    activeRequests.value.filter((r) => !r.queued),
  );
  const queuedRequests = computed(() =>
    activeRequests.value.filter((r) => r.queued === true),
  );

  // --- SSE event handlers ---

  const handleSSEMessage = (event: MessageEvent) =>
    handleSSEMessageImpl(event, {
      recentCompleted,
      activeRequests,
      concurrency,
      stats,
      runtime,
    });

  async function handleSSEOpen() {
    connected.value = true;
    if (!sseConnectedOnce) {
      sseConnectedOnce = true;
      return;
    }
    await syncActiveOnSSEReconnect(activeRequests, () =>
      api.getMonitorActive(),
    );
  }

  function handleSSEClose() {
    connected.value = false;
  }

  // --- Initial data loading ---

  const loadInitialData = () =>
    loadInitialDataImpl(
      activeRequests,
      recentCompleted,
      stats,
      concurrency,
      runtime,
    );

  // --- SSE connection (封装在内部，消费者无需手动绑定 handler) ---

  const { connect, disconnect } = useMonitorSSE(
    "/admin/api/monitor/stream",
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
  );

  // --- Log detail loading (non-stream body + request diff data) ---

  const logDetailData = ref<{
    responseBody?: string;
    clientRequest?: string;
    upstreamRequest?: string;
  } | null>(null);
  const nonStreamBodyLoading = ref(false);
  const loadVersion = ref(0);

  async function loadLogDetail(requestId: string) {
    const version = ++loadVersion.value;
    const req =
      activeRequests.value.find((r) => r.id === requestId) ??
      recentCompleted.value.find((r) => r.id === requestId);
    if (!req) {
      logDetailData.value = null;
      return;
    }
    logDetailData.value = null;

    nonStreamBodyLoading.value = true;
    try {
      // Pending 请求：从 tracker 内存获取 clientRequest（日志尚未写入 DB）
      if (req.status === "pending") {
        try {
          const trackerReq = await api.getMonitorRequest(requestId);
          if (version !== loadVersion.value) return;
          logDetailData.value = {
            clientRequest: trackerReq.clientRequest ?? undefined,
            upstreamRequest: trackerReq.upstreamRequest ?? undefined,
          };
        } catch (e: unknown) {
          // 仅在 tracker 中请求不存在(404)时回退到 DB 查询
          const status = (e as { response?: { status?: number } })?.response
            ?.status;
          if (status !== HTTP_NOT_FOUND) throw e;
          if (version !== loadVersion.value) return;
          const log = await api.getLogDetail(requestId);
          if (version !== loadVersion.value) return;
          logDetailData.value = log.client_request
            ? { clientRequest: log.client_request }
            : null;
        }
        return;
      }

      // 已完成请求：从 DB 获取完整日志
      const log = await api.getLogDetail(requestId);
      if (version !== loadVersion.value) return;
      // 从 upstream_response 提取 body（兼容 {statusCode, headers, body} 包装格式）
      let responseBody: string | undefined;
      if (!req.isStream) {
        const raw = log.upstream_response;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            responseBody =
              (typeof parsed.body === "string" ? parsed.body : raw) ??
              undefined;
          } catch {
            /* JSON 解析失败，使用原始文本 */ responseBody = raw;
          }
        }
      }
      logDetailData.value = {
        responseBody,
        clientRequest: log.client_request ?? undefined,
        upstreamRequest: log.upstream_request ?? undefined,
      };
    } catch (e) {
      if (version !== loadVersion.value) return;
      console.warn("Failed to load log detail:", e);
      logDetailData.value = null;
    } finally {
      if (version === loadVersion.value) {
        nonStreamBodyLoading.value = false;
      }
    }
  }

  // --- Request selection ---

  const selectedRequestId = ref<string | null>(null);
  const requestDetailOpen = ref(false);
  const selectedStreamContent = ref<StreamContentSnapshot | null>(null);
  let streamPollingTimer: ReturnType<typeof setInterval> | null = null;

  function startStreamContentPolling(id: string) {
    stopStreamContentPolling();
    if (!id) return;

    const poll = async () => {
      // 只轮询活跃请求
      const req = activeRequests.value.find((r) => r.id === id);
      if (!req || req.status === "completed" || req.status === "failed") {
        stopStreamContentPolling();
        return;
      }
      try {
        const full = await api.getMonitorRequest(id);
        // 选中已变化，丢弃
        if (selectedRequestId.value !== id) return;
        // 防闪烁：仅在响应包含有效 streamContent 时更新
        if (full.streamContent) {
          selectedStreamContent.value = full.streamContent;
        }
      } catch (e: unknown) {
        const status = (e as { response?: { status?: number } })?.response
          ?.status;
        if (status === HTTP_NOT_FOUND) {
          stopStreamContentPolling();
        }
      }
    };

    poll(); // 立即首次获取
    streamPollingTimer = setInterval(poll, STREAM_POLL_INTERVAL_MS);
  }

  function stopStreamContentPolling() {
    if (streamPollingTimer) {
      clearInterval(streamPollingTimer);
      streamPollingTimer = null;
    }
  }

  function selectRequest(id: string) {
    selectedRequestId.value = id;
    requestDetailOpen.value = true;
    selectedStreamContent.value = null;
    // 已完成请求从 recentCompleted 或 API 获取最终 snapshot
    const existing = recentCompleted.value.find((r) => r.id === id);
    if (
      existing &&
      (existing.status === "completed" || existing.status === "failed")
    ) {
      // 优先使用 existing.streamContent（从 loadInitialData 加载的完整条目）
      if (existing.streamContent) {
        selectedStreamContent.value = existing.streamContent;
      } else {
        // SSE request_complete 剥离了 streamContent，需要单独获取
        loadCompletedStreamContent(id);
      }
    }
    startStreamContentPolling(id);
    loadLogDetail(id);
  }

  /** 对已完成请求，从后端 tracker 拉取最后一帧 streamContent */
  async function loadCompletedStreamContent(id: string) {
    try {
      const full = await api.getMonitorRequest(id);
      if (selectedRequestId.value !== id) return;
      if (full.streamContent) {
        selectedStreamContent.value = full.streamContent;
      }
    } catch (e: unknown) {
      console.error("loadCompletedStreamContent:", e);
      void e;
    }
  }

  const selectedRequest = computed(() => {
    if (!selectedRequestId.value) return null;
    return (
      activeRequests.value.find((r) => r.id === selectedRequestId.value) ??
      recentCompleted.value.find((r) => r.id === selectedRequestId.value) ??
      null
    );
  });

  // 请求从 pending 变为 completed 时，停止轮询，保留最后 snapshot
  watch(
    () => selectedRequest.value?.status,
    (newStatus, oldStatus) => {
      if (
        oldStatus === "pending" &&
        (newStatus === "completed" || newStatus === "failed")
      ) {
        stopStreamContentPolling();
        loadLogDetail(selectedRequestId.value!);
      }
    },
  );

  onUnmounted(() => {
    stopStreamContentPolling();
  });

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
    // Stream content (on-demand polling)
    selectedStreamContent,
    // Log detail data
    logDetailData,
    nonStreamBodyLoading,
    // SSE lifecycle
    connect,
    disconnect,
    // Lifecycle
    loadInitialData,
  };
}
