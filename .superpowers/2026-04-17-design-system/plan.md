# Design System v2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将管理后台从灰阶 neutral 主题迁移到 Teal 品牌色体系，新增角色色/SSE事件色 token 和日志详情所需的自定义组件。

**Architecture:** 在现有 oklch CSS 变量 + Tailwind 引用模式上扩展。tokens.css 新增品牌色色阶/角色色/SSE事件色，style.css 调整 shadcn primary 为 teal，tailwind.config.js 映射新 token 为 utility class。自定义组件基于 shadcn-vue 基础组件封装。

**Tech Stack:** Vue 3 + Tailwind CSS + oklch + shadcn-vue

**Spec:** `.superpowers/2026-04-17-design-system/spec.md`

---

## Task 1: CSS Token 扩展

**Files:**
- Modify: `frontend/src/styles/tokens.css`

- [ ] **Step 1: 在 `:root` 状态色之前添加品牌色色阶**

在 `tokens.css` 的 `:root` 块中，`/* === 状态色 === */` 注释之前插入：

```css
  /* === 品牌色（Teal · hue 175） === */
  --color-teal-50:  oklch(0.97 0.02 175);
  --color-teal-100: oklch(0.93 0.04 175);
  --color-teal-200: oklch(0.87 0.07 175);
  --color-teal-300: oklch(0.78 0.10 175);
  --color-teal-400: oklch(0.68 0.13 175);
  --color-teal-500: oklch(0.58 0.14 175);
  --color-teal-600: oklch(0.48 0.12 175);
  --color-teal-700: oklch(0.40 0.10 175);
  --color-teal-800: oklch(0.32 0.08 175);
  --color-teal-900: oklch(0.25 0.06 175);
```

- [ ] **Step 2: 在语义色之后添加角色色**

在 `:root` 块中 `--color-text-tertiary` 之后、间距注释 `/* === 间距 ===` 之前插入：

```css
  /* === 角色色 === */
  --color-role-user:        oklch(0.78 0.10 175);
  --color-role-user-bg:     oklch(0.97 0.02 175);
  --color-role-assistant:   oklch(0.65 0.14 260);
  --color-role-assistant-bg:oklch(0.93 0.04 260);
  --color-role-tool:        oklch(0.65 0.14 30);
  --color-role-tool-bg:     oklch(0.94 0.04 30);
  --color-role-thinking:    oklch(0.58 0.12 290);
  --color-role-thinking-bg: oklch(0.91 0.03 290);
```

- [ ] **Step 3: 添加 SSE 事件色和排版 token**

```css
  /* === SSE 事件色 === */
  --color-sse-message-start:       oklch(0.68 0.13 175);
  --color-sse-content-block-start: oklch(0.58 0.14 175);
  --color-sse-content-block-delta: oklch(0.48 0.12 175);
  --color-sse-message-delta:       oklch(0.40 0.10 175);
  --color-sse-message-stop:        oklch(0.65 0.17 150);

  /* === 紧凑间距（高密度布局） === */
  --spacing-dense-xs: 0.25rem;
  --spacing-dense-sm: 0.375rem;
  --spacing-dense-md: 0.5rem;
```

- [ ] **Step 4: 在 `.dark` 块中添加暗色覆盖**

在 `.dark` 块末尾 `}` 闭合之前（`--color-text-tertiary` 之后）插入：

```css
  --color-role-user-bg:     oklch(0.28 0.04 175);
  --color-role-user:        oklch(0.72 0.08 175);
  --color-role-assistant-bg:oklch(0.25 0.05 260);
  --color-role-assistant:   oklch(0.60 0.10 260);
  --color-role-tool-bg:     oklch(0.25 0.05 30);
  --color-role-tool:        oklch(0.60 0.10 30);
  --color-role-thinking-bg: oklch(0.23 0.04 290);
  --color-role-thinking:    oklch(0.55 0.09 290);
```

- [ ] **Step 5: 验证 CSS 无语法错误**

