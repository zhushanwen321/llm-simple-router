# 前端详细设计：图片检测自动切换多模态模型

## 1. 概述

本文档覆盖 spec 中两个前端 task 的详细设计：

- **TF1**: Provider 管理页 — 模型能力（capabilities）展示与编辑
- **TF2**: 映射组配置页 — image_fallback 配置

### 设计原则

- **最小侵入**：复用现有组件和交互模式，不改变页面整体结构
- **编辑→保存模式**：两个功能点都在已有的编辑对话框/展开卡片中完成，不新增独立页面
- **渐进增强**：capabilities 和 image_fallback 均为可选字段，缺失时 UI 不报错，展示合理默认值

---

## 2. TF1: Provider 管理页 — 模型能力编辑

### 2.1 需求描述

在 Provider 编辑对话框的模型卡片（`ModelCard.vue`）中，为每个模型增加 **capabilities** 展示和编辑。用户可标记模型为纯文本（text）或支持图片理解（text + image）。同时在 Providers 列表页的模型 Badge 区域展示能力标识。

### 2.2 设计决策

#### ADR-1: 能力标签使用 Checkbox 组

**背景**：capabilities 当前只有两种值（text、image），未来可能扩展 audio/video。

**方案 A**：Badge 可点击切换
**方案 B**：Checkbox 组（text 默认勾选且禁用，image 可勾选）

**选择**：方案 B

**理由**：
- Checkbox 语义明确（勾选=启用），不需要用户猜测"点击 badge 会发生什么"
- text 始终存在，用 disabled Checkbox 表示不可取消，语义清晰
- 扩展性好，后续加 audio/video 只需加 Checkbox
- 项目已有 `components/ui/checkbox/` 组件

#### ADR-2: 能力编辑内嵌在 ModelCard 中

**理由**：ModelCard 已承载 context_window（Select）和 patches（Collapsible），capabilities 是同等粒度的属性，应与其并列。ModelCard 当前 template 约 70 行，增加约 15 行后仍在 400 行上限内。

### 2.3 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/src/types/mapping.ts` | 修改 | `ModelInfo` 增加 `capabilities?: string[]` |
| `frontend/src/components/quick-setup/types.ts` | 修改 | `ModelConfig` 增加 `capabilities?: string[]` |
| `frontend/src/components/quick-setup/ModelCard.vue` | 修改 | 增加 image Checkbox |
| `frontend/src/composables/useProviderForm.ts` | 修改 | `addModel`/`openEdit`/`buildPayload`/`updateModel` 适配 capabilities |
| `frontend/src/views/Providers.vue` | 修改 | 表格中模型 Badge 增加能力图标展示 |
| `frontend/src/api/client.ts` | 修改 | `ProviderPayload.models` 类型增加 `capabilities` |
| `frontend/src/components/mappings/cascading-types.ts` | 修改 | `ModelOption` 增加 `capabilities` 字段 |
| `frontend/src/i18n/locales/zh-CN/providers.json` | 修改 | 新增翻译 key |

### 2.4 数据流

```
DB (provider.models JSON, 含 capabilities)
  → API GET /admin/api/providers
  → Provider.models: ModelInfo[]  (ModelInfo.capabilities?: string[])
  → useProviderForm.openEdit() 映射到 form.models[i].capabilities
  → ModelCard 接收 capabilities 作为 Checkbox 状态
  → 用户勾选/取消 image
  → emit('update:model', {...model, capabilities})
  → useProviderForm.updateModel() 更新本地 form.models[i].capabilities
  → buildPayload() 将 capabilities 写入 payload.models[i]
  → API PUT /admin/api/providers/:id → 写入 DB
```

### 2.5 类型变更

**`ModelInfo`**（`frontend/src/types/mapping.ts`）：

```typescript
export interface ModelInfo {
  name: string
  context_window: number | null
  patches: string[]
  stream_timeout_ms?: number | null
  capabilities?: string[]  // 新增：默认 ["text"]
}
```

**`ModelConfig`**（`frontend/src/components/quick-setup/types.ts`）：

```typescript
export interface ModelConfig {
  name: string
  contextWindow: number
  enabled: boolean
  patches: string[]
  capabilities?: string[]  // 新增
}
```

