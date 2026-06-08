import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { api, getApiMessage } from "@/api/client";
import { toast } from "vue-sonner";
import { formatProviderTokenLabel } from "@/utils/token-format";
import { formatTimeShort } from "@/utils/format";
import { watchTheme } from "@/composables/useTheme";
import type { Provider } from "@/types/mapping";
import { useDashboardFilters } from "./useDashboardFilters";
import { useDashboardData } from "./useDashboardData";
import { useTimeSelector } from "./useTimeSelector";
import type { TimeSelection } from "./useTimeSelector";

// --- Constants ---

const DEBOUNCE_MS = 300;
const PERCENT_MULTIPLIER = 100;

// --- useDashboard (facade) ---

export function useDashboard() {
  const { t } = useI18n();

  // --- Provider list and selection ---
  const providers = ref<Provider[]>([]);
  const selectedProvider = ref("");
  const providerLoadError = ref(false);

  // --- Sub-composables ---
  const filters = useDashboardFilters({ selectedProvider, providers, t });
  const timeSelector = useTimeSelector({ selectedProvider });

  // --- Derived: provider token labels from overview response ---
  const providerTokenLabels = computed(() => {
    const map = new Map<string, string>();
    const summary = data.providerTokenSummary.value;
    for (const [id, tokens] of Object.entries(summary)) {
      map.set(id, formatProviderTokenLabel(tokens));
    }
    return map;
  });

  // --- Provider sorting based on total input tokens from overview ---
  const sortedProviders = computed(() => {
    const tokenMap = data.providerTokenSummary.value;
    return [...providers.value].sort((a, b) => {
      const aIn = tokenMap[a.id] ?? 0;
      const bIn = tokenMap[b.id] ?? 0;
      return bIn - aIn;
    });
  });

  // --- Convert timeSelector.timeSelection (Date) to ISO string for useDashboardData ---
  const timeSelectionForData = computed(() => {
    const sel: TimeSelection = timeSelector.timeSelection.value;
    return {
      startTime: sel.startTime.toISOString(),
      endTime: sel.endTime.toISOString(),
    };
  });

  // --- Inline tertiary metrics label ---
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
    filterParams: filters.filterParams,
    timeSelection: timeSelectionForData,
    watchKey,
    t,
  });

  // --- Environment comparison (prev range stats from overview response) ---
  const deltaValues = computed(() => {
    const prev = data.prevStats.value;
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
    if (!selectedProvider.value && providers.value.length > 0) {
      selectedProvider.value = providers.value[0].id;
    }
  }

  // --- Watchers ---

  const initialized = ref(false);
  let skipNextFilterRefresh = false;

  // 切换 provider 时重置 modelFilter
  watch(selectedProvider, () => {
    if (
      filters.modelFilter.value !== "all" &&
      !filters.modelOptions.value.includes(filters.modelFilter.value)
    ) {
      filters.modelFilter.value = "all";
    }
  });

  // Provider 或时间范围变化 → 刷新数据
  watch([selectedProvider, timeSelector.timeSelection], async () => {
    if (!initialized.value) return;
    skipNextFilterRefresh = true;
    await data.refresh();
  });

  // Filter 变化 → debounced refresh
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
    }, DEBOUNCE_MS);
  });

  // --- Watch theme changes to re-render charts ---
  let stopWatchTheme: (() => void) | null = null;

  // --- Retry ---
  async function retry() {
    await loadProviders();
    if (providerLoadError.value) return;
    autoSelectProviderIfNeeded();
    await Promise.allSettled([filters.loadFilterOptions(), data.refresh()]);
  }

  // --- Lifecycle ---
  onMounted(async () => {
    await loadProviders();
    if (providerLoadError.value) return;
    autoSelectProviderIfNeeded();
    await Promise.allSettled([data.refresh(), filters.loadFilterOptions()]);
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
    // Time selector
    activeRange: timeSelector.activeRange,
    timeSelection: timeSelector.timeSelection,
    timeRangeLabel: timeSelector.timeRangeLabel,
    showCustom: timeSelector.showCustom,
    customError: timeSelector.customError,
    totalRangeDays: timeSelector.totalRangeDays,
    selectQuickRange: timeSelector.selectQuickRange,
    toggleCustom: timeSelector.toggleCustom,
    applyCustom: timeSelector.applyCustom,
    // Custom date (Date refs for Calendar datetime picker)
    customStartDate: timeSelector.customStartDate,
    customEndDate: timeSelector.customEndDate,
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
    deltaValues,
    // Actions
    retry,
  };
}