Run: `cd frontend && npx tailwindcss --help 2>&1 | head -1`
启动 dev server 确认页面无报错。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles/tokens.css
git commit -m "feat(tokens): add teal brand color, role colors, SSE event colors, dense spacing"
```

---

## Task 2: shadcn 基础色调整

**Files:**
- Modify: `frontend/src/style.css`

将 shadcn 的 `--primary` 从灰阶改为 teal，使按钮、选中态等使用品牌色。

- [ ] **Step 1: 修改浅色模式 primary**

在 `style.css` 的 `:root` 块中：

```css
/* 前 */ --primary: oklch(0.205 0 0);
/* 后 */ --primary: oklch(0.48 0.12 175);        /* teal-600 */

/* 前 */ --primary-foreground: oklch(0.985 0 0);
/* 后 */ --primary-foreground: oklch(0.985 0 0);  /* 保持白色 */

/* 前 */ --ring: oklch(0.708 0 0);
/* 后 */ --ring: oklch(0.58 0.14 175);            /* teal-500 */
```

- [ ] **Step 2: 修改暗色模式 primary**

在 `.dark` 块中：

```css
/* 前 */ --primary: oklch(0.922 0 0);
/* 后 */ --primary: oklch(0.68 0.13 175);         /* teal-400 */

/* 前 */ --primary-foreground: oklch(0.205 0 0);
/* 后 */ --primary-foreground: oklch(0.985 0 0);  /* 保持白色 */

/* 前 */ --ring: oklch(0.556 0 0);
/* 后 */ --ring: oklch(0.78 0.10 175);            /* teal-300 */

/* 前 */ --sidebar-primary: oklch(0.488 0.243 264.376);
/* 后 */ --sidebar-primary: oklch(0.68 0.13 175); /* teal-400 */
```

同时更新 `tokens.css` 中的 `--shadow-focus` 从 hue 250 改为 hue 175：

```css
/* tokens.css :root 中 */
/* 前 */ --shadow-focus: 0 0 0 2px oklch(0.62 0.18 250);
/* 后 */ --shadow-focus: 0 0 0 2px oklch(0.58 0.14 175);
```

- [ ] **Step 3: 添加 mono 字体**

在 `style.css` 顶部 import 区域添加 Google Fonts 引入：

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
```

在 `:root` 中 `--font-heading` 之后添加：

```css
--font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
```

- [ ] **Step 4: 启动 dev server 验证**

Run: `cd frontend && npm run dev`
确认：Dashboard 页面主按钮变为 teal 色，选中态高亮为 teal。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/style.css
git commit -m "feat(theme): switch primary to teal, add JetBrains Mono font"
```

---

## Task 3: Tailwind 配置更新

**Files:**
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/src/styles/design-tokens.ts`

- [ ] **Step 1: 在 `theme.extend` 中添加品牌色和角色色映射**

在 `colors` 对象中 `page` 之后添加：

```js
teal: {
  50: 'var(--color-teal-50)',
  100: 'var(--color-teal-100)',
  200: 'var(--color-teal-200)',
  300: 'var(--color-teal-300)',
  400: 'var(--color-teal-400)',
  500: 'var(--color-teal-500)',
  600: 'var(--color-teal-600)',
  700: 'var(--color-teal-700)',
  800: 'var(--color-teal-800)',
  900: 'var(--color-teal-900)',
},
role: {
  user: 'var(--color-role-user)',
  'user-bg': 'var(--color-role-user-bg)',
  assistant: 'var(--color-role-assistant)',
  'assistant-bg': 'var(--color-role-assistant-bg)',
  tool: 'var(--color-role-tool)',
  'tool-bg': 'var(--color-role-tool-bg)',
  thinking: 'var(--color-role-thinking)',
  'thinking-bg': 'var(--color-role-thinking-bg)',
},
sse: {
  'message-start': 'var(--color-sse-message-start)',
  'content-block-start': 'var(--color-sse-content-block-start)',
  'content-block-delta': 'var(--color-sse-content-block-delta)',
  'message-delta': 'var(--color-sse-message-delta)',
  'message-stop': 'var(--color-sse-message-stop)',
},
```

- [ ] **Step 2: 添加字体和间距映射**

在 `fontFamily` 中添加 `mono`，在 `theme.extend` 中添加 `spacing`：

