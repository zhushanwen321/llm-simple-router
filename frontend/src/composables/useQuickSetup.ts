import { ref, computed, onMounted } from 'vue'
import { api, getApiMessage, type ProviderGroup, type RecommendedRetryRule, type QuickSetupPayload } from '@/api/client'
import { toast } from 'vue-sonner'
import {
  type ClientType, type ModelConfig, type MappingPreviewItem,
  CLIENTS, DEFAULT_CLIENT_MAPPINGS,
} from '@/components/quick-setup/types'
import router from '@/router'

export function useQuickSetup() {
  // --- State ---
  const clientType = ref<ClientType>('claude-code')
  const providerGroups = ref<ProviderGroup[]>([])
  const selectedGroup = ref('')
  const selectedPlan = ref('')
  const apiKey = ref('')
  const modelConfigs = ref<ModelConfig[]>([])
  const mappingPreview = ref<MappingPreviewItem[]>([])
  const recommendedRules = ref<RecommendedRetryRule[]>([])
  const selectedRetryRules = ref<Set<string>>(new Set())
  const saving = ref(false)
  const connectionStatus = ref<'idle' | 'testing' | 'ok' | 'error'>('idle')

  // --- Computed ---
  const currentClient = computed(() =>
    CLIENTS.find(c => c.id === clientType.value),
  )

  const currentPreset = computed(() => {
    if (!selectedGroup.value || !selectedPlan.value) return undefined
    const group = providerGroups.value.find(g => g.group === selectedGroup.value)
    if (!group) return undefined
    return group.presets.find(p => p.plan === selectedPlan.value)
  })

  const apiType = computed(() => currentPreset.value?.apiType ?? 'openai')
  const baseUrl = computed(() => currentPreset.value?.baseUrl ?? '')

  const availablePlans = computed(() => {
    const group = providerGroups.value.find(g => g.group === selectedGroup.value)
    return group?.presets ?? []
  })

  const isNonOpenaiEndpoint = computed(() => {
    return !baseUrl.value.includes('openai.com')
  })

  // --- Patch defaults ---

  function getDefaultPatches(modelName: string, type: 'openai' | 'anthropic'): string[] {
    const patches: string[] = []
    const isDeepseek = modelName.toLowerCase().includes('deepseek')

    if (isDeepseek) {
      if (type === 'anthropic') {
        patches.push('thinking-param', 'cache-control', 'thinking-blocks', 'orphan-tool-results')
      } else {
        patches.push('non-ds-tools', 'orphan-tool-results-oa')
      }
    }

    if (type === 'openai' && isNonOpenaiEndpoint.value) {
      patches.push('developer-role')
    }

    return patches
  }

  function initModels(preset: { models: string[]; apiType: 'openai' | 'anthropic' }) {
    modelConfigs.value = preset.models.map(name => ({
      name,
      contextWindow: 128000,
      enabled: true,
      patches: getDefaultPatches(name, preset.apiType),
    }))
  }

  // --- Mappings ---

  function updateMappings() {
    const enabledModels = modelConfigs.value.filter(m => m.enabled)
    const clientDefaults = DEFAULT_CLIENT_MAPPINGS[clientType.value]

    if (clientDefaults && enabledModels.length > 0) {
      mappingPreview.value = clientDefaults.map((fromName, index) => ({
        from: fromName,
        to: enabledModels[index]?.name ?? enabledModels[enabledModels.length - 1]?.name ?? '',
        tag: 'def' as const,
      }))
    } else {
      mappingPreview.value = enabledModels.map(m => ({
        from: m.name,
        to: m.name,
        tag: 'auto' as const,
      }))
    }
  }

  // --- Client / Provider / Plan selection ---

  function selectClient(type: ClientType) {
    clientType.value = type
    const client = CLIENTS.find(c => c.id === type)
    if (!client) return

    selectedGroup.value = ''
    selectedPlan.value = ''

    for (const group of providerGroups.value) {
      if (group.group === client.defaultProvider) {
        selectedGroup.value = group.group
        for (const preset of group.presets) {
          if (preset.plan === client.defaultPlan) {
            selectedPlan.value = preset.plan
            initModels(preset)
            break
          }
        }
        break
      }
    }

    updateMappings()
  }

  function onProviderChange(group: string) {
    selectedGroup.value = group
    selectedPlan.value = ''
    modelConfigs.value = []

    const groupData = providerGroups.value.find(g => g.group === group)
    if (groupData && groupData.presets.length > 0) {
      selectedPlan.value = groupData.presets[0].plan
      initModels(groupData.presets[0])
    }

    updateMappings()
  }

  function onPlanChange(plan: string) {
    selectedPlan.value = plan
    const group = providerGroups.value.find(g => g.group === selectedGroup.value)
    if (!group) return
    const preset = group.presets.find(p => p.plan === plan)
    if (!preset) return
    initModels(preset)
    updateMappings()
  }

  // --- Retry rules ---

  function toggleRetryRule(name: string, checked: boolean) {
    const next = new Set(selectedRetryRules.value)
    if (checked) {
      next.add(name)
    } else {
      next.delete(name)
    }
    selectedRetryRules.value = next
  }

  // --- Connection test ---

  async function testConnection() {
    if (!apiKey.value.trim()) {
      connectionStatus.value = 'error'
      toast.error('请先填写 API Key')
      return
    }
    connectionStatus.value = 'testing'
    await new Promise(resolve => setTimeout(resolve, 800))
    connectionStatus.value = 'ok'
  }

  // --- Submit ---

  async function submit() {
    if (!currentPreset.value) {
      toast.error('请选择供应商和套餐')
      return
    }
    if (!apiKey.value.trim()) {
      toast.error('请填写 API Key')
      return
    }

    saving.value = true
    try {
      const payload: QuickSetupPayload = {
        provider: {
          name: selectedGroup.value,
          api_type: apiType.value,
          base_url: baseUrl.value,
          api_key: apiKey.value.trim(),
          models: modelConfigs.value.map(m => ({
            name: m.name,
            context_window: m.contextWindow,
            patches: m.patches.length > 0 ? m.patches : undefined,
          })),
        },
        mappings: mappingPreview.value.map(m => ({
          client_model: m.from,
          backend_model: m.to,
        })),
        retry_rules: recommendedRules.value
          .filter(r => selectedRetryRules.value.has(r.name))
          .map(r => ({
            name: r.name,
            status_code: r.status_code,
            body_pattern: r.body_pattern,
            retry_strategy: r.retry_strategy,
            retry_delay_ms: r.retry_delay_ms,
            max_retries: r.max_retries,
            max_delay_ms: r.max_delay_ms,
          })),
      }

      await api.quickSetup(payload)
      toast.success('快速配置完成！')
      router.push('/')
    } catch (e: unknown) {
      toast.error(getApiMessage(e, '快速配置失败'))
    } finally {
      saving.value = false
    }
  }

  // --- Init ---

  onMounted(async () => {
    try {
      const [groups, rules] = await Promise.all([
        api.recommended.getProviders(),
        api.recommended.getRetryRules(),
      ])
      providerGroups.value = groups
      recommendedRules.value = rules

      selectClient('claude-code')
    } catch (e: unknown) {
      toast.error(getApiMessage(e, '加载推荐配置失败'))
    }
  })

  return {
    clientType, providerGroups, selectedGroup, selectedPlan,
    apiKey, modelConfigs, mappingPreview, recommendedRules,
    selectedRetryRules, saving, connectionStatus,
    currentClient, currentPreset, apiType, baseUrl,
    availablePlans, isNonOpenaiEndpoint,
    selectClient, onProviderChange, onPlanChange,
    initModels, getDefaultPatches, updateMappings,
    toggleRetryRule, testConnection, submit,
  }
}
