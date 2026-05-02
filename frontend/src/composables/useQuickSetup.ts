import { ref, computed, onMounted, watch } from 'vue'
import { api, getApiMessage, type ProviderGroup, type RecommendedRetryRule, type QuickSetupPayload } from '@/api/client'
import type { MappingGroup } from '@/types/mapping'
import type { Provider as ApiProvider } from '@/types/mapping'
import { toast } from 'vue-sonner'
import {
  type ClientType, type ModelConfig, type MappingEntry, type MappingTarget,
  CLIENTS, DEFAULT_CLIENT_MAPPINGS, getDefaultContextWindow,
} from '@/components/quick-setup/types'
import type { Rule } from '@/types/mapping'
import router from '@/router'

export type ConcurrencyMode = 'auto' | 'manual' | 'none'

/** Convert Chinese provider group name to valid backend name (a-zA-Z0-9_-) */
const PROVIDER_NAME_MAP: Record<string, string> = {
  'DeepSeek': 'deepseek',
  '百度千帆': 'qianfan',
  '科大讯飞': 'iflytek',
  '硅基流动': 'siliconflow',
  '智谱': 'zhipu',
  '月之暗面': 'moonshot',
  'Minimax': 'minimax',
  '火山引擎': 'volcengine',
  '阿里云': 'aliyun',
  '腾讯云': 'tencent',
  'OpenCode Go': 'opencode-go',
  '阶跃星辰': 'stepfun',
}

function toProviderName(group: string): string {
  return PROVIDER_NAME_MAP[group] ?? group.toLowerCase().replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-')
}

