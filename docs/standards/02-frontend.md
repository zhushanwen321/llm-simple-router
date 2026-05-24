# 前端规范

> 适用范围：`frontend/` 目录下所有 Vue / TypeScript 代码。
> 最后更新：2026-05-24

---

## 1. 技术栈

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | Vue 3 | 3.5+ | SFC + Composition API |
| 语言 | TypeScript | 5.x | 严格模式 |
| 构建工具 | Vite | 8.x | 开发服务器 + 生产构建 |
| CSS 框架 | Tailwind CSS | 3.4 | 原子化工具类 |
| 组件库 | shadcn-vue | 2.6 | 基于 Radix Vue / Reka UI 的无样式组件 |
| 路由 | Vue Router | 4.x | History 模式，base: `/admin/` |
| 状态管理 | 无 Pinia/Vuex | — | 使用 composable + 组件本地 ref/computed |
| 图表 | Chart.js + vue-chartjs | 4.5 / 5.3 | 仪表盘、监控图表 |
| 表格 | @tanstack/vue-table | 8.21 | 复杂交互表格 |
| 图标 | lucide-vue-next | 1.x | 所有 UI 图标 |
| 通知 | vue-sonner | 2.x | Toast 通知 |
| HTTP | axios | 1.x | API 客户端 |
| 表单验证 | vee-validate + zod | 4.x / 3.x | 类型安全的表单校验 |
| i18n | vue-i18n | 11.x | zh-CN + en 双语 |
| 日期 | date-fns | 4.x | 日期格式化 |
| 工具函数 | @vueuse/core | 14.x | 响应式工具 |
| SVG 加载 | vite-svg-loader | — | SVG 作为 Vue 组件导入 |

### 为什么选择这套技术栈

- **shadcn-vue 而非 Element/Ant Design**：项目需要精细控制 UI 外观（oklch 色彩空间、暗色模式），shadcn-vue 提供 WAI-ARIA 无样式的底层原语，与 Tailwind 深度集成，不引入额外设计语言冲突。
- **无 Pinia**：管理后台状态简单（页面级 CRUD + 少量全局状态如主题、认证），composable 模式更轻量，避免引入 store 的概念负担。全局共享状态（`isDark`、`isAuthenticated`、`localeLoaded`）通过模块级 ref 导出。
- **原生 EventSource 而非封装库**：Monitor 页面只需 SSE 连接管理，`useMonitorSSE` composable 足够简单（连接/断开/重连/页面隐藏检测），无需引入第三方 SSE 库。

---

## 2. 目录结构

```
frontend/
├── index.html                  # 入口 HTML
├── vite.config.ts              # Vite 构建配置
├── tailwind.config.js          # Tailwind 语义色/间距/圆角扩展
├── postcss.config.js           # PostCSS（Tailwind + autoprefixer）
├── vitest.config.ts            # 测试配置（jsdom 环境）
├── package.json
└── src/
    ├── main.ts                 # 应用入口：挂载 Vue、初始化主题、异步加载 i18n
    ├── App.vue                 # 根组件：认证布局 + Toaster
    ├── constants.ts            # 前端常量（HTTP 状态码、API 业务码、阈值）
    ├── style.css               # Tailwind 入口（@tailwind base/components/utilities）
    ├── api/
    │   └── client.ts           # axios 实例 + request<T>() 类型安全封装 + api 对象
    ├── assets/
    │   └── icons/              # SVG 图标文件（Provider 品牌 icon，明暗双版）
    ├── components/
    │   ├── ui/                 # shadcn-vue 组件（25+ 个，禁止修改内部实现）
    │   ├── layout/             # 布局组件（Sidebar.vue）
    │   ├── icons/              # 图标组件（ProviderIcon.vue，根据品牌/主题切换）
    │   ├── shared/             # 跨页面共享组件（ConcurrencyControl、ProxyConfigForm 等）
    │   ├── providers/          # Provider 管理页面专用组件
    │   ├── mappings/           # 模型映射页面专用组件
    │   ├── logs/               # 日志页面专用组件 + types.ts
    │   ├── monitor/            # 监控页面专用组件
    │   ├── retry-rules/        # 重试规则页面专用组件
    │   ├── schedules/          # 定时调度页面专用组件
    │   ├── request-detail/     # 请求详情组件 + types.ts
    │   ├── log-viewer/         # 日志内容查看器
    │   └── quick-setup/        # 快速配置向导组件
    ├── composables/
    │   ├── useTheme.ts         # 主题切换（light/dark，localStorage 持久化）
    │   ├── useLocale.ts        # 语言切换
    │   ├── useClipboard.ts     # 剪贴板操作
    │   ├── useLogs.ts          # 日志列表加载 + 分页 + 筛选 + 详情
    │   ├── useMonitorSSE.ts    # SSE 连接管理（EventSource + 自动重连 + 页面隐藏断开）
    │   ├── useMonitorData.ts   # 监控数据聚合（活跃/最近/统计/并发）
    │   ├── useDashboard.ts     # 仪表盘数据
    │   ├── useProviderForm.ts  # Provider 表单状态
    │   ├── useProviderActions.ts # Provider 操作（创建/更新/删除/测试）
    │   ├── useProviderPresets.ts # Provider 预设模板
    │   ├── useFetchUpstreamModels.ts # 拉取上游模型列表
    │   ├── useTransformRules.ts    # Transform Rules 管理
    │   ├── useLogFilters.ts    # 日志筛选器
    │   ├── useLogRetention.ts  # 日志保留天数管理
    │   ├── useQuickSetup.ts    # 快速配置向导状态
    │   └── quick-setup-*.ts    # QuickSetup 子 composable
    ├── views/
    │   ├── Setup.vue           # 首次设置（/setup，无需认证）
    │   ├── Login.vue           # 登录（/login，无需认证）
    │   ├── Dashboard.vue       # 仪表盘（/）
    │   ├── Providers.vue       # Provider 管理（/providers）
    │   ├── ModelMappings.vue   # 模型映射（/mappings）
    │   ├── RetryRules.vue      # 重试规则（/retry-rules）
    │   ├── RouterKeys.vue      # 路由密钥（/router-keys）
    │   ├── ProxyEnhancement.vue # 代理增强（/proxy-enhancement）
    │   ├── Schedules.vue       # 定时调度（/schedules）
    │   ├── Logs.vue            # 请求日志（/logs）
    │   ├── Monitor.vue         # 实时监控（/monitor）
    │   ├── QuickSetup.vue      # 快速配置（/quick-setup）
    │   ├── Settings.vue        # 系统设置（/settings）
    │   └── __tests__/          # View 测试
    ├── router/
    │   └── index.ts            # 路由定义 + 认证守卫 + setup 状态检测
    ├── i18n/
    │   ├── index.ts            # vue-i18n 实例 + 动态 locale 加载
    │   ├── datetime.ts         # 日期格式化
    │   ├── number.ts           # 数字格式化
    │   └── locales/
    │       ├── zh-CN/          # 中文翻译（16 个模块 JSON 文件）
    │       └── en/             # 英文翻译
    ├── styles/
    │   ├── tokens.css          # 设计令牌（oklch 色彩变量）
    │   ├── components.css      # Tailwind @layer components（语义类名组合）
    │   └── design-tokens.ts    # TS 版设计令牌常量
    ├── types/
    │   ├── mapping.ts          # Provider / MappingGroup / TransformRule 类型
    │   ├── models.ts           # 模型相关类型
    │   ├── monitor.ts          # ActiveRequest / StatsSnapshot / RuntimeMetrics 类型
    │   ├── schedule.ts         # Schedule 类型
    │   └── concurrency.ts      # 并发控制类型
    ├── lib/
    │   └── utils.ts            # cn()（clsx + tailwind-merge），Tailwind 类名合并
    └── utils/
        ├── format.ts           # 时间/数字格式化（固定时区 Asia/Shanghai）
        ├── status.ts           # HTTP 状态码工具
        ├── token-format.ts     # Token 数量格式化
        └── model-patches.ts    # 模型补丁工具
```

