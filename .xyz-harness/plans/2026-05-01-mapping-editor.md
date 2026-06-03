# Quick Setup 映射增强：已有映射展示 + 故障转移/溢出编辑

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在快速配置页的模型映射区域，加载并展示已有映射（含故障转移链和溢出模型），支持行内编辑目标、添加故障转移、设置溢出模型，统一保存时区分新增和修改。

**Architecture:** 
- composable 扩展：onMounted 并发加载已有映射组 + 所有供应商列表，合并到映射展示数据中
- 重写 MappingPreview 组件为 MappingEditor，每行展开显示完整目标链
- 复用 ModelMappings 页面的 CascadingModelSelect 组件做供应商+模型选择
- submit 时：新映射走 quick-setup API，已有映射调 updateMappingGroup API

**Tech Stack:** Vue 3 + TypeScript + shadcn-vue 组件库

---

## File Structure

```
frontend/src/
├── components/quick-setup/
│   ├── types.ts                    # MODIFY: 新增 MappingEntry 类型
│   ├── MappingEditor.vue           # CREATE: 替代 MappingPreview.vue，行内展开编辑
│   └── MappingPreview.vue          # DELETE: 被 MappingEditor.vue 替代
├── composables/useQuickSetup.ts    # MODIFY: 加载已有映射、供应商列表、保存逻辑
├── views/QuickSetup.vue            # MODIFY: 替换 MappingPreview → MappingEditor
└── components/mappings/
    └── CascadingModelSelect.vue    # READ-ONLY: 复用现有级联选择组件
```

---

### Task 1: 扩展 types.ts — 新增映射条目类型

**Files:**
- Modify: `frontend/src/components/quick-setup/types.ts`

- [ ] **Step 1: 添加映射相关类型定义**

在 `types.ts` 末尾追加：

```typescript
/** 映射目标（与后端 MappingTarget 对齐） */
export interface MappingTarget {
  backend_model: string
  provider_id: string
  overflow_provider_id?: string
  overflow_model?: string
}

/** 映射条目：合并了新建映射和已有映射的统一结构 */
export interface MappingEntry {
  /** 客户端模型名 */
  clientModel: string
  /** 映射目标链（故障转移） */
  targets: MappingTarget[]
  /** 是否为已有映射（来自 DB） */
  existing: boolean
  /** 已有映射的 DB id，用于 updateMappingGroup */
  existingId?: string
  /** 来源标签 */
  tag: 'def' | 'auto' | 'cust' | 'existing'
}
```

- [ ] **Step 2: 验证 typecheck 通过**

Run: `cd frontend && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/quick-setup/types.ts
git commit -m "feat(quick-setup): add MappingEntry and MappingTarget types"
```

---

### Task 2: 扩展 composable — 加载已有映射和供应商列表

**Files:**
- Modify: `frontend/src/composables/useQuickSetup.ts`

- [ ] **Step 1: 导入新类型和 API**

在文件顶部 import 中添加：

```typescript
import { api, getApiMessage, type ProviderGroup, type RecommendedRetryRule, type QuickSetupPayload, type MappingGroup, type Provider } from '@/api/client'
import {
  type ClientType, type ModelConfig, type MappingEntry, type MappingTarget,
  CLIENTS, DEFAULT_CLIENT_MAPPINGS, getDefaultContextWindow,
} from '@/components/quick-setup/types'
import type { MappingTarget as ApiMappingTarget, Rule } from '@/types/mapping'
```

- [ ] **Step 2: 替换 mappingPreview 为 mappingEntries**

将 `mappingPreview` ref 的类型从 `MappingPreviewItem[]` 改为 `MappingEntry[]`：

```typescript
const mappingEntries = ref<MappingEntry[]>([])
```

删除旧的 `MappingPreviewItem` import（已在 Step 1 替换）。

- [ ] **Step 3: 添加已有映射和供应商的 state**

```typescript
const existingMappings = ref<MappingGroup[]>([])
const allProviders = ref<Provider[]>([])
```

- [ ] **Step 4: 重写 updateMappings 函数**

替换原 `updateMappings()`，合并已有映射和新推荐映射：

