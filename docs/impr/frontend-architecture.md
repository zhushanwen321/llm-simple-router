# 前端架构质量分析报告

**项目**: llm-simple-router (feat-performance-impr)
**分析日期**: 2026-05-12
**分析范围**: `frontend/src/` 全部文件（~100+ 个文件，~6700 行 TS/Vue）

---

## 1. 总览评分

| 维度 | 分数 | 权重 |
|------|------|------|
| 组件架构 | 7.5 / 10 | 20% |
| 状态管理 | 7.0 / 10 | 15% |
| 路由设计 | 8.0 / 10 | 10% |
| API 层设计 | 8.5 / 10 | 15% |
| UI 组件库使用 | 8.5 / 10 | 10% |
| 设计系统 | 8.0 / 10 | 10% |
| i18n 架构 | 8.0 / 10 | 5% |
| 目录结构 | 7.5 / 10 | 5% |
| 类型系统 | 7.5 / 10 | 5% |
| 错误边界 | 6.5 / 10 | 5% |

**加权总分: 7.7 / 10**

总体评价：这是一个中等偏上的前端架构。无 Pinia/Vuex 的 composable 方案在中小规模下运行良好，但存在跨组件状态共享问题和局部耦合。API 层设计成熟，错误处理和类型安全是亮点。主要短板在错误边界缺失和若干可测试性问题。

---

## 2. 逐项分析

### 2.1 组件架构（7.5 / 10）

#### 正面

- **职责划分总体清晰**。Views 层（`views/*.vue`）专注于页面布局和数据获取，可复用 UI 逻辑下沉到 composables，可复用 UI 块下沉到 `components/`。
- **按领域拆分子组件**做得不错：`monitor/`、`logs/`、`mappings/`、`request-detail/`、`shared/` 等子目录各司其职。
- **组合式 API（Composition API）使用一致**，所有组件的 `<script setup lang="ts">` 写法统一。

#### 问题

**P1 — 部分 View 组件行数偏高**

| 文件 | 行数 | 说明 |
|------|------|------|
| `Schedules.vue` | 544 | 含大量重复模板，可拆分 |
| `Providers.vue` | 335 | 模板层含较多逻辑（maskKey 等） |
| `Logs.vue` | 414 | 含内置 filter 逻辑 |
| `Settings.vue` | 324 | 多个独立配置区域的聚合页面 |

虽然没有超过 `max-lines: 500` 的硬性限制（Schedules.vue 544 行略超），但部分文件可进一步拆分为子组件。`Providers.vue` 的 335 行中模板部分约 200 行，create/edit dialog 内联在同一个组件中导致上下文过长。

**P2 — `App.vue` 认证逻辑与路由守卫重复**

`App.vue` 的 `checkAuth()` 函数和 `router/index.ts` 的 `beforeEach` 守卫做了 **两次认证检查**：
- `router.beforeEach` 先检查 setup 状态，再检查认证
- `App.vue` 的 `watch` + `checkAuth` 又做了一次认证检查

这导致 `/login` 和 `/setup` 两个公开页被重复判定，且如果路由守卫已做了 401 跳转，`App.vue` 的二次检查是冗余的。

**P3 — Sidebar.vue（275 行）的升级逻辑内嵌在布局组件中**

`Sidebar.vue` 不仅承担导航渲染，还内嵌了完整的升级检查、执行、重启轮询逻辑。这些功能与"侧边栏导航"的职责不匹配。`UpgradePanel` 应抽成独立组件。

**改进建议**:
1. `Schedules.vue` 拆分为 `SchedulesList.vue` + `ScheduleDialog.vue`
2. `Providers.vue` 的 dialog 抽为 `ProviderDialog.vue`
3. `App.vue` 移除 `checkAuth`，统一在路由守卫中处理
4. `Sidebar.vue` 的升级逻辑抽为 `SidebarUpgradePopover.vue`

---

