import { ref, computed } from "vue";
import { api, type ProviderGroup } from "@/api/client";
import type { ModelInfo } from "@/types/mapping";
import { getDefaultContextWindow } from "@/components/quick-setup/types";
import { computeDefaultPatches } from "@/utils/model-patches";

export function useProviderPresets(form: {
  value: {
    name: string;
    api_type: string;
    base_url: string;
    models: ModelInfo[];
    upstream_path: string;
    endpoints: import("@/types/mapping").ProviderEndpoint[];
  };
}) {
  const providerPresets = ref<ProviderGroup[]>([]);
  const presetGroup = ref("");
  const presetPlan = ref("");

  const availablePlans = computed(() => {
    if (!presetGroup.value) return [];
    return (
      providerPresets.value
        .find((g) => g.group === presetGroup.value)
        ?.presets.filter((p) => !p.hidden) ?? []
    );
  });

  function onGroupChange() {
    if (presetGroup.value === "__custom__") {
      presetPlan.value = "";
      form.value.name = "";
      form.value.api_type = "openai";
      form.value.base_url = "";
      form.value.models = [];
      form.value.endpoints = [];
      return;
    }
    const group = providerPresets.value.find(
      (g) => g.group === presetGroup.value,
    );
    const plans = group?.presets;
    if (plans?.length) {
      presetPlan.value = plans[0].plan;
      onPresetChange();
      // Auto-generate endpoints from all presets in the group
      const seen = new Set<string>();
      const endpoints: import("@/types/mapping").ProviderEndpoint[] = [];
      for (const preset of plans) {
        if (seen.has(preset.apiType)) continue;
        seen.add(preset.apiType);
        endpoints.push({
          api_type:
            preset.apiType as import("@/types/mapping").ProviderEndpoint["api_type"],
          base_url: preset.baseUrl,
          upstream_path: preset.upstreamPath || null,
          api_key: null,
        });
      }
      form.value.endpoints = endpoints;
    } else {
      presetPlan.value = "";
    }
  }

  function onPresetChange() {
    const preset = availablePlans.value.find(
      (p) => p.plan === presetPlan.value,
    );
    if (!preset) return;
    form.value.name = preset.presetName;
    form.value.api_type = preset.apiType;
    form.value.base_url = preset.baseUrl;
    form.value.upstream_path = preset.upstreamPath ?? "";
    form.value.models = preset.models.map((name) => ({
      name,
      context_window: getDefaultContextWindow(name),
      patches: computeDefaultPatches(name, preset.apiType, false),
      capabilities: preset.modelCapabilities?.[name],
    }));
  }

  /** 获取当前选中预设的 modelsEndpoint */
  function getCurrentModelsEndpoint(): string | undefined {
    const preset = availablePlans.value.find(
      (p) => p.plan === presetPlan.value,
    );
    return preset?.modelsEndpoint;
  }

  /** 获取当前选中预设的写死模型列表（用于兜底） */
  function getCurrentPresetModels(): string[] {
    const preset = availablePlans.value.find(
      (p) => p.plan === presetPlan.value,
    );
    return preset?.models ?? [];
  }

  async function loadPresets() {
    try {
      const result = await api.recommended.getProviders();
      providerPresets.value = result;
    } catch (e: unknown) {
      console.error("useProviderPresets.loadPresets:", e);
      providerPresets.value = [];
    }
  }

  function resetPreset() {
    presetGroup.value = "";
    presetPlan.value = "";
  }

  return {
    providerPresets,
    presetGroup,
    presetPlan,
    availablePlans,
    onGroupChange,
    onPresetChange,
    getCurrentModelsEndpoint,
    getCurrentPresetModels,
    loadPresets,
    resetPreset,
  };
}