### 文件归属原则

| 问题 | 决策 | 原因 |
|------|------|------|
| 新增类型放哪里？ | `types/` 放跨组件共享的类型；组件专属类型放组件同级 `types.ts` | 避免循环依赖，就近原则 |
| 工具函数放 `lib/` 还是 `utils/`？ | `lib/` 放 UI 基础设施（如 `cn()`）；`utils/` 放业务无关的纯函数 | `lib/` 是 shadcn-vue 约定位置 |
| composable 太大怎么办？ | 拆分为主 composable + 辅助 `*-helpers.ts` / `*-actions.ts` | 参考 `useQuickSetup` 模式 |
| 组件放 `shared/` 还是页面子目录？ | 被 ≥2 个页面使用 → `shared/`；仅一个页面使用 → 页面子目录 | 避免过早抽象 |

---

## 3. 设计系统

### 3.1 色彩体系

项目使用 **oklch 色彩空间** 定义所有颜色，通过 CSS 自定义属性（CSS Variables）在 `tokens.css` 中声明。

**为什么用 oklch 而非 HSL/Hex**：
- oklch 的亮度通道是感知均匀的——`oklch(0.5 0.1 250)` 和 `oklch(0.5 0.1 30)` 看起来确实一样亮。HSL 的 50% 亮度因色相不同差异很大。
- 暗色模式下只需调整 L 通道，色相和饱和度保持一致，品牌感不丢失。

**变量分层**：

```
tokens.css（原始色值：oklch(...)）
  ↓ 被引用
tailwind.config.js（语义映射：--primary → var(--primary)）
  ↓ 被使用
组件模板（Tailwind 类名：bg-primary、text-muted-foreground）
```

| 层级 | 文件 | 职责 | 可变性 |
|------|------|------|--------|
| 原始色 | `tokens.css` | oklch 色值定义 | 仅设计系统维护者修改 |
| 语义映射 | `tailwind.config.js` | `primary: 'var(--primary)'` | 跟随 shadcn-vue 主题变量 |
| 组件使用 | `*.vue` | `bg-primary`、`text-muted` | 开发者使用，不直接引用原始色 |

### 3.2 语义色名

所有 Tailwind 语义色名通过 CSS 变量间接引用，支持亮/暗模式切换：

| 色名 | 用途 | 示例 |
|------|------|------|
| `bg-background` / `text-foreground` | 页面底色 + 主文字 | 页面容器 |
| `bg-card` / `text-card-foreground` | 卡片容器 | `<Card>` |
| `bg-primary` / `text-primary-foreground` | 主操作按钮 | `<Button>` 默认 |
| `bg-secondary` / `text-secondary-foreground` | 次要操作 | `<Button variant="secondary">` |
| `bg-destructive` / `text-destructive-foreground` | 危险操作 | 删除确认 |
| `bg-muted` / `text-muted-foreground` | 次要信息、占位符 | 辅助文字 |
| `bg-accent` / `text-accent-foreground` | 强调/选中态 | Sidebar 选中项 |
| `bg-popover` / `text-popover-foreground` | 弹出层 | Dropdown、Tooltip |
| `border` | 边框色 | `border border-border` |
| `success` / `warning` / `danger` / `info` | 状态指示 | 各有 light/dark 变体 |
| `teal-50` ~ `teal-900` | 品牌色阶 | 品牌元素 |
| `role-*` / `sse-*` | 领域专用色 | 日志角色色、SSE 事件色 |

### 3.3 组件级样式组合

`components.css` 通过 `@layer components` 定义语义化 Tailwind 组合类：

```css
@layer components {
  .page { @apply p-6 max-w-[1440px] mx-auto; }
  .surface-card { @apply bg-card rounded-lg border; }
  .block-thinking { background-color: var(--color-role-thinking-bg); }
}
```

**规则**：`<style scoped>` 内只允许 `@apply`，禁止手写 CSS 选择器（`@keyframes`/`animation`/`transition` 例外）。复杂样式应提取到 `components.css` 的 `@layer components` 中。

### 3.4 间距 / 圆角 / 阴影

| 令牌类别 | Tailwind 扩展 | 使用场景 |
|---------|--------------|---------|
| 圆角 | `rounded-sm/md/lg/xl` → `var(--radius-*)` | 组件统一圆角 |
| 阴影 | `shadow-card` / `shadow-elevated` / `shadow-focus` | 卡片、弹出层、聚焦态 |
| 间距 | `dense-xs` / `dense-sm` / `dense-md` | 紧凑布局（表格行、列表项） |
| 过渡 | `duration-fast` / `duration-normal` | 微交互 |
| z-index | `z-dropdown` / `z-modal` / `z-toast` | 层叠顺序 |

**标准 Tailwind scale 间距**：`p-1`(4px)、`p-2`(8px)、`p-3`(12px)、`p-4`(16px)、`p-6`(24px)、`gap-2`、`gap-4` 等。禁止魔数间距如 `p-[17px]`。

### 3.5 暗色模式

