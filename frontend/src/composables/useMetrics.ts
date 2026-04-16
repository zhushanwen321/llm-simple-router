import { ref, computed, watch, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import type { ChartData } from 'chart.js'
import { api } from '@/api/client'
import { fillTimeseries } from '@/views/metrics-helpers'
import { CHART_COLORS } from '@/styles/design-tokens'

const PERCENT_MULTIPLIER = 100

interface SummaryRow {
  backend_model: string
  request_count: number
  avg_ttft_ms: number | null
  avg_tps: number | null
  total_input_tokens: number | null
  total_output_tokens: number | null
  total_cache_hit_tokens: number | null
  cache_hit_rate: number | null
}

export function useMetrics() {
  const period = ref('24h')
  const modelFilter = ref('all')
  const routerKeyFilter = ref('all')
  const loading = ref(false)
  const routerKeys = ref<{ id: string; name: string }[]>([])
  const modelOptions = ref<string[]>([])

  const ttftData = ref<ChartData<'line'> | null>(null)
  const tpsData = ref<ChartData<'line'> | null>(null)
  const tokensData = ref<ChartData<'line'> | null>(null)
  const cacheRateData = ref<ChartData<'line'> | null>(null)
  const summaryRows = ref<SummaryRow[]>([])

  const noData = computed(() => {
    const hasChart = ttftData.value || tpsData.value || tokensData.value || cacheRateData.value
    return !hasChart && summaryRows.value.length === 0
  })

  function buildTimeseriesParams(metric: string) {
    const params: { period: string; metric: string; backend_model?: string; router_key_id?: string } = { period: period.value, metric }
    if (modelFilter.value !== 'all') params.backend_model = modelFilter.value
    if (routerKeyFilter.value !== 'all') params.router_key_id = routerKeyFilter.value
    return params
  }

  function buildSummaryParams() {
    const params: { period: string; backend_model?: string; router_key_id?: string } = { period: period.value }
    if (modelFilter.value !== 'all') params.backend_model = modelFilter.value
    if (routerKeyFilter.value !== 'all') params.router_key_id = routerKeyFilter.value
    return params
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
      const p = period.value

      const ttftOk = fulfilled(ttftRes) ? ttftRes.value.data : null
      const tpsOk = fulfilled(tpsRes) ? tpsRes.value.data : null
      const inputTokensOk = fulfilled(inputTokensRes) ? inputTokensRes.value.data : null
      const outputTokensOk = fulfilled(outputTokensRes) ? outputTokensRes.value.data : null
      const cacheHitTokensOk = fulfilled(cacheHitTokensRes) ? cacheHitTokensRes.value.data : null
      const cacheRateOk = fulfilled(cacheRateRes) ? cacheRateRes.value.data : null
      const summaryOk = fulfilled(summaryRes) ? summaryRes.value.data : null

      const emptyAxis = fillTimeseries([], p)
      const ttftFilled = ttftOk?.length ? fillTimeseries(ttftOk, p) : emptyAxis
      const tpsFilled = tpsOk?.length ? fillTimeseries(tpsOk, p) : emptyAxis
      const inputTokensFilled = inputTokensOk?.length ? fillTimeseries(inputTokensOk, p) : emptyAxis
      const outputTokensFilled = outputTokensOk?.length ? fillTimeseries(outputTokensOk, p) : emptyAxis
      const cacheHitTokensFilled = cacheHitTokensOk?.length ? fillTimeseries(cacheHitTokensOk, p) : emptyAxis
      const cacheRateFilled = cacheRateOk?.length ? fillTimeseries(cacheRateOk, p) : emptyAxis

      const hasAny = ttftOk?.length || tpsOk?.length || inputTokensOk?.length || outputTokensOk?.length || cacheHitTokensOk?.length || cacheRateOk?.length

      ttftData.value = hasAny ? toDataset('TTFT (ms)', CHART_COLORS.blue, CHART_COLORS.blueFillLight, false, ttftFilled) : null
      tpsData.value = hasAny ? toDataset('TPS', CHART_COLORS.purple, CHART_COLORS.purpleFill, false, tpsFilled) : null
      tokensData.value = hasAny ? {
        labels: inputTokensFilled.labels,
        datasets: [
          { label: 'Input Tokens', data: inputTokensFilled.values, borderColor: CHART_COLORS.blue, backgroundColor: CHART_COLORS.blueFill, fill: true, tension: 0.4, pointRadius: 0 },
          { label: 'Output Tokens', data: outputTokensFilled.values, borderColor: CHART_COLORS.purple, backgroundColor: CHART_COLORS.purpleFill, fill: true, tension: 0.4, pointRadius: 0 },
          { label: 'Cache Hit Tokens', data: cacheHitTokensFilled.values, borderColor: CHART_COLORS.green, backgroundColor: CHART_COLORS.greenFill, fill: true, tension: 0.4, pointRadius: 0 },
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
      routerKeys.value = res.data
    } catch (e) {
      console.error('Failed to load router keys:', e)
      toast.error('加载密钥列表失败')
    }
  }

  let filterTimer: ReturnType<typeof setTimeout> | null = null
  watch([period, modelFilter, routerKeyFilter], () => {
    if (filterTimer) clearTimeout(filterTimer)
    filterTimer = setTimeout(() => fetchMetrics(), 300) // eslint-disable-line no-magic-numbers
  })

  onMounted(() => {
    loadRouterKeys()
    fetchMetrics()
  })

  return {
    period,
    modelFilter,
    routerKeyFilter,
    loading,
    routerKeys,
    modelOptions,
    ttftData,
    tpsData,
    tokensData,
    cacheRateData,
    summaryRows,
    noData,
    fetchMetrics,
  }
}