### 2.2 状态管理（7.0 / 10）

#### 正面

- **Composable 模式组织良好**，14 个 composable 文件各司其职，名称语义清晰（`useDashboard`、`useLogs`、`useMonitorData` 等）。
- **SSE 实时数据管理（`useMonitorSSE` + `useMonitorData`）设计优雅**，SSE 生命周期与组件 <-> 数据层分离。
- **`useDashboard` 的 debounce + 去重缓存**是好的实践，避免了短时间内重复请求。

#### 问题

**P0 — 模块级单例状态的隐式共享**

多个 composable 使用**模块级（module-level）`ref`**，导致所有调用方共享同一份状态：

```typescript
// useTheme.ts — 模块级 ref，全局共享
export const isDark = ref(false)

// useProviderForm.ts — 但 compose 通过函数返回
```

`useTheme` 是**有意的全局单例**，这很合理。但其他 composable（如 `useProviderForm`）如果被多个组件同时挂载（比如在测试中），不同的调用实例之间不会有问题，因为 `useProviderForm` 是每次调用返回新 ref。

**P1 — `useDashboard` 内部状态未通过 `provide/inject` 范围限定**

`useDashboard()` 每次调用返回新的实例，状态是隔离的。但如果同一页面有两个 Dashboard 组件，它们会各自加载一份数据。当前只有 `Dashboard.vue` 使用，所以问题不显现。但架构上应该文档化：此 composable 非单例，每个组件实例独立。

**P1 — composable 之间缺乏明确的依赖声明**

`useProviderForm` 依赖 `useProviderPresets` 和 `useTransformRules`，但这两个依赖是**在函数内部直接调用**的，无法在测试中注入 mock：

```typescript
export function useProviderForm() {
  const { transformForm, loadTransformRules, saveTransformRules } = useTransformRules()
  const presetHook = useProviderPresets(form)  // 直接依赖，无法替换
}
```

这降低了可测试性。如果使用依赖注入（传入或 provide/inject），单元测试可以 mock 这些子 composable。

**P2 — `useMonitorData` 内部使用 `shallowRef` + `triggerRef` 手动触发更新**

```typescript
const activeRequests = shallowRef<ActiveRequest[]>([])
// ...
case 'stream_content_update': {
  // 直接修改 shallowRef 内部对象属性，然后手动 triggerRef
  req.streamContent = update.streamContent
  triggerRef(activeRequests)
}
```

这种模式依赖于开发者记住调用 `triggerRef()`，容易遗漏。建议改为 `ref` 配合 `value = [...activeRequests.value]` 的不可变更新，或使用 `reactive`。

**改进建议**:
1. composable 间依赖通过函数参数注入，或至少文档化依赖关系
2. `useMonitorData` 中的 `shallowRef` + `triggerRef` 改为 `ref` + spread 更新，或封装 `updateRequest(id, patch)` 方法
3. 为所有返回复杂状态的 composable 添加 `reset()` 方法，便于测试隔离

---

### 2.3 路由设计（8.0 / 10）

#### 正面

- **全量懒加载**：所有路由组件使用 `() => import(...)` 动态导入，构建产物代码分割良好。
- **路由守卫逻辑清晰**：`beforeEach` 在一个地方统一处理 setup 状态检查和认证检查。
- **setup 状态缓存**：`setupChecked` + `isSetupInitialized` 避免每次导航都调用 API。
- **base path 配置**：`createWebHistory('/admin/')` 与后端 `/admin/` 部署路径一致。

#### 问题

**P2 — 缺少 404 路由**

当前路由表中没有 `path: '/:pathMatch(.*)*'` 的 catch-all 路由。访问任意不存在的路径会进入空白页面。

**P2 — 路由守卫的 catch 块过于宽容**

```typescript
} catch {
  next()
  return
}
```

setup 状态检查失败时静默放行，未做任何日志记录。应至少 `console.error` 异常信息。

