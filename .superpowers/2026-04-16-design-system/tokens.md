# Token 定义规范

## 颜色 Token

### 状态色（4 组 x 3 级）

基于 oklch，每组包含 base / light / dark 三个变体。`.dark` 模式下不调整状态色本身（oklch 明度已考虑可读性），但 `-light` 变体会反转亮度。

| Token | 用途 | light oklch | dark oklch (仅 -light 调整) |
|-------|------|-------------|----------------------------|
| `--color-success` | 成功/在线 | oklch(0.65 0.17 150) | 不变 |
| `--color-success-light` | 成功背景 | oklch(0.92 0.05 150) | oklch(0.30 0.05 150) |
| `--color-success-dark` | 成功文本 | oklch(0.45 0.15 150) | 不变 |
| `--color-warning` | 警告/待处理 | oklch(0.78 0.16 80) | 不变 |
| `--color-warning-light` | 警告背景 | oklch(0.94 0.06 80) | oklch(0.32 0.06 80) |
| `--color-warning-dark` | 警告文本 | oklch(0.55 0.14 80) | 不变 |
| `--color-danger` | 错误/删除 | oklch(0.58 0.22 25) | 不变 |
| `--color-danger-light` | 错误背景 | oklch(0.90 0.08 25) | oklch(0.28 0.08 25) |
| `--color-danger-dark` | 错误文本 | oklch(0.40 0.18 25) | 不变 |
| `--color-info` | 提示/信息 | oklch(0.62 0.18 250) | 不变 |
| `--color-info-light` | 信息背景 | oklch(0.91 0.06 250) | oklch(0.28 0.06 250) |
| `--color-info-dark` | 信息文本 | oklch(0.43 0.16 250) | 不变 |

### 语义色映射

| Token | 用途 | light oklch | dark oklch |
|-------|------|-------------|------------|
| `--color-bg-page` | 页面背景 | oklch(0.985 0 0) | oklch(0.145 0 0) |
| `--color-bg-card` | 卡片背景 | oklch(1 0 0) | oklch(0.205 0 0) |
| `--color-bg-sidebar` | 侧边栏 | oklch(0.205 0 0) | oklch(0.145 0 0) |
| `--color-text-primary` | 主文本 | oklch(0.145 0 0) | oklch(0.985 0 0) |
| `--color-text-secondary` | 次要文本 | oklch(0.45 0 0) | oklch(0.708 0 0) |
| `--color-text-tertiary` | 辅助文本 | oklch(0.65 0 0) | oklch(0.556 0 0) |

**与 shadcn-vue 的关系：** 不重复定义 `--background`、`--foreground`、`--card` 等 shadcn-vue 已有变量。

## 间距 Token

基于 4px 网格的语义化命名：

| Token | 值 | 用途 |
|-------|----|------|
| `--spacing-page` | 1.5rem | 页面级内边距 |
| `--spacing-section` | 1.25rem | 区块间距 |
| `--spacing-card` | 1rem | 卡片内边距 |
| `--spacing-tight` | 0.5rem | 紧凑间距 |
| `--gap-icon-text` | 0.375rem | 图标与文字间距 |

## 圆角 Token

在 shadcn-vue 的 `--radius` 基础上补充：

| Token | 值 | 用途 |
|-------|----|------|
| `--radius-pill` | 9999px | 胶囊形 |

## 阴影 Token

| Token | 值 | 用途 |
|-------|----|------|
| `--shadow-card` | 0 1px 3px oklch(0 0 0 / 0.1) | 卡片 |
| `--shadow-elevated` | 0 4px 12px oklch(0 0 0 / 0.12) | 悬浮 |
| `--shadow-focus` | 0 0 0 2px oklch(0.62 0.18 250) | 聚焦环 |

## 动画 Token

| Token | 值 | 用途 |
|-------|----|------|
| `--duration-fast` | 150ms | 快速反馈 |
| `--duration-normal` | 200ms | 标准过渡 |
| `--ease-default` | cubic-bezier(0.4, 0, 0.2, 1) | 默认缓动 |

## z-index Token

| Token | 值 | 用途 |
|-------|----|------|
| `--z-dropdown` | 50 | 下拉菜单 |
| `--z-modal` | 100 | 模态框 |
| `--z-toast` | 200 | Toast 通知 |

## Tailwind 注册

在 `tailwind.config.js` 的 `theme.extend` 中注册所有新 token，格式与现有映射保持一致：

```js
colors: {
  success: {
    DEFAULT: 'var(--color-success)',
    light: 'var(--color-success-light)',
    dark: 'var(--color-success-dark)',
  },
  warning: {
    DEFAULT: 'var(--color-warning)',
    light: 'var(--color-warning-light)',
    dark: 'var(--color-warning-dark)',
  },
  danger: {
    DEFAULT: 'var(--color-danger)',
    light: 'var(--color-danger-light)',
    dark: 'var(--color-danger-dark)',
  },
  info: {
    DEFAULT: 'var(--color-info)',
    light: 'var(--color-info-light)',
    dark: 'var(--color-info-dark)',
  },
  page: 'var(--color-bg-page)',
  sidebar: {
    DEFAULT: 'var(--color-bg-sidebar)',
    // 现有 sidebar 变量保持不变
  },
},
boxShadow: {
  card: 'var(--shadow-card)',
  elevated: 'var(--shadow-elevated)',
  focus: 'var(--shadow-focus)',
},
zIndex: {
  dropdown: 'var(--z-dropdown)',
  modal: 'var(--z-modal)',
  toast: 'var(--z-toast)',
},
```

## TypeScript 等价常量

`design-tokens.ts` 提供：

```ts
export const CHART_COLORS = {
  blue: 'oklch(0.62 0.18 250)',
  purple: 'oklch(0.55 0.2 290)',
  green: 'oklch(0.65 0.17 150)',
  amber: 'oklch(0.78 0.16 80)',
  blueFill: 'oklch(0.62 0.18 250 / 0.3)',
  purpleFill: 'oklch(0.55 0.2 290 / 0.3)',
  greenFill: 'oklch(0.65 0.17 150 / 0.3)',
} as const

export const STATUS_COLORS = {
  success: { bg: 'var(--color-success-light)', text: 'var(--color-success-dark)' },
  danger: { bg: 'var(--color-danger-light)', text: 'var(--color-danger-dark)' },
  warning: { bg: 'var(--color-warning-light)', text: 'var(--color-warning-dark)' },
  info: { bg: 'var(--color-info-light)', text: 'var(--color-info-dark)' },
} as const
```

主要供 Chart.js（不支持 CSS 变量）和动态逻辑使用。