- 策略：`darkMode: 'class'`（Tailwind 通过 `.dark` 类切换）
- 实现：`useTheme` composable 切换 `document.documentElement.classList`，存入 localStorage
- 图标适配：Provider 图标有明暗双版（`xxx.svg` + `xxx-dark.svg`），`ProviderIcon` 根据 `isDark` 自动选择
- Chart.js 适配：通过 `watchTheme()` 监听 `.dark` 类变化，触发图表重新渲染

### 3.6 字体

| 令牌 | 用途 | Tailwind 类名 |
|------|------|---------------|
| `--font-sans` | 正文 | `font-sans` |
| `--font-heading` | 标题 | `font-heading` |
| `--font-mono` | 代码、日志 | `font-mono` |

---

## 4. 硬性规范

以下规则通过 ESLint 自定义规则（`taste-lint/`）和 Git pre-commit hook（`vue_rules_checker.py`）双重强制执行。

### 4.1 禁止原生 HTML 表单/交互元素

| 禁止 | 必须 | 原因 |
|------|------|------|
| `<button>` | `<Button>` | 统一视觉风格、内置 loading/disabled 状态 |
| `<input>` | `<Input>` | shadcn-vue 组件绑定样式变量，原生元素不受 Tailwind 语义色控制 |
| `<select>` + `<option>` | `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>` | WAI-ARIA 无障碍 + 统一交互 |
| `<table>` 系列 | `<Table>` + `<TableHeader>` + ... | 样式一致性 |
| 手写模态框 | `<Dialog>` + `<DialogContent>` | 焦点管理、ESC 关闭、滚动锁定 |
| 手写确认弹窗 | `<AlertDialog>` | 统一确认交互 |
| `<span>` 状态标签 | `<Badge>` | 语义化 + 样式一致性 |
| `<div>` 卡片容器 | `<Card>` + `<CardHeader>` + `<CardContent>` | 结构语义化 |
| `<label>` | `<Label>` | 无障碍关联 |

**豁免**：`components/ui/` 目录下的 shadcn-vue 组件内部实现可以使用原生元素。

### 4.2 禁止 Emoji

所有 UI 中的图标必须使用 `lucide-vue-next` 图标库。

```vue
<!-- 禁止 -->
<span>✅ 成功</span>
<Button>⚙️ 设置</Button>

<!-- 正确 -->
<CheckCircle class="h-4 w-4 text-success" />
<span>成功</span>
<Button><Settings class="h-4 w-4 mr-2" />设置</Button>
```

### 4.3 禁止硬编码颜色值

```vue
<!-- 禁止 -->
<div class="bg-[#1a1a2e]">
<div style="color: #333">

<!-- 正确 -->
<div class="bg-card">
<div class="text-foreground">
```

**ESLint 规则**：`taste/no-hardcoded-colors`（error 级别），检测 Tailwind 类名中的硬编码色值。

### 4.4 禁止魔数间距

```vue
<!-- 禁止 -->
<div class="p-[17px] mt-[23px]">

<!-- 正确 -->
<div class="p-4 mt-6">     <!-- 16px, 24px -->
```

**ESLint 规则**：`taste/no-magic-spacing`（error 级别）。

### 4.5 禁止手写 CSS 选择器

```vue
<style scoped>
/* 禁止 */
.my-title { font-size: 14px; color: red; }
.container:hover { opacity: 0.8; }

/* 允许 */
.card { @apply bg-card rounded-lg border p-4; }

/* 例外：@keyframes / animation / transition */
@keyframes pulse {
  0% { opacity: 1; }
  100% { opacity: 0.5; }
}
</style>
```

### 4.6 行数上限

| 区块 | 上限 | 检测工具 |
|------|------|---------|
| `<template>` | 800 行 | `vue_rules_checker.py` |
| `<script setup>` | 600 行 | `vue_rules_checker.py` |
| 单个函数 | 300 行 | ESLint `max-lines-per-function` |
| 单个文件 | 1000 行 | ESLint `max-lines` |

**超过上限时的处理**：拆分子组件提取到 `components/` 对应页面目录，或提取逻辑到 composable。

### 4.7 禁止 Tab 缩进

仅允许 Space 缩进（2 空格）。ESLint `indent` 规则 + `vue_rules_checker.py` 双重检测。

### 4.8 禁止 React Radix 风格 prop 绑定

```vue
<!-- 禁止：React/Radix 风格 -->
<Switch :checked="value" @update:checked="value = $event" />
<Dialog :open="show" @update:open="show = $event" />

<!-- 正确：Vue 标准 v-model -->
<Switch v-model="value" />
<Dialog v-model:open="show" />
```

---

## 5. 组件开发规范

### 5.1 SFC 结构顺序

```vue
<template>
  <!-- 模板 -->
</template>

<script setup lang="ts">
// 1. Vue 核心 import
import { ref, computed, watch, onMounted } from 'vue'

// 2. 第三方库 import
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'

// 3. 内部模块 import（按 @/ 别名路径）
import { Button } from '@/components/ui/button'
import { api, getApiMessage } from '@/api/client'
import type { Provider } from '@/types/mapping'

// 4. Props / Emits 定义
interface Props {
  modelValue: string
  disabled?: boolean
}
const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// 5. Composable 调用
const { t } = useI18n()

// 6. 响应式状态
const loading = ref(false)
const data = ref<Provider[]>([])

// 7. 计算属性
const sorted = computed(() => data.value.sort((a, b) => a.name.localeCompare(b.name)))

// 8. 方法/生命周期
async function fetchData() { /* ... */ }
onMounted(fetchData)
</script>
```

### 5.2 组件命名

| 类型 | 规则 | 示例 |
|------|------|------|
| 页面视图 | PascalCase，与路由名对应 | `Providers.vue`、`RetryRules.vue` |
| 业务组件 | PascalCase，按功能命名 | `ConcurrencyControl.vue`、`ToggleRow.vue` |
| UI 组件 | PascalCase，跟随 shadcn-vue | `Button.vue`、`Select.vue` |
| composable | camelCase，use 前缀 | `useLogs.ts`、`useMonitorSSE.ts` |
| 工具函数 | camelCase | `format.ts`、`status.ts` |

**模板中的组件名必须 PascalCase**：ESLint `vue/component-name-in-template-casing` 强制。

### 5.3 Props 类型定义

必须使用 TypeScript interface 定义 props，禁止运行时默认值语法：

```vue
<!-- 正确 -->
<script setup lang="ts">
interface Props {
  title: string
  count?: number
  items: string[]
}
const props = withDefaults(defineProps<Props>(), {
  count: 0,
})
</script>

<!-- 禁止 -->
<script setup>
const props = defineProps({
  title: String,
  count: { type: Number, default: 0 },
})
</script>
```