export function useQuickSetup() {
  // --- State ---
  const clientType = ref<ClientType>('claude-code')
  const providerGroups = ref<ProviderGroup[]>([])
  const selectedGroup = ref('')
  const selectedPlan = ref('')
  const apiType = ref<'openai' | 'anthropic'>('anthropic')
  const apiKey = ref('')
  const modelConfigs = ref<ModelConfig[]>([])
  const mappingEntries = ref<MappingEntry[]>([])
  const allRecommendedRules = ref<RecommendedRetryRule[]>([])
  const selectedRetryRules = ref<Set<string>>(new Set())
  const saving = ref(false)
  const connectionStatus = ref<'idle' | 'testing' | 'ok' | 'error'>('idle')

  // Concurrency state
  const concurrencyMode = ref<ConcurrencyMode>('auto')
  const maxConcurrency = ref(10)
  const queueTimeoutMs = ref(120000)
  const maxQueueSize = ref(100)

  // Transform rules state
  const transformInjectHeaders = ref('')
  const transformDropFields = ref('')
  const transformRequestDefaults = ref('')

  // Existing mappings + providers for failover/overflow editing
  const existingMappings = ref<MappingGroup[]>([])
  const allProviders = ref<ApiProvider[]>([])

  // --- Computed ---
  const isCustomProvider = computed(() => selectedGroup.value === '__custom__')

  const currentClient = computed(() =>
    CLIENTS.find(c => c.id === clientType.value),
  )

  const currentPreset = computed(() => {
    if (!selectedGroup.value || !selectedPlan.value) return undefined
    const group = providerGroups.value.find(g => g.group === selectedGroup.value)
    if (!group) return undefined
    return group.presets.find(p => p.plan === selectedPlan.value)
  })

  const customBaseUrl = ref('')
  const baseUrl = computed(() => isCustomProvider.value ? customBaseUrl.value : (currentPreset.value?.baseUrl ?? ''))

  const availablePlans = computed(() => {
    const group = providerGroups.value.find(g => g.group === selectedGroup.value)
    return group?.presets ?? []
  })

  const isNonOpenaiEndpoint = computed(() => {
    return !baseUrl.value.includes('openai.com')
  })

  // Provider groups for CascadingModelSelect (includes current new provider)
  const currentProviderGroup = computed(() => {
    if (!selectedGroup.value) return null
    // Determine a temporary ID and display name for the new provider
    const tempId = isCustomProvider.value
      ? '__new_custom__'
      : `__new_${toProviderName(selectedGroup.value)}_${toProviderName(selectedPlan.value)}__`
    const displayName = isCustomProvider.value
      ? '自定义供应商'
      : `${selectedGroup.value} - ${selectedPlan.value}`
    return {
      provider: { id: tempId, name: displayName },
      models: modelConfigs.value
        .filter(m => m.enabled)
        .map(m => ({
          name: m.name,
          contextWindow: m.contextWindow,
        })),
      isNew: true,
    }
  })

  const allProviderGroups = computed(() => {
    const existing = allProviders.value.map(p => ({
      provider: { id: p.id, name: p.name },
      models: (p.models ?? []).map(m => ({
        name: m.name,
        contextWindow: m.context_window ?? 128000,
      })),
    }))
    // Only include new provider when there are enabled models configured
    if (currentProviderGroup.value && currentProviderGroup.value.models.length > 0) {
      return [...existing, currentProviderGroup.value]
    }
    return existing
  })

  // Filter retry rules by selected provider
  const recommendedRules = computed(() => {
    const group = selectedGroup.value
    return allRecommendedRules.value.filter(r => {
      if (!r.providers || r.providers.length === 0) return true
      return r.providers.includes(group)
    })
  })

  // --- Patch defaults ---
  function getDefaultPatches(modelName: string, format: 'openai' | 'anthropic'): string[] {
    const patches: string[] = []
    const isDeepseek = modelName.toLowerCase().includes('deepseek')

    if (isDeepseek) {
      if (format === 'anthropic') {
        patches.push('thinking-param', 'cache-control', 'thinking-blocks', 'orphan-tool-results')
      } else {
        patches.push('non-ds-tools', 'orphan-tool-results-oa')
      }
    }

    if (format === 'openai' && isNonOpenaiEndpoint.value) {
      patches.push('developer-role')
    }

    return patches
  }

  function initModels(preset: { models: string[]; apiType: 'openai' | 'anthropic' }) {
    modelConfigs.value = preset.models.map(name => ({
      name,
      contextWindow: getDefaultContextWindow(name),
      enabled: true,
      patches: getDefaultPatches(name, preset.apiType),
    }))
  }

  // --- Custom model management ---
  function addCustomModel(name: string, contextWindow = 128000) {
    modelConfigs.value.push({
      name,
      contextWindow,
      enabled: true,
      patches: getDefaultPatches(name, apiType.value),
    })
  }

  // --- Mappings ---
  function updateMappings() {
    const enabledModels = modelConfigs.value.filter(m => m.enabled)

    // Build new recommended mappings based on client type
    let clientModelNames: string[]
    if (clientType.value === 'pi') {
      // Pi: client model names = provider model names
      clientModelNames = enabledModels.map(m => m.name)
    } else {
      clientModelNames = DEFAULT_CLIENT_MAPPINGS[clientType.value] ?? enabledModels.map(m => m.name)
    }

    // For each client model name, check if it already has a mapping in DB
    const entries: MappingEntry[] = clientModelNames.map((cmName) => {
      // Look up existing mapping for this client model
      const existingGroup = existingMappings.value.find(g => g.client_model === cmName)
      if (existingGroup) {
        let rule: Rule = {}
        try { rule = JSON.parse(existingGroup.rule) } catch { /* ignore */ }
        const targets = rule.targets ?? []
        return {
          clientModel: cmName,
          targets: targets.length > 0
            ? targets.map(t => ({
                backend_model: t.backend_model,
                provider_id: t.provider_id,
                overflow_provider_id: t.overflow_provider_id,
                overflow_model: t.overflow_model,
              }))
            : [{ backend_model: enabledModels[0]?.name ?? '', provider_id: '__new__' }],
          existing: true,
          existingId: existingGroup.id,
          tag: 'existing' as const,
          active: !!existingGroup.is_active,
          originalActive: !!existingGroup.is_active,
        }
      }

      // No existing mapping → create default
      // Find best matching provider model by index
      const defaultTarget = enabledModels[clientModelNames.indexOf(cmName)]?.name
        ?? enabledModels[enabledModels.length - 1]?.name
        ?? ''
      return {
        clientModel: cmName,
        targets: [{ backend_model: defaultTarget, provider_id: '__new__' }],
        existing: false,
        tag: (clientType.value === 'pi' ? 'auto' : 'def') as 'auto' | 'def',
        active: true,
      }
    })

    mappingEntries.value = entries
  }

  // --- Auto-select retry rules when provider changes ---
  function autoSelectRetryRules() {
    selectedRetryRules.value = new Set(
      recommendedRules.value
        .filter(r => !r.exists)
        .map(r => r.name),
    )
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
            apiType.value = preset.apiType as 'openai' | 'anthropic'
            initModels(preset)
            break
          }
        }
        break
      }
    }

    updateMappings()
    autoSelectRetryRules()
  }

  function onProviderChange(group: string) {
    selectedGroup.value = group
    selectedPlan.value = ''
    modelConfigs.value = []

    if (group === '__custom__') {
      apiType.value = 'openai'
      customBaseUrl.value = ''
      modelConfigs.value = []
    } else {
      const groupData = providerGroups.value.find(g => g.group === group)
      if (groupData && groupData.presets.length > 0) {
        const client = currentClient.value
        const match = client
          ? groupData.presets.find(p => p.apiType === client.format)
          : null
        const preset = match ?? groupData.presets[0]
        selectedPlan.value = preset.plan
        apiType.value = preset.apiType as 'openai' | 'anthropic'
        initModels(preset)
      }
    }

    updateMappings()
    autoSelectRetryRules()
  }

  function onPlanChange(plan: string) {
    selectedPlan.value = plan
    const group = providerGroups.value.find(g => g.group === selectedGroup.value)
    if (!group) return
    const preset = group.presets.find(p => p.plan === plan)
    if (!preset) return
    apiType.value = preset.apiType as 'openai' | 'anthropic'
    initModels(preset)
    updateMappings()
  }

  watch(apiType, () => {
    for (const model of modelConfigs.value) {
      model.patches = getDefaultPatches(model.name, apiType.value)
    }
  })

  // --- Retry rules ---
  function toggleRetryRule(name: string, checked: boolean) {
    const next = new Set(selectedRetryRules.value)
    if (checked) next.add(name)
    else next.delete(name)
    selectedRetryRules.value = next
  }
  // --- Mapping editing ---
  function updateMappingTargets(index: number, targets: MappingTarget[]) {
    const next = [...mappingEntries.value]
    next[index] = { ...next[index], targets }
    mappingEntries.value = next
  }

  function toggleMappingActive(index: number) {
    const next = [...mappingEntries.value]
    next[index] = { ...next[index], active: !next[index].active }
    mappingEntries.value = next
  }

  function addMappingEntry(clientModel: string, targetModel: string) {
    const existing = mappingEntries.value.filter(m => m.clientModel !== clientModel)
    existing.push({
      clientModel,
      targets: [{ backend_model: targetModel, provider_id: '__new__' }],
      existing: false,
      tag: 'cust' as const,
      active: true,
    })
    mappingEntries.value = existing
  }

  function removeMappingEntry(clientModel: string) {
    const entry = mappingEntries.value.find(m => m.clientModel === clientModel)
    if (entry?.existing) {
      toast.error('已有映射请到"模型映射"页面删除')
      return
    }
    mappingEntries.value = mappingEntries.value.filter(m => m.clientModel !== clientModel)
  }

  // --- Concurrency ---
  function onConcurrencyModeChange(mode: ConcurrencyMode) {
    concurrencyMode.value = mode
    if (mode === 'auto') maxConcurrency.value = 10
    else if (mode === 'manual') maxConcurrency.value = 3
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
  function buildTransformRules(): NonNullable<QuickSetupPayload['transform_rules']> | undefined | false {
    const headersStr = transformInjectHeaders.value.trim()
    const dropStr = transformDropFields.value.trim()
    const defaultsStr = transformRequestDefaults.value.trim()
    if (!headersStr && !dropStr && !defaultsStr) return undefined
    const result: NonNullable<QuickSetupPayload['transform_rules']> = {}
    if (headersStr) {
      try { result.inject_headers = JSON.parse(headersStr) } catch { toast.error('注入 Headers JSON 格式错误'); return false }
    }
    if (dropStr) {
      result.drop_fields = dropStr.split(',').map(s => s.trim()).filter(Boolean)
    }
    if (defaultsStr) {
      try { result.request_defaults = JSON.parse(defaultsStr) } catch { toast.error('请求默认值 JSON 格式错误'); return false }
    }
    return Object.keys(result).length > 0 ? result : undefined
  }

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
          name: isCustomProvider.value
            ? `custom-${Date.now()}`
            : `${toProviderName(selectedGroup.value)}-${toProviderName(selectedPlan.value)}`,
          api_type: apiType.value,
          base_url: baseUrl.value,
          api_key: apiKey.value.trim(),
          models: modelConfigs.value.map(m => ({
            name: m.name,
            context_window: m.contextWindow,
            patches: m.patches.length > 0 ? m.patches : undefined,
          })),
          concurrency_mode: concurrencyMode.value,
          max_concurrency: concurrencyMode.value !== 'none' ? maxConcurrency.value : undefined,
          queue_timeout_ms: concurrencyMode.value !== 'none' ? queueTimeoutMs.value : undefined,
          max_queue_size: concurrencyMode.value !== 'none' ? maxQueueSize.value : undefined,
        },
        mappings: mappingEntries.value
          .filter(m => m.targets[0]?.backend_model)
          .map(m => ({
            client_model: m.clientModel,
            backend_model: m.targets[0]?.backend_model ?? '',
          })),
        retry_rules: recommendedRules.value
          .filter(r => selectedRetryRules.value.has(r.name) && !r.exists)
          .map(r => ({
            name: r.name,
            status_code: r.status_code,
            body_pattern: r.body_pattern,
            retry_strategy: r.retry_strategy,
            retry_delay_ms: r.retry_delay_ms,
            max_retries: r.max_retries,
            max_delay_ms: r.max_delay_ms,
          })),
        transform_rules: (() => {
          const rules = buildTransformRules()
          if (rules === false) throw new Error('__transform_invalid__')
          return rules
        })(),
      }

      await api.quickSetup(payload)

      // Toggle active state for existing mappings that changed
      const toggleErrors: string[] = []
      for (const entry of mappingEntries.value) {
        if (entry.existing && entry.existingId && entry.originalActive !== undefined && entry.active !== entry.originalActive) {
          try {
            await api.toggleMappingGroup(entry.existingId)
          } catch {
            toggleErrors.push(entry.clientModel)
          }
        }
      }

      if (toggleErrors.length > 0) {
        toast.success(`快速配置完成！${toggleErrors.length} 个映射状态切换失败`)
      } else {
        toast.success('快速配置完成！')
      }
      await new Promise(r => setTimeout(r, 1500))
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
      const [groups, rules, mappings, providers] = await Promise.all([
        api.recommended.getProviders(),
        api.recommended.getRetryRules(),
        api.getMappingGroups().catch(() => [] as MappingGroup[]),
        api.getProviders().catch(() => [] as ApiProvider[]),
      ])
      providerGroups.value = groups
      allRecommendedRules.value = rules
      existingMappings.value = mappings as MappingGroup[]
      allProviders.value = providers as ApiProvider[]

      selectClient('claude-code')
    } catch (e: unknown) {
      toast.error(getApiMessage(e, '加载推荐配置失败'))
    }
  })

  return {
    clientType, providerGroups, selectedGroup, selectedPlan,
    apiType, apiKey, modelConfigs, mappingEntries,
    allRecommendedRules, recommendedRules,
    selectedRetryRules, saving, connectionStatus,
    currentClient, currentPreset, baseUrl, customBaseUrl, isCustomProvider,
    availablePlans, isNonOpenaiEndpoint,
    concurrencyMode, maxConcurrency, queueTimeoutMs, maxQueueSize,
    transformInjectHeaders, transformDropFields, transformRequestDefaults,
    existingMappings, allProviders, allProviderGroups,
    selectClient, onProviderChange, onPlanChange,
    initModels, getDefaultPatches, updateMappings,
    updateMappingTargets, toggleMappingActive, addMappingEntry, removeMappingEntry,
    toggleRetryRule, onConcurrencyModeChange, testConnection, submit,
    addCustomModel,
  }
}
