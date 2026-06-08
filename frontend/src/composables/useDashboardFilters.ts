import { ref, computed } from "vue";
import type { Ref, ComputedRef } from "vue";
import { api, getApiMessage } from "@/api/client";
import { toast } from "vue-sonner";
import type { Provider } from "@/types/mapping";

export interface DashboardFiltersInput {
  selectedProvider: Ref<string>;
  providers: Ref<Provider[]>;
  t: (key: string) => string;
}

export function useDashboardFilters({
  selectedProvider,
  providers,
  t,
}: DashboardFiltersInput) {
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

  const filterParams: ComputedRef<Record<string, string>> = computed(() => {
    const p: Record<string, string> = {};
    if (selectedProvider.value) p.provider_id = selectedProvider.value;
    if (modelFilter.value !== "all") p.backend_model = modelFilter.value;
    if (keyFilter.value !== "all") p.router_key_id = keyFilter.value;
    if (clientType.value !== "all") p.client_type = clientType.value;
    return p;
  });

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
    filterParams,
    loadFilterOptions,
  };
}