**`ModelOption`**（`frontend/src/components/mappings/cascading-types.ts`）：

```typescript
export interface ModelOption {
  name: string
  contextWindow: number
  streamTimeoutMs?: number | null
  capabilities?: string[]  // 新增：用于后续 image_fallback 过滤展示
}
```

**`ProviderPayload`**（`frontend/src/api/client.ts`）：

```typescript
models?: Array<string | {
  name: string
  context_window?: number
  patches?: string[]
  capabilities?: string[]  // 新增
}>
```

### 2.6 ModelCard.vue 变更

在 context window Select 右侧增加 image Checkbox：

```
[模型名] [context_window Select] [text Checkbox(disabled)] [image Checkbox] [patch展开] [删除]
```

交互逻辑：
- `text` Checkbox 始终勾选且 disabled，不可操作
- `image` Checkbox 初始状态由 `model.capabilities?.includes('image')` 决定
- 勾选 image → `capabilities: ["text", "image"]`
- 取消 image → `capabilities: ["text"]`
- 无 capabilities 字段时默认显示 `["text"]`（image 未勾选）

使用 `Checkbox` + `CheckboxIndicator` + `Label`（均来自 `@/components/ui/checkbox/`），配合 `ImageIcon`（lucide-vue-next）作为 image 的视觉标识。

### 2.7 Providers.vue 表格展示变更

模型列（Badge 区域）中，支持 image 的模型在 Badge 旁显示 `ImageIcon`（size-3，text-muted-foreground）：

```
[gpt-4.1 (128K)]  [glm-4v-plus (200K) 🖼]
```

### 2.8 useProviderForm.ts 变更

| 方法 | 变更 |
|------|------|
| `addModel()` | 新模型默认 `capabilities: ['text']` |
| `openEdit()` | 映射 `capabilities: m.capabilities ?? ['text']` |
| `updateModel()` | 透传 `capabilities` 字段（与 patches 同理） |
| `buildPayload()` | 序列化 `capabilities: m.capabilities` ，仅非默认 `['text']` 时写入以减少 DB 存储 |

### 2.9 验收标准

| AC# | 条件 | 验证方式 |
|-----|------|---------|
| AC-TF1-1 | 打开 Provider 编辑对话框，已有模型的 capabilities 正确显示（有 image 的勾选 image） | 手动验证 |
| AC-TF1-2 | 勾选 image 后保存，重新打开仍为勾选 | 手动验证 |
| AC-TF1-3 | 取消 image 后保存，重新打开为未勾选 | 手动验证 |
| AC-TF1-4 | 新添加模型默认只有 text 能力 | 手动验证 |
| AC-TF1-5 | Providers 列表页支持 image 的模型有图标标识 | 手动验证 |
| AC-TF1-6 | text Checkbox 始终禁用且勾选 | 手动验证 |

### 2.10 风险点

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 后端 API 尚未支持 capabilities 字段 | 无法端到端测试 | 前端代码不依赖后端返回 capabilities 存在，缺失时默认 `['text']` |
| ModelCard.vue 增加约 15 行 template | 约 85 行，仍在 400 行上限内 | 无需额外处理 |

### 2.11 依赖

- 后端 `parseModels()` 返回的 `ModelInfo` 包含 `capabilities` 字段（spec AC5/AC6）
- 后端 Provider API GET/PUT 透传 `capabilities`
- 无前端新组件依赖

---

## 3. TF2: 映射组配置 — image_fallback

### 3.1 需求描述

在映射组编辑卡片中增加 **image_fallback** 配置区域。用户选择一个 provider + backend_model，作为图片请求的 fallback 目标。数据结构与 overflow 对称（provider_id + model）。

### 3.2 设计决策

#### ADR-3: image_fallback 复用 overflow 的 UI 模式

**背景**：`MappingEntryEditor.vue` 已有 overflow 配置模式：`[标签] [CascadingModelSelect] [删除按钮]`，带虚线分隔和添加按钮。

**选择**：完全复用此模式

**理由**：
- 数据结构对称（都是 provider_id + model）
- 用户已熟悉溢出模型的添加/编辑/删除，零学习成本
- 代码复用 `CascadingModelSelect` 组件
- 布局一致性高

#### ADR-4: image_fallback 放在 overflow 之后