```js
fontFamily: {
  sans: ['var(--font-sans)'],
  heading: ['var(--font-heading)'],
  mono: ['var(--font-mono)'],   // 新增
},
spacing: {
  'dense-xs': 'var(--spacing-dense-xs)',
  'dense-sm': 'var(--spacing-dense-sm)',
  'dense-md': 'var(--spacing-dense-md)',
},
```

- [ ] **Step 3: 更新 design-tokens.ts**

在 `design-tokens.ts` 中新增角色色和 SSE 色：

```ts
/** 角色色映射（Tailwind utility class 场景使用变量，JS 动态场景用此常量） */
export const ROLE_COLORS = {
  user:        { bg: 'var(--color-role-user-bg)',     text: 'var(--color-role-user)' },
  assistant:   { bg: 'var(--color-role-assistant-bg)', text: 'var(--color-role-assistant)' },
  tool:        { bg: 'var(--color-role-tool-bg)',     text: 'var(--color-role-tool)' },
  thinking:    { bg: 'var(--color-role-thinking-bg)', text: 'var(--color-role-thinking)' },
} as const

/** SSE 事件色映射 */
export const SSE_COLORS = {
  'message-start':       'var(--color-sse-message-start)',
  'content-block-start': 'var(--color-sse-content-block-start)',
  'content-block-delta': 'var(--color-sse-content-block-delta)',
  'message-delta':       'var(--color-sse-message-delta)',
  'message-stop':        'var(--color-sse-message-stop)',
} as const
```

- [ ] **Step 4: 验证 Tailwind 构建无报错**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 `Cannot resolve` 错误。

- [ ] **Step 5: Commit**

```bash
git add frontend/tailwind.config.js frontend/src/styles/design-tokens.ts
git commit -m "feat(tailwind): map teal, role, sse colors + mono font + dense spacing"
```

---

## Task 4: 安装 shadcn-vue 组件

**Files:**
- Create: `frontend/src/components/ui/tooltip/`
- Create: `frontend/src/components/ui/separator/`
- Create: `frontend/src/components/ui/scroll-area/`
- Create: `frontend/src/components/ui/avatar/`
- Create: `frontend/src/components/ui/switch/`

- [ ] **Step 1: 安装组件**

Run: `cd frontend && npx shadcn-vue@latest add tooltip separator scroll-area avatar switch`

- [ ] **Step 2: 验证安装**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/
git commit -m "feat(ui): add tooltip, separator, scroll-area, avatar, switch components"
```

---

## Task 5: 自定义基础组件（TagPill + StatPill）

**Files:**
- Create: `frontend/src/components/log-viewer/TagPill.vue`
- Create: `frontend/src/components/log-viewer/StatPill.vue`

- [ ] **Step 1: 创建 TagPill**

等宽小标签，用于工具名列表、content_type 标识。基于 Badge 组件。

```vue
<script setup lang="ts">
import { Badge } from '@/components/ui/badge'

defineProps<{
  label: string
}>()
</script>

<template>
  <Badge variant="outline" class="font-mono text-[10px] rounded-full px-2 py-0.5">
    {{ label }}
  </Badge>
</template>
```

- [ ] **Step 2: 创建 StatPill**

参数标签，用于 model/stream/max_tokens 等键值对。基于 Badge 组件，model 值使用品牌色强调。

```vue
<script setup lang="ts">
import { Badge } from '@/components/ui/badge'

defineProps<{
  label: string
  value: string
  highlight?: boolean
}>()
</script>

<template>
  <Badge
    :variant="highlight ? 'default' : 'secondary'"
    class="font-mono text-sm px-3 py-1.5 rounded-md gap-1"
  >
    <span class="opacity-70">{{ label }}:</span>
    {{ value }}
  </Badge>
