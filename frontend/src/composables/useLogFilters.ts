import { ref, computed, onMounted } from "vue";
import { toast } from "vue-sonner";
import { useI18n } from "vue-i18n";
import { api, getApiMessage } from "@/api/client";
import type { Provider } from "@/types/mapping";
import { toIsoStart, toIsoEnd } from "@/utils/format";

const PERIODS = [
  { label: "1h", value: "1h" },
  { label: "5h", value: "5h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
] as const;

export type PeriodValue = (typeof PERIODS)[number]["value"];

export function useLogFilters() {
  const { t } = useI18n();
  const period = ref<PeriodValue>("5h");
  const dateRange = ref({ start: "", end: "" });
  const providerFilter = ref("all");
  const clientModelFilter = ref("all");
  const backendModelFilter = ref("all");
  const keyFilter = ref("all");
  const apiTypeFilter = ref("all");
  const statusFilter = ref("all");

  const providers = ref<Provider[]>([]);
  const routerKeys = ref<{ id: string; name: string }[]>([]);
  const clientModelOptions = ref<string[]>([]);
  const backendModelOptions = ref<string[]>([]);

  const hasDateRange = computed(
    () =>
      dateRange.value.start &&
      dateRange.value.end &&
      dateRange.value.start < dateRange.value.end,
  );

  const dateRangeError = computed(() => {
    const { start, end } = dateRange.value;
    if (!start || !end) return "";
    return start >= end ? t("logs.validation.endTimeAfterStart") : "";
  });

  const PERIOD_MS: Record<string, number> = {
    "1h": 3600000,
    "5h": 18000000,
    "24h": 86400000,
    "7d": 604800000,
    "30d": 2592000000,
  };

  function buildFilterParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (hasDateRange.value) {
      params.start_time = toIsoStart(dateRange.value.start);
      params.end_time = toIsoEnd(dateRange.value.end);
    } else {
      const offset = PERIOD_MS[period.value];
      if (offset)
        params.start_time = new Date(Date.now() - offset).toISOString();
    }
    if (apiTypeFilter.value !== "all") params.api_type = apiTypeFilter.value;
    if (providerFilter.value !== "all")
      params.provider_id = providerFilter.value;
    if (clientModelFilter.value !== "all")
      params.client_model = clientModelFilter.value;
    if (backendModelFilter.value !== "all")
      params.backend_model = backendModelFilter.value;
    if (keyFilter.value !== "all") params.router_key_id = keyFilter.value;
    if (statusFilter.value !== "all") params.status_code = statusFilter.value;
    return params;
  }

  function clearDateRange() {
    dateRange.value = { start: "", end: "" };
  }

  async function loadProviders() {
    try {
      providers.value = await api.getProviders();
    } catch (e: unknown) {
      console.error("Failed to load providers:", e);
      toast.error(getApiMessage(e, t("logs.messages.loadProvidersFailed")));
    }
  }

  async function loadRouterKeys() {
    try {
      routerKeys.value = await api.getRouterKeys();
    } catch (e: unknown) {
      console.error("Failed to load router keys:", e);
      toast.error(getApiMessage(e, t("logs.messages.loadKeysFailed")));
    }
  }

  async function loadModelOptions() {
    try {
      const [summaryResult, availableModels] = await Promise.allSettled([
        api.getMetricsSummary({ period: "30d" }),
        api.getAvailableModels(),
      ]);
      clientModelOptions.value =
        availableModels.status === "fulfilled" ? availableModels.value : [];
      backendModelOptions.value =
        summaryResult.status === "fulfilled"
          ? [...new Set(summaryResult.value.rows.map((r) => r.backend_model))]
          : [];
    } catch (e: unknown) {
      console.error("useLogFilters.loadModelOptions:", e);
      clientModelOptions.value = [];
      backendModelOptions.value = [];
    }
  }

  onMounted(() => {
    Promise.allSettled([loadProviders(), loadRouterKeys(), loadModelOptions()]);
  });

  return {
    PERIODS,
    period,
    dateRange,
    dateRangeError,
    providerFilter,
    clientModelFilter,
    backendModelFilter,
    keyFilter,
    apiTypeFilter,
    statusFilter,
    providers,
    routerKeys,
    clientModelOptions,
    backendModelOptions,
    hasDateRange,
    clearDateRange,
    buildFilterParams,
  };
}
