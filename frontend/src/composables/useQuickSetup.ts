import {
  ref,
  computed,
  onMounted,
  watch,
  type Ref,
  type ComputedRef,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  api,
  getApiMessage,
  type ProviderGroup,
  type RecommendedRetryRule,
} from "@/api/client";
import type {
  MappingGroup,
  Provider as ApiProvider,
  ProviderEndpoint,
} from "@/types/mapping";
import { toast } from "vue-sonner";
import {
  type ClientType,
  type ModelConfig,
  type MappingEntry,
  CLIENTS,
} from "@/components/quick-setup/types";
import { DEFAULT_CONTEXT_WINDOW } from "@/constants";
import {
  DEFAULT_CONCURRENCY_CONFIG,
  DEFAULT_TRANSFORM_CONFIG,
} from "@/components/shared/types";
import type {
  ConcurrencyConfig,
  TransformConfig,
} from "@/components/shared/types";
import { computeDefaultPatches } from "@/utils/model-patches";
import { toProviderName } from "./quick-setup-helpers";
import { useQuickSetupActions, type ActionCtx } from "./quick-setup-actions";

function computeProviderGroupDisplayInfo(
  isCustomProvider: ComputedRef<boolean>,
  selectedGroup: Ref<string>,
  selectedPlan: Ref<string>,
  modelConfigs: Ref<ModelConfig[]>,
  allProviders: Ref<ApiProvider[]>,
  t: (key: string, params?: Record<string, unknown>) => string,
) {
  const currentProviderGroup = computed(() => {
    if (!selectedGroup.value) return null;
    const tempId = isCustomProvider.value
      ? "__new_custom__"
      : `__new_${toProviderName(selectedGroup.value)}_${toProviderName(selectedPlan.value)}__`;
    const displayName = isCustomProvider.value
      ? t("quickSetup.provider.customProvider")
      : `${selectedGroup.value} - ${selectedPlan.value}`;
    return {
      provider: { id: tempId, name: displayName },
      models: modelConfigs.value
        .filter((m) => m.enabled)
        .map((m) => ({ name: m.name, contextWindow: m.contextWindow })),
      isNew: true,
    };
  });
  const allProviderGroups = computed(() => {
    const existing = allProviders.value.map((p) => ({
      provider: { id: p.id, name: p.name },
      models: (p.models ?? []).map((m) => ({
        name: m.name,
        contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
      })),
    }));
    if (
      currentProviderGroup.value &&
      currentProviderGroup.value.models.length > 0
    ) {
      return [...existing, currentProviderGroup.value];
    }
    return existing;
  });
  return { allProviderGroups };
}

