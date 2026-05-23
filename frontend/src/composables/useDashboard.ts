import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import type { Ref, ComputedRef } from "vue";
import { useI18n } from "vue-i18n";
import type { ChartData } from "chart.js";
import { api, getApiMessage } from "@/api/client";
import type { UsageWindowWithUsage } from "@/api/client";
import { toast } from "vue-sonner";
import { fillTimeseries } from "@/views/metrics-helpers";
import { CHART_COLORS } from "@/styles/design-tokens";
import { formatProviderTokenLabel } from "@/utils/token-format";
import { formatTimeShort } from "@/utils/format";
import { watchTheme } from "@/composables/useTheme";
import type { Provider } from "@/types/mapping";

export interface DashboardStats {
  totalRequests: number;
  successRate: number;
  avgTps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  startTime: string | null;
  endTime: string | null;
}

// --- Constants ---

const CACHE_TTL = 5000;
const DEBOUNCE_MS = 300;
const PERCENT_MULTIPLIER = 100;
const MIN_WINDOWS_FOR_DELTA = 2;
const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3600_000;
const DAYS_3 = 3;
const DAYS_7 = 7;
const PAD_WIDTH = 2;

const TIMELINE_DURATIONS: Record<TimelineRange, number> = {
  "24h": HOURS_PER_DAY * MS_PER_HOUR,
  "3d": DAYS_3 * HOURS_PER_DAY * MS_PER_HOUR,
  "7d": DAYS_7 * HOURS_PER_DAY * MS_PER_HOUR,
};

export type TimelineRange = "24h" | "3d" | "7d";

// --- Helpers ---

