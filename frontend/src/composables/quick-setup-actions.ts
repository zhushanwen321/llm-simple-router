import { toast } from "vue-sonner";
import { getApiMessage, api } from "@/api/client";
import router from "@/router";
import {
  buildMappingEntries,
  buildQuickSetupPayload,
  buildRetryProviderMap,
  applyPresetModels,
  resolveClientDefaults,
  applyProviderChange,
  applyPlanChange,
  applyPresetEndpoints,
  parseTransformRules,
  toggleChangedMappings,
} from "./quick-setup-helpers";
import { computeDefaultPatches } from "@/utils/model-patches";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_STREAM_TIMEOUT_MS } from "@/constants";

const CONNECTION_DELAY_MS = 800;
const POST_SAVE_DELAY_MS = 1500;
import type { Ref, ComputedRef } from "vue";
import type {
  ClientType,
  ModelConfig,
  MappingEntry,
  MappingTarget,
  MultimodalFallback,
} from "@/components/quick-setup/types";
import type { ProviderGroup, RecommendedRetryRule } from "@/api/client";
import type { MappingGroup, ProviderEndpoint } from "@/types/mapping";
import type { Provider as ApiProvider } from "@/types/mapping";
import {
  DEFAULT_CONCURRENCY_CONFIG,
  DEFAULT_CONCURRENCY_MANUAL_CONFIG,
  type TransformConfig,
  type ConcurrencyConfig,
} from "@/components/shared/types";
import type { ConcurrencyMode } from "@/types/concurrency";
import type { ProviderChangeContext } from "./quick-setup-helpers";

/** Client/provider/plan selection state */
export interface SelectionState {
  clientType: Ref<ClientType>;
  selectedGroup: Ref<string>;
  selectedPlan: Ref<string>;
  apiType: Ref<"openai" | "openai-responses" | "anthropic">;
  providerGroups: Ref<ProviderGroup[]>;
  currentClient: ComputedRef<
    { format: string; defaultProvider: string; defaultPlan: string } | undefined
  >;
  currentPreset: ComputedRef<
    { apiType: string; baseUrl?: string; upstreamPath?: string } | undefined
  >;
  isCustomProvider: ComputedRef<boolean>;
  customBaseUrl: Ref<string>;
  customUpstreamPath: Ref<string>;
}

/** Core mutable data: models, mappings, keys, retry rules */
export interface DataState {
  modelConfigs: Ref<ModelConfig[]>;
  mappingEntries: Ref<MappingEntry[]>;
  apiKey: Ref<string>;
  baseUrl: ComputedRef<string>;
  upstreamPath: ComputedRef<string>;
  existingMappings: Ref<MappingGroup[]>;
  allProviders: Ref<ApiProvider[]>;
  allRecommendedRules: Ref<RecommendedRetryRule[]>;
  recommendedRules: ComputedRef<RecommendedRetryRule[]>;
  selectedRetryRules: Ref<Set<string>>;
  retryProviderMap: Ref<Map<string, "general" | string>>;
  isNonOpenaiEndpoint: ComputedRef<boolean>;
  endpoints: Ref<ProviderEndpoint[]>;
}

/** Submit configuration: saving state, concurrency, transforms */
export interface SubmitState {
  saving: Ref<boolean>;
  connectionStatus: Ref<string>;
  concurrencyConfig: Ref<ConcurrencyConfig>;
  transformConfig: Ref<TransformConfig>;
}

export interface ActionCtx {
  t: (key: string, params?: Record<string, unknown>) => string;
  selection: SelectionState;
  data: DataState;
  submit: SubmitState;
}

