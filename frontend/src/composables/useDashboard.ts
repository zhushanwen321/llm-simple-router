import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { api, getApiMessage, type UsageWindowWithUsage } from "@/api/client";
import { toast } from "vue-sonner";
import { formatProviderTokenLabel } from "@/utils/token-format";
import { formatTimeShort } from "@/utils/format";
import { watchTheme } from "@/composables/useTheme";
import type { Provider } from "@/types/mapping";
import { useDashboardFilters } from "./useDashboardFilters";
import type { DashboardStats } from "./useDashboardData";
import { useDashboardData } from "./useDashboardData";
import { useTimeSelector } from "./useTimeSelector";

// --- Constants ---

const DEBOUNCE_MS = 300;
const PERCENT_MULTIPLIER = 100;

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
  const timeSelector = useTimeSelector({ selectedProvider, t });

  // --- Usage windows (kept for provider token sort; not driving time selection) ---
  const usageWindows = ref<UsageWindowWithUsage[]>([]);
  const selectedWindowId = ref("");

  async function loadUsageWindows() {
    try {
      const params: { provider_id?: string } = {};
      if (selectedProvider.value) params.provider_id = selectedProvider.value;
      usageWindows.value = await api.getUsageWindows(params);
      if (
        selectedWindowId.value &&
        !usageWindows.value.some((w) => w.window.id === selectedWindowId.value)
      ) {
        selectedWindowId.value = "";
      }
    } catch (e: unknown) {
      console.error("useDashboard.loadUsageWindows:", e);
      /* 非关键：provider 排序数据缺失不影响主仪表盘功能 */
      usageWindows.value = [];
      selectedWindowId.value = "";
    }
  }

  // --- Derived: provider token labels from usageWindows (stable across provider selection) ---
  const providerInputTokens = computed(() =>
    aggregateAllProviderInputTokens(usageWindows.value),
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

  // --- Synthesize selectedWindow from timeSelector for useDashboardData ---
  // useDashboardData 的接口要求 `selectedWindow: ComputedRef<UsageWindowWithUsage | null>`，
  // 内部从 `selectedWindow.value.window.start_time/end_time` 读取时间范围。
  // 我们合成一个镜像 timeSelector.timeSelection 的对象，避免改动 useDashboardData 签名。
  const selectedWindowFromTime = computed<UsageWindowWithUsage | null>(() => {
    const sel = timeSelector.timeSelection.value;
    if (!sel) return null;
    return {
      window: {
        id: `time-selector-${sel.source}`,
        router_key_id: null,
        provider_id: selectedProvider.value || null,
        provider_name: null,
        start_time: sel.startTime.toISOString(),
        end_time: sel.endTime.toISOString(),
        created_at: new Date().toISOString(),
      },
      usage: {
        request_count: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
      },
    };
  });

  // --- Inline tertiary metrics label (Zone 2 保持旧格式：MM/DD HH:MM) ---
  const windowTimeRange = computed(() => {
    const sel = timeSelector.timeSelection.value;
    return `${formatTimeShort(sel.startTime.toISOString())} ~ ${formatTimeShort(sel.endTime.toISOString())}`;
  });

  // --- Watch key (cross-composite dependency fingerprint) ---
  const watchKey = computed(() =>
    JSON.stringify({
      selectedProvider: selectedProvider.value,
      timeSelection: timeSelector.timeSelection.value,
      modelFilter: filters.modelFilter.value,
      keyFilter: filters.keyFilter.value,
      clientType: filters.clientType.value,
    }),
  );

  // --- Data fetching ---
  const data = useDashboardData({
    selectedProvider,
    statsParams: filters.statsParams,
    cacheSummaryParams: filters.cacheSummaryParams,
    tsParams: filters.tsParams,
    selectedWindow: selectedWindowFromTime,
    watchKey,
    t,
  });

  // --- Environment comparison (prev range stats) ---
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
    const sel = timeSelector.timeSelection.value;
    const dur = sel.endTime.getTime() - sel.startTime.getTime();
    if (dur <= 0) {
      prevWindowStats.value = null;
      return;
    }
    // prev = 与当前选区等长、紧邻其前的范围
    const prevEnd = new Date(sel.startTime.getTime());
    const prevStart = new Date(prevEnd.getTime() - dur);
    try {
      const params: Record<string, string> = {
        period: "window",
        start_time: prevStart.toISOString(),
        end_time: prevEnd.toISOString(),
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

  // Watch provider / time range 变化 → 重新加载数据
  let skipNextFilterRefresh = false;

  watch([selectedProvider, timeSelector.timeSelection], async () => {
    if (!initialized.value) return;
    skipNextFilterRefresh = true;
    await Promise.allSettled([loadUsageWindows(), timeSelector.loadActivity()]);
    await data.refresh();
    await loadPrevWindowStats();
  });

  // Watch filter 变化 → debounced refresh + loadPrev
  let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  watch([filters.modelFilter, filters.keyFilter, filters.clientType], () => {
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
  });

  // --- Watch theme changes to re-render charts ---
  let stopWatchTheme: (() => void) | null = null;

  // --- Retry ---
  async function retry() {
    await loadProviders();
    if (providerLoadError.value) return;
    await Promise.allSettled([
      filters.loadFilterOptions(),
      loadUsageWindows(),
      timeSelector.loadActivity(),
    ]);
    autoSelectProviderIfNeeded();
    await data.refresh();
    await loadPrevWindowStats();
  }

  // --- Lifecycle ---
  onMounted(async () => {
    await loadProviders();
    if (providerLoadError.value) return;
    await Promise.allSettled([
      loadUsageWindows(),
      filters.loadFilterOptions(),
      timeSelector.loadActivity(),
    ]);
    autoSelectProviderIfNeeded();
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
    // Time selector (new — replaces old timeline window navigator)
    activeRange: timeSelector.activeRange,
    timeSelection: timeSelector.timeSelection,
    timeRangeLabel: timeSelector.timeRangeLabel,
    showCustom: timeSelector.showCustom,
    customStart: timeSelector.customStart,
    customEnd: timeSelector.customEnd,
    customError: timeSelector.customError,
    activityBuckets: timeSelector.activityBuckets,
    detailDays: timeSelector.detailDays,
    rangeStart: timeSelector.rangeStart,
    totalRangeDays: timeSelector.totalRangeDays,
    selectQuickRange: timeSelector.selectQuickRange,
    toggleCustom: timeSelector.toggleCustom,
    applyCustom: timeSelector.applyCustom,
    setCustomRange: timeSelector.setCustomRange,
    // Usage windows (kept for provider token sort; not driving time selection)
    usageWindows,
    selectedWindowId,
    // Alias for Zone 2 inline tertiary metrics
    windowTimeRange,
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
    // Actions
    retry,
  };
}