</template>
```

- [ ] **Step 3: 验证组件可导入**

在任意页面临时导入确认无编译错误：
```ts
import TagPill from '@/components/log/TagPill.vue'
import StatPill from '@/components/log/StatPill.vue'
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/log-viewer/
git commit -m "feat(components): add TagPill and StatPill for log detail view"
```

---

## Task 6: 自定义日志组件（MessageRow + SseEventLine + InfoBanner）

**Files:**
- Create: `frontend/src/components/log-viewer/MessageRow.vue`
- Create: `frontend/src/components/log-viewer/SseEventLine.vue`
- Create: `frontend/src/components/log-viewer/InfoBanner.vue`

- [ ] **Step 1: 创建 MessageRow**

消息摘要行：Avatar + 角色名 + 内容截断 + 元信息。

```vue
<script setup lang="ts">
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

defineProps<{
  role: 'user' | 'assistant' | 'tool'
  content: string
  meta?: string
  size?: string
}>()

const roleConfig: Record<string, { initial: string; class: string }> = {
  user:      { initial: 'U', class: 'bg-role-user-bg text-role-user' },
  assistant: { initial: 'A', class: 'bg-role-assistant-bg text-role-assistant' },
  tool:      { initial: 'T', class: 'bg-role-tool-bg text-role-tool' },
}
</script>

<template>
  <div class="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50">
    <Avatar :class="'w-5 h-5 ' + roleConfig[role].class">
      <AvatarFallback class="text-[10px] font-medium">
        {{ roleConfig[role].initial }}
      </AvatarFallback>
    </Avatar>
    <span class="text-xs text-foreground flex-1 truncate">{{ content }}</span>
    <span v-if="meta" class="text-[10px] text-muted-foreground">{{ meta }}</span>
  </div>
</template>
```

- [ ] **Step 2: 创建 SseEventLine**

SSE 单行事件：事件类型标签 + 数据摘要。

```vue
<script setup lang="ts">
defineProps<{
  eventType: string
  summary: string
  highlight?: boolean
}>()
</script>

<template>
  <div
    class="px-3 py-2 flex items-center gap-2"
    :class="highlight ? 'bg-warning/10' : ''"
  >
    <span
      class="px-1.5 py-0.5 rounded text-[10px] font-medium"
      :class="{
        'bg-teal-200 text-teal-700 dark:bg-teal-800 dark:text-teal-300': eventType === 'message_start',
        'bg-teal-300 text-teal-700 dark:bg-teal-700 dark:text-teal-200': eventType === 'content_block_start',
        'bg-muted text-muted-foreground': eventType === 'content_block_delta',
        'bg-teal-500 text-white dark:bg-teal-600': eventType === 'message_delta',
        'bg-success-light text-success': eventType === 'message_stop',
      }"
    >{{ eventType }}</span>
    <span class="text-xs text-foreground">{{ summary }}</span>
  </div>
</template>
```

- [ ] **Step 3: 创建 InfoBanner**

信息横幅，基于 Card。

```vue
<script setup lang="ts">
import { Card, CardContent } from '@/components/ui/card'

defineProps<{
  icon?: string
  title: string
  subtitle?: string
  details?: string[]
}>()
</script>

<template>
  <Card class="border-teal-200 dark:border-teal-800">
    <CardContent class="p-3 flex items-center gap-3 bg-teal-50 dark:bg-teal-900">
      <div class="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-xs font-bold">
        {{ icon }}
      </div>
      <div class="flex-1">
        <div class="text-sm font-medium text-teal-900 dark:text-teal-100">{{ title }}</div>
        <div v-if="subtitle" class="text-xs text-teal-700 dark:text-teal-300">{{ subtitle }}</div>
      </div>
      <div v-if="details?.length" class="text-right text-xs text-teal-700 dark:text-teal-300 space-y-0.5">
        <div v-for="d in details" :key="d">{{ d }}</div>
      </div>
    </CardContent>
  </Card>
</template>
```

- [ ] **Step 4: 验证所有组件可导入**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/log-viewer/
git commit -m "feat(components): add MessageRow, SseEventLine, InfoBanner for log detail"
```

---

## Task 7: 文档更新

**Files:**
- Modify: `frontend/docs/design-system.md`

- [ ] **Step 1: 更新设计系统文档**

