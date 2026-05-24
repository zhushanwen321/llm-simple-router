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
  parseTransformRules,
  toggleChangedMappings,
} from "./quick-setup-helpers";
import { computeDefaultPatches } from "@/utils/model-patches";
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_STREAM_TIMEOUT_MS } from "@/constants";

const CONNECTION_DELAY_MS = 800;
const POST_SAVE_DELAY_MS = 1500;
const DEFAULT_CONCURRENCY = 10;
import type { Ref, ComputedRef } from "vue";
import type {
  ClientType,
  ModelConfig,
  MappingEntry,
  MappingTarget,
  MultimodalFallback,
} from "@/components/quick-setup/types";
import type { ProviderGroup, RecommendedRetryRule } from "@/api/client";
import type { MappingGroup } from "@/types/mapping";
import type { Provider as ApiProvider } from "@/types/mapping";
import type { ConcurrencyMode } from "@/types/concurrency";
import type { ProviderChangeContext } from "./quick-setup-helpers";

export interface ActionCtx {
  t: (key: string, params?: Record<string, unknown>) => string;
  clientType: Ref<ClientType>;
  providerGroups: Ref<ProviderGroup[]>;
  selectedGroup: Ref<string>;
  selectedPlan: Ref<string>;
  apiType: Ref<"openai" | "openai-responses" | "anthropic">;
  apiKey: Ref<string>;
  modelConfigs: Ref<ModelConfig[]>;
  mappingEntries: Ref<MappingEntry[]>;
  allRecommendedRules: Ref<RecommendedRetryRule[]>;
  selectedRetryRules: Ref<Set<string>>;
  retryProviderMap: Ref<Map<string, "general" | string>>;
  saving: Ref<boolean>;
  connectionStatus: Ref<string>;
  concurrencyMode: Ref<ConcurrencyMode>;
  maxConcurrency: Ref<number>;
  queueTimeoutMs: Ref<number>;
  maxQueueSize: Ref<number>;
  transformInjectHeaders: Ref<string>;
  transformDropFields: Ref<string>;
  transformRequestDefaults: Ref<string>;
  existingMappings: Ref<MappingGroup[]>;
  allProviders: Ref<ApiProvider[]>;
  isCustomProvider: ComputedRef<boolean>;
  currentClient: ComputedRef<
    { format: string; defaultProvider: string; defaultPlan: string } | undefined
  >;
  currentPreset: ComputedRef<
    | {
        apiType: string;
        baseUrl?: string;
        upstreamPath?: string;
      }
    | undefined
  >;
  baseUrl: ComputedRef<string>;
  upstreamPath: ComputedRef<string>;
  isNonOpenaiEndpoint: ComputedRef<boolean>;
  recommendedRules: ComputedRef<RecommendedRetryRule[]>;
  customBaseUrl: Ref<string>;
  customUpstreamPath: Ref<string>;
}