**改进建议**:
1. 添加 `{ path: '/:pathMatch(.*)*', redirect: '/' }` 的兜底路由
2. 路由守卫 catch 块添加 `console.error`

---

### 2.4 API 层设计（8.5 / 10）

#### 正面

这是整个前端架构中**最成熟的部分**：

- **类型安全**：`request<T>()` 泛型包装 Axios，返回 `Promise<T>`，调用方获得完整类型推断。
- **统一错误处理**：Axios 拦截器统一处理 401/40103 跳转，附加 `apiMessage`/`apiCode` 到 error 对象。
- **`getApiMessage()` 工具函数**：所有 catch 块统一使用，错误消息提取逻辑内聚。
- **`Promise.allSettled` 模式**：Dashboard 和 Monitor 都使用 `allSettled` 并发请求，避免单点失败影响整体。
- **取消机制**：`loadLogDetail` 使用 `loadVersion` 计数器防止竞态条件。
- **API 拆分**：`settings-api.ts` 从 `client.ts` 拆出，控制单文件行数。
- **payload 类型**：所有请求体在 `client.ts` 中有明确的 interface 定义。

#### 问题

**P2 — AxiosError 的 apiMessage 扩展依赖 module augmentation**

```typescript
declare module "axios" {
  interface AxiosError {
    apiMessage?: string
    apiCode?: number
  }
}
```

这本质上是用全局类型声明绕过了 TypeScript 的类型检查。`AxiosError` 对象上没有 `apiMessage`，是拦截器运行时注入的。更健壮的做法是创建一个包装类型：

```typescript
type EnhancedError = Error & { apiMessage?: string; apiCode?: number }
```

**P3 — 非流式请求无 AbortController 支持**

Dashboard 页面在不同 filter 间切换时，前一个请求如果迟迟不返回，会覆盖后一个请求的结果（无请求取消机制）。虽然 `watchKey` 的 debounce 缓解了问题，但没有真正的请求取消。

**改进建议**:
1. 考虑将 `apiMessage`/`apiCode` 的附加逻辑改为包装类型而非 module augmentation
2. 为频繁切换场景（Dashboard filter 切换、Monitor 详情加载）添加 AbortController 支持

---

### 2.5 UI 组件库使用（8.5 / 10）

#### 正面

- **shadcn-vue 组件全覆盖**：`components/ui/` 下包含 19 个子目录，覆盖了 button、card、dialog、table、select、tabs、form、tooltip、popover、alert-dialog、badge、switch、checkbox、textarea、skeleton、separator、progress、collapsible、scroll-area、avatar 等组件。
- **无原生 HTML 表单元素混用**：经检查，所有输入控件、按钮、表格、对话框均使用 shadcn-vue 组件。项目有严格的 ESLint 规则（`vue_rules_checker.py`）强制此约束。
- **UI 图标来源统一**：全部使用 `lucide-vue-next`图标库，无内联 SVG 字面量。
- **自定义组件复用率良好**：`shared/` 目录下有 `ConcurrencyControl`、`TransformRulesForm`、`ProxyConfigForm`、`QuickSetupMappingList` 等跨页面复用组件。

#### 问题

**P2 — 少数场景自定义 switch 实现在模板中**

`Providers.vue` 的 toggle 按钮使用手写的 div + span + Tailwind class 实现 switch：

```html
<span class="relative inline-flex h-4 w-7...">
  <span class="inline-block h-3 w-3..."
    :class="p.is_active ? 'translate-x-3.5' : 'translate-x-0.5'" />
</span>
```

应该使用 `<Switch>` 组件，但 project context 中说明 `ProxyEnhancement.vue` 需要保存按钮模式。这里的场景是 toggle 后需要二次确认（AlertDialog），所以不用 `<Switch>` 是合理的设计选择，但应添加注释说明原因。

**P3 — `CascadingSelect` 是一个自定义 UI 组件，放在 `components/ui/` 下但非 shadcn-native**

