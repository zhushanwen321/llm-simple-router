import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import * as z from 'zod'
import type { ProviderPayload } from '@/api/client'
import type { Provider, ModelInfo } from '@/types/mapping'
import { DEFAULT_CONTEXT_WINDOW } from '@/constants'
import type { ModelConfig } from '@/components/quick-setup/types'
import { useTransformRules } from '@/composables/useTransformRules'
import { useProviderPresets } from '@/composables/useProviderPresets'

const DEFAULT_CONCURRENCY = 3
const DEFAULT_CONCURRENCY_AUTO = 10
const DEFAULT_QUEUE_TIMEOUT_MS = 120_000
const DEFAULT_QUEUE_SIZE = 10
const MAX_CONCURRENCY = 100
const MAX_QUEUE_SIZE = 1000
const CONTEXT_K = 1000
const CONTEXT_M = 1_000_000
const MS_PER_SECOND = 1000

export type ConcurrencyMode = 'auto' | 'manual' | 'none'

interface FormState {
  name: string
  api_type: string
  base_url: string
  upstream_path: string
  api_key: string
  models: ModelInfo[]
  is_active: boolean
  max_concurrency: number
  queue_timeout_ms: number
  max_queue_size: number
  adaptive_enabled: boolean
  proxy_type: string
  proxy_url: string
  proxy_username: string
  proxy_password: string
}

const DEFAULT_FORM: FormState = {
  name: '', api_type: 'anthropic', base_url: '', upstream_path: '', api_key: '',
  models: [], is_active: true, max_concurrency: DEFAULT_CONCURRENCY_AUTO,
  queue_timeout_ms: DEFAULT_QUEUE_TIMEOUT_MS, max_queue_size: DEFAULT_QUEUE_SIZE,
  adaptive_enabled: true, proxy_type: '', proxy_url: '', proxy_username: '', proxy_password: '',
}

const CONTEXT_WINDOW_OPTIONS = [
  { label: '8K', value: '8000' }, { label: '16K', value: '16000' },
  { label: '32K', value: '32000' }, { label: '64K', value: '64000' },
  { label: '128K', value: '128000' }, { label: '160K', value: '160000' },
  { label: '200K', value: '200000' }, { label: '256K', value: '256000' },
  { label: '1M', value: '1000000' },
] as const

export const API_TYPE_LABELS: Record<string, string> = {
  openai: 'OpenAI Chat Completions', 'openai-responses': 'OpenAI Responses', anthropic: 'Anthropic Messages',
}

export { CONTEXT_WINDOW_OPTIONS, MS_PER_SECOND, CONTEXT_K, CONTEXT_M }

type ProviderFormPayload = Pick<ProviderPayload,
  'name' | 'api_type' | 'base_url' | 'upstream_path' | 'models' |
  'is_active' | 'max_concurrency' | 'queue_timeout_ms' | 'max_queue_size' |
  'adaptive_enabled' | 'proxy_type' | 'proxy_url' | 'proxy_username' | 'proxy_password'
> & { api_key?: string }