### 5.4 组件拆分策略

| 触发条件 | 拆分方式 |
|---------|---------|
| `<template>` 超过 500 行 | 提取独立子组件到同页面目录 |
| 逻辑超过 400 行 | 提取 composable |
| 可复用的 UI 模式 | 提取到 `components/shared/` |
| 纯展示型重复块 | 提取到页面子目录 |

### 5.5 shadcn-vue 组件使用

**规则**：`components/ui/` 下的组件是 shadcn-vue 生成的基础组件，禁止修改其内部实现。

如需定制样式：
1. 通过 `class` prop 传入 Tailwind 类名覆盖
2. 通过 `v-model` 绑定数据
3. 如需修改组件结构，在 `components/` 业务目录中创建包装组件

安装新组件：`cd frontend && npx shadcn-vue@latest add <component>`

---

## 6. 状态管理

### 6.1 无全局 Store 架构

项目不使用 Pinia / Vuex。状态管理分为三个层级：

| 层级 | 技术 | 适用场景 | 示例 |
|------|------|---------|------|
| 全局单例 | 模块级 `ref` + composable | 跨页面共享的极少量状态 | `isDark`（useTheme）、`isAuthenticated`（router） |
| 页面级 | composable | 页面内多个组件共享的状态 | `useLogs()`、`useMonitorData()` |
| 组件级 | 组件内 `ref`/`computed` | 仅当前组件使用 | 表单输入、展开/折叠 |

### 6.2 Composable 模式

```typescript
// composables/useLogs.ts — 典型 composable 结构
export function useLogs() {
  const { t } = useI18n()

  // 状态
  const logs = ref<LogEntry[]>([])
  const loading = ref(false)
  const total = ref(0)

  // 方法
  async function loadLogs(params?: Record<string, string>) {
    loading.value = true
    try {
      const res = await api.getLogs({ page: page.value, limit: PAGE_SIZE, ...params })
      logs.value = res.data
      total.value = res.total
    } catch (e: unknown) {
      console.error('useLogs.loadLogs:', e)
      toast.error(getApiMessage(e, t('logs.messages.loadFailed')))
    } finally {
      loading.value = false
    }
  }

  // 返回：只暴露页面需要的状态和方法
  return { logs, loading, total, loadLogs, /* ... */ }
}
```

**composable 规范**：
- 函数名以 `use` 前缀
- 内部错误处理完整（console.error + toast.error）
- 返回值是响应式引用和方法，不返回整个 composable 内部状态
- 清理逻辑在 `onUnmounted` 中执行（如 SSE 连接、定时器）

### 6.3 全局状态的特殊处理

`isDark`、`isAuthenticated`、`localeLoaded` 是模块级 `ref`，跨组件共享但不走 store：

```typescript
// composables/useTheme.ts
export const isDark = ref(false)  // 模块级导出，所有导入者共享同一引用

export function useTheme() {
  initTheme()  // 幂等初始化
  return { isDark, toggleTheme }
}
```

**为什么不用 provide/inject**：这些状态在 `App.vue` 和 `router/index.ts` 中初始化，使用时跨越了组件树层级（如 `Sidebar` 需要认证状态），模块级 ref 更简单直接。

---

## 7. API 调用规范

### 7.1 API 客户端架构

```
View / Composable
  → api.xxxMethod()           # 类型安全的 API 方法
    → request<T>(method, url)  # 通用请求封装
      → axios instance         # Cookie 认证 + 401 自动跳转
        → 后端 /admin/api/*    # 响应信封 {code, message, data}
```

**响应解包**：`request<T>()` 自动解包 `{code: 0, message: "ok", data: T}` 信封，调用方直接拿到类型化的 `T`。

**认证失败处理**：axios 拦截器检测 401，区分"未初始化"（跳 `/setup`）和"未登录"（跳 `/login`）。

### 7.2 错误处理（双层）

所有 API 调用的 `catch` 块必须同时包含两层错误处理：

```typescript
async function handleSave() {
  try {
    await api.updateProvider(id, form.value)
    toast.success(t('common.saveSuccess'))
  } catch (e: unknown) {
    console.error('providers.handleSave:', e)                    // 第一层：开发调试
    toast.error(getApiMessage(e, t('providers.toast.saveFailed')))  // 第二层：用户通知
  }
}
```

| 规则 | 说明 |
|------|------|
| `console.error` 在 `toast.error` 之前 | 先记录日志，再通知用户 |
| `console.error` 格式 | `'模块名.操作名:', e` |
| 错误消息提取 | 使用 `getApiMessage(e, fallback)` 提取后端错误消息 |
| 纯 JSON.parse 验证 | 可省略 console.error（输入格式验证不是 API 错误） |
| 空 catch 块 | 必须加 `/* 原因 */` 注释说明为什么静默处理 |

### 7.3 并行请求

独立数据源的并行请求必须使用 `Promise.allSettled`，不使用 `Promise.all`：

```typescript
// 正确：一个失败不影响其他
const results = await Promise.allSettled([
  api.getProviders(),
  api.getMappingGroups(),
  api.getRetryRules(),
])

const providers = results[0].status === 'fulfilled' ? results[0].value : []
const groups = results[1].status === 'fulfilled' ? results[1].value : []
```

**为什么不用 Promise.all**：一个请求失败会导致整个 Promise 拒绝，其他成功的结果丢失。管理后台的多个面板数据相互独立，一个面板加载失败不应影响其他面板。

**ESLint 规则**：`taste/prefer-allsettled` 检测独立的 `Promise.all` 调用并发出警告。

### 7.4 Loading 状态

所有异步操作必须管理 loading 状态：

```typescript
const loading = ref(false)

async function fetchData() {
  loading.value = true
  try {
    data.value = await api.getData()
  } catch (e: unknown) {
    console.error('module.fetchData:', e)
    toast.error(getApiMessage(e, t('module.fetchFailed')))
  } finally {
    loading.value = false
  }
}
```

模板中使用 loading 状态显示骨架屏或禁用按钮：

```vue
<Button :disabled="loading" @click="handleSave">
  <Loader2 v-if="loading" class="h-4 w-4 mr-2 animate-spin" />
  {{ loading ? t('common.saving') : t('common.save') }}
</Button>
```

---

## 8. 通用 useApi<T> 模式与请求取消

### 8.1 为什么需要通用 API 封装

当前 composable 各自管理 API 调用的 loading/error 状态，模式重复且容易遗漏状态重置和请求取消。

Vue 社区（Vue Storefront、Yeasir Arafat 等企业级实践）推荐将通用 API 调用模式抽取为基础 composable。

