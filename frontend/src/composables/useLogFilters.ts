import { ref, computed, onMounted } from "vue";
import { toast } from "vue-sonner";
import { useI18n } from "vue-i18n";
import { api, getApiMessage } from "@/api/client";
import type { Provider, Rule } from "@/types/mapping";
import { toIsoStart, toIsoEnd } from "@/utils/format";

/** 安全解析 mapping group 的 rule JSON，格式异常返回 null */
function parseRuleJson(rule: string): Rule | null {
  try {
    return JSON.parse(rule) as Rule;
  } catch {
    /* rule JSON 格式异常，跳过该映射组 */
    return null;
  }
}

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

  /** 从映射组提取 client_model 和 backend_model 列表，避免扫描 metrics 大表 */
  async function loadModelOptions() {
    try {
      const groups = await api.getMappingGroups();
      const clientSet = new Set<string>();
      const backendSet = new Set<string>();
      for (const g of groups) {
        if (g.client_model) clientSet.add(g.client_model);
        const rule: Rule | null = parseRuleJson(g.rule);
        if (rule) {
          for (const t of rule.targets ?? []) {
            if (t.backend_model) backendSet.add(t.backend_model);
          }
        }
      }
      clientModelOptions.value = [...clientSet].sort();
      backendModelOptions.value = [...backendSet].sort();
    } catch (e: unknown) {
      console.error("useLogFilters.loadModelOptions:", e);
      clientModelOptions.value = [];
      backendModelOptions.value = [];
    }
  }

  onMounted(async () => {
    try {
      const init = await api.getLogsInit();
      if (init.providers)
        providers.value = init.providers as unknown as Provider[];
      if (init.router_keys) routerKeys.value = init.router_keys;
      if (init.client_models) clientModelOptions.value = init.client_models;
      if (init.backend_models) backendModelOptions.value = init.backend_models;
    } catch (e: unknown) {
      console.error("useLogFilters.init:", e);
      // fallback: 逐个加载
      await Promise.allSettled([
        loadProviders(),
        loadRouterKeys(),
        loadModelOptions(),
      ]);
    }
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
