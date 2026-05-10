import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChartData } from 'chart.js'
import { api, getApiMessage } from '@/api/client'
import { toast } from 'vue-sonner'
import { fillTimeseries } from '@/views/metrics-helpers'
import { CHART_COLORS } from '@/styles/design-tokens'
import { formatTimeShort } from '@/utils/format'
import { watchTheme } from '@/composables/useTheme'
import type { Provider } from '@/types/mapping'

export interface DashboardStats {
  totalRequests: number
  successRate: number
  avgTps: number
  totalInputTokens: number
  totalOutputTokens: number
  startTime: string | null
  endTime: string | null
}

function toIsoStart(dateStr: string): string {
  if (dateStr.includes('T')) return `${dateStr}:00.000Z`
  return `${dateStr}T00:00:00.000Z`
}

function toIsoEnd(dateStr: string): string {
  if (dateStr.includes('T')) return `${dateStr}:59.999Z`
  return `${dateStr}T23:59:59.999Z`
}

export function useDashboard() {
  const { t } = useI18n()

  // --- Provider list and selection ---
  const providers = ref<Provider[]>([])
  const selectedProvider = ref('')

  const sortedProviders = computed(() =>
    [...providers.value].sort((a, b) => {
      const aOut = providerOutputTokens.value[a.id] ?? 0
      const bOut = providerOutputTokens.value[b.id] ?? 0
      return bOut - aOut
    }),
  )

  // --- Period tab ---
  const periodTab = ref<'window' | 'weekly' | 'monthly' | 'custom'>('window')
  const customStart = ref('')
  const customEnd = ref('')

  // --- Filters ---
  const modelFilter = ref('all')
  const keyFilter = ref('all')
  const clientType = ref('all')
  const allModelOptions = ref<string[]>([])
  const keyOptions = ref<{ id: string; name: string }[]>([])

  const modelOptions = computed(() => {
    if (selectedProvider.value) {
      const provider = providers.value.find((p) => p.id === selectedProvider.value)
      if (provider) {
        const providerModels = new Set(provider.models.map((m) => m.name))
        return allModelOptions.value.filter((m) => providerModels.has(m))
      }
    }
    return allModelOptions.value
  })

  // --- Time range text ---
  const timeRangeText = computed(() => {
    const start = stats.value.startTime
    const end = stats.value.endTime
    if (!start || !end) return '—'
    try {
      return `${formatTimeShort(start)} ~ ${formatTimeShort(end)}`
    } catch {
      return '—'
    }
  })

  // --- API params ---
  const apiStartTime = computed(() => {
    if (periodTab.value === 'custom' && customStart.value) {
      return toIsoStart(customStart.value)
    }
    return undefined
  })
  const apiEndTime = computed(() => {
    if (periodTab.value === 'custom' && customEnd.value) {
      return toIsoEnd(customEnd.value)
    }
    return undefined
  })

  const statsParams = computed(() => {
    const p: Record<string, string> = {}
    if (periodTab.value !== 'custom') {
      p.period = periodTab.value
    } else if (apiStartTime.value && apiEndTime.value) {
      p.start_time = apiStartTime.value
      p.end_time = apiEndTime.value
    }
    if (selectedProvider.value) p.provider_id = selectedProvider.value
    if (modelFilter.value !== 'all') p.backend_model = modelFilter.value
    if (keyFilter.value !== 'all') p.router_key_id = keyFilter.value
    return p
  })

  const cacheSummaryParams = computed(() => {
    const p: Record<string, string> = {}
    if (periodTab.value !== 'custom') {
      p.period = periodTab.value
    } else if (apiStartTime.value && apiEndTime.value) {
      p.start_time = apiStartTime.value
      p.end_time = apiEndTime.value
    }
    if (selectedProvider.value) p.provider_id = selectedProvider.value
    if (modelFilter.value !== 'all') p.backend_model = modelFilter.value
    if (keyFilter.value !== 'all') p.router_key_id = keyFilter.value
    if (clientType.value !== 'all') p.client_type = clientType.value
    return p
  })

  const timeseriesPeriod = computed(() => {
    if (periodTab.value === 'custom' && apiStartTime.value && apiEndTime.value) {
      return 'monthly'
    }
    return periodTab.value as 'window' | 'weekly' | 'monthly'
  })

  function tsParams(metric: string) {
    const p: { period?: string; metric: string; provider_id?: string; backend_model?: string; router_key_id?: string; start_time?: string; end_time?: string } = { metric }
    if (periodTab.value !== 'custom') {
      p.period = periodTab.value
    } else if (apiStartTime.value && apiEndTime.value) {
      p.start_time = apiStartTime.value
      p.end_time = apiEndTime.value
    }
    if (selectedProvider.value) p.provider_id = selectedProvider.value
    if (modelFilter.value !== 'all') p.backend_model = modelFilter.value
    if (keyFilter.value !== 'all') p.router_key_id = keyFilter.value
    return p
  }

  // --- Data state ---
  const stats = ref<DashboardStats>({
    totalRequests: 0, successRate: 0, avgTps: 0,
    totalInputTokens: 0, totalOutputTokens: 0,
    startTime: null, endTime: null,
  })
  const cacheHitRate = ref(0)
  const clientTypeBreakdown = ref<Record<string, number>>({})
  const tpsChartData = ref<ChartData<'line'> | null>(null)
  const inputTokensChartData = ref<ChartData<'line'> | null>(null)
  const outputTokensChartData = ref<ChartData<'line'> | null>(null)
  const loading = ref(false)

  // --- Per-provider output tokens (for sorting) ---
  const providerOutputTokens = ref<Record<string, number>>({})

  function toChartData(
    timeseries: { labels: string[]; values: number[] },
    label: string,
    color: string,
  ): ChartData<'line'> {
    return {
      labels: timeseries.labels,
      datasets: [{
        label,
        data: timeseries.values,
        borderColor: color,
        backgroundColor: color.replace(')', ' / 0.1)'),
        fill: false,
        tension: 0.4,
        pointRadius: 0,
      }],
    }
  }

  // --- Fetch providers ---
  async function loadProviders() {
    try {
      providers.value = await api.getProviders()
    } catch (e: unknown) {
      console.error('Failed to load providers:', e)
      toast.error(getApiMessage(e, t('dashboard.loadProvidersFailed')))
    }
  }

  // --- Fetch model/keys options ---
  async function loadFilterOptions() {
    try {
      const [models, keys] = await Promise.allSettled([
        api.getAvailableModels(),
        api.getRouterKeys(),
      ])
      if (models.status === 'fulfilled') allModelOptions.value = models.value
      if (keys.status === 'fulfilled') keyOptions.value = keys.value
    } catch (e: unknown) {
      console.error('Failed to load options:', e)
    }
  }

  // --- Fetch provider output tokens for sorting ---
  async function loadProviderOutputTokens() {
    if (periodTab.value === 'custom' && !(apiStartTime.value && apiEndTime.value)) return
    try {
      const results = await Promise.allSettled(
        providers.value.map(async (p) => {
          const p2: Record<string, string> = {}
          if (periodTab.value !== 'custom') {
            p2.period = periodTab.value
          } else if (apiStartTime.value && apiEndTime.value) {
            p2.start_time = apiStartTime.value
            p2.end_time = apiEndTime.value
          }
          p2.provider_id = p.id
          const stat = await api.getStats(p2)
          return { id: p.id, outputTokens: stat.totalOutputTokens }
        }),
      )
      const map: Record<string, number> = {}
      for (const r of results) {
        if (r.status === 'fulfilled') map[r.value.id] = r.value.outputTokens
      }
      providerOutputTokens.value = map
      if (Object.keys(map).length > 0 && !selectedProvider.value) {
        const top = sortedProviders.value[0]
        if (top) selectedProvider.value = top.id
      }
    } catch (e: unknown) {
      console.error('Failed to load output tokens:', e)
    }
  }

  // --- Fetch stats + timeseries ---
  async function refresh() {
    if (!selectedProvider.value) return
    if (periodTab.value === 'custom' && !(apiStartTime.value && apiEndTime.value)) return
    loading.value = true
    try {
      const [statsRes, tpsRes, inputRes, outputRes, summaryRes] = await Promise.allSettled([
        api.getStats(statsParams.value),
        api.getMetricsTimeseries(tsParams('total_tps')),
        api.getMetricsTimeseries(tsParams('input_tokens')),
        api.getMetricsTimeseries(tsParams('output_tokens')),
        api.getMetricsSummary(cacheSummaryParams.value),
      ])

      const fulfilled = <T>(r: PromiseSettledResult<T>): r is PromiseFulfilledResult<T> => r.status === 'fulfilled'

      if (fulfilled(statsRes)) stats.value = statsRes.value

      const period = timeseriesPeriod.value
      const timeRange = stats.value.startTime && stats.value.endTime
        ? { startTime: stats.value.startTime, endTime: stats.value.endTime }
        : undefined

      if (fulfilled(tpsRes) && tpsRes.value.length > 0) {
        const filled = fillTimeseries(tpsRes.value, period, timeRange)
        tpsChartData.value = toChartData(filled, t('dashboard.charts.tokenOutputSpeed'), CHART_COLORS.indigo)
      } else {
        tpsChartData.value = null
      }

      if (fulfilled(inputRes) && inputRes.value.length > 0) {
        const filled = fillTimeseries(inputRes.value, period, timeRange)
        inputTokensChartData.value = toChartData(filled, t('dashboard.charts.tokenInputTotal'), CHART_COLORS.teal)
      } else {
        inputTokensChartData.value = null
      }

      if (fulfilled(outputRes) && outputRes.value.length > 0) {
        const filled = fillTimeseries(outputRes.value, period, timeRange)
        outputTokensChartData.value = toChartData(filled, t('dashboard.charts.tokenOutputTotal'), CHART_COLORS.green)
      } else {
        outputTokensChartData.value = null
      }

      if (fulfilled(summaryRes)) {
        cacheHitRate.value = summaryRes.value.cache_hit_rate
        clientTypeBreakdown.value = summaryRes.value.client_type_breakdown
      }
    } catch (e: unknown) {
      console.error('Failed to load dashboard:', e)
      toast.error(getApiMessage(e, t('dashboard.loadDashboardFailed')))
    } finally {
      loading.value = false
    }
  }

  // --- Watchers ---
  watch(periodTab, () => {
    if (periodTab.value !== 'custom') {
      customStart.value = ''
      customEnd.value = ''
    }
  })

  // 切换 provider 时，如果当前模型不在新 provider 下，重置为 all
  watch(selectedProvider, () => {
    if (modelFilter.value !== 'all' && !modelOptions.value.includes(modelFilter.value)) {
      modelFilter.value = 'all'
    }
  })

  // When period tab changes, reload sorting data and select best provider
  watch(periodTab, () => {
    if (providers.value.length > 0) {
      loadProviderOutputTokens().then(() => refresh())
    }
  })

  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  watch([selectedProvider, modelFilter, keyFilter, clientType], () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => refresh(), 300)
  })

  // Custom date range: trigger refresh on both start and end filled
  watch([customStart, customEnd], () => {
    if (periodTab.value === 'custom' && customStart.value && customEnd.value) {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => refresh(), 300)
    }
  })

  // --- Watch theme changes to re-render charts ---
  let stopWatchTheme: (() => void) | null = null

  onMounted(async () => {
    await loadProviders()
    await loadFilterOptions()
    if (providers.value.length > 0) {
      await loadProviderOutputTokens()
    }
    await refresh()
    // Re-render charts when theme changes (Chart.js doesn't support CSS vars)
    stopWatchTheme = watchTheme(() => refresh())
  })

  onUnmounted(() => {
    if (stopWatchTheme) stopWatchTheme()
  })

  return {
    providers, selectedProvider, sortedProviders,
    periodTab, customStart, customEnd,
    modelFilter, keyFilter, clientType, modelOptions, keyOptions,
    timeRangeText,
    stats, loading,
    cacheHitRate, clientTypeBreakdown,
    tpsChartData, inputTokensChartData, outputTokensChartData,
  }
}
