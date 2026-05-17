# Frontend Plan: 多模态重定向（Modality Redirect）

## 概述

本次前端改动是**语义重命名 + 能力扩展**，技术架构不变。核心工作：

1. 所有 `ImageFallback` / `image_fallback` / `imageFallback` 重命名为 `MultimodalFallback` / `multimodal_fallback` / `multimodalFallback`
2. `toggleModelImageCapability()` 泛化为 `toggleModelCapability(index, capability)`，支持 image/audio/video 任意模态
3. ModelCard.vue 和 ModelCapabilitiesEditor.vue 增加 audio/video checkbox
4. ModelMappingCard.vue 新增 Alert 警告（永久会话锁定提示）
5. i18n key 重命名 + 新增 audio/video 标签

## 约束

- 禁止原生 HTML 元素，必须用 shadcn-vue 组件
- 禁止 Emoji，使用 lucide-vue-next 图标
- `<style scoped>` 内只允许 `@apply`，禁止手写 CSS 选择器
- 模板 ≤ 800 行，script ≤ 600 行
- 前端控件交互模式：ModelMappingCard 是编辑→保存模式，禁止直调 API

## 设计决策

| ID | 决策 | 理由 |
|----|------|------|
| FD1 | Alert 警告使用 `Card` + 自定义样式组合，不安装 shadcn Alert 组件 | 项目无 Alert 组件，安装引入额外依赖；用 Card + `border-amber-500/30` 语义色即可表达警告级别，与现有样式系统一致 |
| FD2 | `toggleModelCapability(index, capability)` 接受 `capability` 字符串参数而非布尔数组 | 调用方只需知道"切换哪个模态"，函数内部处理 toggle 逻辑。比传完整 capabilities ���组更简洁，减少调用方的状态管理负担 |
| FD3 | i18n key 从 `imageFallback` 改为 `multimodalFallback`，不保留旧 key | 功能未上线，无生产数据。直接重命名避免维护两套 key |
| FD4 | Audio/Video checkbox 与现有 Image checkbox 同级并列 | 保持 UI 一致性；三个模态的 checkbox 结构相同，只是 label 和 icon 不同 |

---

## Task 分解

### Task F1: 类型重命名

**描述**：将 `ImageFallback` 类型重命名为 `MultimodalFallback`，`image_fallback` 字段重命名为 `multimodal_fallback`。这是所有后续 task 的基础。

**文件变更**：

| 文件 | 操作 | 详情 |
|------|------|------|
| `frontend/src/types/mapping.ts` | 修改 | `ImageFallback` → `MultimodalFallback`；`Rule.image_fallback` → `Rule.multimodal_fallback` |
| `frontend/src/components/quick-setup/types.ts` | 修改 | re-export 的 `ImageFallback` → `MultimodalFallback`；`MappingEntry.imageFallback` → `MappingEntry.multimodalFallback` |

**具体改动**：

`types/mapping.ts`:
```typescript
// Before
export interface ImageFallback { ... }
export interface Rule { image_fallback?: ImageFallback; }

// After
export interface MultimodalFallback {
  provider_id: string;
  backend_model: string;
}
export interface Rule {
  targets?: MappingTarget[];
  multimodal_fallback?: MultimodalFallback;
}
```

`quick-setup/types.ts`:
```typescript
// Before
import type { MappingTarget, ImageFallback } from '@/types/mapping'
export type { MappingTarget, ImageFallback }
export interface MappingEntry { imageFallback?: ImageFallback; }

// After
import type { MappingTarget, MultimodalFallback } from '@/types/mapping'
export type { MappingTarget, MultimodalFallback }
export interface MappingEntry { multimodalFallback?: MultimodalFallback; }
```

**验收标准**：
- AC1: `ImageFallback` 在前端代码中零引用（`grep -r "ImageFallback" frontend/src/` 返回空）
- AC2: `image_fallback` 在前端 TS 文件中零引用（i18n JSON 除外）
- AC3: TypeScript 编译零错误

**风险点**：
- 类型重命名影响范围广，需确保所有 import 和使用点同步更新

**依赖**：无（基础 task）

---

### Task F2: ModelMappingCard 重命名 + Alert 警告

**描述**：将 ModelMappingCard.vue 中所有 `imageFallback` / `ImageFallback` 引用更新为 `multimodalFallback` / `MultimodalFallback`。新增 Alert 组件显示永久会话锁定警告。

**文件变更**：

