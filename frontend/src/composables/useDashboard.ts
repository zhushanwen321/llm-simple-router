import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { api, getApiMessage, type UsageWindowWithUsage } from "@/api/client";
import { toast } from "vue-sonner";
import { formatProviderTokenLabel } from "@/utils/token-format";
import { watchTheme } from "@/composables/useTheme";
import type { Provider } from "@/types/mapping";
import { useDashboardFilters } from "./useDashboardFilters";
import type { DashboardStats } from "./useDashboardData";
import { useDashboardData } from "./useDashboardData";
import { useDashboardTimeline } from "./useDashboardTimeline";

// --- Constants ---

const DEBOUNCE_MS = 300;
const PERCENT_MULTIPLIER = 100;
const MIN_WINDOWS_FOR_DELTA = 2;

// --- Helpers ---

/** 从 usageWindows 中按 provider_id 聚合全部 input tokens（不依赖选中窗口） */
function aggregateAllProviderInputTokens(
  windows: UsageWindowWithUsage[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const w of windows) {
    if (!w.window.provider_id || w.usage.total_input_tokens <= 0) continue;
    const existing = map.get(w.window.provider_id) ?? 0;
    map.set(w.window.provider_id, existing + w.usage.total_input_tokens);
  }
  return map;
}

// --- useDashboard (facade) ---

