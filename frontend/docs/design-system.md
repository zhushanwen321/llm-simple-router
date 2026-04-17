# 设计系统规范

## Token 清单

完整定义见 `src/styles/tokens.css`。

### 品牌色

基于 Teal（hue 175）的完整色阶，`--color-teal-500` 为主品牌色。shadcn 的 `--primary` 和 `--ring` 已指向该色阶，因此主按钮、焦点环等均自动使用品牌色。

| Token | 值 |
|-------|----|
| `--color-teal-50` | oklch(0.97 0.02 175) |
| `--color-teal-100` | oklch(0.93 0.04 175) |
| `--color-teal-200` | oklch(0.87 0.07 175) |
| `--color-teal-300` | oklch(0.78 0.10 175) |
| `--color-teal-400` | oklch(0.68 0.13 175) |
| `--color-teal-500` | oklch(0.58 0.14 175) |
| `--color-teal-600` | oklch(0.48 0.12 175) |
| `--color-teal-700` | oklch(0.40 0.10 175) |
| `--color-teal-800` | oklch(0.32 0.08 175) |
| `--color-teal-900` | oklch(0.25 0.06 175) |

### 状态色

| 用途 | 变量 | 浅色值 | 深色值 |
|------|------|--------|--------|
| 成功/在线 | `--color-success` | oklch(0.65 0.17 150) | 同 |
| 警告/待处理 | `--color-warning` | oklch(0.78 0.16 80) | 同 |
| 危险/删除 | `--color-danger` | oklch(0.58 0.22 25) | 同 |
| 提示/信息 | `--color-info` | oklch(0.62 0.18 250) | 同 |

每种状态色均提供 `*-light`（背景）和 `*-dark`（文字）变体，暗色模式下自动调整 light 变体。

### 角色色

用于区分对话中不同角色的视觉标识，暗色模式下有独立覆盖值。

| 角色 | 文字色变量 | 背景色变量 | Hue | Tailwind class |
|------|-----------|-----------|-----|----------------|
| User | `--color-role-user` | `--color-role-user-bg` | 175 (teal) | `text-role-user` / `bg-role-user-bg` |
| Assistant | `--color-role-assistant` | `--color-role-assistant-bg` | 260 (indigo) | `text-role-assistant` / `bg-role-assistant-bg` |
| Tool | `--color-role-tool` | `--color-role-tool-bg` | 30 (orange) | `text-role-tool` / `bg-role-tool-bg` |
| Thinking | `--color-role-thinking` | `--color-role-thinking-bg` | 290 (purple) | `text-role-thinking` / `bg-role-thinking-bg` |

### SSE 事件色

用于请求日志详情页中 SSE 事件的类型标识，采用品牌色（teal）不同明度层级。`message_stop` 事件复用成功色（green），表示流程正常结束。

| 事件类型 | 变量 | 值 | 说明 |
|---------|------|----|------|
| message_start | `--color-sse-message-start` | oklch(0.68 0.13 175) | 最浅 teal |
| content_block_start | `--color-sse-content-block-start` | oklch(0.58 0.14 175) | 中 teal |
| content_block_delta | `--color-sse-content-block-delta` | oklch(0.48 0.12 175) | 深 teal |
| message_delta | `--color-sse-message-delta` | oklch(0.40 0.10 175) | 最深 teal |
| message_stop | `--color-sse-message-stop` | oklch(0.65 0.17 150) | 成功绿 |

### 语义色

引用 shadcn-vue CSS 变量，单一数据源：

| 用途 | Tailwind class | 变量来源 |
|------|---------------|----------|
| 主文本 | `text-foreground` | `--foreground` |
| 次要文本 | `text-muted-foreground` | `--muted-foreground` |
| 页面背景 | `bg-background` | `--background` |
| 卡片背景 | `bg-card` | `--card` |
| 主操作 | `bg-primary` / `text-primary` | `--primary` |
| 次要操作 | `bg-secondary` / `text-secondary` | `--secondary` |
| 危险操作 | `bg-destructive` / `text-destructive` | `--destructive` |
| 边框 | `border-border` | `--border` |
| 输入框 | `border-input` | `--input` |
| 焦点环 | `ring-ring` | `--ring` |

### 排版

| 用途 | 配置 | 说明 |
|------|------|------|
| 等宽字体 | `font-mono` | JetBrains Mono，用于代码、JSON、SSE 等内容 |

### 间距

| Token | 值 | 用途 |
|-------|----|------|
| `--spacing-dense-xs` | 0.25rem | 极紧凑内边距 |
| `--spacing-dense-sm` | 0.375rem | 紧凑内边距 |
| `--spacing-dense-md` | 0.5rem | 中等紧凑内边距 |
| `--spacing-page` | 1.5rem | 页面级内边距 |
| `--spacing-section` | 1.25rem | 区块间距 |
| `--spacing-card` | 1rem | 卡片内边距 |
| `--spacing-tight` | 0.5rem | 紧凑间距 |
| `--gap-icon-text` | 0.375rem | 图标与文字间距 |

密集间距 token 对应 Tailwind class：`p-dense-xs`、`p-dense-sm`、`p-dense-md`、`gap-dense-sm` 等。

### 阴影

| Token | 用途 |
|-------|------|
| `--shadow-card` | 卡片阴影 |
| `--shadow-elevated` | 弹出层/浮层阴影 |
| `--shadow-focus` | 焦点指示环 |

## 颜色使用指南

| 场景 | Tailwind class |
|------|---------------|
| 成功/在线状态 | `text-success` `bg-success-light` |
| 错误/删除确认 | `text-destructive` `bg-destructive` 或 `text-danger` `bg-danger-light` |
| 警告/待处理 | `text-warning` `bg-warning-light` |
| 提示/信息 | `text-info` `bg-info-light` |
| 主文本 | `text-foreground` |
| 次要说明文字 | `text-muted-foreground` |
| 页面背景 | `bg-background` |
| 卡片容器 | `bg-card` |

## 禁止项

- **禁止使用 Tailwind 色系**：`text-gray-*`、`bg-blue-*`、`text-red-*` 等，一律使用语义 token
- **禁止使用 `bg-white`**：用 `bg-card` 替代，确保暗色模式下自动适配
- **禁止使用原生 HTML 表单元素**：用 shadcn-vue 组件替代（Button、Input、Select 等）
- **禁止使用 Emoji**：用 lucide-vue-next 图标组件替代

## 暗色模式

通过根元素 `.dark` 类切换，语义色自动适配。状态色的 `*-light` 变体在暗色模式下有独立覆盖值（见 `tokens.css` 中 `.dark` 块）。业务代码无需手动处理暗色适配。

## Chart.js 颜色

Chart.js 不支持 CSS 变量，使用 `src/styles/design-tokens.ts` 中的常量：

```ts
import { CHART_COLORS } from '@/styles/design-tokens'
// CHART_COLORS.blue, CHART_COLORS.blueFill 等
```
