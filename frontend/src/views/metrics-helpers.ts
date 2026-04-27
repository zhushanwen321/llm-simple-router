import type { ChartOptions } from 'chart.js'
import { parseUtc, formatTimeHM } from '@/utils/format'

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
const DAY_MS = SEC_PER_DAY * MS_PER_SEC
const DAY_TICK_THRESHOLD = 4

const PERIOD_TOTAL_SEC: Record<string, number> = {
  '1h': SEC_PER_HOUR,
  '5h': SEC_PER_HOUR * HOURS_5,
  '6h': SEC_PER_HOUR * HOURS_6,
  '24h': SEC_PER_DAY,
  '7d': SEC_PER_DAY * DAYS_7,
  '30d': SEC_PER_DAY * DAYS_30,
  'window': SEC_PER_HOUR * HOURS_5,
  'weekly': SEC_PER_DAY * DAYS_7,
  'monthly': SEC_PER_DAY * DAYS_30,
}

const BUCKET_SEC: Record<string, number> = {
  '1h': SEC_PER_MINUTE,
  '5h': SEC_PER_MINUTE * MINUTES_5,
  '6h': SEC_PER_MINUTE * MINUTES_5,
  '24h': SEC_PER_MINUTE * MINUTES_15,
  '7d': SEC_PER_HOUR,
  '30d': SEC_PER_HOUR * HOURS_4,
  'window': SEC_PER_MINUTE * MINUTES_5,
  'weekly': SEC_PER_HOUR,
  'monthly': SEC_PER_HOUR * HOURS_4,
}

const DEFAULT_BUCKET_SEC = SEC_PER_MINUTE * MINUTES_15
const DEFAULT_TOTAL_SEC = SEC_PER_DAY
const TICK_COUNT = 5
const LONG_PERIODS = new Set(['7d', '30d', 'weekly', 'monthly'])

interface TimeseriesRawRow {
  time_bucket: string
  avg_value: number | null
  count: number
}

function bucketMs(bucketSec: number): number {
  return bucketSec * MS_PER_SEC
}

/** 根据时间跨度选择标签格式：短区间用 HH:mm，长区间用 M/D */
function pickLabelFormat(periodStr: string, firstTs?: number, lastTs?: number): 'time' | 'day' {
  // 优先根据实际时间区间判断
  if (firstTs != null && lastTs != null) {
    return (lastTs - firstTs) > DAY_TICK_THRESHOLD * DAY_MS ? 'day' : 'time'
  }
  // 无实际区间时，用 periodStr 推断
  return LONG_PERIODS.has(periodStr) ? 'day' : 'time'
}

function makeLabel(date: Date, fmt: 'time' | 'day'): string {
  return fmt === 'day' ? `${date.getMonth() + 1}/${date.getDate()}` : formatTimeHM(date)
}

export function fillTimeseries(
  raw: TimeseriesRawRow[],
  periodStr: string,
  timeRange?: { startTime: string; endTime: string },
): { labels: string[]; values: number[] } {
  const bucketSec = BUCKET_SEC[periodStr] ?? DEFAULT_BUCKET_SEC
  const bMs = bucketMs(bucketSec)

  // Determine the actual time range from provided timeRange or fallback to period-based calculation
  let startMs: number
  let endMs: number
  if (timeRange) {
    startMs = Math.floor(parseUtc(timeRange.startTime).getTime() / bMs) * bMs
    endMs = Math.ceil(parseUtc(timeRange.endTime).getTime() / bMs) * bMs
  } else {
    const totalSec = PERIOD_TOTAL_SEC[periodStr] ?? DEFAULT_TOTAL_SEC
    const now = new Date()
    const nowBucket = Math.floor(now.getTime() / bMs) * bMs
    startMs = nowBucket - totalSec * MS_PER_SEC
    endMs = nowBucket
  }

  const totalBuckets = Math.round((endMs - startMs) / bMs)
  const labelFmt = pickLabelFormat(periodStr, startMs, endMs)

  const byKey = new Map<number, TimeseriesRawRow>()
  for (const r of raw) {
    const d = parseUtc(r.time_bucket)
    const key = Math.floor(d.getTime() / bMs)
    byKey.set(key, r)
  }

  const labels: string[] = []
  const values: number[] = []

  for (let i = 0; i <= totalBuckets; i++) {
    const ts = startMs + i * bMs
    labels.push(makeLabel(new Date(ts), labelFmt))
    const row = byKey.get(Math.floor(ts / bMs))
    values.push(row && row.avg_value != null ? row.avg_value : 0)
  }

  return { labels, values }
}

function tickIndices(total: number): Set<number> {
  const result = new Set<number>()
  if (total <= TICK_COUNT) {
    for (let i = 0; i < total; i++) result.add(i)
    return result
  }
  // Always show exactly TICK_COUNT evenly spaced ticks (including first and last)
  for (let i = 0; i < TICK_COUNT; i++) {
    result.add(Math.round(i * (total - 1) / (TICK_COUNT - 1)))
  }
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
        ticks: { maxRotation: 0, autoSkip: false, callback: makeXTickCallback(ticks) },
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
        ticks: { maxRotation: 0, autoSkip: false, callback: makeXTickCallback(ticks) },
      },
      y: { stacked: true, beginAtZero: true },
    },
  }
}