它是项目中唯一的非标准 shadcn 组件，但在 `ui/` 目录下。建议移到 `components/shared/` 或添加 README 说明。

**改进建议**:
1. `Providers.vue` 的手写 switch 添加注释说明不用 `<Switch>` 的原因
2. 考虑将 `CascadingSelect` 移出 `ui/` 目录（它是业务组件而非基础 UI 组件）

---

### 2.6 设计系统（8.0 / 10）

#### 正面

- **oklch 色彩空间**：全部颜色使用 `oklch()` 格式，色彩一致性好，P3 广色域原生支持。
- **CSS 变量体系完善**：`tokens.css` 定义了品牌色、语义色、角色色、SSE 事件色、间距、圆角、阴影、动画、z-index 等令牌。
- **明暗主题切换**：通过 `<html class="dark">` 触发，`.dark` 选择器覆盖 CSS 变量值，与 shadcn-vue 的 dark mode 机制一致。
- **`design-tokens.ts`** 为 Chart.js 等不支持 CSS 变量的场景提供 JS 侧颜色常量。
- **`@layer components`** 使用 CSS cascade layers 管理组件样式优先级。

#### 问题

**P1 — Chart.js 主题切换需要手动触发重渲染**

`useDashboard` 中使用 `MutationObserver` 监听 `<html>` 的 class 变化，在主题切换时调用 `refresh()` 重新渲染图表。这是一种 hack 式方案，每次主题切换会触发不必要的 API 请求。理想方案是让 Chart.js 使用 CSS 变量（如果有适配层的插件）或在 chartOptions 中动态使用变量。

**P1 — 间距令牌使用不一致**

`tokens.css` 定义了 `--spacing-page`、`--spacing-section` 等变量，但检查 View 组件发现：
- `Dashboard.vue`: `class="p-6"` (Tailwind utility)
- `Monitor.vue`: `class="p-6"`
- `Providers.vue`: `class="p-6"`

所有页面都使用 Tailwind 的 `p-6`，而不是 `var(--spacing-page)`。CSS 变量沦为死代码。要么删除无用变量，要么通过 Tailwind config 的 `extend.spacing` 映射这些变量。

**P2 — `components.css` 中的全局类名与 Tailwind utility 存在功能重叠**

```css
.dot-success { background-color: var(--color-success); }
.progress-active { background-color: var(--color-success); }
```

这些类名既没有被广泛使用（仅少数组件引用），又可以完全用 Tailwind utility 替代（`bg-[var(--color-success)]` 或配置化后 `bg-success`）。维护两套样式系统增加了认知负担。

**改进建议**:
1. 将 CSS 间距令牌映射到 Tailwind config（`extend.spacing`），避免两套系统
2. 考虑为 Chart.js 使用支持 CSS 变量的插件或适配层
3. 清理 `components.css` 中可用 Tailwind 替代的全局类，或在 Tailwind 中配置对应的 utility

---

### 2.7 i18n 架构（8.0 / 10）

#### 正面

- **动态按需加载**：`loadLocaleMessages()` 使用 `import.meta.glob` 扫描所有 locale JSON 文件，按需加载。
- **按领域分文件**：18 个 JSON 文件（zh-CN × 9 + en × 9），对应 dashboard、logs、providers 等业务领域。
- **类型安全**：`SupportedLocale` 约束为 `'zh-CN' | 'en'`，通过 `const` assertion 类型收窄。
- **语言持久化**：locale 选择存储在 localStorage。

#### 问题

**P2 — 切换语言后需手动 `loadLocaleMessages`**

```typescript
async function setLocale(lang: SupportedLocale) {
  locale.value = lang
  localStorage.setItem(STORAGE_KEY, lang)
  document.documentElement.setAttribute('lang', lang)
  await loadLocaleMessages(lang)
}
```

