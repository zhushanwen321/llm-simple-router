import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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

const DEFAULT_CONCURRENCY = 10
const DEFAULT_QUEUE_TIMEOUT_MS = 120_000
const DEFAULT_QUEUE_SIZE = 100
const DEFAULT_CONTEXT_WINDOW = 128_000
const CONNECTION_TEST_DELAY_MS = 800
const POST_SAVE_REDIRECT_MS = 1500

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
  'OpenCode': 'opencode',
  '阶跃星辰': 'stepfun',
}

function toProviderName(group: string): string {
  return PROVIDER_NAME_MAP[group] ?? group.toLowerCase().replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-')
}

/** Compute default patches for a model based on its name and API format */
function computeDefaultPatches(
  modelName: string,
  format: 'openai' | 'openai-responses' | 'anthropic',
  isNonOpenaiEndpoint: boolean,
): string[] {
  const patches: string[] = []
  const isDeepseek = modelName.toLowerCase().includes('deepseek')
  if (isDeepseek) {
    patches.push('thinking-consistency')
    if (format === 'anthropic') {
      patches.push('orphan-tool-results')
    } else {
      patches.push('orphan-tool-results-oa')
    }
  }
  if (format === 'openai' && isNonOpenaiEndpoint) {
    patches.push('developer-role')
  }
  return patches
}

