# Phase 3: 前端改造

## Task 6: 创建 CascadingModelSelect 组件

**Files:**
- Create: `frontend/src/components/mappings/cascading-types.ts`
- Create: `frontend/src/components/mappings/CascadingModelSelect.vue`

### Step 0: 创建共享类型文件

```typescript
// frontend/src/components/mappings/cascading-types.ts
import type { ProviderSummary } from '@/types/mapping'

export interface ModelOption {
  name: string
  contextWindow: number
}

export interface ProviderGroup {
  provider: ProviderSummary
  models: ModelOption[]
}

export interface SelectedValue {
  provider_id: string
  model: string
}
```

### Step 1: 创建组件

级联二层选择器：点击展开供应商列表，hover 向右展开模型列表。

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { ProviderGroup, ModelOption, SelectedValue } from './cascading-types'

const props = defineProps<{
  providers: ProviderGroup[]
  modelValue?: SelectedValue
  placeholder?: string
  filterFn?: (model: ModelOption) => boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SelectedValue]
}>()

const open = ref(false)
const activeProviderId = ref<string | null>(null)
const triggerRef = ref<HTMLElement>()
const dropdownRef = ref<HTMLElement>()

onClickOutside(triggerRef, () => { open.value = false })

const selectedLabel = computed(() => {
  if (!props.modelValue?.provider_id) return props.placeholder ?? '选择模型...'
  const group = props.providers.find(p => p.provider.id === props.modelValue!.provider_id)
  if (!group) return props.placeholder ?? '选择模型...'
  return `${group.provider.name} / ${props.modelValue.model}`
})

const filteredProviders = computed(() =>
  props.providers.map(g => ({
    ...g,
    models: props.filterFn ? g.models.filter(props.filterFn) : g.models,
  })).filter(g => g.models.length > 0)
)

function selectModel(providerId: string, modelName: string) {
  emit('update:modelValue', { provider_id: providerId, model: modelName })
  open.value = false
}

function formatContextWindow(cw: number): string {
  if (cw >= 1000000) return `${cw / 1000000}M`
  return `${cw / 1000}K`
}

function toggle() { open.value = !open.value }

onMounted(() => {
  if (props.modelValue?.provider_id) {
    activeProviderId.value = props.modelValue.provider_id
  }
})
</script>