### 8.2 useApi<T> 基础 composable

```typescript
// composables/useApi.ts
import { ref, readonly, onUnmounted } from 'vue'

export function useApi<T>(fetcher: (signal: AbortSignal) => Promise<T>) {
  const data = ref<T | null>(null)
  const error = ref<Error | null>(null)
  const isLoading = ref(false)
  let abortController: AbortController | null = null

  const execute = async () => {
    if (abortController) { abortController.abort() }
    abortController = new AbortController()

    isLoading.value = true
    error.value = null
    try {
      data.value = await fetcher(abortController.signal)
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        error.value = e
      }
    } finally {
      isLoading.value = false
      abortController = null
    }
  }

  onUnmounted(() => {
    if (abortController) { abortController.abort() }
  })

  return {
    data: readonly(data),
    error: readonly(error),
    isLoading: readonly(isLoading),
    execute,
    refresh: execute,
  }
}
```

### 8.3 Composable 组合

多个基础 composable 可组合成高级 composable：

```typescript
// composables/useLogs.ts — 组合 useApi + usePagination
const { data: raw, isLoading, execute } = useApi(
  (signal) => api.getLogs({ page: page.value, limit: PAGE_SIZE, signal })
)

watch(raw, (result) => {
  if (result) { logs.value = result.data; total.value = result.total }
})
```

### 8.4 AbortSignal 传递规范

所有 API Client 方法必须支持 `AbortSignal`：

```typescript
// api/client.ts
async getProviders(options?: { signal?: AbortSignal }): Promise<Provider[]> {
  return request('GET', '/admin/api/providers', undefined, { signal: options?.signal })
}
```

**为什么需要 AbortController**：

| 场景 | 无请求取消 | 有请求取消 |
|------|-----------|----------|
| 用户快速切换页面 | 旧页面 API 响应回来时组件已卸载，警告 | `onUnmounted` 中 `abort()` 自动取消 |
| 搜索框连续输入 | 3 个请求并发，结果可能乱序覆盖 | 新请求 abort 前一个 |
| 页面隐藏（后台标签） | 继续收发数据 | 可取消轮询减少带宽 |

### 8.5 Vue Error Boundary

在 `main.ts` 中配置全局错误处理，防止组件渲染异常导致白屏：

```typescript
// main.ts
app.config.errorHandler = (err, instance, info) => {
  console.error('Vue Error:', err)
  console.error('Component:', instance?.$?.type?.__name__ ?? 'unknown')
  console.error('Info:', info)
}
```

---

## 9. 路由与认证

### 8.1 路由定义

| 路径 | 视图 | 认证 | 说明 |
|------|------|------|------|
| `/setup` | Setup.vue | 否 | 首次启动设置密码 |
| `/login` | Login.vue | 否 | 登录页 |
| `/` | Dashboard.vue | 是 | 仪表盘 |
| `/providers` | Providers.vue | 是 | Provider 管理 |
| `/mappings` | ModelMappings.vue | 是 | 模型映射 |
| `/retry-rules` | RetryRules.vue | 是 | 重试规则 |
| `/router-keys` | RouterKeys.vue | 是 | 路由密钥 |
| `/proxy-enhancement` | ProxyEnhancement.vue | 是 | 代理增强 |
| `/schedules` | Schedules.vue | 是 | 定时调度 |
| `/logs` | Logs.vue | 是 | 请求日志 |
| `/monitor` | Monitor.vue | 是 | 实时监控 |
| `/quick-setup` | QuickSetup.vue | 是 | 快速配置 |
| `/settings` | Settings.vue | 是 | 系统设置 |
| `/:pathMatch(.*)*` | — | — | 404 重定向到 `/` |

**Base path**：`/admin/`，通过 `createWebHistory('/admin/')` 和 `vite.config.ts` 中 `base: '/admin/'` 统一。

### 8.2 认证守卫流程

```
beforeEach
  → 首次访问？ → api.getSetupStatus()
    → 未初始化 → 重定向 /setup
    → 已初始化 + 访问 /setup → 重定向 /login
  → 需要认证？
    → api.getStats() 探测认证状态（轻量请求）
      → 成功 → 放行（标记 isAuthenticated）
      → 401 → 重定向 /login
```

**为什么用 `api.getStats()` 探测而非专门的 auth API**：后端是 Cookie + JWT 认证，没有独立的 token 验证端点。`getStats()` 是最轻的已认证 API，用于探测当前 Cookie 是否有效。

### 8.3 布局切换

```vue
<!-- App.vue -->
<div v-if="isAuthenticated" class="h-screen flex overflow-hidden">
  <Sidebar />
  <main class="flex-1 overflow-auto bg-muted">
    <router-view />
  </main>
</div>
<router-view v-else />  <!-- 登录/Setup 页面独立布局 -->
```

---

## 9. 控件交互模式

不同页面有不同的交互模式，新增控件时必须遵循页面的既有人机交互模式。

### 9.1 编辑→保存模式

**适用页面**：ProxyEnhancement.vue、Settings.vue

用户修改表单后必须点击"保存"按钮才会提交到后端，控件自身不直调 API：

```vue
<template>
  <!-- 正确：数据变化只更新本地状态 -->
  <Switch v-model="featureEnabled" />

  <!-- 变更提示 + 保存按钮 -->
  <div v-if="isDirty" class="...">
    <span>{{ t('proxyEnhancement.unsavedChanges') }}</span>
    <Button :disabled="saving || !isDirty" @click="handleSave">
      {{ saving ? t('common.saving') : t('common.save') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
const originalConfig = ref<Config | null>(null)
const featureEnabled = ref(false)

// 脏检测
const isDirty = computed(() => {
  return featureEnabled.value !== originalConfig.value?.featureEnabled
})

// 保存时才调 API
async function handleSave() {
  saving.value = true
  try {
    await api.updateProxyEnhancement(buildPayload())
    toast.success(t('common.saveSuccess'))
  } catch (e: unknown) {
    console.error('proxyEnhancement.handleSave:', e)
    toast.error(getApiMessage(e, t('proxyEnhancement.saveFailed')))
  } finally {
    saving.value = false
  }
}
</script>
```

**禁止行为**：`<Switch @update:checked="api.updateConfig(...)"` — 控件变化直调 API，用户无法预览和撤销。

### 9.2 实时刷新模式

**适用页面**：Dashboard.vue、Monitor.vue

数据自动定期刷新，用户不需要手动触发：

