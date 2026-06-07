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
      providerPresets.value.find((g) => g.group === presetGroup.value)
        ?.presets ?? []
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
    const preset = group?.presets[0];
    if (preset) {
      presetPlan.value = preset.plan;
      onPresetChange();
      // Auto-generate endpoints from preset's embedded endpoints or fallback to single
      if (preset.endpoints && preset.endpoints.length > 0) {
        form.value.endpoints = preset.endpoints.map((ep) => ({
          api_type:
            ep.apiType as import("@/types/mapping").ProviderEndpoint["api_type"],
          base_url: ep.baseUrl,
          upstream_path: ep.upstreamPath || null,
          api_key: null,
        }));
      } else {
        form.value.endpoints = [
          {
            api_type:
              preset.apiType as import("@/types/mapping").ProviderEndpoint["api_type"],
            base_url: preset.baseUrl,
            upstream_path: preset.upstreamPath || null,
            api_key: null,
          },
        ];
      }
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
