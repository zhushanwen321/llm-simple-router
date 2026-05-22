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

  const DEBOUNCE_MS = 300;
  const CACHE_TTL = 5000;
  let lastRefreshKey = "";
  let lastRefreshTime = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  async function refresh() {
    if (!selectedProvider.value) return;
    const key = watchKey.value;
    const now = Date.now();
    if (key === lastRefreshKey && now - lastRefreshTime < CACHE_TTL) return;
    loading.value = true;
    try {
      const windowTimeRange = selectedWindow.value
        ? {
          startTime: selectedWindow.value.window.start_time,
          endTime: selectedWindow.value.window.end_time,
        }
        : undefined;

      const [statsRes, tpsRes, inputRes, outputRes, summaryRes] =
        await Promise.allSettled([
          api.getStats(statsParams.value),
          api.getMetricsTimeseries(tsParams("total_tps", windowTimeRange)),
          api.getMetricsTimeseries(tsParams("input_tokens", windowTimeRange)),
          api.getMetricsTimeseries(tsParams("output_tokens", windowTimeRange)),
          api.getMetricsSummary(cacheSummaryParams.value),
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

  // debounced watch on watchKey
  watch(watchKey, () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(), DEBOUNCE_MS);
  });

  onUnmounted(() => {
    if (refreshTimer) clearTimeout(refreshTimer);
  });

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

  // Timeline 渲染用：按 start_time 排序的窗口列表
  const timelineWindows = computed(() =>
    [...usageWindows.value].sort(
      (a, b) =>
        new Date(a.window.start_time).getTime() -
        new Date(b.window.start_time).getTime(),
    ),
  );

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
  const providerTokenLabels = computed(() => {
    const map = new Map<string, string>();
    const window = selectedWindow.value;
    if (!window) return map;
    // 从 timelineWindows 中提取当前窗口下各 provider 的 output tokens
    for (const w of usageWindows.value) {
      if (
        w.window.id === window.window.id &&
        w.window.provider_id &&
        w.usage.total_output_tokens > 0
      ) {
        map.set(
          w.window.provider_id,
          formatProviderTokenLabel(w.usage.total_output_tokens),
        );
      }
    }
    // 所有 provider 窗口：选中窗口 id 下可能有多个 provider 的窗口
    // usageWindows 中相同 window.id 可能有不同 provider_id 条目，
    // 上面已处理。但同一时间范围的窗口 id 可能不同，
    // 需要匹配 start_time 和 end_time 来找同范围的所有 provider 窗口
    for (const w of usageWindows.value) {
      if (
        w.window.provider_id &&
        w.usage.total_output_tokens > 0 &&
        w.window.start_time === window.window.start_time &&
        w.window.end_time === window.window.end_time &&
        w.window.id !== window.window.id
      ) {
        map.set(
          w.window.provider_id,
          formatProviderTokenLabel(w.usage.total_output_tokens),
        );
      }
    }
    return map;
  });

  // --- Provider sorting based on current window's output tokens ---
  const sortedProviders = computed(() => {
    const tokenMap = new Map<string, number>();
    const window = selectedWindow.value;
    if (window) {
      for (const w of usageWindows.value) {
        if (
          w.window.provider_id &&
          w.window.start_time === window.window.start_time &&
          w.window.end_time === window.window.end_time
        ) {
          tokenMap.set(w.window.provider_id, w.usage.total_output_tokens);
        }
      }
    }
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
    const PERCENT_MULTIPLIER = 100;
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
    const MIN_WINDOWS_FOR_DELTA = 2;
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
      // 用前一个窗口的 start_time/end_time 作为时间范围，不依赖 period=window
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
  async function loadUsageWindows() {
    try {
      usageWindows.value = await api.getUsageWindows();
    } catch (e: unknown) {
      console.error("useDashboard.loadUsageWindows:", e);
      /* 降级：无窗口数据时 dashboard 仍可用 */
      toast.error(getApiMessage(e, t("dashboard.loadDashboardFailed")));
    }
  }

  // --- Auto-select latest window ---
  function autoSelectLatestWindow() {
    const sorted = timelineWindows.value;
    if (sorted.length > 0 && !selectedWindowId.value) {
      selectedWindowId.value = sorted[sorted.length - 1].window.id;
    }
  }

  // --- Auto-select top provider ---
  function autoSelectProviderIfNeeded() {
    if (!selectedProvider.value && sortedProviders.value.length > 0) {
      selectedProvider.value = sortedProviders.value[0].id;
    }
  }

  // --- Watchers ---
  // 切换 provider 时重置 modelFilter
  watch(selectedProvider, () => {
    if (
      modelFilter.value !== "all" &&
      !modelOptions.value.includes(modelFilter.value)
    ) {
      modelFilter.value = "all";
    }
  });

  // 窗口切换时加载前一个窗口的 stats 用于环比
  watch(selectedWindowId, () => {
    loadPrevWindowStats();
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
    stopWatchTheme = watchTheme(() => refresh());
  });

  onUnmounted(() => {
    if (stopWatchTheme) stopWatchTheme();
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
