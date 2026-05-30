import type { Ref, ComputedRef } from "vue";
import {
  type ProviderGroup,
  type RecommendedRetryRule,
  type QuickSetupPayload,
  api as ApiNamespace,
} from "@/api/client";
import type { MappingGroup, ProviderEndpoint } from "@/types/mapping";
import type { Rule } from "@/types/mapping";
import type {
  TransformConfig,
  ConcurrencyConfig,
} from "@/components/shared/types";
import {
  type ClientType,
  type ModelConfig,
  type MappingEntry,
  DEFAULT_CLIENT_MAPPINGS,
  getDefaultContextWindow,
} from "@/components/quick-setup/types";
import { computeDefaultPatches } from "@/utils/model-patches";
import { DEFAULT_STREAM_TIMEOUT_MS } from "@/constants";
import { buildTransformRule as buildTransformRuleCore } from "@/utils/transform-domain";

type Api = typeof ApiNamespace;

/** Convert Chinese provider group name to valid backend name (a-zA-Z0-9_-) */
const PROVIDER_NAME_MAP: Record<string, string> = {
  DeepSeek: "deepseek",
  百度千帆: "qianfan",
  科大讯飞: "iflytek",
  硅基流动: "siliconflow",
  智谱: "zhipu",
  月之暗面: "moonshot",
  Minimax: "minimax",
  火山引擎: "volcengine",
  阿里云: "aliyun",
  腾讯云: "tencent",
  OpenCode: "opencode",
  阶跃星辰: "stepfun",
};

export function toProviderName(group: string): string {
  return (
    PROVIDER_NAME_MAP[group] ??
    group
      .toLowerCase()
      .replace(/[^a-z0-9]/gi, "-")
      .replace(/-+/g, "-")
  );
}

export function parseTransformRules(
  config: TransformConfig,
  onError: (msg: string) => void,
): NonNullable<QuickSetupPayload["transform_rules"]> | undefined | false {
  const { injectHeaders, dropFields, requestDefaults } = config;
  if (!injectHeaders.trim() && !dropFields.trim() && !requestDefaults.trim())
    return undefined;

  const { rule, errorKey } = buildTransformRuleCore({
    injectHeaders,
    dropFields,
    requestDefaults,
  });

  if (errorKey) {
    onError(errorKey);
    return false;
  }
  if (!rule) return undefined;

  return JSON.parse(rule) as NonNullable<QuickSetupPayload["transform_rules"]>;
}

/** Toggle active state for existing mappings that changed */
export async function toggleChangedMappings(
  apiClient: Api,
  entries: MappingEntry[],
): Promise<string[]> {
  const errors: string[] = [];
  for (const entry of entries) {
    if (
      entry.existing &&
      entry.existingId &&
      entry.originalActive !== undefined &&
      entry.active !== entry.originalActive
    ) {
      try {
        await apiClient.toggleMappingGroup(entry.existingId);
      } catch (e: unknown) {
        console.error("quick-setup-helpers.toggleChangedMappings:", e);
        errors.push(entry.clientModel);
      }
    }
  }
  return errors;
}

/** Build retry rules payload from selected rules */
function buildRetryRulesPayload(
  rules: RecommendedRetryRule[],
  selectedRules: Set<string>,
  providerMap: Map<string, "general" | string>,
): QuickSetupPayload["retry_rules"] {
  return rules
    .filter((r) => selectedRules.has(r.name) && !r.exists)
    .map((r) => {
      const binding = providerMap.get(r.name) ?? "general";
      return {
        name: r.name,
        status_code: r.status_code,
        body_pattern: r.body_pattern,
        retry_strategy: r.retry_strategy,
        retry_delay_ms: r.retry_delay_ms,
        max_retries: r.max_retries,
        max_delay_ms: r.max_delay_ms,
        provider_shortname: binding === "general" ? null : binding,
      };
    });
}

interface ProviderPayloadInput {
  isCustom: boolean;
  selectedGroup: string;
  selectedPlan: string;
  apiType: "openai" | "openai-responses" | "anthropic";
  baseUrl: string;
  upstreamPath: string;
  apiKey: string;
  models: ModelConfig[];
  concurrency: ConcurrencyConfig;
  endpoints?: ProviderEndpoint[];
}

