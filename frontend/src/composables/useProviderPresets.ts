import { ref, computed } from 'vue'
import { api, type ProviderGroup } from '@/api/client'
import type { ModelInfo } from '@/types/mapping'
import { getDefaultContextWindow } from '@/components/quick-setup/types'

const DEFAULT_PATCHES_BY_KEYWORD = 'deepseek'

export function useProviderPresets(form: { value: { name: string; api_type: string; base_url: string; models: ModelInfo[] } }) {
  const providerPresets = ref<ProviderGroup[]>([])
  const presetGroup = ref('')
  const presetPlan = ref('')

  const availablePlans = computed(() => {
    if (!presetGroup.value) return []
    return providerPresets.value.find(g => g.group === presetGroup.value)?.presets ?? []
  })

  function onGroupChange() {
    if (presetGroup.value === '__custom__') {
      presetPlan.value = ''
      form.value.name = ''
      form.value.api_type = 'openai'
      form.value.base_url = ''
      form.value.models = []
      return
    }
    const plans = providerPresets.value.find(g => g.group === presetGroup.value)?.presets
    if (plans?.length) {
      presetPlan.value = plans[0].plan
      onPresetChange()
    } else {
      presetPlan.value = ''
    }
  }

  function onPresetChange() {
    const preset = availablePlans.value.find(p => p.plan === presetPlan.value)
    if (!preset) return
    form.value.name = preset.presetName
    form.value.api_type = preset.apiType
    form.value.base_url = preset.baseUrl
    form.value.models = preset.models.map(name => ({
      name,
      context_window: getDefaultContextWindow(name),
      patches: getDefaultPatches(name, preset.apiType),
    }))
  }

  /** 获取当前选中预设的 modelsEndpoint */
  function getCurrentModelsEndpoint(): string | undefined {
    const preset = availablePlans.value.find(p => p.plan === presetPlan.value)
    return preset?.modelsEndpoint
  }

  /** 获取当前选中预设的写死模型列表（用于兜底） */
  function getCurrentPresetModels(): string[] {
    const preset = availablePlans.value.find(p => p.plan === presetPlan.value)
    return preset?.models ?? []
  }

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

  async function loadPresets() {
    try {
      const result = await api.recommended.getProviders()
      providerPresets.value = result
    } catch {
      providerPresets.value = []
    }
  }

  function resetPreset() {
    presetGroup.value = ''
    presetPlan.value = ''
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
  }
}