```typescript
function updateMappings() {
  const enabledModels = modelConfigs.value.filter(m => m.enabled)

  // 构建新的推荐映射
  let newMappings: MappingEntry[]
  if (clientType.value === 'pi') {
    newMappings = enabledModels.map(m => ({
      clientModel: m.name,
      targets: [{ backend_model: m.name, provider_id: '__new__' }],
      existing: false,
      tag: 'auto' as const,
    }))
  } else {
    const clientDefaults = DEFAULT_CLIENT_MAPPINGS[clientType.value]
    if (clientDefaults && enabledModels.length > 0) {
      newMappings = clientDefaults.map((fromName, index) => ({
        clientModel: fromName,
        targets: [{
          backend_model: enabledModels[index]?.name ?? enabledModels[enabledModels.length - 1]?.name ?? '',
          provider_id: '__new__',
        }],
        existing: false,
        tag: 'def' as const,
      }))
    } else {
      newMappings = enabledModels.map(m => ({
        clientModel: m.name,
        targets: [{ backend_model: m.name, provider_id: '__new__' }],
        existing: false,
        tag: 'auto' as const,
      }))
    }
  }

  // 合并：如果已有映射中包含同名的客户端模型，用已有映射替换
  const existingMap = new Map<string, MappingEntry>()
  for (const g of existingMappings.value) {
    let rule: Rule = {}
    try { rule = JSON.parse(g.rule) } catch { /* ignore */ }
    const targets = rule.targets ?? []
    if (targets.length > 0) {
      existingMap.set(g.client_model, {
        clientModel: g.client_model,
        targets: targets.map(t => ({
          backend_model: t.backend_model,
          provider_id: t.provider_id,
          overflow_provider_id: t.overflow_provider_id,
          overflow_model: t.overflow_model,
        })),
        existing: true,
        existingId: g.id,
        tag: 'existing' as const,
      })
    }
  }

  // 先放已有映射（同名覆盖新推荐），再放新推荐的
  const merged = newMappings.map(nm => existingMap.get(nm.clientModel) ?? nm)
  // 再追加已有映射中不在新推荐里的
  for (const [_, em] of existingMap) {
    if (!merged.find(m => m.clientModel === em.clientModel)) {
      merged.push(em)
    }
  }

  mappingEntries.value = merged
}
```

- [ ] **Step 5: 添加映射编辑函数**

```typescript
/** 更新某个映射条目的目标链 */
function updateMappingTargets(index: number, targets: MappingTarget[]) {
  const next = [...mappingEntries.value]
  next[index] = { ...next[index], targets }
  mappingEntries.value = next
}

/** 添加新映射 */
function addMappingEntry(clientModel: string, targetModel: string) {
  const existing = mappingEntries.value.filter(m => m.clientModel !== clientModel)
  existing.push({
    clientModel,
    targets: [{ backend_model: targetModel, provider_id: '__new__' }],
    existing: false,
    tag: 'cust' as const,
  })
  mappingEntries.value = existing
}

/** 删除映射（仅删除新映射，已有映射提示去映射页面删除） */
function removeMappingEntry(clientModel: string) {
  const entry = mappingEntries.value.find(m => m.clientModel === clientModel)
  if (entry?.existing) {
    toast.error('已有映射请到"模型映射"页面删除')
    return
  }
  mappingEntries.value = mappingEntries.value.filter(m => m.clientModel !== clientModel)
}
```

- [ ] **Step 6: 重写 submit 函数**

替换原 `submit()` 中的 mappings 和 retry_rules 部分：