| 文件 | 操作 | 详情 |
|------|------|------|
| `frontend/src/components/mappings/ModelMappingCard.vue` | 修改 | 1) 类型/变量/函数重命名；2) JSON 序列化字段 `image_fallback` → `multimodal_fallback`；3) i18n key `imageFallback.*` → `multimodalFallback.*`；4) 新增 Alert 警告区域；5) 引入 `AlertTriangle` 图标替代 `ImageIcon` 作为 section 标题图标 |

**具体改动**：

1. Import 类型更新：`ImageFallback` → `MultimodalFallback`
2. `localImageFallback` ref → `localMultimodalFallback` ref
3. `addImageFallback()` → `addMultimodalFallback()`
4. `handleUpdateImageFallback()` → `handleUpdateMultimodalFallback()`
5. `handleFallbackSelect()` 中赋值更新
6. `handleSave()` 中 JSON key：`image_fallback` → `multimodal_fallback`
7. 模板中所有绑定更新
8. **新增 Alert 区域**：在 fallback 配置下方，当 `localMultimodalFallback` 有值时显示警告
9. `ImageIcon` import 替换为 `AlertTriangle`（section 标题）+ 保留 `ImageIcon`（如果仍有图片相关 badge）→ 统一改为 `Layers` 图标（表示多模态）

Alert 警告 UI 结构（在 fallback select 下方）：
```vue
<!-- 永久锁定警告 -->
<div v-if="localMultimodalFallback" class="mt-2 p-2 rounded-md border border-amber-500/30 bg-amber-500/5">
  <div class="flex gap-2">
  <AlertTriangle class="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
  <div class="text-[11px] text-amber-600/80 space-y-1">
    <p>{{ t('mappings.multimodalFallback.sessionLockWarning') }}</p>
    <p class="text-amber-600/60">{{ t('mappings.multimodalFallback.sessionLockReason') }}</p>
  </div>
  </div>
</div>
```

**验收标准**：
- AC1: ModelMappingCard 内所有 `imageFallback` 引用更新为 `multimodalFallback`
- AC2: 保存时 JSON 中字段名为 `multimodal_fallback`（非 `image_fallback`）
- AC3: 配置了 fallback 时，下方显示琥珀色警告区域
- AC4: 警告文本包含会话锁定、原因、恢复方式三项信息
- AC5: 无 fallback 配置时，不显示警告

**风险点**：
- Alert 样式使用 `amber` 语义色，需确认在暗色模式下可读性。使用 `amber-500/30` border + `amber-500/5` bg 在亮/暗模式均表现良好
- 模板行数增加约 15 行（Alert 区域），仍在 800 行限制内

**依赖**：F1（类型重命名）

---

### Task F3: ModelMappings.vue 字段名更新

**描述**：更新 ModelMappings.vue 中 `buildEntries()` 函数里的 `image_fallback` / `imageFallback` 引用。

**文件变更**：

| 文件 | 操作 | 详情 |
|------|------|------|
| `frontend/src/views/ModelMappings.vue` | 修改 | `rule.image_fallback` → `rule.multimodal_fallback`；`imageFallback` 变量 → `multimodalFallback`；MappingEntry 字段更新 |

**具体改动**：

`buildEntries()` 函数中：
```typescript
// Before
const imageFallback = rule.image_fallback ? { ... } : undefined;
return { ..., imageFallback };

// After
const multimodalFallback = rule.multimodal_fallback ? {
  provider_id: rule.multimodal_fallback.provider_id,
  backend_model: rule.multimodal_fallback.backend_model,
} : undefined;
return { ..., multimodalFallback };
```

**验收标准**：
- AC1: `buildEntries()` 正确从 `rule.multimodal_fallback` 解析数据
- AC2: 生成的 MappingEntry 使用 `multimodalFallback` 字段名
- AC3: 页面加载已有映射数据正确显示

**风险点**：
- 后端需同步返回 `multimodal_fallback` 字段名。前后端需同时部署

**依赖**：F1（类型重命名）

---

### Task F4: toggleModelCapability 泛化

**描述**：将 `toggleModelImageCapability()` 泛化为 `toggleModelCapability(index, capability)`，支持切换任意模态（image/audio/video）。

**文件变更**：

| 文件 | 操作 | 详情 |
|------|------|------|
| `frontend/src/composables/useProviderForm.ts` | 修改 | 函数签名和逻辑泛化 |
| `frontend/src/views/Providers.vue` | 修改 | emit 名和调用参数更新 |
| `frontend/src/views/QuickSetup.vue` | 修改 | 本地函数重命名 + 参数更新 |

**具体改动**：