<template>
  <div ref="triggerRef" class="relative">
    <div
      class="flex h-9 w-full items-center justify-between rounded-md border border-input
        bg-background px-3 py-2 text-sm cursor-pointer hover:bg-accent"
      @click="toggle"
    >
      <span :class="modelValue?.provider_id ? 'text-foreground' : 'text-muted-foreground'">
        {{ selectedLabel }}
      </span>
      <ChevronDown class="h-4 w-4 opacity-50" />
    </div>

    <div
      v-if="open"
      ref="dropdownRef"
      class="absolute z-50 mt-1 min-w-56 rounded-md border bg-popover
        text-popover-foreground shadow-md"
    >
      <div class="py-1">
        <div
          v-for="group in filteredProviders"
          :key="group.provider.id"
          class="relative px-2 py-1.5 text-sm cursor-pointer hover:bg-accent"
          @mouseenter="activeProviderId = group.provider.id"
        >
          <div class="flex items-center justify-between">
            <span class="font-medium">{{ group.provider.name }}</span>
            <ChevronRight class="h-3 w-3 opacity-50" />
          </div>

          <!-- 二级模型列表 -->
          <div
            v-if="activeProviderId === group.provider.id"
            class="absolute left-full top-0 ml-1 min-w-48 rounded-md border
              bg-popover text-popover-foreground shadow-md py-1"
          >
            <div
              v-for="model in group.models"
              :key="model.name"
              class="px-3 py-1.5 text-sm cursor-pointer hover:bg-accent"
              :class="modelValue?.model === model.name && modelValue?.provider_id === group.provider.id
                ? 'bg-accent' : ''"
              @click.stop="selectModel(group.provider.id, model.name)"
            >
              <div class="flex items-center justify-between">
                <span>{{ model.name }}</span>
                <span class="text-xs text-muted-foreground ml-2">{{ formatContextWindow(model.contextWindow) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
```

### Step 2: 验证组件可导入

确认 `@vueuse/core` 已安装（项目应已依赖）。运行 `cd frontend && npx vue-tsc --noEmit`。

### Step 3: Commit

```bash
git add frontend/src/components/mappings/CascadingModelSelect.vue
git commit -m "feat: add CascadingModelSelect component"
```

---

## Task 7: 重构 MappingGroupFormDialog

**Files:**
- Modify: `frontend/src/components/mappings/MappingGroupFormDialog.vue`
- Modify: `frontend/src/views/ModelMappings.vue`（传递 providerGroups prop）

### Step 1: 准备 providerGroups 数据

在 `ModelMappings.vue` 中构建 CascadingModelSelect 需要的 `ProviderGroup[]` 数据：

```typescript
// frontend/src/views/ModelMappings.vue — 新增 computed
import type { ProviderGroup } from '@/components/mappings/cascading-types'

const providerGroups = computed<ProviderGroup[]>(() =>
  providers.value.map(p => ({
    provider: { id: p.id, name: p.name },
    models: (p.models ?? []).map(m => ({
      name: m.name,
      contextWindow: m.context_window ?? 200000,
    })),
  }))
)
```

将 `providerGroups` 作为 prop 传递给 `MappingGroupFormDialog`。

同时构建 `contextWindowMap` 供溢出过滤使用：

```typescript
const contextWindowMap = computed(() => {
  const map = new Map<string, number>()
  for (const p of providers.value) {
    for (const m of p.models ?? []) {
      if (m.context_window != null) {
        map.set(`${p.id}:${m.name}`, m.context_window)
      }
    }
  }
  return map
})
```

将 `providerGroups` 和 `contextWindowMap` 都作为 prop 传递给 `MappingGroupFormDialog`。

### Step 2: 重构 dialog 模板

在 `MappingGroupFormDialog.vue` 中：

**Props 新增：**
```typescript
providerGroups: ProviderGroup[]
contextWindowMap: Map<string, number>  // provider_id:model -> context_window
```

**替换默认目标的供应商+模型选择（scheduled 策略）：**

将两个独立 `<Select>` 替换为：

```vue
<!-- 默认模型 -->
<div class="flex-1">
  <div class="text-xs text-muted-foreground mb-1">默认模型</div>
  <CascadingModelSelect
    :providers="providerGroups"
    :model-value="{ provider_id: form.default.provider_id, model: form.default.backend_model }"
    placeholder="选择模型..."
    @update:model-value="onDefaultModelSelect"
  />
</div>

<!-- 1M 模型（可选） -->
<div class="flex-1">
  <div class="text-xs text-muted-foreground mb-1 flex items-center gap-1">
    1M 模型（可选）
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="inline-flex items-center justify-center w-3.5 h-3.5
            rounded-full bg-muted text-muted-foreground text-[9px]">?</span>
        </TooltipTrigger>
        <TooltipContent>上下文超过默认模型限制时自动切换到此模型</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
  <CascadingModelSelect
    :providers="overflowProviderGroups"
    :model-value="form.default.overflow_provider_id
      ? { provider_id: form.default.overflow_provider_id, model: form.default.overflow_model }
      : undefined"
    placeholder="点击选择模型..."
    @update:model-value="onDefaultOverflowSelect"
  />
</div>
```

**新增 computed：**

```typescript
// 获取默认模型的 context window
const defaultContextWindow = computed(() => {
  const key = `${form.default.provider_id}:${form.default.backend_model}`
  return contextWindowMap.get(key) ?? 200000
})

// 溢出模型下拉：仅列出 context_window >= 默认模型的选项
const overflowProviderGroups = computed(() =>
  props.providerGroups.map(g => ({
    ...g,
    models: g.models.filter(m => m.contextWindow >= defaultContextWindow.value),
  })).filter(g => g.models.length > 0)
)

// 溢出提示文字
const overflowHint = computed(() => {
  if (!form.default.overflow_provider_id || !form.default.overflow_model) return ''
  if (defaultContextWindow.value >= 1000000) return ''
  const cw = defaultContextWindow.value >= 1000
    ? `${defaultContextWindow.value / 1000}K`
    : `${defaultContextWindow.value}`
  return `上下文超过 ${form.default.backend_model} 限制 (${cw}) 时自动切换到 ${form.default.overflow_model}`
})
```

**新增 handler：**

```typescript
function onDefaultModelSelect(val: { provider_id: string; model: string }) {
  form.default.provider_id = val.provider_id
  form.default.backend_model = val.model
}

function onDefaultOverflowSelect(val: { provider_id: string; model: string } | undefined) {
  if (val) {
    form.default.overflow_provider_id = val.provider_id
    form.default.overflow_model = val.model
  } else {
    form.default.overflow_provider_id = undefined
    form.default.overflow_model = undefined
  }
}
```

### Step 3: 对其他策略（round-robin/random/failover）的 target 做相同改造

每个 target card 使用相同的双 CascadingModelSelect 布局（默认模型 + 可选溢出模型）。

### Step 4: 更新 validation

在 `validate()` 中，overflow 字段不强制校验（可选）。但若 `overflow_provider_id` 存在则 `overflow_model` 也必须存在，反之亦然。

### Step 5: 验证

Run: `cd frontend && npm run build`
Expected: 构建成功

### Step 6: Commit

```bash
git add frontend/src/components/mappings/MappingGroupFormDialog.vue frontend/src/views/ModelMappings.vue
git commit -m "feat: integrate CascadingModelSelect and overflow model fields in mapping dialog"
```

---

## Task 8: 前端清理

**Files:**
- Delete: `frontend/src/components/proxy-enhancement/ContextCompact.vue`
- Modify: `frontend/src/views/ProxyEnhancement.vue`
- Modify: `frontend/src/api/client.ts`

### Step 1: 删除 ContextCompact.vue

```bash
rm frontend/src/components/proxy-enhancement/ContextCompact.vue
```

### Step 2: 清理 ProxyEnhancement.vue

移除 ContextCompact 导入和对应的 `<TabsContent value="context-compact">` tab。

```vue
<!-- 删除 -->
<TabsContent value="context-compact">
  <ContextCompact />
</TabsContent>
```

```typescript
// 删除导入
// import ContextCompact from '@/components/proxy-enhancement/ContextCompact.vue'
```

### Step 3: 清理 client.ts

移除 compact 相关类型和 API 方法：

```typescript
// 删除 CompactModelEntry 接口
// 删除 ProxyEnhancementConfig 中的 compact 字段
// 简化为：
export interface ProxyEnhancementConfig {
  claude_code_enabled: boolean
}
```

移除 `getCompactModels` API 方法（如果存在于 `api` 对象中）。

### Step 4: 验证构建

Run: `cd frontend && npm run build`
Expected: 构建成功

### Step 5: 全量验证

Run: `npm test && npm run lint && cd frontend && npm run build`
Expected: 全部通过

### Step 6: Commit

```bash
git add -A
git commit -m "refactor: remove ContextCompact and clean up compact-related frontend code"
```