```typescript
async function submit() {
  if (!currentPreset.value) {
    toast.error('请选择供应商和套餐')
    return
  }
  if (!apiKey.value.trim()) {
    toast.error('请填写 API Key')
    return
  }

  saving.value = true
  try {
    // 1. 创建供应商
    const payload: QuickSetupPayload = {
      provider: {
        name: selectedGroup.value.toLowerCase().replace(/\s+/g, '-'),
        api_type: apiType.value,
        base_url: baseUrl.value,
        api_key: apiKey.value.trim(),
        models: modelConfigs.value.map(m => ({
          name: m.name,
          context_window: m.contextWindow,
          patches: m.patches.length > 0 ? m.patches : undefined,
        })),
        concurrency_mode: concurrencyMode.value,
        max_concurrency: concurrencyMode.value !== 'none' ? maxConcurrency.value : undefined,
        queue_timeout_ms: concurrencyMode.value !== 'none' ? queueTimeoutMs.value : undefined,
        max_queue_size: concurrencyMode.value !== 'none' ? maxQueueSize.value : undefined,
      },
      mappings: mappingEntries.value
        .filter(m => !m.existing)
        .map(m => ({
          client_model: m.clientModel,
          backend_model: m.targets[0]?.backend_model ?? '',
        })),
      retry_rules: recommendedRules.value
        .filter(r => selectedRetryRules.value.has(r.name) && !r.exists)
        .map(r => ({
          name: r.name,
          status_code: r.status_code,
          body_pattern: r.body_pattern,
          retry_strategy: r.retry_strategy,
          retry_delay_ms: r.retry_delay_ms,
          max_retries: r.max_retries,
          max_delay_ms: r.max_delay_ms,
        })),
    }

    await api.quickSetup(payload)

    // 2. 更新已有映射（故障转移/溢出变更）
    for (const entry of mappingEntries.value) {
      if (entry.existing && entry.existingId) {
        const ruleJson = JSON.stringify({ targets: entry.targets })
        await api.updateMappingGroup(entry.existingId, {
          client_model: entry.clientModel,
          rule: ruleJson,
        })
      }
    }

    toast.success('快速配置完成！')
    router.push('/')
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '快速配置失败'))
  } finally {
    saving.value = false
  }
}
```

- [ ] **Step 7: 修改 onMounted 加载已有映射和供应商**

```typescript
onMounted(async () => {
  try {
    const [groups, rules, mappings, providers] = await Promise.all([
      api.recommended.getProviders(),
      api.recommended.getRetryRules(),
      api.getMappingGroups().catch(() => [] as MappingGroup[]),
      api.getProviders().catch(() => [] as Provider[]),
    ])
    providerGroups.value = groups
    allRecommendedRules.value = rules
    existingMappings.value = mappings as MappingGroup[]
    allProviders.value = providers as Provider[]

    selectClient('claude-code')
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '加载推荐配置失败'))
  }
})
```

- [ ] **Step 8: 更新 return 对象**

删除旧的 `mappingPreview`, `addMapping`, `removeMapping`, `updateMappings`。
添加新的：

```typescript
return {
  clientType, providerGroups, selectedGroup, selectedPlan,
  apiType, apiKey, modelConfigs, mappingEntries,
  allRecommendedRules, recommendedRules,
  selectedRetryRules, saving, connectionStatus,
  currentClient, currentPreset, baseUrl,
  availablePlans, isNonOpenaiEndpoint,
  concurrencyMode, maxConcurrency, queueTimeoutMs, maxQueueSize,
  existingMappings, allProviders,
  selectClient, onProviderChange, onPlanChange,
  initModels, getDefaultPatches, updateMappings,
  updateMappingTargets, addMappingEntry, removeMappingEntry,
  toggleRetryRule, onConcurrencyModeChange, testConnection, submit,
}
```

- [ ] **Step 9: 验证 typecheck**

Run: `cd frontend && npm run typecheck`

Expected: PASS（可能有 QuickSetup.vue 的引用错误，在 Task 3 修复）

- [ ] **Step 10: Commit**

```bash
git add frontend/src/composables/useQuickSetup.ts
git commit -m "feat(quick-setup): load existing mappings + providers, merge with recommended mappings"
```

---

### Task 3: 创建 MappingEditor.vue — 行内展开编辑组件

**Files:**
- Create: `frontend/src/components/quick-setup/MappingEditor.vue`

- [ ] **Step 1: 创建 MappingEditor.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { MappingEntry, MappingTarget } from './types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, ArrowRight, Plus, ChevronDown, Trash2 } from 'lucide-vue-next'
import CascadingModelSelect from '@/components/mappings/CascadingModelSelect.vue'
import type { ProviderGroup } from '@/components/mappings/cascading-types'
import type { SelectedValue } from '@/components/mappings/cascading-types'

const props = defineProps<{
  entries: MappingEntry[]
  providerGroups: ProviderGroup[]
}>()

const emit = defineEmits<{
  'update:targets': [index: number, targets: MappingTarget[]]
  'add': [clientModel: string, targetModel: string]
  'remove': [clientModel: string]
}>()

const newFrom = ref('')
const newTo = ref('')

const expandedEntries = ref<Set<string>>(new Set())

function toggleExpand(clientModel: string) {
  const next = new Set(expandedEntries.value)
  if (next.has(clientModel)) {
    next.delete(clientModel)
  } else {
    next.add(clientModel)
  }
  expandedEntries.value = next
}