export function useQuickSetupActions(ctx: ActionCtx) {
  const updateMappings = () => {
    ctx.data.mappingEntries.value = buildMappingEntries(
      ctx.selection.clientType.value,
      ctx.data.modelConfigs.value.filter((m) => m.enabled),
      ctx.data.existingMappings.value,
    );
  };
  const selectClient = (type: ClientType) => {
    const { selection, data } = ctx;
    selection.clientType.value = type;
    const client = selection.currentClient.value;
    if (client) {
      const defaults = resolveClientDefaults(
        {
          defaultProvider: client.defaultProvider,
          defaultPlan: client.defaultPlan,
          format: client.format,
        },
        selection.providerGroups.value,
      );
      if (defaults) {
        selection.selectedGroup.value = defaults.group;
        selection.selectedPlan.value = defaults.plan;
        selection.apiType.value = defaults.apiType;
        applyPresetModels(
          defaults.preset,
          data.modelConfigs,
          data.isNonOpenaiEndpoint,
        );
        // Generate endpoints from the group's presets
        const groupData = selection.providerGroups.value.find(
          (g) => g.group === defaults.group,
        );
        if (groupData) {
          applyPresetEndpoints(data.endpoints, groupData.presets);
        }
      }
    }
    updateMappings();
    syncRetry(ctx);
  };
  const providerCtx: ProviderChangeContext = {
    selectedGroup: ctx.selection.selectedGroup,
    selectedPlan: ctx.selection.selectedPlan,
    apiType: ctx.selection.apiType,
    modelConfigs: ctx.data.modelConfigs,
    customBaseUrl: ctx.selection.customBaseUrl,
    customUpstreamPath: ctx.selection.customUpstreamPath,
    providerGroups: ctx.selection.providerGroups,
    currentClient: ctx.selection.currentClient,
    isNonOpenaiEndpoint: ctx.data.isNonOpenaiEndpoint,
    endpoints: ctx.data.endpoints,
    updateMappings,
    syncRetryRules: () => syncRetry(ctx),
  };
  const onProviderChange = (group: string) =>
    applyProviderChange(group, providerCtx);
  const onPlanChange = (plan: string) => {
    const { selection, data } = ctx;
    selection.selectedPlan.value = plan;
    applyPlanChange(
      plan,
      selection.selectedGroup,
      selection.apiType,
      selection.currentClient,
      data.modelConfigs,
      data.isNonOpenaiEndpoint,
      selection.providerGroups,
      data.endpoints,
      updateMappings,
    );
  };
  const toggleRetryRule = (name: string, checked: boolean) => {
    const next = new Set(ctx.data.selectedRetryRules.value);
    if (checked) next.add(name);
    else next.delete(name);
    ctx.data.selectedRetryRules.value = next;
  };
  const setAllRetryRules = (names: string[], checked: boolean) => {
    const next = new Set(ctx.data.selectedRetryRules.value);
    for (const n of names) {
      if (checked) next.add(n);
      else next.delete(n);
    }
    ctx.data.selectedRetryRules.value = next;
  };
  const updateMappingTargets = (index: number, targets: MappingTarget[]) => {
    ctx.data.mappingEntries.value = ctx.data.mappingEntries.value.map((e, i) =>
      i === index ? { ...e, targets } : e,
    );
  };
  const toggleMappingActive = (index: number) => {
    ctx.data.mappingEntries.value = ctx.data.mappingEntries.value.map((e, i) =>
      i === index ? { ...e, active: !e.active } : e,
    );
  };
  const updateMappingClientModel = (index: number, cm: string) => {
    ctx.data.mappingEntries.value = ctx.data.mappingEntries.value.map((e, i) =>
      i === index ? { ...e, clientModel: cm } : e,
    );
  };
  const updateMappingMultimodalFallback = (
    index: number,
    fb: MultimodalFallback | undefined,
  ) => {
    ctx.data.mappingEntries.value = ctx.data.mappingEntries.value.map((e, i) =>
      i === index ? { ...e, multimodalFallback: fb } : e,
    );
  };
  const addMappingEntry = (clientModel: string, targetModel: string) => {
    ctx.data.mappingEntries.value = [
      ...ctx.data.mappingEntries.value.filter(
        (m) => m.clientModel !== clientModel,
      ),
      {
        clientModel,
        targets: [{ backend_model: targetModel, provider_id: "__new__" }],
        existing: false,
        tag: "cust" as const,
        active: true,
      },
    ];
  };
  const removeMappingEntry = (clientModel: string) => {
    const entry = ctx.data.mappingEntries.value.find(
      (m) => m.clientModel === clientModel,
    );
    if (entry?.existing) {
      toast.error(ctx.t("quickSetup.messages.existingMappingDelete"));
      return;
    }
    ctx.data.mappingEntries.value = ctx.data.mappingEntries.value.filter(
      (m) => m.clientModel !== clientModel,
    );
  };
  const onConcurrencyModeChange = (mode: ConcurrencyMode) => {
    ctx.submit.concurrencyConfig.value = {
      ...ctx.submit.concurrencyConfig.value,
      mode,
    };
    if (mode === "auto")
      ctx.submit.concurrencyConfig.value.max_concurrency =
        DEFAULT_CONCURRENCY_CONFIG.max_concurrency;
    else if (mode === "manual")
      ctx.submit.concurrencyConfig.value.max_concurrency =
        DEFAULT_CONCURRENCY_MANUAL_CONFIG.max_concurrency;
  };
  const testConnection = () => {
    if (!ctx.data.apiKey.value.trim()) {
      ctx.submit.connectionStatus.value = "error";
      toast.error(ctx.t("quickSetup.messages.fillApiKeyFirst"));
      return Promise.resolve();
    }
    ctx.submit.connectionStatus.value = "testing";
    return new Promise((r) => setTimeout(r, CONNECTION_DELAY_MS)).then(() => {
      ctx.submit.connectionStatus.value = "ok";
    });
  };
  const addCustomModel = (name: string, cw = DEFAULT_CONTEXT_WINDOW) => {
    ctx.data.modelConfigs.value.push({
      name,
      contextWindow: cw,
      enabled: true,
      patches: computeDefaultPatches(
        name,
        ctx.selection.apiType.value,
        ctx.data.isNonOpenaiEndpoint.value,
      ),
      stream_timeout_ms: DEFAULT_STREAM_TIMEOUT_MS,
      capabilities: ["text"],
    });
  };
  const updateModel = (index: number, updated: ModelConfig) => {
    const next = [...ctx.data.modelConfigs.value];
    next[index] = updated;
    ctx.data.modelConfigs.value = next;
  };
  const removeModel = (index: number) => {
    ctx.data.modelConfigs.value = ctx.data.modelConfigs.value.filter(
      (_, i) => i !== index,
    );
  };
  const updateModelTimeout = (index: number, ms: number | undefined) => {
    const next = [...ctx.data.modelConfigs.value];
    next[index] = { ...next[index], stream_timeout_ms: ms || undefined };
    ctx.data.modelConfigs.value = next;
  };
  const toggleModelCapability = (index: number, capability: string) => {
    const next = [...ctx.data.modelConfigs.value];
    const model = { ...next[index] };
    const caps = model.capabilities ?? ["text"];
    if (caps.includes(capability)) {
      model.capabilities = caps.filter((c) => c !== capability);
    } else {
      model.capabilities = [...caps, capability];
    }
    next[index] = model;
    ctx.data.modelConfigs.value = next;
  };
  const submit = async () => {
    const { selection, data, submit: sub } = ctx;
    if (!selection.currentPreset.value) {
      toast.error(ctx.t("quickSetup.messages.selectProviderAndPlan"));
      return;
    }
    if (!data.apiKey.value.trim()) {
      toast.error(ctx.t("quickSetup.messages.fillApiKey"));
      return;
    }
    sub.saving.value = true;
    try {
      const tr = parseTransformRules(sub.transformConfig.value, (k) =>
        toast.error(ctx.t(`quickSetup.messages.${k}`)),
      );
      if (tr === false) return;
      await api.quickSetup(
        buildQuickSetupPayload({
          isCustomProvider: selection.isCustomProvider.value,
          selectedGroup: selection.selectedGroup.value,
          retryProviderMap: data.retryProviderMap.value,
          selectedPlan: selection.selectedPlan.value,
          apiType: selection.apiType.value,
          baseUrl: data.baseUrl.value,
          upstreamPath: data.upstreamPath.value,
          apiKey: data.apiKey.value.trim(),
          models: data.modelConfigs.value.filter((m) => m.enabled),
          concurrency: sub.concurrencyConfig.value,
          mappingEntries: data.mappingEntries.value,
          recommendedRules: data.recommendedRules.value,
          selectedRetryRules: data.selectedRetryRules.value,
          transformRules: tr,
          endpoints:
            data.endpoints.value.length > 0
              ? data.endpoints.value.map((ep) => ({
                ...ep,
                api_key: ep.api_key || data.apiKey.value.trim() || null,
              }))
              : undefined,
        }),
      );
      const errs = await toggleChangedMappings(api, data.mappingEntries.value);
      toast.success(
        errs.length > 0
          ? ctx.t("quickSetup.messages.setupCompleteWithErrors", {
            count: errs.length,
          })
          : ctx.t("quickSetup.messages.setupComplete"),
      );
      await new Promise((r) => setTimeout(r, POST_SAVE_DELAY_MS));
      router.push("/");
    } catch (e: unknown) {
      console.error("quickSetup.save:", e);
      toast.error(getApiMessage(e, ctx.t("quickSetup.messages.setupFailed")));
    } finally {
      sub.saving.value = false;
    }
  };

  return {
    updateMappings,
    selectClient,
    onProviderChange,
    onPlanChange,
    toggleRetryRule,
    setAllRetryRules,
    updateMappingTargets,
    updateMappingClientModel,
    updateMappingMultimodalFallback,
    toggleMappingActive,
    addMappingEntry,
    removeMappingEntry,
    onConcurrencyModeChange,
    testConnection,
    addCustomModel,
    updateModel,
    removeModel,
    updateModelTimeout,
    toggleModelCapability,
    submit,
  };
}

function syncRetry(ctx: ActionCtx) {
  const { selection, data } = ctx;
  data.selectedRetryRules.value = new Set(
    data.recommendedRules.value.filter((r) => !r.exists).map((r) => r.name),
  );
  const sn = selection.providerGroups.value.find(
    (g) => g.group === selection.selectedGroup.value,
  )?.shortname;
  data.retryProviderMap.value = buildRetryProviderMap(
    data.recommendedRules.value,
    sn,
  );
}