```typescript
// Dashboard — 轮询刷新
const INTERVAL_MS = 5000
let timer: ReturnType<typeof setInterval>

onMounted(() => {
  loadDashboard()
  timer = setInterval(loadDashboard, INTERVAL_MS)
})
onUnmounted(() => clearInterval(timer))
```

```typescript
// Monitor — SSE 实时推送
const { connect, disconnect } = useMonitorSSE('/admin/api/monitor/stream', {
  'request-start': handleRequestStart,
  'request-complete': handleRequestComplete,
  'metrics': handleMetrics,
  // ...
}, {
  onOpen: () => { connected.value = true },
  onClose: () => { connected.value = false },
})

onMounted(() => connect())
```

### 9.3 CRUD 模式

**适用页面**：Providers.vue、RetryRules.vue、RouterKeys.vue、Schedules.vue

标准 CRUD 操作通过 Dialog/AlertDialog 交互：

```
列表展示 → 点击"新增" → Dialog 表单 → 提交 → 刷新列表
列表展示 → 点击行项"编辑" → Dialog 表单（预填数据） → 提交 → 刷新列表
列表展示 → 点击行项"删除" → AlertDialog 确认 → 删除 → 刷新列表
```

---

## 10. SSE 实时通信

### 10.1 useMonitorSSE composable

```typescript
const { connect, disconnect } = useMonitorSSE(
  '/admin/api/monitor/stream',
  {
    'request-start': (event) => { /* 处理请求开始 */ },
    'request-complete': (event) => { /* 处理请求完成 */ },
    'metrics': (event) => { /* 处理指标更新 */ },
    'stats': (event) => { /* 处理统计快照 */ },
    'concurrency': (event) => { /* 处理并发状态 */ },
    'runtime': (event) => { /* 处理运行时指标 */ },
  },
  {
    onOpen: () => { connected.value = true },
    onClose: () => { connected.value = false },
  },
)
```

### 10.2 连接管理

| 特性 | 实现 |
|------|------|
| 自动重连 | 指数退避（3s → 6s → 12s → ... → 30s 上限） |
| 页面隐藏断开 | `visibilitychange` 事件，隐藏超过 30s 自动断开 |
| 页面恢复重连 | 从 hidden 恢复 visible 时，如果 SSE 已断开则自动重连 |
| 组件卸载清理 | `onUnmounted` 中关闭连接 + 移除 visibilitychange 监听 |

### 10.3 为什么用原生 EventSource

- 项目只需要标准的 SSE（单向服务端推送），不需要 WebSocket 的双向通信
- `useMonitorSSE` 只有 100 行左右的连接管理逻辑，不值得引入第三方库
- 自动重连和页面生命周期管理用原生 API 就能实现

---

## 11. 国际化（i18n）

### 11.1 架构

- 支持 `zh-CN`（默认）和 `en` 两种语言
- 使用 `vue-i18n` Composition API 模式（`legacy: false`）
- 翻译文件按模块拆分，每个模块一个 JSON 文件

```
locales/
├── zh-CN/
│   ├── common.json          # 通用（按钮、操作、状态）
│   ├── sidebar.json         # 侧边栏
│   ├── dashboard.json       # 仪表盘
│   ├── providers.json       # Provider 管理
│   ├── mappings.json        # 模型映射
│   ├── logs.json            # 日志
│   ├── monitor.json         # 监控
│   ├── retryRules.json      # 重试规则
│   ├── routerKeys.json      # 路由密钥
│   ├── proxyEnhancement.json # 代理增强
│   ├── schedules.json       # 调度
│   ├── settings.json        # 设置
│   ├── quickSetup.json      # 快速配置
│   ├── setup.json           # 首次设置
│   ├── login.json           # 登录
│   └── requestDetail.json   # 请求详情
└── en/
    └── （同结构）
```

### 11.2 使用方式

```vue
<template>
  <h1>{{ t('providers.title') }}</h1>
  <p>{{ t('providers.description', { count: providers.length }) }}</p>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>
```

### 11.3 懒加载机制

翻译文件通过 `import.meta.glob` 动态加载，不打包到主 chunk：

```typescript
// i18n/index.ts
const modules = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.json')
```

- 应用先挂载（避免白屏），再异步加载翻译
- `localeLoaded` ref 控制渲染时机：`App.vue` 中 `v-if="localeLoaded"`
- 语言切换时重新加载目标语言的翻译文件

### 11.4 翻译 key 命名

| 层级 | 格式 | 示例 |
|------|------|------|
| 模块名 | camelCase | `providers`、`retryRules`、`proxyEnhancement` |
| key | camelCase | `providers.toast.saveFailed`、`common.saveSuccess` |

### 11.5 新增翻译文件

1. 在 `locales/zh-CN/` 和 `locales/en/` 下创建同名 JSON 文件
2. 按模块顶级 key 组织，自动通过 `import.meta.glob` 加载
3. 不需要修改 `i18n/index.ts`——glob 会自动发现新文件

---

## 12. Vite 开发与构建

### 12.1 开发配置

```typescript
// vite.config.ts 关键配置
{
  base: '/admin/',                    // 部署 base path
  server: {
    port: 5173,
    proxy: {
      '/admin/api': {
        target: 'http://localhost:9980',  // 代理到后端
        changeOrigin: true,
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(rootVersion),  // 版本号注入
  },
}
```

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 开发端口 | 5173 | Vite 默认 |
| API 代理 | `/admin/api` → `:9980` | 开发时前后端分离 |
| SVG 加载 | `vite-svg-loader` | SVG 文件作为 Vue 组件导入：`import Icon from './icon.svg?component'` |
| 版本号 | 从 `router/package.json` 读取 | 通过 `__APP_VERSION__` 全局常量注入 |
| 路径别名 | `@` → `src/` | 避免相对路径地狱 |

### 12.2 构建产物

```bash
# 前端构建
cd frontend && npm run build

# 实际执行：vue-tsc -b && vite build
# 产出 → frontend/dist/
# 生产时由后端 @fastify/static 托管
```

构建顺序：先 `vue-tsc` 类型检查，再 `vite build` 打包。类型检查失败不会产出构建文件。

### 12.3 生产部署

生产环境不需要独立的前端服务器：

```
客户端 → :9980/admin/
              ├── /admin/api/*  → 后端路由
              └── /admin/*      → @fastify/static → frontend/dist/
```

---

## 13. 测试

### 13.1 测试配置

```typescript
// vitest.config.ts
{
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
}
```

### 13.2 测试文件位置

测试文件与被测文件同目录：

```
views/
├── Dashboard.vue
├── __tests__/
│   └── Dashboard.test.ts
├── metrics-helpers.ts
```

### 13.3 运行命令

