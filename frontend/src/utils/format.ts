import { i18n } from '@/i18n'

function currentLocale(): string {
  return i18n.global.locale.value
}

/** 项目展示时区，所有用户可见的时间都应通过此常量格式化 */
const DISPLAY_TZ = 'Asia/Shanghai'

const TZ_OPTS: Intl.DateTimeFormatOptions = { timeZone: DISPLAY_TZ }

// --- 解析 ---

/** 将后端返回的 UTC datetime 字符串正确解析为 Date（补 Z 后缀避免被当作本地时间） */
export function parseUtc(iso: string): Date {
  return new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z')
}

// --- 格式化 ---

/** 完整时间：2026/04/25 20:21:00 */
export function formatTime(iso: string): string {
  return parseUtc(iso).toLocaleString(currentLocale(), TZ_OPTS)
}

/** 短时间：04/25 20:21（用于表格、图表标签等紧凑场景） */
export function formatTimeShort(iso: string): string {
  return parseUtc(iso).toLocaleString(currentLocale(), {
    ...TZ_OPTS,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 仅时分：20:21（用于图表 x 轴等） */
export function formatTimeHM(date: Date): string {
  return date.toLocaleTimeString(currentLocale(), { ...TZ_OPTS, hour: '2-digit', minute: '2-digit' })
}

/** 月日时分：4/25 20:00（用于长周期图表标签） */
export function formatTimeMDH(date: Date): string {
  return date.toLocaleString(currentLocale(), {
    ...TZ_OPTS,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