export function useDashboard() {
  const { t } = useI18n();

  // --- Provider list and selection ---
  const providers = ref<Provider[]>([]);
  const selectedProvider = ref("");
  const providerLoadError = ref(false);

  // --- Sub-composables ---
  const filters = useDashboardFilters({ selectedProvider, providers, t });

  const timeline = useDashboardTimeline({ selectedProvider, t });

  // --- Derived: provider token labels from usageWindows (stable across provider selection) ---
  const providerInputTokens = computed(() =>
    aggregateAllProviderInputTokens(timeline.usageWindows.value),
  );

  const providerTokenLabels = computed(() => {
    const map = new Map<string, string>();
    for (const [id, tokens] of providerInputTokens.value) {
      map.set(id, formatProviderTokenLabel(tokens));
    }
    return map;
  });

  // --- Provider sorting based on total input tokens across all windows ---
  const sortedProviders = computed(() => {
    const tokenMap = providerInputTokens.value;
    return [...providers.value].sort((a, b) => {
      const aIn = tokenMap.get(a.id) ?? 0;
      const bIn = tokenMap.get(b.id) ?? 0;
      return bIn - aIn;
    });
  });

  // --- Watch key (cross-composite dependency fingerprint) ---
  const watchKey = computed(() =>
    JSON.stringify({
      selectedProvider: selectedProvider.value,
      selectedWindowId: timeline.selectedWindowId.value,
      modelFilter: filters.modelFilter.value,
      keyFilter: filters.keyFilter.value,
      clientType: filters.clientType.value,
      timelineRange: timeline.timelineRange.value,
    }),
  );

  // --- Data fetching ---
  const data = useDashboardData({
    selectedProvider,
    statsParams: filters.statsParams,
    cacheSummaryParams: filters.cacheSummaryParams,
    tsParams: filters.tsParams,
    selectedWindow: timeline.selectedWindow,
    watchKey,
    t,
  });

  // --- Environment comparison (prev window stats) ---
  const prevWindowStats = ref<DashboardStats | null>(null);

  const deltaValues = computed(() => {
    const prev = prevWindowStats.value;
    const curr = data.stats.value;
    if (!prev) return null;
    function delta(cur: number, prv: number): string {
      if (prv === 0) return cur > 0 ? "+100.0" : "0.0";
      const val = ((cur - prv) / prv) * PERCENT_MULTIPLIER;
      const str = Math.abs(val).toFixed(1);
      return val > 0 ? `+${str}` : str;
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
    const sorted = timeline.timelineWindows.value;
    const window = timeline.selectedWindow.value;
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

  // --- Load providers ---
  async function loadProviders() {
    try {
      providers.value = await api.getProviders();
      providerLoadError.value = false;
      data.loadError.value = false;
    } catch (e: unknown) {
      console.error("useDashboard.loadProviders:", e);
      providerLoadError.value = true;
      data.loadError.value = true;
      toast.error(getApiMessage(e, t("dashboard.loadProvidersFailed")));
    }
  }

  // --- Auto-select top provider ---
  function autoSelectProviderIfNeeded() {
    if (!selectedProvider.value && sortedProviders.value.length > 0) {
      selectedProvider.value = sortedProviders.value[0].id;
    }
  }

  // --- Watchers ---

  const initialized = ref(false);

  // 切换 provider 时重置 modelFilter
  watch(selectedProvider, () => {
    if (
      filters.modelFilter.value !== "all" &&
      !filters.modelOptions.value.includes(filters.modelFilter.value)
    ) {
      filters.modelFilter.value = "all";
    }
  });

  // Watch provider/range 变化 → 重新加载窗口 + 自动选择 + 刷新
  let skipNextFilterRefresh = false;

  watch([selectedProvider, timeline.timelineRange], async () => {
    if (!initialized.value) return;
    skipNextFilterRefresh = true;
    await timeline.loadUsageWindows();
    timeline.autoSelectLatestWindow();
    await data.refresh();
    await loadPrevWindowStats();
  });

  // Watch selectedWindowId/filter 变化 → debounced refresh + loadPrev
  let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  watch(
    [
      timeline.selectedWindowId,
      filters.modelFilter,
      filters.keyFilter,
      filters.clientType,
    ],
    () => {
      if (!initialized.value) return;
      if (skipNextFilterRefresh) {
        skipNextFilterRefresh = false;
        return;
      }
      if (filterDebounceTimer) clearTimeout(filterDebounceTimer);
      filterDebounceTimer = setTimeout(async () => {
        await data.refresh();
        await loadPrevWindowStats();
      }, DEBOUNCE_MS);
    },
  );

  // --- Watch theme changes to re-render charts ---
  let stopWatchTheme: (() => void) | null = null;

  // --- Retry ---
  async function retry() {
    await loadProviders();
    if (providerLoadError.value) return;
    await Promise.allSettled([
      filters.loadFilterOptions(),
      timeline.loadUsageWindows(),
    ]);
    autoSelectProviderIfNeeded();
    timeline.autoSelectLatestWindow();
    await data.refresh();
    await loadPrevWindowStats();
  }

  // --- Lifecycle ---
  onMounted(async () => {
    await loadProviders();
    if (providerLoadError.value) return;
    await timeline.loadUsageWindows();
    await filters.loadFilterOptions();
    autoSelectProviderIfNeeded();
    timeline.autoSelectLatestWindow();
    await data.refresh();
    await loadPrevWindowStats();
    initialized.value = true;
    stopWatchTheme = watchTheme(() => data.refresh());
  });

  onUnmounted(() => {
    if (stopWatchTheme) stopWatchTheme();
    if (filterDebounceTimer) clearTimeout(filterDebounceTimer);
  });

  return {
    // Provider
    providers,
    selectedProvider,
    sortedProviders,
    providerTokenLabels,
    // Timeline
    usageWindows: timeline.usageWindows,
    selectedWindowId: timeline.selectedWindowId,
    selectedWindow: timeline.selectedWindow,
    timelineWindows: timeline.timelineWindows,
    timelineRange: timeline.timelineRange,
    // Filters
    modelFilter: filters.modelFilter,
    keyFilter: filters.keyFilter,
    clientType: filters.clientType,
    modelOptions: filters.modelOptions,
    keyOptions: filters.keyOptions,
    // Data
    stats: data.stats,
    loading: data.loading,
    loadError: data.loadError,
    cacheHitRate: data.cacheHitRate,
    clientTypeBreakdown: data.clientTypeBreakdown,
    tpsChartData: data.tpsChartData,
    inputTokensChartData: data.inputTokensChartData,
    outputTokensChartData: data.outputTokensChartData,
    tokenThroughputChartData: data.tokenThroughputChartData,
    timeRangeText: data.timeRangeText,
    // Comparison
    prevWindowStats,
    deltaValues,
    windowTimeRange: timeline.windowTimeRange,
    // Timeline rendering
    getWindowStyle: timeline.getWindowStyle,
    getWindowWidth: timeline.getWindowWidth,
    formatWindowTooltip: timeline.formatWindowTooltip,
    timelineDayLabels: timeline.timelineDayLabels,
    // Actions
    retry,
  };
}