function isExpanded(clientModel: string): boolean {
  return expandedEntries.value.has(clientModel)
}

function addTarget(index: number) {
  const entry = props.entries[index]
  if (!entry) return
  const firstProvider = props.providerGroups[0]
  const firstModel = firstProvider?.models[0]?.name ?? ''
  const providerId = firstProvider?.provider.id ?? ''
  const newTargets = [...entry.targets, { backend_model: firstModel, provider_id: providerId }]
  emit('update:targets', index, newTargets)
}

function removeTarget(entryIndex: number, targetIndex: number) {
  const entry = props.entries[entryIndex]
  if (!entry) return
  const newTargets = entry.targets.filter((_, i) => i !== targetIndex)
  emit('update:targets', entryIndex, newTargets)
}

function updateTargetProvider(entryIndex: number, targetIndex: number, val: SelectedValue) {
  const entry = props.entries[entryIndex]
  if (!entry) return
  const newTargets = [...entry.targets]
  newTargets[targetIndex] = {
    ...newTargets[targetIndex],
    provider_id: val.provider_id,
    backend_model: val.model,
  }
  emit('update:targets', entryIndex, newTargets)
}

function updateOverflow(entryIndex: number, targetIndex: number, val: SelectedValue | undefined) {
  const entry = props.entries[entryIndex]
  if (!entry) return
  const newTargets = [...entry.targets]
  if (val) {
    newTargets[targetIndex] = {
      ...newTargets[targetIndex],
      overflow_provider_id: val.provider_id,
      overflow_model: val.model,
    }
  } else {
    const { overflow_provider_id, overflow_model, ...rest } = newTargets[targetIndex]
    newTargets[targetIndex] = rest as MappingTarget
  }
  emit('update:targets', entryIndex, newTargets)
}

function canAdd(): boolean {
  return newFrom.value.trim().length > 0 && newTo.value.trim().length > 0
}

function addMapping() {
  const from = newFrom.value.trim()
  const to = newTo.value.trim()
  if (from && to) {
    emit('add', from, to)
    newFrom.value = ''
    newTo.value = ''
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && canAdd()) {
    e.preventDefault()
    addMapping()
  }
}

const tagLabels: Record<string, string> = {
  def: '默认',
  auto: '自动',
  cust: '自定义',
  existing: '已有',
}

const tagColors: Record<string, string> = {
  def: 'outline',
  auto: 'secondary',
  cust: 'default',
  existing: 'default',
}
</script>