export function useQuickSetup() {
  const { t } = useI18n();
  const clientType = ref<ClientType>("claude-code");
  const providerGroups = ref<ProviderGroup[]>([]);
  const selectedGroup = ref("");
  const selectedPlan = ref("");
  const apiType = ref<"openai" | "openai-responses" | "anthropic">("anthropic");
  // sharedKey 是页面绑定的 API Key 输入框，同时作为提交和测试连接的 key
  const apiKey = ref("");
  const sharedKey = apiKey;
  const endpoints = ref<ProviderEndpoint[]>([]);
  const modelConfigs = ref<ModelConfig[]>([]);
  const mappingEntries = ref<MappingEntry[]>([]);
  const allRecommendedRules = ref<RecommendedRetryRule[]>([]);
  const selectedRetryRules = ref<Set<string>>(new Set());
  const retryProviderMap = ref<Map<string, "general" | string>>(new Map());
  const saving = ref(false);
  const connectionStatus = ref<"idle" | "testing" | "ok" | "error">("idle");
  const concurrencyConfig = ref<ConcurrencyConfig>({
    ...DEFAULT_CONCURRENCY_CONFIG,
  });
  const transformConfig = ref<TransformConfig>({ ...DEFAULT_TRANSFORM_CONFIG });
  const existingMappings = ref<MappingGroup[]>([]);
  const allProviders = ref<ApiProvider[]>([]);
  const isCustomProvider = computed(() => selectedGroup.value === "__custom__");
  const currentClient = computed(() =>
    CLIENTS.find((c) => c.id === clientType.value),
  );
  const currentPreset = computed(() => {
    if (!selectedGroup.value || !selectedPlan.value) return undefined;
    const group = providerGroups.value.find(
      (g) => g.group === selectedGroup.value,
    );
    return group?.presets.find((p) => p.plan === selectedPlan.value);
  });
  const customBaseUrl = ref("");
  const customUpstreamPath = ref("");
  const presetBaseUrl = ref("");
  const presetUpstreamPath = ref("");

  // Sync preset URLs when the current preset changes
  watch(currentPreset, (preset) => {
    if (preset && !isCustomProvider.value) {
      presetBaseUrl.value = preset.baseUrl;
      const defPath =
        preset.apiType === "anthropic"
          ? "/v1/messages"
          : preset.apiType === "openai-responses"
            ? "/v1/responses"
            : "/v1/chat/completions";
      presetUpstreamPath.value =
        preset.upstreamPath && preset.upstreamPath !== defPath
          ? preset.upstreamPath
          : "";
    }
  });

  const baseUrl = computed(() =>
    isCustomProvider.value ? customBaseUrl.value : presetBaseUrl.value,
  );
  const upstreamPath = computed(() =>
    isCustomProvider.value
      ? customUpstreamPath.value
      : presetUpstreamPath.value,
  );
  const availablePlans = computed(
    () =>
      providerGroups.value.find((g) => g.group === selectedGroup.value)
        ?.presets ?? [],
  );
  const isNonOpenaiEndpoint = computed(
    () => !baseUrl.value.includes("openai.com"),
  );
  const recommendedRules = computed(() => {
    const shortname =
      providerGroups.value.find((g) => g.group === selectedGroup.value)
        ?.shortname ?? selectedGroup.value;
    return allRecommendedRules.value.filter(
      (r) =>
        !r.providers ||
        r.providers.length === 0 ||
        r.providers.includes(shortname),
    );
  });
  const allProviderGroups = computeProviderGroupDisplayInfo(
    isCustomProvider,
    selectedGroup,
    selectedPlan,
    modelConfigs,
    allProviders,
    t,
  ).allProviderGroups;

  const actionCtx: ActionCtx = {
    t,
    selection: {
      clientType,
      selectedGroup,
      selectedPlan,
      apiType,
      providerGroups,
      currentClient,
      currentPreset,
      isCustomProvider,
      customBaseUrl,
      customUpstreamPath,
    },
    data: {
      modelConfigs,
      mappingEntries,
      apiKey,
      baseUrl,
      upstreamPath,
      existingMappings,
      allProviders,
      allRecommendedRules,
      recommendedRules,
      selectedRetryRules,
      retryProviderMap,
      isNonOpenaiEndpoint,
      endpoints,
    },
    submit: {
      saving,
      connectionStatus,
      concurrencyConfig,
      transformConfig,
    },
  };
  const actions = useQuickSetupActions(actionCtx);

  watch(apiType, () => {
    for (const m of modelConfigs.value) {
      m.patches = computeDefaultPatches(
        m.name,
        apiType.value,
        isNonOpenaiEndpoint.value,
      );
    }
  });

  onMounted(async () => {
    try {
      const init = await api.getQuickSetupInit();
      providerGroups.value = init.provider_groups;
      allRecommendedRules.value = init.recommended_rules;
      existingMappings.value = init.existing_mappings;
      allProviders.value = init.existing_providers;
      actions.selectClient("claude-code");
    } catch (e: unknown) {
      console.error("quickSetup.load:", e);
      toast.error(getApiMessage(e, ""));
    }
  });

  return {
    clientType,
    providerGroups,
    selectedGroup,
    selectedPlan,
    apiType,
    apiKey,
    sharedKey,
    endpoints,
    modelConfigs,
    mappingEntries,
    allRecommendedRules,
    recommendedRules,
    selectedRetryRules,
    retryProviderMap,
    saving,
    connectionStatus,
    currentClient,
    currentPreset,
    baseUrl,
    customBaseUrl,
    presetBaseUrl,
    upstreamPath,
    customUpstreamPath,
    presetUpstreamPath,
    isCustomProvider,
    availablePlans,
    isNonOpenaiEndpoint,
    concurrencyConfig,
    transformConfig,
    existingMappings,
    allProviders,
    allProviderGroups,
    ...actions,
    setRetryProvider: (n: string, v: "general" | string) =>
      void retryProviderMap.value.set(n, v),
  };
}
