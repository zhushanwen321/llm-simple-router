import { ref } from "vue";
import { toast } from "vue-sonner";
import { api } from "@/api/client";
import type { ModelInfo } from "@/types/mapping";
import { getDefaultContextWindow } from "@/components/quick-setup/types";
import { useI18n } from "vue-i18n";
import { computeDefaultPatches, type ApiFormat } from "@/utils/model-patches";

export function useFetchUpstreamModels(
  form: {
    value: {
      api_type: string;
      base_url: string;
      api_key: string;
      models: ModelInfo[];
    };
  },
  getCurrentModelsEndpoint: () => string | undefined,
  getCurrentPresetModels: () => string[],
) {
  const { t } = useI18n();
  const fetchingModels = ref(false);

  /** 将模型名称列表添加到表单（自动去重） */
  function addModelsToForm(modelIds: string[], source: string) {
    if (modelIds.length === 0) {
      toast.info(t("providers.fetchModels.empty"));
      return;
    }

    const existingNames = new Set(form.value.models.map((m) => m.name));
    let added = 0;
    for (const name of modelIds) {
      if (!existingNames.has(name)) {
        form.value.models.push({
          name,
          context_window: getDefaultContextWindow(name),
          patches: computeDefaultPatches(
            name,
            form.value.api_type as ApiFormat,
            false,
          ),
        });
        added++;
      }
    }
    if (added > 0) {
      toast.success(
        t("providers.fetchModels.success", {
          source,
          total: modelIds.length,
          added,
        }),
      );
    } else {
      toast.info(
        t("providers.fetchModels.allExist", { total: modelIds.length }),
      );
    }
  }

  /** 使用预设的写死模型列表（兜底） */
  function applyPresetModels() {
    const presetModels = getCurrentPresetModels();
    addModelsToForm(presetModels, t("providers.fetchModels.sourcePreset"));
  }

  async function fetchUpstreamModels() {
    const modelsEndpoint = getCurrentModelsEndpoint();

    // 兜底1: 没有 modelsEndpoint，直接使用预设模型
    if (!modelsEndpoint) {
      applyPresetModels();
      return;
    }

    if (!form.value.api_key?.trim()) {
      toast.error(t("providers.fetchModels.noApiKey"));
      return;
    }

    fetchingModels.value = true;
    try {
      const modelIds = await api.fetchUpstreamModels({
        base_url: form.value.base_url,
        models_endpoint: modelsEndpoint,
        api_key: form.value.api_key,
        api_type: form.value.api_type,
      });

      if (modelIds.length === 0) {
        // 上游返回空列表，兜底使用预设模型
        applyPresetModels();
        return;
      }

      addModelsToForm(modelIds, t("providers.fetchModels.sourceUpstream"));
    } catch (e: unknown) {
      console.error("useFetchUpstreamModels.fetch:", e);
      applyPresetModels();
    } finally {
      fetchingModels.value = false;
    }
  }

  return {
    fetchingModels,
    fetchUpstreamModels,
  };
}