`useProviderForm.ts`:
```typescript
// Before
function toggleModelImageCapability(index: number) {
  const model = form.value.models[index];
  const caps = model.capabilities ?? ["text"];
  const hasImage = caps.includes("image");
  model.capabilities = hasImage
  ? caps.filter((c) => c !== "image")
  : [...caps, "image"];
}
// Export: toggleModelImageCapability

// After
function toggleModelCapability(index: number, capability: string) {
  const model = form.value.models[index];
  const caps = model.capabilities ?? ["text"];
  const hasIt = caps.includes(capability);
  model.capabilities = hasIt
  ? caps.filter((c) => c !== capability)
  : [...caps, capability];
}
// Export: toggleModelCapability
```

`Providers.vue`:
```vue
<!-- Before -->
@toggle-model-image-capability="toggleModelImageCapability"

<!-- After -->
@toggle-model-capability="(cap: string) => toggleModelCapability(i, cap)"
```
（注：Providers.vue 通过 ModelCapabilitiesEditor 中转，实际改动链是 Providers.vue → emit 传递）

`QuickSetup.vue`:
```typescript
// Before
function toggleModelImageCapability(index: number) {
  const next = [...modelConfigs.value];
  const model = { ...next[index] };
  const caps = model.capabilities ?? ['text'];
  if (caps.includes('image')) {
  model.capabilities = caps.filter(c => c !== 'image');
  } else {
  model.capabilities = [...caps, 'image'];
  }
  next[index] = model;
  modelConfigs.value = next;
}

// After
function toggleModelCapability(index: number, capability: string) {
  const next = [...modelConfigs.value];
  const model = { ...next[index] };
  const caps = model.capabilities ?? ['text'];
  if (caps.includes(capability)) {
  model.capabilities = caps.filter(c => c !== capability);
  } else {
  model.capabilities = [...caps, capability];
  }
  next[index] = model;
  modelConfigs.value = next;
}
```

模板中：
```vue
<!-- Before -->
@toggle-image-capability="toggleModelImageCapability(index)"

<!-- After -->
@toggle-capability="(cap: string) => toggleModelCapability(index, cap)"
```

**验收标准**：
- AC1: `toggleModelImageCapability` 在前端代码中零引用
- AC2: 切换 image capability 行为与重命名前完全一致
- AC3: 切换 audio capability 正确添加/移除 `"audio"` 到 capabilities 数组
- AC4: 切换 video capability 正确添加/移除 `"video"` 到 capabilities 数组
- AC5: `"text"` 始终存在于 capabilities 中（不可移除）

**风险点**：
- 无。逻辑完全等价，只是参数化

**依赖**：无（可与 F1 并行）

---

### Task F5: ModelCard + ModelCapabilitiesEditor 事件名和 UI 扩展

**描述**：更新 emit 事件名，增加 capability 参数。在 ModelCard.vue 的 capabilities 区域增加 audio/video checkbox。同步更新 ModelCapabilitiesEditor.vue 的事件传递。

**文件变更**：

| 文件 | 操作 | 详情 |
|------|------|------|
| `frontend/src/components/quick-setup/ModelCard.vue` | 修改 | emit 重命名 + 增加 audio/video checkbox + 新增 lucide 图标 |
| `frontend/src/components/providers/ModelCapabilitiesEditor.vue` | 修改 | emit 重命名 + 传递 capability 参数 |

**具体改动**：

**ModelCard.vue**:

emit 更新：
```typescript
// Before
emit: { "toggle-image-capability": [] }
// After
emit: { "toggle-capability": [capability: string] }
```