**理由**：
- 逻辑顺序：primary target → failover targets → overflow → image fallback
- 每个都是"前面的不适用时"的兜底策略
- 虚线分隔，视觉层次清晰
- 不与 overflow 混在一起，避免用户困惑

### 3.3 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/src/types/mapping.ts` | 修改 | `Rule` 接口增加 `image_fallback` 字段 |
| `frontend/src/components/quick-setup/types.ts` | 修改 | `MappingEntry` 增加 `image_fallback` 字段 |
| `frontend/src/components/mappings/MappingEntryEditor.vue` | 修改 | 增加 image_fallback 配置区域 |
| `frontend/src/components/mappings/ModelMappingCard.vue` | 修改 | 保存/加载 image_fallback，折叠展示 |
| `frontend/src/views/ModelMappings.vue` | 修改 | `buildEntries()` 解析 image_fallback |
| `frontend/src/i18n/locales/zh-CN/providers.json` | 修改 | 新增翻译 key（共享 providers.shared 命名空间） |

### 3.4 数据流

```
DB (mapping_groups.rule JSON: {targets, image_fallback})
  → API GET /admin/api/mapping-groups → MappingGroup.rule: string
  → ModelMappings.vue buildEntries() 解析 JSON
  → image_fallback 挂在 MappingEntry 顶层
  → MappingEntryEditor 接收 imageFallback prop
  → 用户通过 CascadingModelSelect 选择 provider + model
  → emit('update:imageFallback', {provider_id, backend_model})
  → ModelMappingCard 更新本地 localImageFallback
  → 保存时 JSON.stringify({targets, image_fallback})
  → API PUT /admin/api/mapping-groups/:id → 写入 DB
```

### 3.5 类型变更

**`Rule`**（`frontend/src/types/mapping.ts`）：

```typescript
export interface Rule {
  targets?: MappingTarget[]
  image_fallback?: {         // 新增
  provider_id: string
  backend_model: string
  }
}
```

**`MappingEntry`**（`frontend/src/components/quick-setup/types.ts`）：

```typescript
export interface MappingEntry {
  clientModel: string
  targets: MappingTarget[]
  existing: boolean
  existingId?: string
  tag: 'def' | 'auto' | 'cust' | 'existing'
  active: boolean
  originalActive?: boolean
  image_fallback?: {          // 新增
  provider_id: string
  backend_model: string
  }
}
```

### 3.6 MappingEntryEditor.vue 变更

**新增 props**：

```typescript
imageFallback?: { provider_id: string; backend_model: string }
```

**新增 emits**：

```typescript
'update:imageFallback': [value: { provider_id: string; backend_model: string } | undefined]
```

**模板结构**（在 overflow 区域之后增加）：

```
<!-- 故障转移链 -->
<div>targets...</div>

<!-- 溢出模型（虚线分隔，border-primary/15） -->
<div class="border-t border-dashed border-primary/15">
  overflow 配置...
</div>

<!-- 图片 Fallback（虚线分隔，border-violet-400/15） -->     ← 新增
<div class="pt-2 mt-1 border-t border-dashed border-violet-400/15 space-y-1.5">
  <!-- 有配置：[标签] [CascadingModelSelect] [删除按钮] -->
  <!-- 无配置：[添加按钮] [Tooltip] -->
</div>
```

颜色区分：overflow 用 `primary` 色调，image_fallback 用 `violet` 色调，视觉上有区分。

**折叠视图变更**：在 overflow 信息之后，如有 image_fallback 增加一行：

```
① glm-5.1 [智谱]
   ↓ 失败时切换
② deepseek-v4 [DS]
   ⤵ 溢出 → glm-5.1-turbo
   🖼 图片 → moonshot-v1-128k [Kimi]     ← 新增
```

使用 `ImageIcon`（lucide-vue-next），`text-violet-400/50` 颜色。

### 3.7 ModelMappingCard.vue 变更

| 位置 | 变更 |
|------|------|
| 本地状态 | 新增 `localImageFallback` ref |
| `watch(expanded)` | 同步 `localImageFallback` from `props.entry.image_fallback` |
| `watch(() => props.entry.targets)` | 同步时也更新 `localImageFallback` |
| `workingEntry` computed | 包含 `image_fallback: localImageFallback` |
| `handleSave()` | `JSON.stringify({targets, ...(localImageFallback ? {image_fallback: localImageFallback} : {})})` |