```bash
cd frontend
npm run typecheck    # vue-tsc 类型检查
npm run build        # vue-tsc + vite build（包含类型检查）
npx vitest run       # 运行组件测试
npx vitest --ui      # 交互式测试 UI（开发时）
```

### 13.4 组件测试要求

虽然当前前端测试覆盖不多（仅 1 个测试文件），新增代码应逐步补充测试：

**测试目标**：

| 组件类型 | 测试重点 | 工具 |
|---------|---------|------|
| 页面视图（views/） | 页面级渲染、路由切换 | Vue Test Utils + vitest |
| 表单组件（如 ProviderForm） | 表单校验、提交/取消逻辑 | Vue Test Utils + vee-validate mock |
| 列表组件（如 LogTable） | 分页、排序、筛选交互 | @tanstack/vue-table mock |
| Composable | 纯函数式输入输出 | vitest 直接调用 |

**测试文件位置**：
- 组件测试：与组件同级，`ComponentName.test.ts`
- Composable 测试：与 composable 同级，`useComposable.test.ts`

**最低要求**：
- 核心 composable（`useLogs`、`useMonitorData`、`useClipboard`）必须有单元测试
- 新增复杂表单组件必须有渲染 + 提交测试

---

## 14. 代码质量工具链

### 14.1 自动化检查层次

| 检查层 | 工具 | 触发时机 | 说明 |
|--------|------|---------|------|
| ESLint | `taste-lint/` 自定义规则 | 编辑时 + pre-commit | 类型安全、Promise 规范、色值/间距 |
| Prettier | 格式化 | pre-commit | 统一代码风格 |
| vue-tsc | TypeScript 编译 | pre-commit + build | 类型检查 |
| vue_rules_checker.py | Python 脚本 | pre-commit | 原生元素、Emoji、CSS、行数、缩进 |
| eslint-disable 检测 | git hook grep | pre-commit | 禁止跳过 lint 规则 |

### 14.2 taste-lint 自定义 ESLint 规则

前端相关的自定义规则：

| 规则 | 级别 | 适用文件 | 说明 |
|------|------|---------|------|
| `taste/no-hardcoded-colors` | error | `*.vue` | 检测 Tailwind 类名中的硬编码色值 |
| `taste/no-magic-spacing` | error | `*.vue` | 检测任意值间距如 `p-[17px]` |
| `taste/no-silent-catch` | warn | `*.ts` + `*.vue` | catch 块不能为空或仅 console |
| `taste/prefer-allsettled` | warn | `*.ts` + `*.vue` | 独立数据源用 Promise.allSettled |
| `taste/no-unsafe-string-conversion` | warn | `*.ts` + `*.vue` | 禁止对非原始类型用 String() |
| `taste/no-inline-import-type` | warn | `*.ts` + `*.vue` | 禁止行内 `as import(...).Type` |

### 14.3 基础 ESLint 规则

| 规则 | 级别 | 说明 |
|------|------|------|
| `@typescript-eslint/no-explicit-any` | error | 禁止 `any`，用 `unknown` 或具体类型 |
| `@typescript-eslint/no-unused-vars` | error | 允许 `_` 前缀忽略 |
| `vue/no-v-html` | error | XSS 防护 |
| `vue/component-name-in-template-casing` | error | 模板中组件名 PascalCase |
| `vue/require-prop-types` | warn | Props 必须有类型定义 |
| `no-magic-numbers` | warn | 忽略 0、1、-1 |
| `no-eval` | error | 禁止 eval |
| `indent` | warn | 2 空格缩进 |

### 14.4 Pre-commit Hook 完整检查

`.githooks/pre-commit` 四阶段检查（前端相关部分）：

| 阶段 | 检查内容 | 跳过方式 |
|------|---------|---------|
| Prettier + ESLint | `frontend/src/` 变更文件 | `SKIP_FRONTEND_LINT=1` |
| vue-tsc | 前端 TypeScript 类型检查（全量） | `SKIP_TYPE_CHECK=1` |
| vue_rules_checker.py | 原生元素 + Emoji + CSS + 行数 + 缩进 + v-model | `SKIP_CODE_RULES_CHECK=1` |
| eslint-disable grep | 检测 `// eslint-disable` 注释 | `SKIP_ALL_CHECKS=1` |

---

## 15. 常用模式速查

### 15.1 cn() 类名合并

```vue
<script setup lang="ts">
import { cn } from '@/lib/utils'
</script>

<template>
  <div :class="cn('p-4 rounded-lg', isActive && 'bg-primary text-primary-foreground')">
</template>
```

### 15.2 类型安全 API 调用

```typescript
import { api, getApiMessage } from '@/api/client'

// 自动类型推导：返回 Promise<Provider[]>
const providers = await api.getProviders()

// 错误处理
try {
  await api.createProvider(payload)
  toast.success(t('common.createSuccess'))
} catch (e: unknown) {
  console.error('providers.create:', e)
  toast.error(getApiMessage(e, t('providers.toast.createFailed')))
}
```

### 15.3 时间格式化

```typescript
import { formatTime, formatTimeShort, formatRelativeTime } from '@/utils/format'

// 所有时间显示固定使用 Asia/Shanghai 时区
formatTime('2026-05-24T12:00:00Z')          // → '2026/05/24 20:00:00'
formatTimeShort('2026-05-24T12:00:00Z')     // → '05/24 20:00'
formatRelativeTime('2026-05-24T12:00:00Z')  // → '3 分钟前'
```

### 15.4 图标使用

```vue
<script setup lang="ts">
import { Plus, Trash2, Loader2, CheckCircle } from 'lucide-vue-next'
</script>

<template>
  <Button @click="handleAdd">
    <Plus class="h-4 w-4 mr-2" />
    {{ t('common.add') }}
  </Button>

  <Button variant="destructive" @click="handleDelete">
    <Trash2 class="h-4 w-4 mr-2" />
    {{ t('common.delete') }}
  </Button>

  <!-- 加载中图标 -->
  <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
  <CheckCircle v-else class="h-4 w-4 text-success" />
</template>
```

### 15.5 Dialog 确认模式

```vue
<script setup lang="ts">
import { ref } from 'vue'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const open = ref(false)

function handleConfirm() {
  open.value = false
  // 执行操作
}
</script>

<template>
  <Button variant="destructive" @click="open = true">{{ t('common.delete') }}</Button>

  <Dialog v-model:open="open">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('providers.confirmDelete.title') }}</DialogTitle>
        <DialogDescription>{{ t('providers.confirmDelete.description') }}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="open = false">{{ t('common.cancel') }}</Button>
        <Button variant="destructive" @click="handleConfirm">{{ t('common.confirm') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

### 15.6 空状态

```vue
<template>
  <div v-if="!loading && items.length === 0" class="flex flex-col items-center py-12 text-muted-foreground">
    <Inbox class="h-12 w-12 mb-4" />
    <p>{{ t('common.noData') }}</p>
  </div>