export function useQuickSetupActions(ctx: ActionCtx) {
  const updateMappings = () => {
    ctx.mappingEntries.value = buildMappingEntries(
      ctx.clientType.value,
      ctx.modelConfigs.value.filter((m) => m.enabled),
      ctx.existingMappings.value,
    );
  };
  const selectClient = (type: ClientType) => {
    ctx.clientType.value = type;
    const client = ctx.currentClient.value;
    if (client) {
      const defaults = resolveClientDefaults(
        {
          defaultProvider: client.defaultProvider,
          defaultPlan: client.defaultPlan,
          format: client.format,
        },
        ctx.providerGroups.value,
      );
      if (defaults) {
        ctx.selectedGroup.value = defaults.group;
        ctx.selectedPlan.value = defaults.plan;
        ctx.apiType.value = defaults.apiType;
        applyPresetModels(
          defaults.preset,
          ctx.modelConfigs,
          ctx.isNonOpenaiEndpoint,
        );
      }
    }
    updateMappings();
    syncRetry(ctx);
  };
  const providerCtx: ProviderChangeContext = {
    selectedGroup: ctx.selectedGroup,
    selectedPlan: ctx.selectedPlan,
    apiType: ctx.apiType,
    modelConfigs: ctx.modelConfigs,
    customBaseUrl: ctx.customBaseUrl,
    customUpstreamPath: ctx.customUpstreamPath,
    providerGroups: ctx.providerGroups,
    currentClient: ctx.currentClient,
    isNonOpenaiEndpoint: ctx.isNonOpenaiEndpoint,
    updateMappings,
    syncRetryRules: () => syncRetry(ctx),
  };
  const onProviderChange = (group: string) =>
    applyProviderChange(group, providerCtx);
  const onPlanChange = (plan: string) => {
    ctx.selectedPlan.value = plan;
    applyPlanChange(
      plan,
      ctx.selectedGroup,
      ctx.apiType,
      ctx.currentClient,
      ctx.modelConfigs,
      ctx.isNonOpenaiEndpoint,
      ctx.providerGroups,
      updateMappings,
    );
  };
  const toggleRetryRule = (name: string, checked: boolean) => {
    const next = new Set(ctx.selectedRetryRules.value);
    if (checked) next.add(name);
    else next.delete(name);
    ctx.selectedRetryRules.value = next;
  };
  const setAllRetryRules = (names: string[], checked: boolean) => {
    const next = new Set(ctx.selectedRetryRules.value);
    for (const n of names) {
      if (checked) next.add(n);
      else next.delete(n);
    }
    ctx.selectedRetryRules.value = next;
  };
  const updateMappingTargets = (index: number, targets: MappingTarget[]) => {
    ctx.mappingEntries.value = ctx.mappingEntries.value.map((e, i) =>
      i === index ? { ...e, targets } : e,
    );
  };
  const toggleMappingActive = (index: number) => {
    ctx.mappingEntries.value = ctx.mappingEntries.value.map((e, i) =>
      i === index ? { ...e, active: !e.active } : e,
    );
  };
  const updateMappingClientModel = (index: number, cm: string) => {
    ctx.mappingEntries.value = ctx.mappingEntries.value.map((e, i) =>
      i === index ? { ...e, clientModel: cm } : e,
    );
  };
  const updateMappingMultimodalFallback = (
    index: number,
    fb: MultimodalFallback | undefined,
  ) => {
    ctx.mappingEntries.value = ctx.mappingEntries.value.map((e, i) =>
      i === index ? { ...e, multimodalFallback: fb } : e,
    );
  };
  const addMappingEntry = (clientModel: string, targetModel: string) => {
    ctx.mappingEntries.value = [
      ...ctx.mappingEntries.value.filter((m) => m.clientModel !== clientModel),
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
    const entry = ctx.mappingEntries.value.find(
      (m) => m.clientModel === clientModel,
    );
    if (entry?.existing) {
      toast.error(ctx.t("quickSetup.messages.existingMappingDelete"));
      return;
    }
    ctx.mappingEntries.value = ctx.mappingEntries.value.filter(
      (m) => m.clientModel !== clientModel,
    );
  };
  const onConcurrencyModeChange = (mode: ConcurrencyMode) => {
    ctx.concurrencyMode.value = mode;
    if (mode === "auto") ctx.maxConcurrency.value = DEFAULT_CONCURRENCY;
    else if (mode === "manual") ctx.maxConcurrency.value = 3;
  };
  const testConnection = () => {
    if (!ctx.apiKey.value.trim()) {
      ctx.connectionStatus.value = "error";
      toast.error(ctx.t("quickSetup.messages.fillApiKeyFirst"));
      return Promise.resolve();
    }
    ctx.connectionStatus.value = "testing";
    return new Promise((r) => setTimeout(r, CONNECTION_DELAY_MS)).then(() => {
      ctx.connectionStatus.value = "ok";
    });
  };
  const addCustomModel = (name: string, cw = DEFAULT_CONTEXT_WINDOW) => {
    ctx.modelConfigs.value.push({
      name,
      contextWindow: cw,
      enabled: true,
      patches: computeDefaultPatches(
        name,
        ctx.apiType.value,
        ctx.isNonOpenaiEndpoint.value,
      ),
      stream_timeout_ms: DEFAULT_STREAM_TIMEOUT_MS,
      capabilities: ["text"],
    });
  };
  const submit = async () => {
    if (!ctx.currentPreset.value) {
      toast.error(ctx.t("quickSetup.messages.selectProviderAndPlan"));
      return;
    }
    if (!ctx.apiKey.value.trim()) {
      toast.error(ctx.t("quickSetup.messages.fillApiKey"));
      return;
    }
    ctx.saving.value = true;
    try {
      const tr = parseTransformRules(
        ctx.transformInjectHeaders.value.trim(),
        ctx.transformDropFields.value.trim(),
        ctx.transformRequestDefaults.value.trim(),
        (k) => toast.error(ctx.t(`quickSetup.messages.${k}`)),
      );
      if (tr === false) return;
      await api.quickSetup(
        buildQuickSetupPayload({
          isCustomProvider: ctx.isCustomProvider.value,
          selectedGroup: ctx.selectedGroup.value,
          retryProviderMap: ctx.retryProviderMap.value,
          selectedPlan: ctx.selectedPlan.value,
          apiType: ctx.apiType.value,
          baseUrl: ctx.baseUrl.value,
          upstreamPath: ctx.upstreamPath.value,
          apiKey: ctx.apiKey.value.trim(),
          models: ctx.modelConfigs.value.filter((m) => m.enabled),
          concurrencyMode: ctx.concurrencyMode.value,
          maxConcurrency: ctx.maxConcurrency.value,
          queueTimeoutMs: ctx.queueTimeoutMs.value,
          maxQueueSize: ctx.maxQueueSize.value,
          mappingEntries: ctx.mappingEntries.value,
          recommendedRules: ctx.recommendedRules.value,
          selectedRetryRules: ctx.selectedRetryRules.value,
          transformRules: tr,
        }),
      );
      const errs = await toggleChangedMappings(api, ctx.mappingEntries.value);
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
      ctx.saving.value = false;
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
    submit,
  };
}

function syncRetry(ctx: ActionCtx) {
  ctx.selectedRetryRules.value = new Set(
    ctx.recommendedRules.value.filter((r) => !r.exists).map((r) => r.name),
  );
  const sn = ctx.providerGroups.value.find(
    (g) => g.group === ctx.selectedGroup.value,
  )?.shortname;
  ctx.retryProviderMap.value = buildRetryProviderMap(
    ctx.recommendedRules.value,
    sn,
  );
}