vue-i18n 本身支持 `lazy: true` 模式，但项目使用了手动调用 `loadLocaleMessages` 的方案。这本身不是问题，但如果未来添加更多语言，需要确保每个新语言目录下都有所有领域文件。

**P3 — 缺少翻译缺失的 fallback 处理**

`loadLocaleMessages` 使用 `mergeLocaleMessage`，如果某个语言缺少某个领域文件（如 `en/monitor.json` 被删除），monitor 页面的英文翻译会 fallback 到 key 本身。虽然 `fallbackLocale: 'zh-CN'` 提供了兜底，但会导致中英混杂。

**改进建议**:
1. 添加翻译文件完整性检查脚本（CI 中验证两个 locale 目录下文件列表一致）
2. 初次加载时预加载当前语言的全部翻译，避免页面渲染时闪现 key

---

### 2.8 目录结构（7.5 / 10）

#### 正面

```
frontend/src/
├── api/              # API client + settings-api
├── components/
│   ├── layout/       # Sidebar
│   ├── logs/         # LogTableRow
│   ├── log-viewer/   # 日志详情查看组件
│   ├── mappings/     # 映射配置组件
│   ├── monitor/      # 监控子面板组件
│   ├── quick-setup/  # 快速设置组件
│   ├── request-detail/ # 请求详情统一对话框
│   ├── shared/       # 跨页面复用组件
│   └── ui/           # shadcn-vue 基础组件 + CascadingSelect
├── composables/      # 14 个 composable
├── i18n/             # vue-i18n 配置 + locale JSON 文件
├── lib/              # 工具函数（目前只有 utils.ts）
├── router/           # Vue Router 配置
├── styles/           # CSS 变量 + 组件样式 + design-tokens.ts
├── types/            # 类型定义（mapping、monitor、schedule）
├── utils/            # format、status 工具函数
└── views/            # 13 个页面组件
```

按角色分层的同时，在 `components/` 下按领域做了二级划分。结构合理。

#### 问题

**P2 — `components/log-viewer/` vs `components/logs/` 的区分不明确**

`log-viewer/` 包含 7 个组件（JsonCopyBlock、LogRequestViewer、LogResponseViewer、MessageRow、SseEventLine 等），`logs/` 只有 1 个文件（LogTableRow）。两者的职责边界模糊——看代码才能区分 `log-viewer` 是日志详情弹窗内使用的子组件，`logs` 是日志列表页的行组件。建议合并为一个 `logs/` 目录，内部再按 `list/` 和 `detail/` 区分。

**P3 — `types/` 目录扁平化，与领域耦合弱**

当前 3 个 type 文件（mapping.ts、monitor.ts、schedules.ts）分别对应后端业务领域，但其中的 interface 在多个 composable 中被引用。如果未来 types 增多，扁平结构会变得杂乱。建议考虑给每个领域建子目录或 index barrel。

**P3 — `lib/utils.ts` 几乎空置**

只有 `cn()` 一个函数（clsx + tailwind-merge wrapper），放在 `lib/` 目录下显得孤零零。可以合并到 `utils/` 或直接位于 `src/` 下。

**改进建议**:
1. 合并 `log-viewer/` 和 `logs/` 为 `logs/`，内部用 `list/` 和 `detail/` 子目录
2. `lib/utils.ts` 合并到 `utils/cn.ts`
3. `CascadingSelect.vue` 从 `ui/` 移到 `shared/`

---

### 2.9 类型系统（7.5 / 10）

#### 正面

- **`request<T>()` 泛型函数**确保 API 调用返回类型安全。
- **TypeScript strict mode**：项目配置了 strict，无 `useUnknownInCatchVariables` 例外。
- **类型定义与后端模型一致**：`mapping.ts` 中的 `Provider`、`MappingGroup` 等 interface 与后端 DB 模型对齐。
- **`env.d.ts` 中的 `__APP_VERSION__` 声明**：为 Vite define 注入的编译时常量提供类型安全。

