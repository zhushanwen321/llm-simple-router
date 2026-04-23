import { ref, computed, watch, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import type { ChartData } from 'chart.js'
import { api } from '@/api/client'
import { fillTimeseries } from '@/views/metrics-helpers'
import { CHART_COLORS } from '@/styles/design-tokens'
import type { Provider } from '@/types/mapping'

const PERCENT_MULTIPLIER = 100

interface SummaryRow {
  provider_id: string
  provider_name: string
  backend_model: string
  request_count: number
  avg_ttft_ms: number | null
  avg_tps: number | null
  total_input_tokens: number
  total_output_tokens: number
  total_cache_hit_tokens: number
  cache_hit_rate: number | null
}

export function useMetrics() {
  const period = ref('5h')
  const modelFilter = ref('all')
  const routerKeyFilter = ref('all')
  const providerFilter = ref('all')
  const dateRange = ref({ start: '', end: '' })
  const loading = ref(false)
  const routerKeys = ref<{ id: string; name: string }[]>([])
  const modelOptions = ref<string[]>([])
  const providers = ref<Provider[]>([])

  const ttftData = ref<ChartData<'line'> | null>(null)
  const tpsData = ref<ChartData<'line'> | null>(null)
  const tokensData = ref<ChartData<'line'> | null>(null)
  const cacheRateData = ref<ChartData<'line'> | null>(null)
  const summaryRows = ref<SummaryRow[]>([])

  const hasDateRange = computed(() => dateRange.value.start && dateRange.value.end && dateRange.value.start < dateRange.value.end)

  const filteredModelOptions = computed(() => {
    if (providerFilter.value === 'all') return modelOptions.value
    const provider = providers.value.find((p) => p.id === providerFilter.value)
    if (!provider) return modelOptions.value
    const providerModels = new Set(provider.models)
    return modelOptions.value.filter((m) => providerModels.has(m))
  })

  const noData = computed(() => {
    const hasChart = ttftData.value || tpsData.value || tokensData.value || cacheRateData.value
    return !hasChart && summaryRows.value.length === 0
  })

  function toIsoStart(dateStr: string): string {
    if (dateStr.includes('T')) return `${dateStr}:00.000Z`
    return `${dateStr}T00:00:00.000Z`
  }

  function toIsoEnd(dateStr: string): string {
    if (dateStr.includes('T')) return `${dateStr}:59.999Z`
    return `${dateStr}T23:59:59.999Z`
  }

  function buildFilterParams(): { period?: string; backend_model?: string; router_key_id?: string; provider_id?: string; start_time?: string; end_time?: string } {
    const params: ReturnType<typeof buildFilterParams> = {}
    if (hasDateRange.value) {
      params.start_time = toIsoStart(dateRange.value.start)
      params.end_time = toIsoEnd(dateRange.value.end)
    } else {
      params.period = period.value
    }
    if (modelFilter.value !== 'all') params.backend_model = modelFilter.value
    if (routerKeyFilter.value !== 'all') params.router_key_id = routerKeyFilter.value
    if (providerFilter.value !== 'all') params.provider_id = providerFilter.value
    return params
  }

  function buildTimeseriesParams(metric: string) {
    return { ...buildFilterParams(), metric }
  }

  function buildSummaryParams() {
    return buildFilterParams()
  }

  function toDataset(label: string, color: string, bgColor: string, filled: boolean, data: { labels: string[]; values: number[] }) {
    return {
      labels: data.labels,
      datasets: [{
        label,
        data: data.values,
        borderColor: color,
        backgroundColor: bgColor,
        fill: filled,
        tension: 0.4,
        pointRadius: 0,
      }],
    }
  }

  async function fetchMetrics() {
    loading.value = true
    try {
      const [ttftRes, tpsRes, inputTokensRes, outputTokensRes, cacheHitTokensRes, cacheRateRes, summaryRes] = await Promise.allSettled([
        api.getMetricsTimeseries(buildTimeseriesParams('ttft')),
        api.getMetricsTimeseries(buildTimeseriesParams('tps')),
        api.getMetricsTimeseries(buildTimeseriesParams('input_tokens')),
        api.getMetricsTimeseries(buildTimeseriesParams('output_tokens')),
        api.getMetricsTimeseries(buildTimeseriesParams('cache_hit_tokens')),
        api.getMetricsTimeseries(buildTimeseriesParams('cache_rate')),
        api.getMetricsSummary(buildSummaryParams()),
      ])

      const fulfilled = <T>(r: PromiseSettledResult<T>): r is PromiseFulfilledResult<T> => r.status === 'fulfilled'
      const p = hasDateRange.value ? '30d' : period.value

      const ttftOk = fulfilled(ttftRes) ? ttftRes.value : null
      const tpsOk = fulfilled(tpsRes) ? tpsRes.value : null
      const inputTokensOk = fulfilled(inputTokensRes) ? inputTokensRes.value : null
      const outputTokensOk = fulfilled(outputTokensRes) ? outputTokensRes.value : null
      const cacheHitTokensOk = fulfilled(cacheHitTokensRes) ? cacheHitTokensRes.value : null
      const cacheRateOk = fulfilled(cacheRateRes) ? cacheRateRes.value : null
      const summaryOk = fulfilled(summaryRes) ? summaryRes.value : null

      const emptyAxis = fillTimeseries([], p)
      const ttftFilled = ttftOk?.length ? fillTimeseries(ttftOk, p) : emptyAxis
      const tpsFilled = tpsOk?.length ? fillTimeseries(tpsOk, p) : emptyAxis
      const inputTokensFilled = inputTokensOk?.length ? fillTimeseries(inputTokensOk, p) : emptyAxis
      const outputTokensFilled = outputTokensOk?.length ? fillTimeseries(outputTokensOk, p) : emptyAxis
      const cacheHitTokensFilled = cacheHitTokensOk?.length ? fillTimeseries(cacheHitTokensOk, p) : emptyAxis
      const cacheRateFilled = cacheRateOk?.length ? fillTimeseries(cacheRateOk, p) : emptyAxis

      const hasAny = ttftOk?.length || tpsOk?.length || inputTokensOk?.length || outputTokensOk?.length || cacheHitTokensOk?.length || cacheRateOk?.length

      ttftData.value = hasAny ? toDataset('TTFT (ms)', CHART_COLORS.teal, CHART_COLORS.tealFillLight, false, ttftFilled) : null
      tpsData.value = hasAny ? toDataset('TPS', CHART_COLORS.indigo, CHART_COLORS.indigoFill, false, tpsFilled) : null
      tokensData.value = hasAny ? {
        labels: inputTokensFilled.labels,
        datasets: [
          { label: 'Input Tokens', data: inputTokensFilled.values, borderColor: CHART_COLORS.teal, backgroundColor: CHART_COLORS.tealFill, fill: true, tension: 0.4, pointRadius: 0 },
          { label: 'Output Tokens', data: outputTokensFilled.values, borderColor: CHART_COLORS.indigo, backgroundColor: CHART_COLORS.indigoFill, fill: true, tension: 0.4, pointRadius: 0 },
          { label: 'Cache Hit Tokens', data: cacheHitTokensFilled.values, borderColor: CHART_COLORS.green, backgroundColor: CHART_COLORS.tealFillLight, fill: true, tension: 0.4, pointRadius: 0 },
        ],
      } : null
      cacheRateData.value = hasAny ? toDataset('Cache Hit Rate', CHART_COLORS.amber, CHART_COLORS.amberFill, false, {
        labels: cacheRateFilled.labels,
        values: cacheRateFilled.values.map((v) => v * PERCENT_MULTIPLIER),
      }) : null

      summaryRows.value = Array.isArray(summaryOk) ? summaryOk : []
      modelOptions.value = [...new Set(summaryRows.value.map((r: SummaryRow) => r.backend_model))]
    } catch (e) {
      console.error('Failed to load metrics:', e)
      toast.error('加载性能指标失败')
    } finally {
      loading.value = false
    }
  }

  async function loadRouterKeys() {
    try {
      const res = await api.getRouterKeys()
      routerKeys.value = res
    } catch (e) {
      console.error('Failed to load router keys:', e)
      toast.error('加载密钥列表失败')
    }
  }

  async function loadProviders() {
    try {
      providers.value = await api.getProviders()
    } catch (e) {
      console.error('Failed to load providers:', e)
      toast.error('加载供应商列表失败')
    }
  }

  function clearDateRange() {
    dateRange.value = { start: '', end: '' }
  }

  let filterTimer: ReturnType<typeof setTimeout> | null = null
  watch([period, modelFilter, routerKeyFilter, providerFilter, dateRange], () => {
    if (filterTimer) clearTimeout(filterTimer)
    filterTimer = setTimeout(() => fetchMetrics(), 300) // eslint-disable-line no-magic-numbers
  }, { deep: true })

  onMounted(() => {
    loadRouterKeys()
    loadProviders()
    fetchMetrics()
  })

  const dateRangeError = computed(() => {
    const { start, end } = dateRange.value
    if (!start || !end) return ''
    return start >= end ? '结束时间须晚于开始时间' : ''
  })

  return {
    period,
    modelFilter,
    routerKeyFilter,
    providerFilter,
    dateRange,
    dateRangeError,
    loading,
    routerKeys,
    modelOptions,
    filteredModelOptions,
    providers,
    ttftData,
    tpsData,
    tokensData,
    cacheRateData,
    summaryRows,
    noData,
    fetchMetrics,
    clearDateRange,
  }
}