/** Parse transform rules from raw string inputs */
function parseTransformRules(
  headersInput: string,
  dropFieldsInput: string,
  requestDefaultsInput: string,
  onError: (msg: string) => void,
): NonNullable<QuickSetupPayload['transform_rules']> | undefined | false {
  if (!headersInput && !dropFieldsInput && !requestDefaultsInput) return undefined
  const result: NonNullable<QuickSetupPayload['transform_rules']> = {}
  if (headersInput) {
    try { result.inject_headers = JSON.parse(headersInput) } catch { onError('injectHeadersJsonError'); return false }
  }
  if (dropFieldsInput) {
    result.drop_fields = dropFieldsInput.split(',').map(s => s.trim()).filter(Boolean)
  }
  if (requestDefaultsInput) {
    try { result.request_defaults = JSON.parse(requestDefaultsInput) } catch { onError('requestDefaultsJsonError'); return false }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** Toggle active state for existing mappings that changed */
async function toggleChangedMappings(entries: MappingEntry[]): Promise<string[]> {
  const errors: string[] = []
  for (const entry of entries) {
    if (entry.existing && entry.existingId && entry.originalActive !== undefined && entry.active !== entry.originalActive) {
      try {
        await api.toggleMappingGroup(entry.existingId)
      } catch {
        errors.push(entry.clientModel)
      }
    }
  }
  return errors
}

/** Build retry rules payload from selected rules */
function buildRetryRulesPayload(
  rules: RecommendedRetryRule[],
  selectedRules: Set<string>,
): QuickSetupPayload['retry_rules'] {
  return rules
    .filter(r => selectedRules.has(r.name) && !r.exists)
    .map(r => ({
      name: r.name,
      status_code: r.status_code,
      body_pattern: r.body_pattern,
      retry_strategy: r.retry_strategy,
      retry_delay_ms: r.retry_delay_ms,
      max_retries: r.max_retries,
      max_delay_ms: r.max_delay_ms,
    }))
}

interface ProviderPayloadInput {
  isCustom: boolean
  selectedGroup: string
  selectedPlan: string
  apiType: 'openai' | 'openai-responses' | 'anthropic'
  baseUrl: string
  upstreamPath: string
  apiKey: string
  models: ModelConfig[]
  concurrencyMode: ConcurrencyMode
  maxConcurrency: number
  queueTimeoutMs: number
  maxQueueSize: number
}

function buildProviderPayload(input: ProviderPayloadInput): QuickSetupPayload['provider'] {
  return {
    name: input.isCustom
      ? `custom-${Date.now()}`
      : `${toProviderName(input.selectedGroup)}-${toProviderName(input.selectedPlan)}`,
    api_type: input.apiType,
    base_url: input.baseUrl,
    upstream_path: input.upstreamPath || undefined,
    api_key: input.apiKey,
    models: input.models.map(m => ({
      name: m.name,
      context_window: m.contextWindow,
      patches: m.patches.length > 0 ? m.patches : undefined,
    })),
    concurrency_mode: input.concurrencyMode,
    max_concurrency: input.concurrencyMode !== 'none' ? input.maxConcurrency : undefined,
    queue_timeout_ms: input.concurrencyMode !== 'none' ? input.queueTimeoutMs : undefined,
    max_queue_size: input.concurrencyMode !== 'none' ? input.maxQueueSize : undefined,
  }
}

/** Build mapping entries by merging existing DB mappings with client defaults */
function buildMappingEntries(
  clientType: ClientType,
  enabledModels: ModelConfig[],
  existingMappings: MappingGroup[],
): MappingEntry[] {
  let clientModelNames: string[]
  if (clientType === 'pi') {
    clientModelNames = enabledModels.map(m => m.name)
  } else {
    clientModelNames = DEFAULT_CLIENT_MAPPINGS[clientType] ?? enabledModels.map(m => m.name)
  }

  return clientModelNames.map((cmName) => {
    const existingGroup = existingMappings.find(g => g.client_model === cmName)
    if (existingGroup) {
      let rule: Rule = {}
      try { rule = JSON.parse(existingGroup.rule) } catch { rule = {} }
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

    const defaultTarget = enabledModels[clientModelNames.indexOf(cmName)]?.name
      ?? enabledModels[enabledModels.length - 1]?.name
      ?? ''
    return {
      clientModel: cmName,
      targets: [{ backend_model: defaultTarget, provider_id: '__new__' }],
      existing: false,
      tag: (clientType === 'pi' ? 'auto' : 'def') as 'auto' | 'def',
      active: true,
    }
  })
}

export function useQuickSetup() {
  const { t } = useI18n()
  // --- State ---
  const clientType = ref<ClientType>('claude-code')
  const providerGroups = ref<ProviderGroup[]>([])
  const selectedGroup = ref('')
  const selectedPlan = ref('')
  const apiType = ref<'openai' | 'openai-responses' | 'anthropic'>('anthropic')
  const apiKey = ref('')
  const modelConfigs = ref<ModelConfig[]>([])
  const mappingEntries = ref<MappingEntry[]>([])
  const allRecommendedRules = ref<RecommendedRetryRule[]>([])
  const selectedRetryRules = ref<Set<string>>(new Set())
  const saving = ref(false)
  const connectionStatus = ref<'idle' | 'testing' | 'ok' | 'error'>('idle')

  // Concurrency state
  const concurrencyMode = ref<ConcurrencyMode>('auto')
  const maxConcurrency = ref(DEFAULT_CONCURRENCY)
  const queueTimeoutMs = ref(DEFAULT_QUEUE_TIMEOUT_MS)
  const maxQueueSize = ref(DEFAULT_QUEUE_SIZE)

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
  const customUpstreamPath = ref('')
  const baseUrl = computed(() => isCustomProvider.value ? customBaseUrl.value : (currentPreset.value?.baseUrl ?? ''))
  const upstreamPath = computed(() => {
    if (isCustomProvider.value) return customUpstreamPath.value
    const preset = currentPreset.value
    if (!preset) return ''
    const defaultPath = preset.apiType === 'anthropic' ? '/v1/messages'
      : preset.apiType === 'openai-responses' ? '/v1/responses'
        : '/v1/chat/completions'
    if (preset.upstreamPath && preset.upstreamPath !== defaultPath) return preset.upstreamPath
    return ''
  })

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
      ? t('quickSetup.provider.customProvider')
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
        contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
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

  function getDefaultPatches(modelName: string, format: 'openai' | 'openai-responses' | 'anthropic'): string[] {
    return computeDefaultPatches(modelName, format, isNonOpenaiEndpoint.value)
  }

  function initModels(preset: { models: string[]; apiType: 'openai' | 'openai-responses' | 'anthropic' }) {
    modelConfigs.value = preset.models.map(name => ({
      name,
      contextWindow: getDefaultContextWindow(name),
      enabled: true,
      patches: getDefaultPatches(name, preset.apiType),
    }))
  }

  // --- Custom model management ---
  function addCustomModel(name: string, contextWindow = DEFAULT_CONTEXT_WINDOW) {
    modelConfigs.value.push({
      name,
      contextWindow,
      enabled: true,
      patches: getDefaultPatches(name, apiType.value),
    })
  }

  function updateMappings() {
    const enabledModels = modelConfigs.value.filter(m => m.enabled)
    mappingEntries.value = buildMappingEntries(clientType.value, enabledModels, existingMappings.value)
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
  // Client selection only changes client type and rebuilds mappings.
  // It does NOT affect provider configuration (group, plan, apiType, models).
  function selectClient(type: ClientType) {
    clientType.value = type
    updateMappings()
  }

  function onProviderChange(group: string) {
    selectedGroup.value = group
    selectedPlan.value = ''
    modelConfigs.value = []

    if (group === '__custom__') {
      apiType.value = 'openai'
      customBaseUrl.value = ''
      customUpstreamPath.value = ''
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
        apiType.value = preset.apiType as 'openai' | 'openai-responses' | 'anthropic'
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
    apiType.value = preset.apiType as 'openai' | 'openai-responses' | 'anthropic'
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
      toast.error(t('quickSetup.messages.existingMappingDelete'))
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
      toast.error(t('quickSetup.messages.fillApiKeyFirst'))
      return
    }
    connectionStatus.value = 'testing'
    await new Promise(resolve => setTimeout(resolve, CONNECTION_TEST_DELAY_MS))
    connectionStatus.value = 'ok'
  }

  // --- Submit ---

  async function submit() {
    if (!currentPreset.value) {
      toast.error(t('quickSetup.messages.selectProviderAndPlan'))
      return
    }
    if (!apiKey.value.trim()) {
      toast.error(t('quickSetup.messages.fillApiKey'))
      return
    }

    saving.value = true
    try {
      const transformRules = parseTransformRules(
        transformInjectHeaders.value.trim(),
        transformDropFields.value.trim(),
        transformRequestDefaults.value.trim(),
        (key) => toast.error(t(`quickSetup.messages.${key}`)),
      )
      if (transformRules === false) return

      const payload: QuickSetupPayload = {
        provider: buildProviderPayload({
          isCustom: isCustomProvider.value, selectedGroup: selectedGroup.value, selectedPlan: selectedPlan.value,
          apiType: apiType.value, baseUrl: baseUrl.value, upstreamPath: upstreamPath.value, apiKey: apiKey.value.trim(),
          models: modelConfigs.value, concurrencyMode: concurrencyMode.value,
          maxConcurrency: maxConcurrency.value, queueTimeoutMs: queueTimeoutMs.value, maxQueueSize: maxQueueSize.value,
        }),
        mappings: mappingEntries.value
          .filter(m => m.targets[0]?.backend_model)
          .map(m => ({
            client_model: m.clientModel,
            backend_model: m.targets[0]?.backend_model ?? '',
          })),
        retry_rules: buildRetryRulesPayload(recommendedRules.value, selectedRetryRules.value),
        transform_rules: transformRules,
      }

      await api.quickSetup(payload)

      const toggleErrors = await toggleChangedMappings(mappingEntries.value)
      if (toggleErrors.length > 0) {
        toast.success(t('quickSetup.messages.setupCompleteWithErrors', { count: toggleErrors.length }))
      } else {
        toast.success(t('quickSetup.messages.setupComplete'))
      }
      await new Promise(r => setTimeout(r, POST_SAVE_REDIRECT_MS))
      router.push('/')
    } catch (e: unknown) {
      console.error('quickSetup.save:', e)
      toast.error(getApiMessage(e, t('quickSetup.messages.setupFailed')))
    } finally {
      saving.value = false
    }
  }

  // --- Init ---
  onMounted(async () => {
    try {
      const [groupsResult, rulesResult, mappingsResult, providersResult] = await Promise.allSettled([
        api.recommended.getProviders(),
        api.recommended.getRetryRules(),
        api.getMappingGroups(),
        api.getProviders(),
      ])
      if (groupsResult.status === 'fulfilled') providerGroups.value = groupsResult.value
      if (rulesResult.status === 'fulfilled') allRecommendedRules.value = rulesResult.value
      if (mappingsResult.status === 'fulfilled') existingMappings.value = mappingsResult.value as MappingGroup[]
      if (providersResult.status === 'fulfilled') allProviders.value = providersResult.value as ApiProvider[]

      selectClient('claude-code')
    } catch (e: unknown) {
      console.error('quickSetup.load:', e)
      toast.error(getApiMessage(e, t('quickSetup.messages.loadFailed')))
    }
  })

  return {
    clientType, providerGroups, selectedGroup, selectedPlan,
    apiType, apiKey, modelConfigs, mappingEntries,
    allRecommendedRules, recommendedRules,
    selectedRetryRules, saving, connectionStatus,
    currentClient, currentPreset, baseUrl, customBaseUrl, upstreamPath, customUpstreamPath, isCustomProvider,
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