</template>
```

### 15.7 Badge 状态标签

```vue
<template>
  <Badge :variant="isActive ? 'default' : 'secondary'">
    {{ isActive ? t('common.active') : t('common.inactive') }}
  </Badge>
</template>
```

---

## 16. 已知陷阱

| 陷阱 | 说明 | 检测工具 |
|------|------|---------|
| 原生 HTML 元素 | `<button>` / `<input>` / `<select>` 等 | `vue_rules_checker.py` |
| Emoji | UI 中出现 Emoji 字符 | `vue_rules_checker.py` |
| 硬编码颜色 | `bg-[#333]` / `text-[#fff]` | `taste/no-hardcoded-colors` |
| 魔数间距 | `p-[17px]` / `mt-[23px]` | `taste/no-magic-spacing` |
| 手写 CSS 选择器 | `<style scoped>` 内 `.xxx { ... }` | `vue_rules_checker.py` |
| React 风格 prop | `:checked` + `@update:checked` | `vue_rules_checker.py` |
| Tab 缩进 | 混合 Tab / Space | `vue_rules_checker.py` + ESLint `indent` |
| eslint-disable | `// eslint-disable-next-line` | git hook grep 检测 |
| Promise.all | 独立请求用 Promise.all | `taste/prefer-allsettled` |
| 静默 catch | `catch {}` 无处理 | `taste/no-silent-catch` |
| any 类型 | `as any` / `: any` | `@typescript-eslint/no-explicit-any` |
| v-html | `<div v-html="xxx">` | `vue/no-v-html` |
| 页面切换未取消请求 | 切换页面时进行中的 API 请求继续触发状态更新 | 引入 `useApi<T>` + AbortController |
| 组件渲染异常白屏 | 无 `config.errorHandler` 全局捕获 | 手动测试 |
| Design Token 漂移 | `tokens.css` 与 demo `tokens.css` 不同步 | 脚本检测 |

---

## 附录 A：新增页面 Checklist

创建新的管理页面时，按以下清单逐项确认：

- [ ] `views/NewPage.vue`：页面视图，遵循行数上限
- [ ] `router/index.ts`：添加路由（`meta: { requiresAuth: true }`）
- [ ] `components/layout/Sidebar.vue`：添加侧边栏导航项
- [ ] `composables/useNewPage.ts`：提取页面逻辑（如需要）
- [ ] `components/newpage/`：页面专用子组件（如需要）
- [ ] `api/client.ts`：添加新 API 方法（如需要）
- [ ] `types/`：添加类型定义（如需要）
- [ ] `i18n/locales/zh-CN/newpage.json` + `en/newpage.json`：翻译文件
- [ ] 所有控件使用 shadcn-vue 组件，无原生 HTML 元素
- [ ] 所有图标使用 lucide-vue-next，无 Emoji
- [ ] 所有颜色使用 Tailwind 语义类名，无硬编码色值
- [ ] 所有间距使用标准 Tailwind scale，无魔数
- [ ] 错误处理包含 console.error + toast.error 双层
- [ ] 并行请求使用 Promise.allSettled
- [ ] 确定交互模式（编辑→保存 / 实时刷新 / CRUD）

## 附录 B：shadcn-vue 组件清单

项目已安装的 shadcn-vue 组件（`components/ui/`）：

| 组件 | 用途 |
|------|------|
| AlertDialog | 确认弹窗（删除、重置等危险操作） |
| Avatar | 头像 |
| Badge | 状态标签 |
| Button | 按钮（default / secondary / destructive / outline / ghost） |
| Card | 卡片容器（CardHeader / CardContent / CardTitle / CardDescription） |
| CascadingSelect | 级联选择器（自定义组件） |
| Checkbox | 复选框 |
| Collapsible | 折叠面板 |
| Dialog | 模态框（DialogContent / DialogHeader / DialogTitle / DialogDescription / DialogFooter） |
| Form | 表单（FormField / FormLabel / FormMessage / FormControl，基于 vee-validate） |
| Input | 输入框 |
| Label | 标签 |
| Popover | 弹出层 |
| Progress | 进度条 |
| ScrollArea | 滚动区域 |
| Select | 下拉选择（SelectTrigger / SelectContent / SelectItem） |
| Separator | 分隔线 |
| Skeleton | 骨架屏 |
| Sonner | Toast 通知（Toaster + toast() 函数） |
| Switch | 开关 |
| Table | 表格（TableHeader / TableBody / TableRow / TableHead / TableCell） |
| Tabs | 选项卡（TabsList / TabsTrigger / TabsContent） |
| Textarea | 多行文本输入 |
| Tooltip | 工具提示 |

## 附录 C：设计系统质量保障

### C.1 Design Token 单一来源

当前 `frontend/src/styles/tokens.css` 和 `docs/designs/components/tokens.css` 分别维护，存在漂移风险。

**规范**：设计令牌应从单一来源生成。推荐结构：

```
frontend/src/styles/
├── tokens.ts            # TS 常量（type-safe，单一来源）
├── tokens.css           # 编译产物（由 tokens.ts 生成，禁止手动编辑）
└── design-tokens.ts     # 运行时常量
```

**同步机制**：新增 token 时：1) 更新 `tokens.ts`，2) 运行生成脚本产生 `tokens.css`，3) `docs/designs/components/tokens.css` 通过脚本自动同步。

### C.2 无障碍（A11y）基线

shadcn-vue 组件自带 WAI-ARIA，但自定义组件需人工检查。新增页面应自检：

| 检查项 | 标准 | 验证方式 |
|--------|------|---------|
| 色相对比度 | 正文 ≥ 4.5:1，大文字 ≥ 3:1（WCAG AA） | Chrome DevTools 对比度检查器 |
| 键盘导航 | Tab/Shift+Tab 可达所有交互元素，Enter/Space 可激活 | 手动测试 |
| 焦点指示器 | 可聚焦元素可见的 focus ring | `focus:ring-*` Tailwind 类 |
| 屏幕阅读器 | 图片有 `alt`，表单有 `label`，语义化 HTML | axe DevTools 浏览器扩展 |

**暗色模式关注**：oklch 感知均匀，但高饱和度颜色在暗色背景下可能偏低对比度。`tokens.css` 中危险色应同时校验亮暗两版。
