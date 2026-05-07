import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api/client'
import type { ModelInfo } from '@/types/mapping'
import { getDefaultContextWindow } from '@/components/quick-setup/types'
import { useI18n } from 'vue-i18n'

const DEFAULT_PATCHES_BY_KEYWORD = 'deepseek'

export function useFetchUpstreamModels(form: {
  value: {
    api_type: string
    base_url: string
    api_key: string
    models: ModelInfo[]
  }
}, getCurrentModelsEndpoint: () => string | undefined) {
  const { t } = useI18n()
  const fetchingModels = ref(false)

  function getDefaultPatches(modelName: string, apiType: string): string[] {
    const patches: string[] = []
    if (modelName.toLowerCase().includes(DEFAULT_PATCHES_BY_KEYWORD)) {
      if (apiType === 'anthropic') {
        patches.push('thinking-param', 'cache-control', 'thinking-blocks', 'orphan-tool-results')
      } else {
        patches.push('non-ds-tools', 'orphan-tool-results-oa')
      }
    }
    return patches
  }

  async function fetchUpstreamModels() {
    const modelsEndpoint = getCurrentModelsEndpoint()
    if (!modelsEndpoint) {
      toast.error(t('providers.fetchModels.noEndpoint'))
      return
    }
    if (!form.value.api_key?.trim()) {
      toast.error(t('providers.fetchModels.noApiKey'))
      return
    }

    fetchingModels.value = true
    try {
      const modelIds = await api.fetchUpstreamModels({
        base_url: form.value.base_url,
        models_endpoint: modelsEndpoint,
        api_key: form.value.api_key,
        api_type: form.value.api_type,
      })

      if (modelIds.length === 0) {
        toast.info(t('providers.fetchModels.empty'))
        return
      }

      const existingNames = new Set(form.value.models.map(m => m.name))
      let added = 0
      for (const name of modelIds) {
        if (!existingNames.has(name)) {
          form.value.models.push({
            name,
            context_window: getDefaultContextWindow(name),
            patches: getDefaultPatches(name, form.value.api_type),
          })
          added++
        }
      }
      toast.success(t('providers.fetchModels.success', { total: modelIds.length, added }))
    } catch (e) {
      console.error('Failed to fetch upstream models:', e)
      toast.error(t('providers.fetchModels.failed'))
    } finally {
      fetchingModels.value = false
    }
  }

  return {
    fetchingModels,
    fetchUpstreamModels,
  }
}