function buildProviderPayload(
  input: ProviderPayloadInput,
): QuickSetupPayload["provider"] {
  return {
    name: input.isCustom
      ? `custom-${Date.now()}`
      : `${toProviderName(input.selectedGroup)}-${toProviderName(input.selectedPlan)}`,
    api_type: input.apiType,
    base_url: input.baseUrl,
    upstream_path: input.upstreamPath || undefined,
    api_key: input.apiKey,
    models: input.models.map((m) => ({
      name: m.name,
      context_window: m.contextWindow,
      patches: m.patches.length > 0 ? m.patches : undefined,
      stream_timeout_ms: m.stream_timeout_ms ?? undefined,
      capabilities:
        m.capabilities && m.capabilities.length > 0
          ? m.capabilities
          : undefined,
    })),
    concurrency_mode: input.concurrency.mode,
    max_concurrency:
      input.concurrency.mode !== "none"
        ? input.concurrency.max_concurrency
        : undefined,
    queue_timeout_ms:
      input.concurrency.mode !== "none"
        ? input.concurrency.queue_timeout_ms
        : undefined,
    max_queue_size:
      input.concurrency.mode !== "none"
        ? input.concurrency.max_queue_size
        : undefined,
    ...(input.endpoints && input.endpoints.length > 0
      ? { endpoints: input.endpoints }
      : {}),
  };
}

/** Build mapping entries by merging existing DB mappings with client defaults */
export function buildMappingEntries(
  clientType: ClientType,
  enabledModels: ModelConfig[],
  existingMappings: MappingGroup[],
): MappingEntry[] {
  let clientModelNames: string[];
  if (clientType === "pi") {
    clientModelNames = enabledModels.map((m) => m.name);
  } else {
    clientModelNames =
      DEFAULT_CLIENT_MAPPINGS[clientType] ?? enabledModels.map((m) => m.name);
  }

  return clientModelNames.map((cmName) => {
    const existingGroup = existingMappings.find(
      (g) => g.client_model === cmName,
    );
    if (existingGroup) {
      let rule: Rule = {};
      try {
        rule = JSON.parse(existingGroup.rule);
      } catch {
        /* JSON 解析失败，回退空对象 */ rule = {};
      }
      const targets = rule.targets ?? [];
      return {
        clientModel: cmName,
        targets:
          targets.length > 0
            ? targets.map((t) => ({
              backend_model: t.backend_model,
              provider_id: t.provider_id,
              overflow_provider_id: t.overflow_provider_id,
              overflow_model: t.overflow_model,
            }))
            : [
              {
                backend_model: enabledModels[0]?.name ?? "",
                provider_id: "__new__",
              },
            ],
        existing: true,
        existingId: existingGroup.id,
        tag: "existing" as const,
        active: !!existingGroup.is_active,
        originalActive: !!existingGroup.is_active,
      };
    }

    const defaultTarget =
      enabledModels[clientModelNames.indexOf(cmName)]?.name ??
      enabledModels[enabledModels.length - 1]?.name ??
      "";
    return {
      clientModel: cmName,
      targets: [{ backend_model: defaultTarget, provider_id: "__new__" }],
      existing: false,
      tag: (clientType === "pi" ? "auto" : "def") as "auto" | "def",
      active: true,
    };
  });
}

/** Resolve the effective apiType, preserving openai-responses for codex clients
 *  when the preset is openai-compatible. Anthropic presets are never overridden. */
export function resolveApiType(
  clientFormat: string | undefined,
  presetApiType: string,
): "openai" | "openai-responses" | "anthropic" {
  if (
    clientFormat === "openai-responses" &&
    (presetApiType === "openai" || presetApiType === "openai-responses")
  ) {
    return "openai-responses";
  }
  return presetApiType as "openai" | "openai-responses" | "anthropic";
}

interface QuickSetupPayloadInput {
  isCustomProvider: boolean;
  selectedGroup: string;
  retryProviderMap: Map<string, "general" | string>;
  selectedPlan: string;
  apiType: "openai" | "openai-responses" | "anthropic";
  baseUrl: string;
  upstreamPath: string;
  apiKey: string;
  models: ModelConfig[];
  concurrency: ConcurrencyConfig;
  mappingEntries: MappingEntry[];
  recommendedRules: RecommendedRetryRule[];
  selectedRetryRules: Set<string>;
  transformRules: QuickSetupPayload["transform_rules"];
  endpoints?: ProviderEndpoint[];
}