#### 问题

**P1 — catch 块中大量使用 `unknown` + 手动断言**

```typescript
} catch (e: unknown) {
  const code = (e as { apiCode?: number }).apiCode
}
```

这种模式在项目中出现了 20+ 次。虽然有 `apiCode` 扩展，但断言写法不一致。部分文件用 `(e as { apiCode?: number }).apiCode`，部分用 `(err as unknown as { apiCode?: number }).apiCode`。应该统一通过 `getApiMessage()` 和新增的 `getApiCode()` 辅助函数封装。

**P2 — `env.d.ts` 的 Vue SFC 模块声明过于宽泛**

```typescript
declare module '*.vue' {
  const component: DefineComponent<object, object, unknown>
}
```

`DefineComponent<object, object, unknown>` 意味着所有 `.vue` 组件被推断为接受任意 props 和 emits。这与 `vue-tsc` 的严格类型检查不符（vue-tsc 会自动推导 SFC 的 props/emits 类型，不需要这个声明）。

**P3 — 少许类型使用了宽松的类型定义**

- `ConfigExportResponse` 中 `data: Record<string, unknown[]>`：后端的 data 结构已知，可以定义为更严格的类型
- `TransformRule.request_defaults: Record<string, unknown> | null`：`unknown` 过于宽泛，可以用 `Record<string, string | number | boolean>` 或至少添加注释说明为什么不能严格化

**改进建议**:
1. 新增 `getApiCode(error: unknown): number` 工具函数，统一 catch 块中的错误码提取
2. 移除 `env.d.ts` 中对 `*.vue` 的宽松声明（依赖 `vue-tsc` 自动类型推导）
3. 逐步收紧 `ConfigExportResponse` 和 `TransformRule` 等存在 `unknown` 的字段类型

---

### 2.10 错误边界（6.5 / 10）

#### 正面

- **API 层错误处理完善**：Axios 拦截器统一 401 跳转 + 错误信息附加。
- **Toast 通知一致性**：所有 catch 块都通过 `toast.error(getApiMessage(e, fallback))` 通知用户。
- **`allSettled` 模式**：Dashboard 和 Monitor 的并发请求使用 `allSettled`，单个失败不影响其他。

#### 问题

**P0 — 缺少全局 Vue 错误处理器**

项目中**没有任何全局错误边界**。如果某个组件的 render 函数抛出异常（如访问 null 对象属性），整个应用会崩溃，白屏。

```typescript
// 缺失：app.config.errorHandler
app.config.errorHandler = (err, instance, info) => {
  console.error('Global Vue error:', err, info)
  // 可展示错误页面或 toast
}
```

同样缺失 `app.config.warnHandler` 和 `window.onerror` 的全局错误捕获。

**P0 — 缺少 `<Suspense>` 或异步组件错误边界**

所有路由组件使用 `() => import(...)` 动态导入，但路由配置中**没有 `errorComponent`**。如果某个 chunk 加载失败（网络问题、404），用户看到的是浏览器默认空白。

**P0 — 缺少 `<ErrorBoundary>` 组件**

没有在组件树的关键层级放置错误边界组件。如果 `Dashboard.vue` 的 charts 渲染崩溃，会影响 `Sidebar` 和其他 UI。

**改进建议**:
1. 在 `main.ts` 中注册 `app.config.errorHandler`，捕获未处理的 Vue 错误
2. 在路由配置中添加 `errorComponent: () => import('@/views/ErrorPage.vue')`
3. 实现一个 `<ErrorBoundary>` 组件（基于 `onErrorCaptured` hook），包裹在 `App.vue` 的关键插槽
4. 考虑为异步 chunk 加载失败添加 `router.onError()` 回调

---

## 3. 改进清单（按优先级排序）

### 高优先级（P0 — 存在稳定性风险）