<template>
  <div class="space-y-1">
    <!-- Mapping entries -->
    <div
      v-for="(entry, idx) in entries"
      :key="entry.clientModel"
      class="rounded-md border border-border"
      :class="entry.existing ? 'bg-primary/5 border-primary/20' : 'bg-card'"
    >
      <!-- Header row -->
      <div
        class="flex items-center gap-2 px-2.5 py-2 cursor-pointer select-none"
        @click="toggleExpand(entry.clientModel)"
      >
        <!-- Client model name -->
        <span class="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">
          {{ entry.clientModel }}
        </span>

        <Badge
          :variant="(tagColors[entry.tag] as 'outline' | 'secondary' | 'default') || 'outline'"
          class="shrink-0 text-[9px] px-1.5 py-0"
          :class="entry.tag === 'existing' ? 'bg-green-600 text-white hover:bg-green-600' : ''"
        >
          {{ tagLabels[entry.tag] || entry.tag }}
        </Badge>

        <!-- Target summary -->
        <span class="text-xs text-muted-foreground shrink-0">
          → {{ entry.targets[0]?.backend_model ?? '?' }}
        </span>

        <!-- Failover badge -->
        <Badge
          v-if="entry.targets.length > 1"
          variant="outline"
          class="shrink-0 text-[9px] px-1 py-0 border-orange-400 text-orange-500"
        >
          {{ entry.targets.length }}级
        </Badge>

        <!-- Overflow badge -->
        <Badge
          v-if="entry.targets[0]?.overflow_model"
          variant="outline"
          class="shrink-0 text-[9px] px-1 py-0 border-blue-400 text-blue-500"
        >
          溢出
        </Badge>

        <!-- Expand chevron -->
        <ChevronDown
          class="size-3.5 shrink-0 text-muted-foreground transition-transform"
          :class="isExpanded(entry.clientModel) ? 'rotate-0' : '-rotate-90'"
        />

        <!-- Delete (only new mappings) -->
        <Button
          v-if="!entry.existing"
          variant="ghost"
          size="icon-xs"
          class="shrink-0 text-muted-foreground hover:text-destructive"
          @click.stop="emit('remove', entry.clientModel)"
        >
          <X class="size-3" />
        </Button>
      </div>

      <!-- Expanded detail -->
      <div v-if="isExpanded(entry.clientModel)" class="border-t px-3 py-2 space-y-2">
        <div
          v-for="(target, tIdx) in entry.targets"
          :key="tIdx"
          class="space-y-1.5"
        >
          <!-- Target label -->
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-medium shrink-0" :class="tIdx === 0 ? 'text-primary' : 'text-muted-foreground'">
              {{ tIdx === 0 ? '首选' : `备${tIdx}` }}
            </span>

            <!-- Provider + Model select -->
            <div class="flex-1">
              <CascadingModelSelect
                :providers="providerGroups"
                :model-value="{ provider_id: target.provider_id, model: target.backend_model }"
                placeholder="选择模型..."
                @update:model-value="(v: SelectedValue) => updateTargetProvider(idx, tIdx, v)"
              />
            </div>

            <!-- Remove target (keep at least 1) -->
            <Button
              v-if="entry.targets.length > 1"
              variant="ghost"
              size="icon-xs"
              class="shrink-0 text-muted-foreground hover:text-destructive"
              @click="removeTarget(idx, tIdx)"
            >
              <Trash2 class="size-3" />
            </Button>
          </div>

          <!-- Overflow model (shared for all targets) -->
          <div class="flex items-center gap-2 pt-2 mt-2 border-t border-border">
            <span class="text-[10px] text-muted-foreground shrink-0">溢出模型</span>
            <div class="flex-1">
              <CascadingModelSelect
                :providers="providerGroups"
                :model-value="entry.targets[0]?.overflow_provider_id && entry.targets[0]?.overflow_model ? { provider_id: entry.targets[0].overflow_provider_id, model: entry.targets[0].overflow_model } : undefined"
                placeholder="可选，上下文超限时自动切换..."
                @update:model-value="(v: SelectedValue | undefined) => updateOverflow(idx, 0, v)"
              />
            </div>
          </div>

          <!-- Add failover target -->
        <Button
          variant="ghost"
          size="sm"
          class="w-full text-xs text-muted-foreground"
          @click="addTarget(idx)"
        >
          <Plus class="w-3 h-3 mr-1" />
          添加故障转移
        </Button>
      </div>
    </div>

    <!-- Empty state -->
    <p v-if="entries.length === 0" class="py-3 text-center text-xs text-muted-foreground">
      暂无映射
    </p>

    <!-- Add new mapping -->
    <div class="flex items-center gap-2 pt-2 border-t mt-2">
      <Input
        v-model="newFrom"
        placeholder="客户端模型"
        class="h-8 flex-1 text-xs font-mono"
        @keydown="handleKeydown"
      />
      <ArrowRight class="size-3 shrink-0 text-muted-foreground" />
      <Input
        v-model="newTo"
        placeholder="目标模型"
        class="h-8 flex-1 text-xs font-mono"
        @keydown="handleKeydown"
      />
      <Button
        size="sm"
        variant="outline"
        class="h-8 shrink-0"
        :disabled="!canAdd()"
        @click="addMapping"
      >
        添加
      </Button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 验证 typecheck**

Run: `cd frontend && npm run typecheck`

如果 CascadingModelSelect 的 import 有问题，检查路径 `@/components/mappings/CascadingModelSelect.vue` 和 `cascading-types.ts` 是否存在：

```bash
ls frontend/src/components/mappings/CascadingModelSelect.vue
ls frontend/src/components/mappings/cascading-types.ts
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/quick-setup/MappingEditor.vue
git commit -m "feat(quick-setup): create MappingEditor with inline failover/overflow editing"
```

---

### Task 4: 更新 QuickSetup.vue — 接入 MappingEditor

**Files:**
- Modify: `frontend/src/views/QuickSetup.vue`

- [ ] **Step 1: 替换 import 和组件引用**

将 `import MappingPreview` 替换为：

```typescript
import MappingEditor from '@/components/quick-setup/MappingEditor.vue'
```