export function buildQuickSetupPayload(
  input: QuickSetupPayloadInput,
): QuickSetupPayload {
  return {
    provider: buildProviderPayload({
      isCustom: input.isCustomProvider,
      selectedGroup: input.selectedGroup,
      selectedPlan: input.selectedPlan,
      apiType: input.apiType,
      baseUrl: input.baseUrl,
      upstreamPath: input.upstreamPath,
      apiKey: input.apiKey,
      models: input.models,
      concurrency: input.concurrency,
      endpoints: input.endpoints,
    }),
    mappings: input.mappingEntries
      .filter((m) => m.targets[0]?.backend_model)
      .map((m) => {
        const hasAdvancedConfig =
          m.targets.length > 1 ||
          m.targets[0]?.overflow_model ||
          m.multimodalFallback?.backend_model;
        if (hasAdvancedConfig) {
          const ruleObj: Record<string, unknown> = {
            targets: m.targets.map((t) => {
              const target: Record<string, unknown> = {
                backend_model: t.backend_model,
                provider_id: t.provider_id,
              };
              if (t.overflow_provider_id)
                target.overflow_provider_id = t.overflow_provider_id;
              if (t.overflow_model) target.overflow_model = t.overflow_model;
              return target;
            }),
          };
          if (m.multimodalFallback?.backend_model) {
            ruleObj.multimodal_fallback = {
              provider_id: m.multimodalFallback.provider_id,
              backend_model: m.multimodalFallback.backend_model,
            };
          }
          return {
            client_model: m.clientModel,
            backend_model: m.targets[0]?.backend_model ?? "",
            rule: JSON.stringify(ruleObj),
          };
        }
        return {
          client_model: m.clientModel,
          backend_model: m.targets[0]?.backend_model ?? "",
        };
      }),
    retry_rules: buildRetryRulesPayload(
      input.recommendedRules,
      input.selectedRetryRules,
      input.retryProviderMap,
    ),
    transform_rules: input.transformRules,
  };
}

export function buildRetryProviderMap(
  rules: RecommendedRetryRule[],
  currentShortname: string | undefined,
): Map<string, "general" | string> {
  const map = new Map<string, "general" | string>();
  for (const rule of rules) {
    if (rule.exists) continue;
    const ruleProviders = rule.providers ?? [];
    if (
      ruleProviders.length > 0 &&
      currentShortname &&
      ruleProviders.includes(currentShortname)
    ) {
      map.set(rule.name, currentShortname);
    } else {
      map.set(rule.name, "general");
    }
  }
  return map;
}

export function applyPresetModels(
  preset: {
    models: string[];
    modelCapabilities?: Record<string, string[]>;
    apiType: "openai" | "openai-responses" | "anthropic";
  },
  modelConfigs: { value: ModelConfig[] },
  isNonOpenaiEndpoint: { value: boolean },
): void {
  modelConfigs.value = preset.models.map((name) => ({
    name,
    contextWindow: getDefaultContextWindow(name),
    enabled: true,
    patches: computeDefaultPatches(
      name,
      preset.apiType,
      isNonOpenaiEndpoint.value,
    ),
    stream_timeout_ms: DEFAULT_STREAM_TIMEOUT_MS,
    capabilities: preset.modelCapabilities?.[name],
  }));
}