capabilities 区域模板扩展（当前只有 text badge + image checkbox）：
```vue
<!-- Before: 只有 text + image -->
<div v-if="capabilities" class="flex items-center gap-2">
  <Badge variant="secondary" class="text-[10px] px-1.5 py-0 gap-0.5">
  <FileText class="w-2.5 h-2.5" />
  {{ t("providers.capabilities.text") }}
  </Badge>
  <Label class="flex items-center gap-1.5 cursor-pointer">
  <Checkbox :checked="capabilities.includes('image')"
    @update:checked="emit('toggle-image-capability')" />
  <span class="text-[10px] text-muted-foreground flex items-center gap-0.5">
    <ImageIcon class="w-2.5 h-2.5" />
    {{ t("providers.capabilities.image") }}
  </span>
  </Label>
</div>

<!-- After: text + image + audio + video -->
<div v-if="capabilities" class="flex items-center gap-2">
  <Badge variant="secondary" class="text-[10px] px-1.5 py-0 gap-0.5">
  <FileText class="w-2.5 h-2.5" />
  {{ t("providers.capabilities.text") }}
  </Badge>
  <Label class="flex items-center gap-1.5 cursor-pointer">
  <Checkbox :checked="capabilities.includes('image')"
    @update:checked="emit('toggle-capability', 'image')" />
  <span class="text-[10px] text-muted-foreground flex items-center gap-0.5">
    <ImageIcon class="w-2.5 h-2.5" />
    {{ t("providers.capabilities.image") }}
  </span>
  </Label>
  <Label class="flex items-center gap-1.5 cursor-pointer">
  <Checkbox :checked="capabilities.includes('audio')"
    @update:checked="emit('toggle-capability', 'audio')" />
  <span class="text-[10px] text-muted-foreground flex items-center gap-0.5">
    <Volume2 class="w-2.5 h-2.5" />
    {{ t("providers.capabilities.audio") }}
  </span>
  </Label>
  <Label class="flex items-center gap-1.5 cursor-pointer">
  <Checkbox :checked="capabilities.includes('video')"
    @update:checked="emit('toggle-capability', 'video')" />
  <span class="text-[10px] text-muted-foreground flex items-center gap-0.5">
    <Video class="w-2.5 h-2.5" />
    {{ t("providers.capabilities.video") }}
  </span>
  </Label>
</div>
```

新增 lucide 图标 import：`Volume2`（音频）、`Video`（视频）。保留 `ImageIcon` 和 `FileText`。

**ModelCapabilitiesEditor.vue**:

emit 更新：
```typescript
// Before
"toggle-model-image-capability": [index: number];

// After
"toggle-model-capability": [index: number, capability: string];
```

模板中：
```vue
<!-- Before -->
@toggle-image-capability="emit('toggle-model-image-capability', i)"

<!-- After -->
@toggle-capability="(cap: string) => emit('toggle-model-capability', i, cap)"
```

**验收标准**：
- AC1: `toggle-image-capability` 在前端组件中零引用
- AC2: `toggle-model-image-capability` 在前端组件中零引用
- AC3: ModelCard 显示 text badge + image/audio/video 三个 checkbox
- AC4: 点击 image checkbox 触发 `toggle-capability` emit，payload 为 `"image"`
- AC5: 点击 audio checkbox 触发 `toggle-capability` emit，payload 为 `"audio"`
- AC6: 点击 video checkbox 触发 `toggle-capability` emit，payload 为 `"video"`
- AC7: ModelCapabilitiesEditor 正确传递 `index` 和 `capability` 参数

**风险点**：
- ModelCard 宽度有限（在 grid 布局中），新增两个 checkbox 可能导致换行。当前已有 `flex items-center gap-2` 布局，新增后自然换行到下一行是可接受的
- 图标 import 增加 `Volume2` 和 `Video`，需确认 lucide-vue-next 包含这两个图标（确认包含）

**依赖**：F4（emit 名称变更需与调用方一致）

---

### Task F6: i18n 更新

**描述**：将 `imageFallback` i18n key 重命名为 `multimodalFallback`，新增 audio/video 标签，新增 Alert 警告文本。

**文件变更**：

| 文件 | 操作 | 详情 |
|------|------|------|
| `frontend/src/i18n/locales/zh-CN/mappings.json` | 修改 | key 重命名 + 新增 session lock warning |
| `frontend/src/i18n/locales/en/mappings.json` | 修改 | key 重命名 + 新增 session lock warning |
| `frontend/src/i18n/locales/zh-CN/providers.json` | 修改 | capabilities 新增 audio/video |
| `frontend/src/i18n/locales/en/providers.json` | 修改 | capabilities 新增 audio/video |

**具体改动**：

**zh-CN/mappings.json**:
```json
// 删除 "imageFallback" 对象，新增：
"multimodalFallback": {
  "title": "多模态 Fallback",
  "add": "添加多模态 Fallback",
  "configured": "已配置",
  "selectProvider": "选择供应商",
  "modelPlaceholder": "模型名称（如 gpt-4o）",
  "selectProviderModel": "选择供应商和模型",
  "sessionLockWarning": "注意：一旦请求中包含图片、音频或视频，整个会话将持续路由到 fallback 模型。",
  "sessionLockReason": "原因：客户端每轮发送完整对话历史，历史中的多媒体内容会持续触发重定向。客户端执行 compact 或开启新会话后自动恢复。",
  "costSuggestion": "建议：选择与原始模型价位相近的 fallback 模型，避免成本差异过大。"
}
```