删除不再需要的 `Badge` 相关 import（如果 MappingEditor 内部已使用）。

- [ ] **Step 2: 替换 template 中的 MappingPreview 为 MappingEditor**

找到模型映射区域的 `<MappingPreview` 标签，替换为：

```html
<MappingEditor
  :entries="mappingEntries"
  :provider-groups="allProviderGroups"
  @update:targets="updateMappingTargets"
  @add="addMappingEntry"
  @remove="removeMappingEntry"
/>
```

- [ ] **Step 3: 添加 allProviderGroups computed**

在 script 中添加，将 allProviders 转为 CascadingModelSelect 需要的格式：

```typescript
import type { ProviderGroup as CascadingProviderGroup } from '@/components/mappings/cascading-types'

const allProviderGroups = computed<CascadingProviderGroup[]>(() =>
  allProviders.value.map(p => ({
    provider: { id: p.id, name: p.name },
    models: (p.models ?? []).map(m => ({
      name: m.name,
      contextWindow: m.context_window ?? 128000,
    })),
  }))
)
```

- [ ] **Step 4: 更新解构**

将 composable 解构中的 `mappingPreview, addMapping, removeMapping` 替换为：

```typescript
const {
  clientType, providerGroups, selectedGroup, selectedPlan,
  apiType, apiKey, modelConfigs, mappingEntries,
  allRecommendedRules, recommendedRules,
  selectedRetryRules, saving, connectionStatus,
  baseUrl, availablePlans, isNonOpenaiEndpoint,
  concurrencyMode, maxConcurrency, queueTimeoutMs, maxQueueSize,
  allProviders,
  selectClient, onProviderChange, onPlanChange,
  updateMappingTargets, addMappingEntry, removeMappingEntry,
  toggleRetryRule, onConcurrencyModeChange, testConnection, submit,
} = useQuickSetup()
```

- [ ] **Step 5: 更新底栏统计**

将 `mappingPreview.length` 替换为 `mappingEntries.length`：

```typescript
const enabledModelCount = computed(() => modelConfigs.value.filter(m => m.enabled).length)
const enabledModelNames = computed(() => modelConfigs.value.filter(m => m.enabled).map(m => m.name))
const clientTypeLabel = computed(() => CLIENTS.find(c => c.id === clientType.value)?.name ?? clientType.value)
```

底栏 template 中的 `mappingPreview.length` → `mappingEntries.length`。

- [ ] **Step 6: 验证 typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/QuickSetup.vue
git commit -m "feat(quick-setup): wire MappingEditor with failover/overflow support"
```

---

### Task 5: 删除旧 MappingPreview.vue

**Files:**
- Delete: `frontend/src/components/quick-setup/MappingPreview.vue`

- [ ] **Step 1: 确认没有其他引用**

```bash
grep -rn "MappingPreview" frontend/src/ --include="*.vue" --include="*.ts"
```

Expected: 无引用（只有已删除的 import）

- [ ] **Step 2: 删除文件**

```bash
git rm frontend/src/components/quick-setup/MappingPreview.vue
```

- [ ] **Step 3: 验证 typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(quick-setup): remove old MappingPreview component"
```

---

### Task 6: 端到端验证

- [ ] **Step 1: 验证 typecheck 全量通过**

Run: `cd frontend && npm run typecheck`
Expected: PASS

- [ ] **Step 2: 验证后端 typecheck**

Run: `cd /path/to/project && npx tsc --noEmit --skipLibCheck`
Expected: PASS

- [ ] **Step 3: 浏览器验证清单**

打开快速配置页，逐项验证：

1. ✅ 选择客户端后，映射区域显示推荐的客户端模型名
2. ✅ 如果某个客户端模型在 DB 中已有映射，显示绿色"已有"标签
3. ✅ 点击某行展开，显示完整目标链（首选/备选）
4. ✅ 已有映射的目标链正确展示（含故障转移和溢出）
5. ✅ 可通过 CascadingModelSelect 修改目标模型
6. ✅ 可点击"添加故障转移"增加备选目标
7. ✅ 可设置溢出模型
8. ✅ 底部可添加新映射（客户端模型 → 目标模型）
9. ✅ 新映射可删除，已有映射不可删除（提示去映射页面）
10. ✅ 点"保存配置"后，新映射走 quick-setup，已有映射走 updateMappingGroup