export function resolveClientDefaults(
  client: { defaultProvider: string; defaultPlan: string; format: string },
  groups: ProviderGroup[],
): {
  group: string;
  plan: string;
  apiType: "openai" | "openai-responses" | "anthropic";
  preset: ProviderGroup["presets"][number];
} | null {
  const groupData = groups.find((g) => g.group === client.defaultProvider);
  if (!groupData || groupData.presets.length === 0) return null;
  const compatibleFormats =
    client.format === "openai-responses"
      ? ["openai-responses", "openai"]
      : [client.format];
  const match = groupData.presets.find(
    (p) =>
      compatibleFormats.includes(p.apiType) && p.plan === client.defaultPlan,
  );
  const preset =
    match ??
    groupData.presets.find((p) => compatibleFormats.includes(p.apiType)) ??
    groupData.presets[0];
  return {
    group: groupData.group,
    plan: preset.plan,
    apiType: resolveApiType(client.format, preset.apiType),
    preset,
  };
}
export interface ProviderChangeContext {
  selectedGroup: Ref<string>;
  selectedPlan: Ref<string>;
  apiType: Ref<"openai" | "openai-responses" | "anthropic">;
  modelConfigs: Ref<ModelConfig[]>;
  customBaseUrl: Ref<string>;
  customUpstreamPath: Ref<string>;
  providerGroups: Ref<ProviderGroup[]>;
  currentClient: ComputedRef<{ format: string } | undefined>;
  isNonOpenaiEndpoint: ComputedRef<boolean>;
  endpoints: Ref<ProviderEndpoint[]>;
  updateMappings: () => void;
  syncRetryRules: () => void;
}

export function applyProviderChange(
  group: string,
  ctx: ProviderChangeContext,
): void {
  ctx.selectedGroup.value = group;
  ctx.selectedPlan.value = "";
  ctx.modelConfigs.value = [];
  ctx.endpoints.value = [];
  if (group === "__custom__") {
    ctx.apiType.value = "openai";
    ctx.customBaseUrl.value = "";
    ctx.customUpstreamPath.value = "";
    ctx.endpoints.value = [
      { api_type: "openai", base_url: "", upstream_path: null, api_key: null },
    ];
  } else {
    const groupData = ctx.providerGroups.value.find((g) => g.group === group);
    if (groupData && groupData.presets.length > 0) {
      const client = ctx.currentClient.value;
      const compatibleFormats =
        client?.format === "openai-responses"
          ? ["openai-responses", "openai"]
          : client
            ? [client.format]
            : [];
      const match = client
        ? groupData.presets.find((p) => compatibleFormats.includes(p.apiType))
        : null;
      const preset = match ?? groupData.presets[0];
      ctx.selectedPlan.value = preset.plan;
      ctx.apiType.value = resolveApiType(client?.format, preset.apiType);
      applyPresetModels(preset, ctx.modelConfigs, ctx.isNonOpenaiEndpoint);
      // Generate endpoints from all presets in the group (dedup by api_type)
      applyPresetEndpoints(ctx.endpoints, groupData.presets);
    }
  }
  ctx.updateMappings();
  ctx.syncRetryRules();
}

export function applyPlanChange(
  plan: string,
  selectedGroup: Ref<string>,
  apiType: Ref<"openai" | "openai-responses" | "anthropic">,
  currentClient: ComputedRef<{ format: string } | undefined>,
  modelConfigs: Ref<ModelConfig[]>,
  isNonOpenaiEndpoint: ComputedRef<boolean>,
  providerGroups: Ref<ProviderGroup[]>,
  endpoints: Ref<ProviderEndpoint[]>,
  updateMappings: () => void,
): void {
  const group = providerGroups.value.find(
    (g) => g.group === selectedGroup.value,
  );
  if (!group) return;
  const preset = group.presets.find((p) => p.plan === plan);
  if (!preset) return;
  apiType.value = resolveApiType(currentClient.value?.format, preset.apiType);
  applyPresetModels(preset, modelConfigs, isNonOpenaiEndpoint);
  applyPresetEndpoints(endpoints, group.presets);
  updateMappings();
}

/** Deduplicate presets by api_type and generate endpoint entries */
export function applyPresetEndpoints(
  endpoints: Ref<ProviderEndpoint[]>,
  presets: Array<{ apiType: string; baseUrl: string; upstreamPath?: string }>,
): void {
  const seen = new Set<string>();
  const result: ProviderEndpoint[] = [];
  for (const preset of presets) {
    if (seen.has(preset.apiType)) continue;
    seen.add(preset.apiType);
    result.push({
      api_type: preset.apiType as ProviderEndpoint["api_type"],
      base_url: preset.baseUrl,
      upstream_path: preset.upstreamPath || null,
      api_key: null,
    });
  }
  endpoints.value = result;
}
