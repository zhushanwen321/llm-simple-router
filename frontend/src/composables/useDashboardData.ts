import { ref, computed } from "vue";
import type { Ref, ComputedRef } from "vue";
import { api, getApiMessage } from "@/api/client";
import type { DashboardInitResponse } from "@/api/client";
import { toast } from "vue-sonner";
import { fillTimeseries } from "@/views/metrics-helpers";
import { CHART_COLORS } from "@/styles/design-tokens";
import { formatTimeShort } from "@/utils/format";
import type { ChartData } from "chart.js";

export interface DashboardStats {
  totalRequests: number;
  successRate: number;
  avgTps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  startTime: string | null;
  endTime: string | null;
}

export interface DashboardDataInput {
  selectedProvider: Ref<string>;
  filterParams: ComputedRef<Record<string, string>>;
  timeSelection: ComputedRef<{ startTime: string; endTime: string }>;
  watchKey: ComputedRef<string>;
  t: (key: string) => string;
}

const CACHE_TTL = 5000;

export function useDashboardData({
  selectedProvider,
  filterParams,
  timeSelection,
  watchKey,
  t,
}: DashboardDataInput) {
  const stats = ref<DashboardStats>({
    totalRequests: 0,
    successRate: 0,
    avgTps: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    startTime: null,
    endTime: null,
  });
  const prevStats = ref<Omit<DashboardStats, "startTime" | "endTime"> | null>(
    null,
  );
  const cacheHitRate = ref(0);
  const clientTypeBreakdown = ref<Record<string, number>>({});
  const tpsChartData = ref<ChartData<"line"> | null>(null);
  const inputTokensChartData = ref<ChartData<"line"> | null>(null);
  const outputTokensChartData = ref<ChartData<"line"> | null>(null);
  const tokenThroughputChartData = ref<ChartData<"line"> | null>(null);
  const providerTokenSummary = ref<Record<string, number>>({});
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

  /** 从 init 响应直接填充所有 ref，跳过网络请求 */
  function initWithData(init: DashboardInitResponse) {
    // Stats（可能为 null——init 端点在 overview 失败时返回 null）
    if (init.stats) {
      stats.value = {
        totalRequests: init.stats.totalRequests,
        successRate: init.stats.successRate,
        avgTps: init.stats.avgTps,
        totalInputTokens: init.stats.totalInputTokens,
        totalOutputTokens: init.stats.totalOutputTokens,
        startTime: init.stats.startTime,
        endTime: init.stats.endTime,
      };
    }

    // Prev stats
    prevStats.value = init.prev_stats;

    // Cache hit rate & client type breakdown
    cacheHitRate.value = init.cache_hit_rate ?? 0;
    clientTypeBreakdown.value = init.client_type_breakdown ?? {};

    // Provider token summary
    providerTokenSummary.value = init.provider_token_summary ?? {};

    // Timeseries charts
    const ts = timeSelection.value;
    const resolvedTimeRange =
      stats.value.startTime && stats.value.endTime
        ? { startTime: stats.value.startTime, endTime: stats.value.endTime }
        : { startTime: ts.startTime, endTime: ts.endTime };
    const period = "window";

    const tpsTs = init.timeseries?.tps ?? [];
    const inputTs = init.timeseries?.input_tokens ?? [];
    const outputTs = init.timeseries?.output_tokens ?? [];

    if (tpsTs.length > 0) {
      const filled = fillTimeseries(tpsTs, period, resolvedTimeRange);
      tpsChartData.value = toChartData(
        filled,
        t("dashboard.charts.tokenOutputSpeed"),
        CHART_COLORS.indigo,
      );
    } else {
      tpsChartData.value = null;
    }

    if (inputTs.length > 0) {
      const filled = fillTimeseries(inputTs, period, resolvedTimeRange);
      inputTokensChartData.value = toChartData(
        filled,
        t("dashboard.charts.inputLegend"),
        CHART_COLORS.teal,
      );
    } else {
      inputTokensChartData.value = null;
    }

    if (outputTs.length > 0) {
      const filled = fillTimeseries(outputTs, period, resolvedTimeRange);
      outputTokensChartData.value = toChartData(
        filled,
        t("dashboard.charts.outputLegend"),
        CHART_COLORS.green,
      );
    } else {
      outputTokensChartData.value = null;
    }

    if (inputTs.length > 0 && outputTs.length > 0) {
      const filledInput = fillTimeseries(inputTs, period, resolvedTimeRange);
      const filledOutput = fillTimeseries(outputTs, period, resolvedTimeRange);
      tokenThroughputChartData.value = toThroughputChartData(
        filledInput,
        filledOutput,
        t("dashboard.charts.inputLegend"),
        t("dashboard.charts.outputLegend"),
      );
    } else {
      tokenThroughputChartData.value = null;
    }

    // Mark cache as fresh
    lastRefreshKey = watchKey.value;
    lastRefreshTime = Date.now();
  }

  async function refresh() {
    if (!selectedProvider.value) return;
    const key = watchKey.value;
    const now = Date.now();
    if (key === lastRefreshKey && now - lastRefreshTime < CACHE_TTL) return;
    // 只在首次加载时显示 skeleton，已有数据时静默刷新避免闪烁
    loading.value = !stats.value.totalRequests && !stats.value.totalInputTokens;
    try {
      const ts = timeSelection.value;
      const fp = filterParams.value;
      const params: {
        start_time: string;
        end_time: string;
        provider_id?: string;
        router_key_id?: string;
        backend_model?: string;
        client_type?: string;
      } = {
        start_time: ts.startTime,
        end_time: ts.endTime,
      };
      if (fp.provider_id) params.provider_id = fp.provider_id;
      if (fp.router_key_id) params.router_key_id = fp.router_key_id;
      if (fp.backend_model) params.backend_model = fp.backend_model;
      if (fp.client_type) params.client_type = fp.client_type;

      const overview = await api.getDashboardOverview(params);

      // Stats
      stats.value = {
        totalRequests: overview.stats.totalRequests,
        successRate: overview.stats.successRate,
        avgTps: overview.stats.avgTps,
        totalInputTokens: overview.stats.totalInputTokens,
        totalOutputTokens: overview.stats.totalOutputTokens,
        startTime: overview.stats.startTime,
        endTime: overview.stats.endTime,
      };

      // Prev stats (for delta comparison)
      prevStats.value = overview.prev_stats;

      // Cache hit rate
      cacheHitRate.value = overview.cache_hit_rate;
      clientTypeBreakdown.value = overview.client_type_breakdown;

      // Provider token summary
      providerTokenSummary.value = overview.provider_token_summary;

      // Timeseries charts
      const resolvedTimeRange =
        stats.value.startTime && stats.value.endTime
          ? { startTime: stats.value.startTime, endTime: stats.value.endTime }
          : { startTime: ts.startTime, endTime: ts.endTime };
      const period = "window";

      const tpsTs = overview.timeseries.tps;
      const inputTs = overview.timeseries.input_tokens;
      const outputTs = overview.timeseries.output_tokens;

      if (tpsTs.length > 0) {
        const filled = fillTimeseries(tpsTs, period, resolvedTimeRange);
        tpsChartData.value = toChartData(
          filled,
          t("dashboard.charts.tokenOutputSpeed"),
          CHART_COLORS.indigo,
        );
      } else {
        tpsChartData.value = null;
      }

      if (inputTs.length > 0) {
        const filled = fillTimeseries(inputTs, period, resolvedTimeRange);
        inputTokensChartData.value = toChartData(
          filled,
          t("dashboard.charts.inputLegend"),
          CHART_COLORS.teal,
        );
      } else {
        inputTokensChartData.value = null;
      }

      if (outputTs.length > 0) {
        const filled = fillTimeseries(outputTs, period, resolvedTimeRange);
        outputTokensChartData.value = toChartData(
          filled,
          t("dashboard.charts.outputLegend"),
          CHART_COLORS.green,
        );
      } else {
        outputTokensChartData.value = null;
      }

      if (inputTs.length > 0 && outputTs.length > 0) {
        const filledInput = fillTimeseries(inputTs, period, resolvedTimeRange);
        const filledOutput = fillTimeseries(
          outputTs,
          period,
          resolvedTimeRange,
        );
        tokenThroughputChartData.value = toThroughputChartData(
          filledInput,
          filledOutput,
          t("dashboard.charts.inputLegend"),
          t("dashboard.charts.outputLegend"),
        );
      } else {
        tokenThroughputChartData.value = null;
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

  const timeRangeText = computed(() => {
    const start = stats.value.startTime;
    const end = stats.value.endTime;
    if (!start || !end) return "—";
    try {
      return `${formatTimeShort(start)} ~ ${formatTimeShort(end)}`;
    } catch {
      /* 时间格式化失败，显示占位符 */ return "—";
    }
  });

  return {
    stats,
    prevStats,
    cacheHitRate,
    clientTypeBreakdown,
    providerTokenSummary,
    tpsChartData,
    inputTokensChartData,
    outputTokensChartData,
    tokenThroughputChartData,
    loading,
    loadError,
    initWithData,
    refresh,
    timeRangeText,
  };
}