| # | 问题 | 影响范围 | 建议方案 | 预估工时 |
|---|------|----------|----------|----------|
| 1 | 缺少全局 Vue 错误处理器 | 整个应用 | 在 `main.ts` 注册 `app.config.errorHandler` | 0.5h |
| 2 | 路由缺少 `errorComponent` / 404 兜底 | 所有页面 | 添加 `errorComponent` + `/:pathMatch(.*)*` 路由 | 0.5h |
| 3 | 缺少 ErrorBoundary 组件 | 所有页面 | 实现 `<ErrorBoundary>` 包裹关键组件树节点 | 2h |

### 中优先级（P1 — 影响可维护性和可测试性）

| # | 问题 | 影响范围 | 建议方案 | 预估工时 |
|---|------|----------|----------|----------|
| 4 | Composable 依赖无法注入 mock | `useProviderForm` 等 | 通过函数参数注入依赖 | 3h |
| 5 | `useMonitorData` 中 `shallowRef` + `triggerRef` 模式脆弱 | Monitor 页面 | 改为 `ref` + 不可变更新或封装 `updateRequest()` | 2h |
| 6 | `App.vue` 和 `router.beforeEach` 双重认证检查 | 认证流程 | 统一在路由守卫处理，移除 `App.vue` 中的 `checkAuth` | 1h |
| 7 | Chart.js 主题切换触发不必要的 API 请求 | Dashboard 页面 | 主题切换只重渲染 chart colors，不重新请求数据 | 2h |
| 8 | CSS 间距令牌未映射到 Tailwind config | 全局样式 | `extend.spacing` 映射 `--spacing-*` 系列变量 | 1h |
| 9 | Schedules.vue 544 行超限制 + 缺少子组件拆分 | Schedules 页面 | 拆分 dialog 为独立组件 | 3h |
| 10 | catch 块中 `as { apiCode?: number }` 的不一致断言 | 所有 catch 块 | 新增 `getApiCode()` 工具函数 | 1h |

### 低优先级（P2-P3 — 改善体验和清理）

| # | 问题 | 影响范围 | 建议方案 | 预估工时 |
|---|------|----------|----------|----------|
| 11 | Sidebar 升级逻辑与导航职责混合 | Sidebar 组件 | 抽 `SidebarUpgradePopover.vue` | 3h |
| 12 | `log-viewer/` 与 `logs/` 目录职责模糊 | 日志组件 | 合并为一个 `logs/` 目录 | 1h |
| 13 | `CascadingSelect` 在 `ui/` 但不属于 shadcn 基础组件 | 组件分类 | 移到 `shared/` | 0.5h |
| 14 | `env.d.ts` 中 `*.vue` 模块声明过于宽泛 | 类型系统 | 移除声明，依赖 vue-tsc 自动推导 | 0.5h |
| 15 | `lib/utils.ts` 几乎空置 | 目录结构 | 合并到 `utils/cn.ts` | 0.5h |
| 16 | 缺少翻译文件完整性检查 | i18n | CI 脚本验证中英文 JSON 文件列表一致 | 1h |
| 17 | Dashboard filter 切换缺少请求取消 | Dashboard 页面 | 添加 AbortController | 2h |

---

## 附录：关键指标

| 指标 | 数值 |
|------|------|
| 总 TS/Vue 文件数 | ~100+ |
| 总代码行数 | ~6700 |
| View 文件数 | 13 |
| Composable 文件数 | 14 |
| 自定义业务组件数 | 30 |
| shadcn-vue UI 组件类型数 | 19 |
| i18n 支持语言数 | 2 |
| 最大单文件行数 | 562 (useQuickSetup.ts) |
| 最大 View 行数 | 544 (Schedules.vue) |
| `any` 类型出现次数 | 1（在 Sidebar.vue 模板注释中，非代码） |
| `unknown` 类型出现次数 | 约 50 次（主要在 catch 块 + ConfigExportResponse 等） |