更新 `design-system.md` 以反映新的 token 体系：
- 品牌色部分：新增 Teal 色阶表格
- 角色色部分：新增四色相角色色映射表
- SSE 事件色部分：新增事件色表格
- 排版部分：新增 mono 字体和紧凑间距
- 组件部分：新增自定义组件列表

- [ ] **Step 2: Commit**

```bash
git add frontend/docs/design-system.md
git commit -m "docs: update design system documentation for v2"
```

---

## Task 8: 页面样式迁移（bg-white + 原生 checkbox）

**Files:**
- Modify: `frontend/src/views/Logs.vue:38`
- Modify: `frontend/src/views/Providers.vue:12,96`
- Modify: `frontend/src/views/ModelMappings.vue:14,60`
- Modify: `frontend/src/views/RouterKeys.vue:11,84,104`
- Modify: `frontend/src/views/RetryRules.vue:13,64`

- [ ] **Step 1: 替换所有 `bg-white` 为 `bg-card`**

涉及 5 处（Logs:38, Providers:12, ModelMappings:14,60, RouterKeys:11, RetryRules:13）：
```vue
<!-- 前 --> class="bg-white rounded-lg border overflow-hidden"
<!-- 后 --> class="bg-card rounded-lg border overflow-hidden"
```

ModelMappings:14 的 Card 上额外移除 `bg-white`：
```vue
<!-- 前 --> <Card class="bg-white ...">
<!-- 后 --> <Card class="...">
```

- [ ] **Step 2: 安装 Checkbox 组件**

Run: `cd frontend && npx shadcn-vue@latest add checkbox`

- [ ] **Step 3: 替换原生 checkbox 为 Checkbox 组件**

涉及 4 处（Providers:96, RouterKeys:84,104, RetryRules:64）。

每处的替换模式：
```vue
<!-- 前 -->
<input type="checkbox" v-model="item.enabled" class="rounded" />

<!-- 后 -->
<script setup>
import { Checkbox } from '@/components/ui/checkbox'
// 需要将 v-model 拆为 :checked + @update:checked
</script>
<Checkbox :checked="item.enabled" @update:checked="item.enabled = $event" />
```

注意：shadcn-vue Checkbox 的 v-model 使用 `checked` prop + `update:checked` event，不兼容原生 `v-model`。

- [ ] **Step 4: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功，无类型错误。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/ frontend/src/components/ui/checkbox/
git commit -m "fix: replace bg-white with bg-card, native checkbox with shadcn-vue Checkbox"
```

---

## Task 9: Chart.js 色彩更新

**Files:**
- Modify: `frontend/src/styles/design-tokens.ts`

- [ ] **Step 1: 更新 CHART_COLORS 使用 teal 品牌色**

```ts
export const CHART_COLORS = {
  teal: 'oklch(0.58 0.14 175)',
  tealFill: 'oklch(0.58 0.14 175 / 0.3)',
  tealFillLight: 'oklch(0.58 0.14 175 / 0.1)',
  indigo: 'oklch(0.65 0.14 260)',
  indigoFill: 'oklch(0.65 0.14 260 / 0.3)',
  green: 'oklch(0.65 0.17 150)',
  amber: 'oklch(0.78 0.16 80)',
  amberFill: 'oklch(0.78 0.16 80 / 0.1)',
} as const
```

- [ ] **Step 2: 更新 Dashboard.vue 中引用 CHART_COLORS 的位置**

将原来使用 `CHART_COLORS.blue` 的地方替换为 `CHART_COLORS.teal`，`CHART_COLORS.purple` 替换为 `CHART_COLORS.indigo`。

- [ ] **Step 3: 验证**

Run: `cd frontend && npm run build`
启动 dev server，检查 Dashboard 图表颜色为 teal 系。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/design-tokens.ts frontend/src/views/Dashboard.vue
git commit -m "feat(dashboard): update chart colors to teal brand palette"
```

---

## Task 10: 端到端验证

- [ ] **Step 1: 浅色模式验证**

启动 `cd frontend && npm run dev`，检查：
- Dashboard 主按钮/选中态为 teal 色，图表为 teal 系
- Logs 页面表格背景适应暗色模式，badge/状态色正常
- Providers / ModelMappings / RouterKeys / RetryRules 页面 checkbox 正常工作
- 无 console 报错

