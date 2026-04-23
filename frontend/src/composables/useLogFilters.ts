import { ref, computed, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api/client'
import type { Provider } from '@/types/mapping'

const PERIODS = [
  { label: '1h', value: '1h' },
  { label: '5h', value: '5h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
] as const

export type PeriodValue = typeof PERIODS[number]['value']

export function useLogFilters() {
  const period = ref<PeriodValue>('5h')
  const dateRange = ref({ start: '', end: '' })
  const providerFilter = ref('all')
  const modelFilter = ref('all')
  const keyFilter = ref('all')
  const apiTypeFilter = ref('all')

  const providers = ref<Provider[]>([])
  const routerKeys = ref<{ id: string; name: string }[]>([])
  const modelOptions = ref<string[]>([])

  const hasDateRange = computed(() => dateRange.value.start && dateRange.value.end && dateRange.value.start < dateRange.value.end)

  const dateRangeError = computed(() => {
    const { start, end } = dateRange.value
    if (!start || !end) return ''
    return start >= end ? '结束时间须晚于开始时间' : ''
  })

  const filteredModelOptions = computed(() => {
    if (providerFilter.value === 'all') return modelOptions.value
    const provider = providers.value.find((p) => p.id === providerFilter.value)
    if (!provider) return modelOptions.value
    const providerModels = new Set(provider.models)
    return modelOptions.value.filter((m) => providerModels.has(m))
  })

  function toIsoStart(dateStr: string): string {
    if (dateStr.includes('T')) return `${dateStr}:00.000Z`
    return `${dateStr}T00:00:00.000Z`
  }

  function toIsoEnd(dateStr: string): string {
    if (dateStr.includes('T')) return `${dateStr}:59.999Z`
    return `${dateStr}T23:59:59.999Z`
  }

  const PERIOD_MS: Record<string, number> = {
    '1h': 3600000,
    '5h': 18000000,
    '24h': 86400000,
    '7d': 604800000,
    '30d': 2592000000,
  }

  function buildFilterParams(): Record<string, string> {
    const params: Record<string, string> = {}
    if (hasDateRange.value) {
      params.start_time = toIsoStart(dateRange.value.start)
      params.end_time = toIsoEnd(dateRange.value.end)
    } else {
      const offset = PERIOD_MS[period.value]
      if (offset) params.start_time = new Date(Date.now() - offset).toISOString()
    }
    if (apiTypeFilter.value !== 'all') params.api_type = apiTypeFilter.value
    if (providerFilter.value !== 'all') params.provider_id = providerFilter.value
    if (modelFilter.value !== 'all') params.model = modelFilter.value
    if (keyFilter.value !== 'all') params.router_key_id = keyFilter.value
    return params
  }

  function clearDateRange() {
    dateRange.value = { start: '', end: '' }
  }

  async function loadProviders() {
    try {
      providers.value = await api.getProviders()
    } catch (e) {
      console.error('Failed to load providers:', e)
      toast.error('加载供应商列表失败')
    }
  }

  async function loadRouterKeys() {
    try {
      routerKeys.value = await api.getRouterKeys()
    } catch (e) {
      console.error('Failed to load router keys:', e)
      toast.error('加载密钥列表失败')
    }
  }

  async function loadModelOptions() {
    try {
      const rows = await api.getMetricsSummary({ period: '30d' })
      modelOptions.value = [...new Set(rows.map((r: { backend_model: string }) => r.backend_model))]
    } catch {
      modelOptions.value = []
    }
  }

  onMounted(() => {
    Promise.allSettled([loadProviders(), loadRouterKeys(), loadModelOptions()])
  })

  return {
    PERIODS,
    period,
    dateRange,
    dateRangeError,
    providerFilter,
    modelFilter,
    keyFilter,
    apiTypeFilter,
    providers,
    routerKeys,
    filteredModelOptions,
    hasDateRange,
    clearDateRange,
    buildFilterParams,
  }
}