**en/mappings.json**:
```json
"multimodalFallback": {
  "title": "Multimodal Fallback",
  "add": "Add Multimodal Fallback",
  "configured": "Configured",
  "selectProvider": "Select Provider",
  "modelPlaceholder": "Model name (e.g. gpt-4o)",
  "selectProviderModel": "Select provider & model",
  "sessionLockWarning": "Note: Once a request contains images, audio, or video, the entire session will be persistently routed to the fallback model.",
  "sessionLockReason": "Reason: The client sends the full conversation history each turn, and multimedia content in history keeps triggering redirects. Session auto-recovers after client compact or new session.",
  "costSuggestion": "Tip: Choose a fallback model with similar pricing to the original model."
}
```

**zh-CN/providers.json** capabilities 新增：
```json
"capabilities": {
  "text": "文本",
  "image": "图片",
  "audio": "音频",
  "video": "视频"
}
```

**en/providers.json** capabilities 新增：
```json
"capabilities": {
  "text": "Text",
  "image": "Image",
  "audio": "Audio",
  "video": "Video"
}
```

**验收标准**：
- AC1: `imageFallback` 在 i18n JSON 中零引用
- AC2: `multimodalFallback.*` 包含所有需要的 key
- AC3: providers.json capabilities 包含 text/image/audio/video 四项
- AC4: 页面显示中文文本（zh-CN 为默认 locale）

**风险点**：
- 无

**依赖**：无（可与所有 task 并行）

---

## Task 执行顺序

```
F1 (类型重命名) ──────────┬──→ F2 (ModelMappingCard)
             ├──→ F3 (ModelMappings.vue)
             │
F4 (toggleCapability) ───┼──→ F5 (ModelCard + Editor)
             │
F6 (i18n) ───────────────┴──→ (无阻塞，可最先或最后执行)
```

建议执行顺序：**F6 → F1 → F3 → F4 → F5 → F2**

理由：
1. F6 (i18n) 无依赖，先改不影响编译
2. F1 (类型) 是 F2/F3 的前置，先完成类型更新
3. F3 (ModelMappings) 依赖 F1 但改动小，趁热打铁
4. F4/F5 是 emit 链路改动，先改 composable 再改组件
5. F2 (ModelMappingCard) 改动最大（新增 Alert），最后做

---

## 暂定 API 调用

| 场景 | 页面 | 暂定 API | 方法 | 说明 | 状态 |
|------|------|---------|------|------|------|
| 保存映射组 | ModelMappings | `/admin/api/mapping-groups` (POST/PUT) | POST/PUT | rule JSON 中 `multimodal_fallback` 替代 `image_fallback` | [暂定] |
| 查询映射组 | ModelMappings | `/admin/api/mapping-groups` | GET | 返回的 rule 中包含 `multimodal_fallback` | [暂定] |

---

## 自检清单

| # | 检查项 | 状态 |
|---|--------|------|
| 1 | 所有 `ImageFallback` 引用已更新为 `MultimodalFallback` | 待验证 |
| 2 | 所有 `image_fallback` 字段名已更新为 `multimodal_fallback` | 待验证 |
| 3 | 所有 `imageFallback` 变量名已更新为 `multimodalFallback` | 待验证 |
| 4 | `toggleModelImageCapability` 已替换为 `toggleModelCapability` | 待验证 |
| 5 | `toggle-image-capability` emit 已替换为 `toggle-capability` | 待验证 |
| 6 | `toggle-model-image-capability` emit 已替换为 `toggle-model-capability` | 待验证 |
| 7 | ModelCard 显示 image/audio/video 三个 checkbox | 待验证 |
| 8 | ModelMappingCard 配置 fallback 时显示 Alert 警告 | 待验证 |
| 9 | i18n zh-CN + en 均已更新 | 待验证 |
| 10 | 无原生 HTML 元素（全部使用 shadcn-vue） | 待验证 |
| 11 | 无 Emoji（全部使用 lucide 图标） | 待验证 |
| 12 | TypeScript 编译零错误 | 待验证 |
| 13 | ESLint 零错误零警告 | 待验证 |
| 14 | 模板行数 ≤ 800, script 行数 ≤ 600 | 待验证 |

## grep 验证命令

完成所有 task 后执行：

```bash
# 应全部返回空
grep -r "ImageFallback" frontend/src/
grep -r "image_fallback" frontend/src/ --include="*.ts" --include="*.vue"
grep -r "toggleModelImageCapability" frontend/src/
grep -r "toggle-image-capability" frontend/src/
grep -r "toggle-model-image-capability" frontend/src/
grep -r '"imageFallback"' frontend/src/ --include="*.json"
```