MappingEntryEditor 调用增加 `:image-fallback` 和 `@update:image-fallback`。

### 3.8 ModelMappings.vue 变更

**`buildEntries()`**：从 `rule.image_fallback` 解析并加入 entry：

```typescript
const image_fallback = rule.image_fallback
  ? { provider_id: rule.image_fallback.provider_id, backend_model: rule.image_fallback.backend_model }
  : undefined
```

**`providerGroups` computed**：已有 models 映射，无需变更（capabilities 通过 TF1 的类型变更自动可用）。

**`newEntry` computed**：无 `image_fallback`（新建时默认不配置）。

### 3.9 验收标准

| AC# | 条件 | 验证方式 |
|-----|------|---------|
| AC-TF2-1 | 映射组展开编辑时，已有 image_fallback 正确显示 provider 和 model | 手动验证 |
| AC-TF2-2 | 点击"添加图片 Fallback"按钮，出现 CascadingModelSelect | 手动验证 |
| AC-TF2-3 | 选择 provider + model 后保存，重新展开显示正确值 | 手动验证 |
| AC-TF2-4 | 删除 image_fallback 后保存，rule JSON 中不含该字段 | DevTools 检查 |
| AC-TF2-5 | 折叠状态下有 image_fallback 的卡片显示 fallback 信息 | 手动验证 |
| AC-TF2-6 | 未配置 image_fallback 时不显示相关 UI | 手动验证 |
| AC-TF2-7 | 多个映射组各自独立配置互不影响 | 手动验证 |

### 3.10 风险点

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| MappingEntryEditor.vue 行数增加 | 现有约 170 行 template，增加约 40 行后约 210 行，仍在 400 行内 | 如超限，提取 `ImageFallbackConfig.vue` 子组件 |
| 用户可能选择不支持图片的模型作为 fallback | fallback 无效 | 初版不做前端过滤，由后端 `validateRule()` 校验 |
| 后端 validateRule 校验失败 | 需要清晰错误提示 | 复用 `toast.error(getApiMessage(e, ...))` |

### 3.11 依赖

- 后端 `mapping_groups.rule` JSON 支持 `image_fallback` 字段存取
- 后端 `validateRule()` 验证 `image_fallback.provider_id` 存在且 active（spec AC17）
- 复用 `CascadingModelSelect`、`Button`、`Tooltip`，无新组件依赖

---

## 4. 交互场景四态覆盖

### 场景 1: 编辑模型能力（TF1）

| 状态 | 表现 |
|------|------|
| **加载态** | Provider 编辑对话框打开时，模型卡片正常渲染。capabilities 缺失时默认 `['text']`，无独立 loading |
| **成功态** | Checkbox 显示正确勾选状态；保存后 toast 提示保存成功 |
| **失败态** | API 保存失败 → `console.error()` + `toast.error(getApiMessage(e, t('providers.toast.saveFailed')))`，对话框不关闭，可重试 |
| **空数据态** | 新添加模型默认 `['text']`，image 未勾选；无模型时不显示卡片 |

### 场景 2: 配置 image_fallback（TF2）

| 状态 | 表现 |
|------|------|
| **加载态** | 展开映射卡片时同步解析 rule JSON，无 loading |
| **成功态** | 保存后 toast 提示保存成功，卡片折叠显示 fallback 信息 |
| **失败态** | API 保存失败 → `console.error()` + `toast.error(getApiMessage(e, t('mappings.messages.saveFailed')))`，卡片保持展开 |
| **空数据态** | 未配置 image_fallback 时，显示"添加图片 Fallback"按钮 + Tooltip |

---

## 5. 状态管理

两个功能点不涉及跨页面或跨组件共享状态，全部组件本地管理：

| 数据 | 类型 | 归属 | 持久化 | 共享范围 |
|------|------|------|--------|---------|
| 模型 capabilities | UI 状态 | `useProviderForm.form.models[i]`（本地 ref） | 保存到 API | Provider 编辑对话框内 |
| image_fallback | 业务状态 | `ModelMappingCard.localImageFallback`（本地 ref） | 保存到 API | 单个映射卡片内 |