/** Date → SQLite-compatible "YYYY-MM-DD HH:mm:ss" (UTC) */
function toDateTimeStr(d: Date): string {
  const pad = (n: number) => n.toString().padStart(PAD_WIDTH, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function getTimelineTimeRange(range: TimelineRange): {
  start_time: string;
  end_time: string;
} {
  const now = new Date();
  const start = new Date(now.getTime() - TIMELINE_DURATIONS[range]);
  return {
    start_time: toDateTimeStr(start),
    end_time: toDateTimeStr(now),
  };
}

/** 检查两个时间窗口是否有重叠 */
function windowsOverlap(
  a: { start_time: string; end_time: string },
  b: { start_time: string; end_time: string },
): boolean {
  const aStart = new Date(a.start_time).getTime();
  const aEnd = new Date(a.end_time).getTime();
  const bStart = new Date(b.start_time).getTime();
  const bEnd = new Date(b.end_time).getTime();
  return aStart < bEnd && aEnd > bStart;
}

/** 从 usageWindows 中按 provider_id 聚合与目标窗口重叠的 output tokens */
function aggregateProviderTokens(
  windows: UsageWindowWithUsage[],
  targetWindow: { start_time: string; end_time: string },
): Map<string, number> {
  const map = new Map<string, number>();
  for (const w of windows) {
    if (!w.window.provider_id || w.usage.total_output_tokens <= 0) continue;
    if (windowsOverlap(w.window, targetWindow)) {
      const existing = map.get(w.window.provider_id) ?? 0;
      map.set(w.window.provider_id, existing + w.usage.total_output_tokens);
    }
  }
  return map;
}

// --- useDashboardFilters ---

function useDashboardFilters(
  selectedProvider: Ref<string>,
  providers: Ref<Provider[]>,
  t: (key: string) => string,
) {
  const modelFilter = ref("all");
  const keyFilter = ref("all");
  const clientType = ref("all");
  const allModelOptions = ref<string[]>([]);
  const keyOptions = ref<{ id: string; name: string }[]>([]);

  const modelOptions = computed(() => {
    if (selectedProvider.value) {
      const provider = providers.value.find(
        (p) => p.id === selectedProvider.value,
      );
      if (provider) {
        const providerModels = new Set(provider.models.map((m) => m.name));
        return allModelOptions.value.filter((m) => providerModels.has(m));
      }
    }
    return allModelOptions.value;
  });

  function buildBaseParams(): Record<string, string> {
    const p: Record<string, string> = { period: "window" };
    if (selectedProvider.value) p.provider_id = selectedProvider.value;
    return p;
  }

  const statsParams = computed(() => {
    const p = buildBaseParams();
    if (modelFilter.value !== "all") p.backend_model = modelFilter.value;
    if (keyFilter.value !== "all") p.router_key_id = keyFilter.value;
    return p;
  });

  const cacheSummaryParams = computed(() => {
    const p = buildBaseParams();
    if (modelFilter.value !== "all") p.backend_model = modelFilter.value;
    if (keyFilter.value !== "all") p.router_key_id = keyFilter.value;
    if (clientType.value !== "all") p.client_type = clientType.value;
    return p;
  });

  function tsParams(
    metric: string,
    timeRange?: { startTime: string; endTime: string },
  ): { metric: string; [key: string]: string } {
    const p: { metric: string; [key: string]: string } = {
      period: "window",
      metric,
    };
    if (selectedProvider.value) p.provider_id = selectedProvider.value;
    if (modelFilter.value !== "all") p.backend_model = modelFilter.value;
    if (keyFilter.value !== "all") p.router_key_id = keyFilter.value;
    if (timeRange) {
      p.start_time = timeRange.startTime;
      p.end_time = timeRange.endTime;
    }
    return p;
  }

  async function loadFilterOptions() {
    try {
      const [models, keys] = await Promise.allSettled([
        api.getAvailableModels(),
        api.getRouterKeys(),
      ]);
      if (models.status === "fulfilled") allModelOptions.value = models.value;
      if (keys.status === "fulfilled")
        keyOptions.value = keys.value.map((k) => ({
          id: k.id,
          name: k.name,
        }));
    } catch (e: unknown) {
      console.error("useDashboardFilters.loadFilterOptions:", e);
      /* 非关键操作：filter 缺失不影响主仪表盘功能 */
      toast.error(getApiMessage(e, t("dashboard.loadFilterFailed")));
    }
  }

  return {
    modelFilter,
    keyFilter,
    clientType,
    keyOptions,
    modelOptions,
    statsParams,
    cacheSummaryParams,
    tsParams,
    loadFilterOptions,
  };
}

// --- useDashboardData ---

function useDashboardData(
  selectedProvider: Ref<string>,
  statsParams: ComputedRef<Record<string, string>>,
  cacheSummaryParams: ComputedRef<Record<string, string>>,
  tsParams: (
    metric: string,
    timeRange?: { startTime: string; endTime: string },
  ) => { metric: string; [key: string]: string },
  selectedWindow: ComputedRef<UsageWindowWithUsage | null>,
  watchKey: ComputedRef<string>,
  t: (key: string) => string,
) {
  const stats = ref<DashboardStats>({
    totalRequests: 0,
    successRate: 0,
    avgTps: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startTime: null,
    endTime: null,
  });
  const cacheHitRate = ref(0);
  const clientTypeBreakdown = ref<Record<string, number>>({});
  const tpsChartData = ref<ChartData<"line"> | null>(null);
  const inputTokensChartData = ref<ChartData<"line"> | null>(null);
  const outputTokensChartData = ref<ChartData<"line"> | null>(null);
  const tokenThroughputChartData = ref<ChartData<"line"> | null>(null);
  const loading = ref(false);

  function toChartData(
    timeseries: { labels: string[]; values: number[] },
    label: string,
    color: string,
  ): ChartData<"line"> {
    return {
      labels: timeseries.labels,
      datasets: [
        {
          label,
          data: timeseries.values,
          borderColor: color,
          backgroundColor: color.replace(")", " / 0.1)"),
          fill: false,
          tension: 0.4,
          pointRadius: 0,
        },
      ],
    };
  }

  function toThroughputChartData(
    inputData: { labels: string[]; values: number[] },
    outputData: { labels: string[]; values: number[] },
    inputLabel: string,
    outputLabel: string,
  ): ChartData<"line"> {
    return {
      labels: inputData.labels,
      datasets: [
        {
          label: inputLabel,
          data: inputData.values,
          borderColor: CHART_COLORS.teal,
          backgroundColor: CHART_COLORS.tealFill,
          fill: "origin",
          tension: 0.4,
          pointRadius: 0,
        },
        {
          label: outputLabel,
          data: outputData.values,
          borderColor: CHART_COLORS.green,
          backgroundColor: CHART_COLORS.greenFill,
          fill: "origin",
          tension: 0.4,
          pointRadius: 0,
        },
      ],
    };
  }

  const loadError = ref(false);

  let lastRefreshKey = "";
  let lastRefreshTime = 0;

  async function refresh() {
    if (!selectedProvider.value) return;
    const key = watchKey.value;
    const now = Date.now();
    if (key === lastRefreshKey && now - lastRefreshTime < CACHE_TTL) return;
    // 只在首次加载时显示 skeleton，已有数据时静默刷新避免闪烁
    loading.value = !stats.value.totalRequests && !stats.value.totalInputTokens;
    try {
      const windowTimeRange = selectedWindow.value
        ? {
          startTime: selectedWindow.value.window.start_time,
          endTime: selectedWindow.value.window.end_time,
        }
        : undefined;

      // Fix #1: 将选中窗口的时间范围合并进 stats 和 cache summary 请求参数
      const finalStatsParams: Record<string, string> = {
        ...statsParams.value,
      };
      const finalCacheSummaryParams: Record<string, string> = {
        ...cacheSummaryParams.value,
      };
      if (windowTimeRange) {
        finalStatsParams.start_time = windowTimeRange.startTime;
        finalStatsParams.end_time = windowTimeRange.endTime;
        finalCacheSummaryParams.start_time = windowTimeRange.startTime;
        finalCacheSummaryParams.end_time = windowTimeRange.endTime;
      }

      const [statsRes, tpsRes, inputRes, outputRes, summaryRes] =
        await Promise.allSettled([
          api.getStats(finalStatsParams),
          api.getMetricsTimeseries(tsParams("total_tps", windowTimeRange)),
          api.getMetricsTimeseries(tsParams("input_tokens", windowTimeRange)),
          api.getMetricsTimeseries(tsParams("output_tokens", windowTimeRange)),
          api.getMetricsSummary(finalCacheSummaryParams),
        ]);

      const fulfilled = <T>(
        r: PromiseSettledResult<T>,
      ): r is PromiseFulfilledResult<T> => r.status === "fulfilled";

      if (fulfilled(statsRes)) stats.value = statsRes.value;

      const resolvedTimeRange =
        stats.value.startTime && stats.value.endTime
          ? { startTime: stats.value.startTime, endTime: stats.value.endTime }
          : windowTimeRange;

      const period = "window";

      if (fulfilled(tpsRes) && tpsRes.value.length > 0) {
        const filled = fillTimeseries(tpsRes.value, period, resolvedTimeRange);
        tpsChartData.value = toChartData(
          filled,
          t("dashboard.charts.tokenOutputSpeed"),
          CHART_COLORS.indigo,
        );
      } else {
        tpsChartData.value = null;
      }

      if (fulfilled(inputRes) && inputRes.value.length > 0) {
        const filled = fillTimeseries(
          inputRes.value,
          period,
          resolvedTimeRange,
        );
        inputTokensChartData.value = toChartData(
          filled,
          t("dashboard.charts.tokenInputTotal"),
          CHART_COLORS.teal,
        );
      } else {
        inputTokensChartData.value = null;
      }

      if (fulfilled(outputRes) && outputRes.value.length > 0) {
        const filled = fillTimeseries(
          outputRes.value,
          period,
          resolvedTimeRange,
        );
        outputTokensChartData.value = toChartData(
          filled,
          t("dashboard.charts.tokenOutputTotal"),
          CHART_COLORS.green,
        );
      } else {
        outputTokensChartData.value = null;
      }

      // 堆叠面积图：input + output tokens
      if (
        fulfilled(inputRes) &&
        inputRes.value.length > 0 &&
        fulfilled(outputRes) &&
        outputRes.value.length > 0
      ) {
        const filledInput = fillTimeseries(
          inputRes.value,
          period,
          resolvedTimeRange,
        );
        const filledOutput = fillTimeseries(
          outputRes.value,
          period,
          resolvedTimeRange,
        );
        tokenThroughputChartData.value = toThroughputChartData(
          filledInput,
          filledOutput,
          t("dashboard.charts.tokenInputTotal"),
          t("dashboard.charts.tokenOutputTotal"),
        );
      } else {
        tokenThroughputChartData.value = null;
      }

      if (fulfilled(summaryRes)) {
        cacheHitRate.value = summaryRes.value.cache_hit_rate;
        clientTypeBreakdown.value = summaryRes.value.client_type_breakdown;
      }
    } catch (e: unknown) {
      console.error("useDashboardData.refresh:", e);
      toast.error(getApiMessage(e, t("dashboard.loadDashboardFailed")));
    } finally {
      loading.value = false;
      lastRefreshKey = key;
      lastRefreshTime = Date.now();
    }
  }

  return {
    stats,
    cacheHitRate,
    clientTypeBreakdown,
    tpsChartData,
    inputTokensChartData,
    outputTokensChartData,
    tokenThroughputChartData,
    loading,
    loadError,
    refresh,
  };
}

// --- useDashboard ---

export function useDashboard() {
  const { t } = useI18n();

  // --- Provider list and selection ---
  const providers = ref<Provider[]>([]);
  const selectedProvider = ref("");

  // --- Timeline range ---
  const timelineRange = ref<TimelineRange>("24h");

  // --- Usage windows ---
  const usageWindows = ref<UsageWindowWithUsage[]>([]);
  const selectedWindowId = ref<string | null>(null);

  const selectedWindow = computed<UsageWindowWithUsage | null>(() => {
    if (!selectedWindowId.value) return null;
    return (
      usageWindows.value.find((w) => w.window.id === selectedWindowId.value) ??
      null
    );
  });

  // Timeline 渲染用：按 start_time 排序，过滤到单个 provider，去重 router_key_id
  // 同一 provider 同一时间可能有多个 router_key_id 的窗口，只保留 router_key_id 为 null 的
  // 如果没有 null 窗口，则保留每个时间段的第一个窗口
  const timelineWindows = computed(() => {
    let windows = [...usageWindows.value].sort(
      (a, b) =>
        new Date(a.window.start_time).getTime() -
        new Date(b.window.start_time).getTime(),
    );
    if (selectedProvider.value) {
      windows = windows.filter(
        (w) => w.window.provider_id === selectedProvider.value,
      );
    }
    // 去重：同一 provider 同一时间段多个 router_key_id 窗口重叠
    // 优先保留 router_key_id === null 的窗口
    const seen = new Map<string, UsageWindowWithUsage>();
    for (const w of windows) {
      // 用 start_time 近似作为去重键（同一 provider 相同 start_time 视为同一窗口）
      const key = `${w.window.provider_id}:${w.window.start_time}`;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, w);
      } else if (w.window.router_key_id === null) {
        // 优先保留 null key 的窗口
        seen.set(key, w);
      }
    }
    return [...seen.values()];
  });

  // --- Filters & params ---
  const {
    modelFilter,
    keyFilter,
    clientType,
    keyOptions,
    modelOptions,
    statsParams,
    cacheSummaryParams,
    tsParams,
    loadFilterOptions,
  } = useDashboardFilters(selectedProvider, providers, t);

  // --- Derived: provider token labels from usageWindows ---
  // Fix #3: 使用时间重叠匹配替代 id/exact time 匹配
  const providerTokenLabels = computed(() => {
    const map = new Map<string, string>();
    const window = selectedWindow.value;
    if (!window) return map;
    const tokenMap = aggregateProviderTokens(usageWindows.value, window.window);
    for (const [id, tokens] of tokenMap) {
      map.set(id, formatProviderTokenLabel(tokens));
    }
    return map;
  });

  // --- Provider sorting based on current window's output tokens ---
  const sortedProviders = computed(() => {
    const window = selectedWindow.value;
    const tokenMap = window
      ? aggregateProviderTokens(usageWindows.value, window.window)
      : new Map<string, number>();
    return [...providers.value].sort((a, b) => {
      const aOut = tokenMap.get(a.id) ?? 0;
      const bOut = tokenMap.get(b.id) ?? 0;
      return bOut - aOut;
    });
  });

  // --- Watch key ---
  const watchKey = computed(() =>
    JSON.stringify({
      selectedProvider: selectedProvider.value,
      selectedWindowId: selectedWindowId.value,
      modelFilter: modelFilter.value,
      keyFilter: keyFilter.value,
      clientType: clientType.value,
      timelineRange: timelineRange.value,
    }),
  );

  // --- Data fetching ---
  const {
    stats,
    cacheHitRate,
    clientTypeBreakdown,
    tpsChartData,
    inputTokensChartData,
    outputTokensChartData,
    tokenThroughputChartData,
    loading,
    loadError,
    refresh,
  } = useDashboardData(
    selectedProvider,
    statsParams,
    cacheSummaryParams,
    tsParams,
    selectedWindow,
    watchKey,
    t,
  );

  // --- Environment comparison (prev window stats) ---
  const prevWindowStats = ref<DashboardStats | null>(null);

  const deltaValues = computed(() => {
    const prev = prevWindowStats.value;
    const curr = stats.value;
    if (!prev) return null;
    function delta(cur: number, prv: number): string {
      if (prv === 0) return cur > 0 ? "+100.0" : "0.0";
      return (((cur - prv) / prv) * PERCENT_MULTIPLIER).toFixed(1);
    }
    return {
      totalRequests: delta(curr.totalRequests, prev.totalRequests),
      successRate: delta(curr.successRate, prev.successRate),
      avgTps: delta(curr.avgTps, prev.avgTps),
      totalInputTokens: delta(curr.totalInputTokens, prev.totalInputTokens),
      totalOutputTokens: delta(curr.totalOutputTokens, prev.totalOutputTokens),
    };
  });

  async function loadPrevWindowStats() {
    const sorted = timelineWindows.value;
    const window = selectedWindow.value;
    if (!window || sorted.length < MIN_WINDOWS_FOR_DELTA) {
      prevWindowStats.value = null;
      return;
    }
    const idx = sorted.findIndex((w) => w.window.id === window.window.id);
    if (idx < 1) {
      prevWindowStats.value = null;
      return;
    }
    const prevWindow = sorted[idx - 1];
    try {
      const params: Record<string, string> = {
        period: "window",
        start_time: prevWindow.window.start_time,
        end_time: prevWindow.window.end_time,
      };
      if (selectedProvider.value) params.provider_id = selectedProvider.value;
      const result = await api.getStats(params);
      prevWindowStats.value = result;
    } catch (e: unknown) {
      console.error("useDashboard.loadPrevWindowStats:", e);
      /* 非关键：环比数据缺失不影响主功能 */
      prevWindowStats.value = null;
    }
  }

  // --- Time range text ---
  const timeRangeText = computed(() => {
    const start = stats.value.startTime;
    const end = stats.value.endTime;
    if (!start || !end) return "—";
    try {
      return `${formatTimeShort(start)} ~ ${formatTimeShort(end)}`;
    } catch {
      return "—";
    }
  });

  const windowTimeRange = computed(() => {
    const window = selectedWindow.value;
    if (!window) return "";
    try {
      return `${formatTimeShort(window.window.start_time)} ~ ${formatTimeShort(window.window.end_time)}`;
    } catch {
      return "";
    }
  });

  // --- Load providers ---
  const providerLoadError = ref(false);

  async function loadProviders() {
    try {
      providers.value = await api.getProviders();
      providerLoadError.value = false;
    } catch (e: unknown) {
      console.error("useDashboard.loadProviders:", e);
      providerLoadError.value = true;
      toast.error(getApiMessage(e, t("dashboard.loadProvidersFailed")));
    }
  }

  // --- Load usage windows ---
  // Fix #2: 传入 start_time/end_time 限制窗口范围
  async function loadUsageWindows() {
    try {
      const range = getTimelineTimeRange(timelineRange.value);
      usageWindows.value = await api.getUsageWindows(range);
    } catch (e: unknown) {
      console.error("useDashboard.loadUsageWindows:", e);
      /* 降级：无窗口数据时 dashboard 仍可用 */
      toast.error(getApiMessage(e, t("dashboard.loadDashboardFailed")));
    }
  }

  // --- Auto-select latest window ---
  function autoSelectLatestWindow() {
    const sorted = timelineWindows.value;
    if (sorted.length > 0) {
      selectedWindowId.value = sorted[sorted.length - 1].window.id;
    } else {
      selectedWindowId.value = null;
    }
  }

  // --- Auto-select top provider ---
  function autoSelectProviderIfNeeded() {
    if (!selectedProvider.value && sortedProviders.value.length > 0) {
      selectedProvider.value = sortedProviders.value[0].id;
    }
  }

  // --- Watchers ---

  // 初始化标志，避免 onMounted 期间 watcher 重复触发
  const initialized = ref(false);

  // 切换 provider 时重置 modelFilter
  watch(selectedProvider, () => {
    if (
      modelFilter.value !== "all" &&
      !modelOptions.value.includes(modelFilter.value)
    ) {
      modelFilter.value = "all";
    }
  });

  // Watch provider/range 变化 → 重新加载窗口 + 自动选择 + 刷新
  // skipNextFilterRefresh: autoSelectLatestWindow 会改 selectedWindowId，
  // 触发第二个 watcher，但此时已由本 watcher 完成了 refresh，需要跳过
  let skipNextFilterRefresh = false;

  watch([selectedProvider, timelineRange], async () => {
    if (!initialized.value) return;
    skipNextFilterRefresh = true;
    await loadUsageWindows();
    autoSelectLatestWindow();
    await refresh();
    await loadPrevWindowStats();
  });

  // Watch selectedWindowId/filter 变化 → debounced refresh + loadPrev
  let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  watch([selectedWindowId, modelFilter, keyFilter, clientType], () => {
    if (!initialized.value) return;
    if (skipNextFilterRefresh) {
      skipNextFilterRefresh = false;
      return;
    }
    if (filterDebounceTimer) clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(async () => {
      await refresh();
      await loadPrevWindowStats();
    }, DEBOUNCE_MS);
  });

  // --- Watch theme changes to re-render charts ---
  let stopWatchTheme: (() => void) | null = null;

  // --- Retry ---
  async function retry() {
    await loadProviders();
    if (providerLoadError.value) return;
    await Promise.allSettled([loadFilterOptions(), loadUsageWindows()]);
    autoSelectLatestWindow();
    autoSelectProviderIfNeeded();
    await refresh();
    await loadPrevWindowStats();
  }

  // --- Lifecycle ---
  onMounted(async () => {
    await loadProviders();
    if (providerLoadError.value) return;
    await loadUsageWindows();
    autoSelectLatestWindow();
    await loadFilterOptions();
    autoSelectProviderIfNeeded();
    await refresh();
    await loadPrevWindowStats();
    initialized.value = true;
    stopWatchTheme = watchTheme(() => refresh());
  });

  onUnmounted(() => {
    if (stopWatchTheme) stopWatchTheme();
    if (filterDebounceTimer) clearTimeout(filterDebounceTimer);
  });

  return {
    providers,
    selectedProvider,
    sortedProviders,
    providerTokenLabels,
    usageWindows,
    selectedWindowId,
    selectedWindow,
    timelineWindows,
    timelineRange,
    modelFilter,
    keyFilter,
    clientType,
    modelOptions,
    keyOptions,
    stats,
    loading,
    loadError,
    cacheHitRate,
    clientTypeBreakdown,
    tpsChartData,
    inputTokensChartData,
    outputTokensChartData,
    tokenThroughputChartData,
    prevWindowStats,
    deltaValues,
    timeRangeText,
    windowTimeRange,
    retry,
  };
}
