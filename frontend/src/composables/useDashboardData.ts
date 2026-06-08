import { ref, computed } from "vue";
import type { Ref, ComputedRef } from "vue";
import { api, getApiMessage } from "@/api/client";
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

  function buildApiParams(): Record<string, string> {
    const ts = timeSelection.value;
    return {
      ...filterParams.value,
      period: "window",
      start_time: ts.startTime,
      end_time: ts.endTime,
    };
  }

  function buildTsParams(metric: string) {
    const base = buildApiParams();
    return {
      period: base.period,
      metric,
      provider_id: base.provider_id,
      backend_model: base.backend_model,
      router_key_id: base.router_key_id,
      start_time: base.start_time,
      end_time: base.end_time,
    };
  }

  async function refresh() {
    if (!selectedProvider.value) return;
    const key = watchKey.value;
    const now = Date.now();
    if (key === lastRefreshKey && now - lastRefreshTime < CACHE_TTL) return;
    // 只在首次加载时显示 skeleton，已有数据时静默刷新避免闪烁
    loading.value = !stats.value.totalRequests && !stats.value.totalInputTokens;
    try {
      const timeRange = {
        startTime: timeSelection.value.startTime,
        endTime: timeSelection.value.endTime,
      };

      const [statsRes, tpsRes, inputRes, outputRes, summaryRes] =
        await Promise.allSettled([
          api.getStats(buildApiParams()),
          api.getMetricsTimeseries(buildTsParams("total_tps")),
          api.getMetricsTimeseries(buildTsParams("input_tokens")),
          api.getMetricsTimeseries(buildTsParams("output_tokens")),
          api.getMetricsSummary(buildApiParams()),
        ]);

      const fulfilled = <T>(
        r: PromiseSettledResult<T>,
      ): r is PromiseFulfilledResult<T> => r.status === "fulfilled";

      if (fulfilled(statsRes)) stats.value = statsRes.value;

      const resolvedTimeRange =
        stats.value.startTime && stats.value.endTime
          ? { startTime: stats.value.startTime, endTime: stats.value.endTime }
          : timeRange;

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
          t("dashboard.charts.inputLegend"),
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
          t("dashboard.charts.outputLegend"),
          CHART_COLORS.green,
        );
      } else {
        outputTokensChartData.value = null;
      }

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
          t("dashboard.charts.inputLegend"),
          t("dashboard.charts.outputLegend"),
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
    cacheHitRate,
    clientTypeBreakdown,
    tpsChartData,
    inputTokensChartData,
    outputTokensChartData,
    tokenThroughputChartData,
    loading,
    loadError,
    refresh,
    timeRangeText,
  };
}
