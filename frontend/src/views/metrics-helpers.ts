import type { ChartOptions } from 'chart.js'

const SEC_PER_MINUTE = 60
const SEC_PER_HOUR = 3600
const SEC_PER_DAY = 86400
const MS_PER_SEC = 1000
const HOURS_5 = 5
const HOURS_6 = 6
const DAYS_7 = 7
const DAYS_30 = 30
const MINUTES_5 = 5
const MINUTES_15 = 15
const HOURS_4 = 4
const TICK_PADDING = 2
const PERIOD_TOTAL_SEC: Record<string, number> = {
  '1h': SEC_PER_HOUR,
  '5h': SEC_PER_HOUR * HOURS_5,
  '6h': SEC_PER_HOUR * HOURS_6,
  '24h': SEC_PER_DAY,
  '7d': SEC_PER_DAY * DAYS_7,
  '30d': SEC_PER_DAY * DAYS_30,
}

const BUCKET_SEC: Record<string, number> = {
  '1h': SEC_PER_MINUTE,
  '5h': SEC_PER_MINUTE * MINUTES_5,
  '6h': SEC_PER_MINUTE * MINUTES_5,
  '24h': SEC_PER_MINUTE * MINUTES_15,
  '7d': SEC_PER_HOUR,
  '30d': SEC_PER_HOUR * HOURS_4,
}

const DEFAULT_BUCKET_SEC = SEC_PER_MINUTE * MINUTES_15
const DEFAULT_TOTAL_SEC = SEC_PER_DAY
const TARGET_TICKS = 12
const MIN_TICKS = 4

function formatLabel(date: Date, periodStr: string): string {
  if (periodStr === '7d' || periodStr === '30d') {
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hours = String(date.getHours()).padStart(TICK_PADDING, '0')
    return `${month}/${day} ${hours}:00`
  }
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

interface TimeseriesRawRow {
  time_bucket: string
  avg_value: number | null
  count: number
}

function bucketMs(bucketSec: number): number {
  return bucketSec * MS_PER_SEC
}

export function fillTimeseries(
  raw: TimeseriesRawRow[],
  periodStr: string,
): { labels: string[]; values: number[] } {
  const bucketSec = BUCKET_SEC[periodStr] ?? DEFAULT_BUCKET_SEC
  const totalSec = PERIOD_TOTAL_SEC[periodStr] ?? DEFAULT_TOTAL_SEC
  const now = new Date()
  const bMs = bucketMs(bucketSec)
  const nowBucket = Math.floor(now.getTime() / bMs) * bMs
  const startBucket = nowBucket - totalSec * MS_PER_SEC
  const totalBuckets = Math.round(totalSec / bucketSec)

  const byKey = new Map<number, TimeseriesRawRow>()
  for (const r of raw) {
    const d = new Date(r.time_bucket)
    const key = Math.floor(d.getTime() / bMs)
    byKey.set(key, r)
  }

  const labels: string[] = []
  const values: number[] = []

  for (let i = 0; i <= totalBuckets; i++) {
    const ts = startBucket + i * bMs
    const date = new Date(ts)
    labels.push(formatLabel(date, periodStr))
    const row = byKey.get(Math.floor(ts / bMs))
    values.push(row && row.avg_value != null ? row.avg_value : 0)
  }

  return { labels, values }
}

function tickIndices(total: number): Set<number> {
  const result = new Set<number>()
  const target = Math.max(MIN_TICKS, Math.min(TARGET_TICKS, total))
  if (total <= target) {
    for (let i = 0; i < total; i++) result.add(i)
    return result
  }
  for (let i = 0; i < target; i++) {
    result.add(Math.round(i * (total - 1) / (target - 1)))
  }
  result.add(total - 1)
  return result
}

type TickCallbackThis = { getLabelForValue: (val: number) => string }

function makeXTickCallback(ticks: Set<number>) {
  return function (this: TickCallbackThis, val: string | number) {
    const idx = typeof val === 'number' ? val : parseInt(val, 10)
    return ticks.has(idx) ? this.getLabelForValue(idx) : ''
  }
}

export function lineOptions(unit: string, labels: string[]): ChartOptions<'line'> {
  const ticks = tickIndices(labels.length)
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: { label: (ctx) => `${ctx.parsed.y} ${unit}` },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        ticks: { maxRotation: 0, callback: makeXTickCallback(ticks) },
      },
      y: { display: true, beginAtZero: true },
    },
  }
}

export function stackedAreaOptions(labels: string[]): ChartOptions<'line'> {
  const ticks = tickIndices(labels.length)
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom' } },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: { maxRotation: 0, callback: makeXTickCallback(ticks) },
      },
      y: { stacked: true, beginAtZero: true },
    },
  }
}
