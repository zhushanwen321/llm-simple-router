/** Chart.js 等不支持 CSS 变量的场景使用的颜色常量 */
export const CHART_COLORS = {
  blue: 'oklch(0.62 0.18 250)',
  purple: 'oklch(0.55 0.2 290)',
  green: 'oklch(0.65 0.17 150)',
  amber: 'oklch(0.78 0.16 80)',
  blueFill: 'oklch(0.62 0.18 250 / 0.3)',
  purpleFill: 'oklch(0.55 0.2 290 / 0.3)',
  greenFill: 'oklch(0.65 0.17 150 / 0.3)',
  amberFill: 'oklch(0.78 0.16 80 / 0.1)',
  blueFillLight: 'oklch(0.62 0.18 250 / 0.1)',
} as const

/** 状态色映射（CSS 变量形式，用于动态样式） */
export const STATUS_COLORS = {
  success: { bg: 'var(--color-success-light)', text: 'var(--color-success-dark)' },
  danger: { bg: 'var(--color-danger-light)', text: 'var(--color-danger-dark)' },
  warning: { bg: 'var(--color-warning-light)', text: 'var(--color-warning-dark)' },
  info: { bg: 'var(--color-info-light)', text: 'var(--color-info-dark)' },
} as const