- [ ] **Step 2: 暗色模式验证**

切换浏览器到暗色模式（或手动添加 `.dark` class），检查：
- primary 按钮为 teal-400
- 表格容器 `bg-card` 在暗色下正确显示
- 角色色背景在深色下可辨认
- 文字对比度可读

- [ ] **Step 3: 后端构建验证**

Run: `npm run build && npm test`
Expected: 后端构建和测试正常，前端改动不影响后端。

---

## Task 11: 日志详情 Modal 重构

**Files:**
- Modify: `frontend/src/views/Logs.vue` — 重构日志详情 Dialog 内容布局
- Rename: `frontend/src/components/logs/` → `frontend/src/components/log-viewer/`（与新增组件统一目录）
- Modify: `frontend/src/components/log-viewer/LogStageDetail.vue` — 替换为新的折叠模式
- Keep: `frontend/src/components/log-viewer/LogRequestViewer.vue` — 保留解析逻辑，更新样式
- Keep: `frontend/src/components/log-viewer/LogResponseViewer.vue` — 保留解析逻辑，更新 SSE 事件展示
- Use: `frontend/src/components/log-viewer/MessageRow.vue`, `SseEventLine.vue`, `InfoBanner.vue`, `TagPill.vue`, `StatPill.vue`

将当前的「时间线 + 阶段钻取」模式改为参考 mockup 的「单页折叠」模式。

**目标布局（参考 `.superpowers/mockup-log-viewer.html`）：**

1. **基本信息区**（始终可见）：类型、模型、状态码、延迟、流式、时间
2. **Claude Code 标识横幅**（条件显示）：使用 InfoBanner 组件
3. **客户端原始请求**（折叠面板）：使用 Collapsible，内部 tabs（结构化/原始 JSON）
   - 结构化视图：StatPill（参数标签）、Headers（折叠）、Messages（MessageRow 列表）、System、Tools（TagPill 列表）
4. **LLM API 返回的原始响应**（折叠面板）：使用 Collapsible，内部 tabs（结构化/原始 SSE 文本）
   - 结构化视图：StatPill（状态+usage）、SSE 事件列表（SseEventLine）

**关键原则：**
- 保留现有的 LogRequestViewer / LogResponseViewer 解析逻辑（JSON parse、SSE parse、block extraction 等）
- 只改变布局组装方式：从 LogDetailFlow + LogStageDetail 的两级导航改为单页折叠
- LogRequestViewer / LogResponseViewer 的 `mode` prop 仍由父组件控制
- 新增的 MessageRow / SseEventLine 等组件在日志数据量大的场景使用，基础 Badge 展示保留给小数据量

- [ ] **Step 1: 读取 mockup 和现有组件，确认重构范围**

Read: `.superpowers/mockup-log-viewer.html`、`Logs.vue`、`LogDetailFlow.vue`、`LogStageDetail.vue`

- [ ] **Step 2: 重构 Logs.vue 中日志详情 Dialog**

将当前的 LogDetailFlow + LogStageDetail 两级导航替换为折叠面板布局。

- [ ] **Step 3: 更新 LogRequestViewer 的 Claude Code 标识区域**

将现有的 Card 样式 Claude Code 标识替换为 InfoBanner 组件。将参数 Badge 替换为 StatPill。

- [ ] **Step 4: 更新 LogResponseViewer 的 SSE 事件展示**

将 Anthropic 原始事件流中的行级展示替换为 SseEventLine 组件。将 status/usage Badge 替换为 StatPill。

- [ ] **Step 5: 验证**

Run: `cd frontend && npm run build`
启动 dev server，打开日志详情 Modal，确认：
- 基本信息区正确显示
- Claude Code 请求正确触发 InfoBanner
- 客户端请求/服务端响应折叠面板可展开
- 结构化/原始 tabs 正常切换
- 暗色模式下显示正确

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat(logs): redesign log detail modal with accordion layout and new design system components"
```

---

## 后续任务（本次不实施）

- Login 页面品牌化：引入 teal 品牌色增强视觉识别