不使用 store 或跨组件 composable，与项目现有模式一致（无 Pinia/Vuex）。

---

## 6. 暂定 API 调用

复用现有 API 端点，无需新增：

| 场景 | 页面 | API | 方法 | 请求数据 | 期望响应 | 状态 |
|------|------|-----|------|---------|---------|------|
| 保存 Provider（含 capabilities） | Providers | `/admin/api/providers/:id` | PUT | `{..., models: [{..., capabilities}]}` | `{success, cascadedGroups}` | [暂定] |
| 创建 Provider（含 capabilities） | Providers | `/admin/api/providers` | POST | `{..., models: [{..., capabilities}]}` | `{id}` | [暂定] |
| 保存映射组（含 image_fallback） | ModelMappings | `/admin/api/mapping-groups/:id` | PUT | `{client_model, rule: '{"targets":[...], "image_fallback":{...}}'}` | `{success}` | [暂定] |
| 创建映射组（含 image_fallback） | ModelMappings | `/admin/api/mapping-groups` | POST | `{client_model, rule: '...'}` | `{id}` | [暂定] |
| 获取 Provider 列表 | Providers | `/admin/api/providers` | GET | — | `Provider[]` | [已确认] |
| 获取映射组列表 | ModelMappings | `/admin/api/mapping-groups` | GET | — | `MappingGroup[]` | [已确认] |

说明：
- capabilities 在现有 Provider API payload 中透传，不需要新端点
- image_fallback 在 MappingGroup API 的 `rule` JSON 字符串中，不需要新端点
- 后端 validateRule() 需扩展验证 image_fallback，但 API 签名不变

---

## 7. 样式策略

### 7.1 一致性

- 使用 Tailwind 语义 token（`text-foreground`、`text-muted-foreground`、`bg-card`、`border-border`）
- image_fallback 区域使用 `violet-400/15` 功能色区分 overflow 的 `primary` 色调
- 图标统一使用 `lucide-vue-next` 的 `ImageIcon`

### 7.2 暗色模式

无需额外处理。所有 Tailwind 类都有暗色模式 CSS 变量，自动适配。

### 7.3 响应式

Provider 编辑对话框已有 `sm:max-w-4xl` + `grid-cols-3`。新增 Checkbox 不影响布局。映射组卡片 `grid-cols-3` 中 image_fallback 区域在卡片内部，自动适配。

---

## 8. 实现顺序

```
TF1（Provider capabilities） → TF2（image_fallback）
```

理由：TF1 是基础数据，capabilities 标记先到位；TF2 的后端校验依赖 capabilities 数据。前端可并行开发，但测试时 TF1 先完成更方便端到端验证。

---

## 9. 自检清单

| # | 检查项 | 结果 |
|---|--------|------|
| 1 | 所有 UI 组件使用 shadcn-vue（无原生 HTML） | 通过 — Checkbox、Badge、CascadingModelSelect、Tooltip |
| 2 | 无 Emoji，使用 lucide-vue-next 图标 | 通过 — 使用 ImageIcon |
| 3 | 错误消息使用中文 | 通过 — i18n zh-CN 翻译 |
| 4 | 遵循现有页面交互模式 | 通过 — 编辑对话框 + 展开卡片保存按钮模式 |
| 5 | 表单验证使用 vee-validate + zod | N/A — Checkbox 布尔值和 Select 选择器无需文本验证 |
| 6 | 异步操作双层错误处理（console.error + toast） | 通过 — 复用现有 handleSave 模式 |
| 7 | template 行数 <= 400 行 | 通过 — ModelCard ~85 行，MappingEntryEditor ~210 行 |
| 8 | script setup 行数 <= 300 行 | 通过 — 变更量小 |
| 9 | 无硬编码颜色值 | 通过 — 使用 Tailwind 语义 token 和标准色阶 |
| 10 | 无魔数间距 | 通过 — 使用标准 Tailwind scale |
| 11 | 暂定 API 标注 [暂定] | 通过 |
| 12 | 每个交互场景覆盖四态 | 通过 — 见第 4 节 |
| 13 | 每个状态数据标注归属 | 通过 — 见第 5 节 |