export function useProviderForm() {
  const { t } = useI18n()
  const { transformForm, loadTransformRules, saveTransformRules } = useTransformRules()

  const form = ref<FormState>({ ...DEFAULT_FORM })
  const errors = ref<Record<string, string>>({})
  const concurrencyMode = ref<ConcurrencyMode>('auto')
  const dialogOpen = ref(false)
  const editingId = ref<string | null>(null)
  const modelInput = ref('')
  const modelContextWindow = ref(DEFAULT_CONTEXT_WINDOW)
  const contextWindowSelect = computed({
    get: () => `${modelContextWindow.value}`,
    set: (val: string) => { modelContextWindow.value = Number(val) },
  })

  const presetHook = useProviderPresets(form)

  function validate(): boolean {
    const schema = z.object({
      name: z.string().min(1, t('providers.validation.nameRequired')).regex(/^[a-zA-Z0-9_-]+$/, t('providers.validation.namePattern')),
      base_url: z.string().min(1, t('providers.validation.baseUrlRequired')).url(t('providers.validation.baseUrlInvalid')),
    })
    const errs: Record<string, string> = {}
    const result = schema.safeParse({ name: form.value.name.trim(), base_url: form.value.base_url.trim() })
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string
        if (!errs[field]) errs[field] = issue.message
      }
    }
    if (!editingId.value && !form.value.api_key.trim()) errs.api_key = t('providers.validation.apiKeyRequired')
    if (concurrencyMode.value !== 'none') {
      const mc = form.value.max_concurrency
      if (!mc || mc < 1 || mc > MAX_CONCURRENCY) errs.max_concurrency = t('providers.validation.concurrencyRange', { min: 1, max: MAX_CONCURRENCY })
      if (form.value.queue_timeout_ms < 0) errs.queue_timeout_ms = t('providers.validation.negativeNotAllowed')
      const qs = form.value.max_queue_size
      if (!qs || qs < 1 || qs > MAX_QUEUE_SIZE) errs.max_queue_size = t('providers.validation.queueSizeRange', { min: 1, max: MAX_QUEUE_SIZE })
    }
    errors.value = errs
    return Object.keys(errs).length === 0
  }

  function buildPayload(): ProviderFormPayload {
    const payload: ProviderFormPayload = {
      name: form.value.name, api_type: form.value.api_type, base_url: form.value.base_url,
      upstream_path: form.value.upstream_path || undefined,
      models: form.value.models.map(m => ({
        name: m.name, context_window: m.context_window ?? undefined,
        patches: m.patches ?? undefined, stream_timeout_ms: m.stream_timeout_ms ?? undefined,
      })),
      is_active: form.value.is_active ? 1 : 0,
      max_concurrency: concurrencyMode.value === 'none' ? 0 : form.value.max_concurrency,
      queue_timeout_ms: concurrencyMode.value === 'none' ? 0 : form.value.queue_timeout_ms,
      max_queue_size: concurrencyMode.value === 'none' ? DEFAULT_QUEUE_SIZE : form.value.max_queue_size,
      adaptive_enabled: concurrencyMode.value === 'auto' ? 1 : 0,
      proxy_type: form.value.proxy_type || null,
      proxy_url: form.value.proxy_url?.trim() || null,
      proxy_username: form.value.proxy_username?.trim() || null,
      proxy_password: form.value.proxy_password || null,
    }
    if (form.value.api_key) payload.api_key = form.value.api_key
    return payload
  }

  function addModel() {
    const input = modelInput.value.trim()
    if (!input) return
    const names = input.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    for (const name of names) {
      if (!form.value.models.some(m => m.name === name)) {
        form.value.models.push({ name, context_window: modelContextWindow.value || DEFAULT_CONTEXT_WINDOW, patches: [] })
      }
    }
    modelInput.value = ''
    modelContextWindow.value = DEFAULT_CONTEXT_WINDOW
  }

  function removeModel(index: number) { form.value.models.splice(index, 1) }

  function updateModel(index: number, updated: ModelConfig) {
    form.value.models[index].context_window = updated.contextWindow
    form.value.models[index].patches = updated.patches
  }

  function updateModelTimeout(index: number, seconds: string | number) {
    const val = Number(seconds)
    form.value.models[index].stream_timeout_ms = val > 0 ? val * MS_PER_SECOND : null
  }

  function onConcurrencyModeChange(mode: ConcurrencyMode) {
    concurrencyMode.value = mode
    if (mode === 'auto') {
      if (!form.value.max_concurrency || form.value.max_concurrency < 1) form.value.max_concurrency = DEFAULT_CONCURRENCY_AUTO
      form.value.adaptive_enabled = true
    } else if (mode === 'manual') {
      if (!form.value.max_concurrency || form.value.max_concurrency < 1) form.value.max_concurrency = DEFAULT_CONCURRENCY
      form.value.adaptive_enabled = false
    }
  }

  function isOfficialOpenai(url: string): boolean {
    return url.includes('api.openai.com')
  }

  function openCreate() {
    editingId.value = null
    form.value = { ...DEFAULT_FORM, models: [] }
    concurrencyMode.value = 'auto'
    modelInput.value = ''
    modelContextWindow.value = DEFAULT_CONTEXT_WINDOW
    presetHook.presetGroup.value = ''
    presetHook.presetPlan.value = ''
    errors.value = {}
    dialogOpen.value = true
  }

  function openEdit(p: Provider) {
    editingId.value = p.id
    const mc = p.max_concurrency ?? 0
    if (mc === 0) concurrencyMode.value = 'none'
    else if (p.adaptive_enabled) concurrencyMode.value = 'auto'
    else concurrencyMode.value = 'manual'
    form.value = {
      name: p.name, api_type: p.api_type, base_url: p.base_url,
      upstream_path: p.upstream_path || '', api_key: '',
      models: (p.models || []).map(m => ({
        name: m.name, context_window: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
        patches: m.patches ?? [], stream_timeout_ms: m.stream_timeout_ms ?? null,
      })),
      is_active: !!p.is_active,
      max_concurrency: concurrencyMode.value === 'none' ? DEFAULT_CONCURRENCY_AUTO : mc,
      queue_timeout_ms: p.queue_timeout_ms ?? DEFAULT_QUEUE_TIMEOUT_MS,
      max_queue_size: p.max_queue_size ?? DEFAULT_QUEUE_SIZE,
      adaptive_enabled: concurrencyMode.value === 'auto',
      proxy_type: p.proxy_type || '', proxy_url: p.proxy_url || '',
      proxy_username: p.proxy_username || '', proxy_password: '',
    }
    presetHook.presetGroup.value = ''
    presetHook.presetPlan.value = ''
    modelInput.value = ''
    modelContextWindow.value = DEFAULT_CONTEXT_WINDOW
    errors.value = {}
    dialogOpen.value = true
    loadTransformRules(p.id)
  }

  return {
    form, errors, concurrencyMode, dialogOpen, editingId,
    modelInput, modelContextWindow, contextWindowSelect,
    transformForm, presetHook,
    validate, buildPayload,
    addModel, removeModel, updateModel, updateModelTimeout,
    onConcurrencyModeChange, isOfficialOpenai,
    openCreate, openEdit, saveTransformRules,
  }
}
