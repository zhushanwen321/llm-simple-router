# 模型映射页面优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构模型映射页面的交互体验——去掉全局编辑按钮，改为展开式就地编辑+单条保存，故障转移链改为垂直管线展示，组件拆分为原子组件+两个专用容器。

**Architecture:** 新建 `MappingEntryEditor.vue` 作为单条映射的原子展示/编辑组件。`ModelMappingCard.vue` 包装它用于模型映射页（含独立保存）。`QuickSetupMappingList.vue` 包装它用于快速配置页（草稿模式）。精简 `ModelMappings.vue` 页面，删除批量编辑逻辑。

**Tech Stack:** Vue 3 (Composition API), TypeScript, vue-i18n, lucide-vue-next, vue-sonner (toast)

---

## File Structure

### Create
| File | Responsibility |
|------|---------------|
| `frontend/src/components/mappings/MappingEntryEditor.vue` | 原子组件：单条映射的垂直管线展示 + 展开/折叠编辑 |
| `frontend/src/components/mappings/ModelMappingCard.vue` | 模型映射页容器：包装 Editor + 单条保存/删除/启禁 |
| `frontend/src/components/shared/QuickSetupMappingList.vue` | 快速配置容器：包装 Editor 列表 + 草稿模式 |

### Modify
| File | Change |
|------|--------|
| `frontend/src/views/ModelMappings.vue` | 精简为纯列表容器，用 ModelMappingCard 替代 MappingList |
| `frontend/src/views/QuickSetup.vue` | import 从 shared/MappingList 改为 shared/QuickSetupMappingList |

### Delete
| File | Reason |
|------|--------|
| `frontend/src/components/mappings/MappingGroupFormDialog.vue` | 旧弹窗编辑器，不再使用 |
| `frontend/src/components/mappings/MappingEditor.vue` | 冗余列表组件 |
| `frontend/src/components/shared/MappingList.vue` | 被 QuickSetupMappingList 替代 |

### Keep unchanged
| File | Note |
|------|------|
| `frontend/src/components/mappings/CascadingModelSelect.vue` | 继续复用 |
| `frontend/src/components/mappings/cascading-types.ts` | 继续复用 |
| `frontend/src/components/quick-setup/types.ts` | MappingEntry / MappingTarget 类型继续复用 |

---

### Task 1: Create MappingEntryEditor (原子组件)

**Files:**
- Create: `frontend/src/components/mappings/MappingEntryEditor.vue`

- [ ] **Step 1: Create the component with collapsed state rendering**

Create `MappingEntryEditor.vue` with the vertical pipeline display for collapsed state:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import CascadingModelSelect from '@/components/mappings/CascadingModelSelect.vue'
import type { MappingTarget, MappingEntry } from '@/components/quick-setup/types'
import type { ProviderGroup, SelectedValue } from '@/components/mappings/cascading-types'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  entry: MappingEntry
  providerGroups: ProviderGroup[]
  expanded: boolean
  editable: boolean
}>(), {
  editable: true,
})

const emit = defineEmits<{
  'update:targets': [targets: MappingTarget[]]
  'toggle:expand': []
}>()

function providerName(providerId: string): string {
  return props.providerGroups.find(p => p.provider.id === providerId)?.provider.name ?? providerId.slice(0, 6)
}

function addTarget() {
  const firstProvider = props.providerGroups[0]
  const newTargets = [...props.entry.targets, {
    backend_model: firstProvider?.models[0]?.name ?? '',
    provider_id: firstProvider?.provider.id ?? '',
  }]
  emit('update:targets', newTargets)
}

function removeTarget(index: number) {
  if (props.entry.targets.length <= 1) return
  emit('update:targets', props.entry.targets.filter((_: MappingTarget, i: number) => i !== index))
}

function updateTargetProvider(targetIndex: number, val: SelectedValue) {
  const newTargets = [...props.entry.targets]
  newTargets[targetIndex] = { ...newTargets[targetIndex], provider_id: val.provider_id, backend_model: val.model }
  emit('update:targets', newTargets)
}

function updateOverflow(val: SelectedValue | undefined) {
  const newTargets = props.entry.targets.map((t: MappingTarget, i: number) => {
    if (i === 0) {
      if (val) {
        return { ...t, overflow_provider_id: val.provider_id, overflow_model: val.model }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { overflow_provider_id: _opid, overflow_model: _omod, ...rest } = t
        return rest as MappingTarget
      }
    }
    return t
  })
  emit('update:targets', newTargets)
}
</script>

<template>
  <div>
    <!-- Collapsed: Vertical Pipeline -->
    <div v-if="!expanded" class="flex items-start gap-3" @click="editable && emit('toggle:expand')">
      <!-- Client model -->
      <span class="min-w-[90px] font-mono text-sm font-semibold text-foreground shrink-0 truncate" :title="entry.clientModel">
        {{ entry.clientModel }}
      </span>

      <!-- Arrow -->
      <svg width="14" height="14" class="mt-0.5 shrink-0 text-muted-foreground/30">
        <line x1="0" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.5"/>
        <polyline points="8,3 12,7 8,11" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>

      <!-- Vertical Pipeline -->
      <div class="flex-1 flex flex-col gap-0 min-w-0">
        <div v-for="(target, tIdx) in entry.targets" :key="tIdx">
          <!-- Target node -->
          <div
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm"
            :class="tIdx === 0
              ? 'bg-primary/10 border border-primary/20 text-primary'
              : 'bg-muted/30 border border-border text-muted-foreground'"
          >
            <span class="text-[10px] font-semibold w-3.5 text-center" :class="tIdx === 0 ? 'text-primary' : 'text-muted-foreground'">
              {{ tIdx === 0 ? '①' : tIdx === 1 ? '②' : tIdx === 2 ? '③' : `${tIdx + 1}` }}
            </span>
            <span class="font-mono truncate">{{ target.backend_model }}</span>
            <span class="text-[10px] px-1 py-px rounded bg-muted/50 text-muted-foreground/50 ml-auto shrink-0">{{ providerName(target.provider_id) }}</span>
          </div>

          <!-- Connector between targets -->
          <div v-if="tIdx < entry.targets.length - 1" class="flex items-center gap-1 pl-5 py-0.5">
            <div class="w-px h-1.5 bg-orange-400/30"></div>
            <span class="text-[9px] text-orange-400/50">{{ t('providers.shared.switchOnFail') }}</span>
          </div>
        </div>

        <!-- Overflow -->
        <div v-if="entry.targets[0]?.overflow_model" class="flex items-center gap-1.5 mt-1 pt-1.5 border-t border-dashed border-primary/10">
          <span class="text-[10px] text-primary/40 w-3.5 text-center">⤵</span>
          <span class="text-[10px] text-primary/30">{{ t('providers.shared.overflow') }}</span>
          <span class="font-mono text-xs text-primary/50">{{ entry.targets[0].overflow_model }}</span>
        </div>
      </div>
    </div>

    <!-- Expanded: Editor -->
    <div v-else class="space-y-1.5">
      <div v-for="(target, tIdx) in entry.targets" :key="tIdx">
        <!-- Target row -->
        <div class="flex items-center gap-2">
          <span
            class="text-xs font-medium shrink-0 w-6 text-center px-1 py-0.5 rounded"
            :class="tIdx === 0 ? 'bg-primary/10 text-primary' : 'bg-muted/30 text-muted-foreground'"
          >
            {{ tIdx === 0 ? '①' : tIdx === 1 ? '②' : tIdx === 2 ? '③' : `${tIdx + 1}` }}
          </span>
          <div class="flex-1">
            <CascadingModelSelect
              :providers="providerGroups"
              :model-value="{ provider_id: target.provider_id, model: target.backend_model }"
              compact
              :placeholder="t('providers.shared.selectModel')"
              @update:model-value="(v: SelectedValue) => updateTargetProvider(tIdx, v)"
            />
          </div>
          <Button
            v-if="entry.targets.length > 1"
            variant="ghost"
            size="icon-xs"
            class="shrink-0 text-muted-foreground/40 hover:text-destructive"
            @click="removeTarget(tIdx)"
          >
            <Trash2 class="size-3" />
          </Button>
        </div>

        <!-- Connector -->
        <div v-if="tIdx < entry.targets.length - 1" class="flex items-center gap-1 pl-8 py-0.5">
          <div class="w-px h-1.5 bg-orange-400/30"></div>
          <span class="text-[9px] text-orange-400/50">{{ t('providers.shared.switchOnFail') }}</span>
        </div>
      </div>

      <!-- Overflow edit -->
      <div class="flex items-center gap-2 pt-2 mt-1 border-t border-dashed border-primary/15">
        <span class="text-[10px] w-6 text-center px-1 py-0.5 rounded bg-primary/10 text-primary/70 shrink-0">{{ t('providers.shared.overflow') }}</span>
        <div class="flex-1">
          <CascadingModelSelect
            :providers="providerGroups"
            :model-value="entry.targets[0]?.overflow_provider_id && entry.targets[0]?.overflow_model ? { provider_id: entry.targets[0].overflow_provider_id, model: entry.targets[0].overflow_model } : undefined"
            compact
            :placeholder="t('providers.shared.overflowPlaceholder')"
            @update:model-value="(v: SelectedValue | undefined) => updateOverflow(v)"
          />
        </div>
      </div>

      <!-- Add failover -->
      <Button variant="ghost" size="sm" class="w-full text-xs text-muted-foreground/50" @click="addTarget">
        <Plus class="w-3 h-3 mr-1" />
        {{ t('providers.shared.addFailover') }}
      </Button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/mappings/MappingEntryEditor.vue
git commit -m "feat: add MappingEntryEditor atomic component with vertical pipeline display"
```

---

### Task 2: Create ModelMappingCard (模型映射页容器)

**Files:**
- Create: `frontend/src/components/mappings/ModelMappingCard.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { api, getApiMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import MappingEntryEditor from '@/components/mappings/MappingEntryEditor.vue'
import type { MappingTarget, MappingEntry } from '@/components/quick-setup/types'
import type { ProviderGroup } from '@/components/mappings/cascading-types'

const { t } = useI18n()

const props = defineProps<{
  entry: MappingEntry
  providerGroups: ProviderGroup[]
}>()

const emit = defineEmits<{
  'saved': []
  'deleted': [clientModel: string]
}>()

const expanded = ref(false)
const localTargets = ref<MappingTarget[]>([])
const saving = ref(false)
const showDeleteConfirm = ref(false)

// When expanding, snapshot current targets as local edit copy
watch(expanded, (val) => {
  if (val) {
    localTargets.value = props.entry.targets.map(t => ({ ...t }))
  }
})

function getWorkingEntry(): MappingEntry {
  if (expanded.value) {
    return { ...props.entry, targets: localTargets.value }
  }
  return props.entry
}

function handleUpdateTargets(targets: MappingTarget[]) {
  localTargets.value = targets
}

async function handleSave() {
  saving.value = true
  try {
    const ruleJson = JSON.stringify({ targets: localTargets.value })
    if (props.entry.existingId) {
      await api.updateMappingGroup(props.entry.existingId, {
        client_model: props.entry.clientModel,
        rule: ruleJson,
      })
    } else {
      await api.createMappingGroup({ client_model: props.entry.clientModel, rule: ruleJson })
    }
    expanded.value = false
    emit('saved')
    toast.success(t('common.saveSuccess'))
  } catch (e: unknown) {
    toast.error(getApiMessage(e, t('mappings.messages.saveFailed')))
  } finally {
    saving.value = false
  }
}

function handleCancel() {
  expanded.value = false
}

async function handleToggleActive() {
  try {
    if (props.entry.existingId) {
      await api.toggleMappingGroup(props.entry.existingId)
    }
    emit('saved')
  } catch (e: unknown) {
    toast.error(getApiMessage(e, t('mappings.messages.toggleFailed')))
  }
}

function handleConfirmDelete() {
  showDeleteConfirm.value = false
  emit('deleted', props.entry.clientModel)
}
</script>

<template>
  <div
    class="rounded-lg border transition-colors"
    :class="expanded ? 'border-primary/30 shadow-sm shadow-primary/5' : 'border-border hover:border-border/80'"
  >
    <!-- Main row -->
    <div
      class="flex items-start gap-2 px-4 py-3"
      :class="{ 'cursor-pointer': !expanded }"
      @click="!expanded && (expanded = true)"
    >
      <!-- Editor (collapsed or expanded) -->
      <div class="flex-1 min-w-0">
        <MappingEntryEditor
          :entry="getWorkingEntry()"
          :provider-groups="providerGroups"
          :expanded="expanded"
          :editable="true"
          @update:targets="handleUpdateTargets"
        />
      </div>

      <!-- Right actions: always visible -->
      <div class="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
        <div class="flex items-center gap-2">
          <span v-if="entry.targets.length > 1" class="text-[10px] px-1.5 py-0.5 rounded border border-orange-400/30 text-orange-400/60">
            {{ t('providers.shared.level', { count: entry.targets.length }) }}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            class="text-muted-foreground/40 hover:text-destructive"
            @click.stop="showDeleteConfirm = true"
          >
            <svg class="size-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </Button>
          <Switch
            :model-value="entry.active"
            @update:model-value="handleToggleActive"
            class="scale-75"
            @click.stop
          />
        </div>
      </div>
    </div>

    <!-- Save bar (only when expanded) -->
    <div v-if="expanded" class="flex items-center justify-end gap-2 px-4 py-2 border-t border-border/50">
      <Button size="sm" variant="outline" @click="handleCancel">{{ t('common.cancel') }}</Button>
      <Button size="sm" :disabled="saving" @click="handleSave">
        {{ saving ? t('common.saving') : t('common.save') }}
      </Button>
    </div>
  </div>

  <!-- Delete confirm dialog -->
  <AlertDialog :open="showDeleteConfirm" @update:open="(val: boolean) => { if (!val) showDeleteConfirm = false }">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t('common.confirmDelete') }}</AlertDialogTitle>
        <AlertDialogDescription>{{ t('mappings.confirmDeleteDesc', { model: entry.clientModel }) }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
        <Button variant="destructive" @click="handleConfirmDelete">{{ t('common.delete') }}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/mappings/ModelMappingCard.vue
git commit -m "feat: add ModelMappingCard with inline expand-edit-save"
```

---

### Task 3: Create QuickSetupMappingList (快速配置容器)

**Files:**
- Create: `frontend/src/components/shared/QuickSetupMappingList.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ArrowRight } from 'lucide-vue-next'
import MappingEntryEditor from '@/components/mappings/MappingEntryEditor.vue'
import type { MappingTarget, MappingEntry } from '@/components/quick-setup/types'
import type { ProviderGroup, SelectedValue } from '@/components/mappings/cascading-types'

const { t } = useI18n()

const props = defineProps<{
  entries: MappingEntry[]
  providerGroups: ProviderGroup[]
}>()

const emit = defineEmits<{
  'update:targets': [index: number, targets: MappingTarget[]]
  'toggle-active': [index: number]
  'add': [clientModel: string, targetModel: string]
}>()

const expandedEntries = ref<Set<string>>(new Set())

function toggleExpand(clientModel: string) {
  const next = new Set(expandedEntries.value)
  if (next.has(clientModel)) next.delete(clientModel)
  else next.add(clientModel)
  expandedEntries.value = next
}

const newFrom = ref('')
const newTo = ref('')

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
</script>

<template>
  <div class="space-y-1.5">
    <div
      v-for="(entry, idx) in entries"
      :key="entry.clientModel"
      class="rounded-md border border-border"
    >
      <!-- Main row -->
      <div class="flex items-start gap-2 px-3 py-2">
        <!-- Editor -->
        <div class="flex-1 min-w-0 cursor-pointer" @click="toggleExpand(entry.clientModel)">
          <MappingEntryEditor
            :entry="entry"
            :provider-groups="providerGroups"
            :expanded="expandedEntries.has(entry.clientModel)"
            :editable="true"
            @update:targets="(targets: MappingTarget[]) => emit('update:targets', idx, targets)"
          />
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-1.5 shrink-0 pt-0.5">
          <Switch
            :model-value="entry.active"
            @update:model-value="emit('toggle-active', idx)"
            class="scale-75"
            @click.stop
          />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <p v-if="entries.length === 0" class="py-3 text-center text-xs text-muted-foreground">
      {{ t('providers.shared.noMappings') }}
    </p>

    <!-- Add new mapping -->
    <div class="flex items-center gap-2 pt-2 border-t mt-2">
      <Input v-model="newFrom" :placeholder="t('providers.shared.clientModel')" class="h-8 flex-1 text-xs font-mono" @keydown="handleKeydown" />
      <ArrowRight class="size-3 shrink-0 text-muted-foreground" />
      <Input v-model="newTo" :placeholder="t('providers.shared.targetModel')" class="h-8 flex-1 text-xs font-mono" @keydown="handleKeydown" />
      <Button size="sm" variant="outline" class="h-8 shrink-0" :disabled="!canAdd()" @click="addMapping">{{ t('providers.shared.add') }}</Button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/shared/QuickSetupMappingList.vue
git commit -m "feat: add QuickSetupMappingList for draft-mode mapping editor"
```

---

### Task 4: Refactor ModelMappings.vue (页面精简)

**Files:**
- Modify: `frontend/src/views/ModelMappings.vue`

- [ ] **Step 1: Rewrite ModelMappings.vue as a slim list container**

Replace the entire content of `ModelMappings.vue`. Remove: `editing`, `draftEntries`, `pendingDeletes`, `enterEdit`, `cancelEdit`, `saveAll`, `hasChanges`, `buildEntriesFromGroups`, `updateDraftTargets`, `toggleDraftActive`, `removeDraftEntry`, `confirmDelete`, `addDraftEntry`. Add: per-card delete handling, direct API calls for add/toggle.

```vue
<template>
  <div class="p-6 space-y-3">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-foreground">{{ t('mappings.title') }}</h2>
        <div class="flex gap-2 mt-1">
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground">{{ t('mappings.totalMappings', { count: entries.length }) }}</span>
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground">{{ t('mappings.enabledCount', { count: activeCount }) }}</span>
        </div>
      </div>
    </div>

    <!-- Mapping Cards -->
    <ModelMappingCard
      v-for="entry in entries"
      :key="entry.clientModel"
      :entry="entry"
      :provider-groups="providerGroups"
      @saved="loadData"
      @deleted="handleDelete"
    />

    <!-- Empty state -->
    <p v-if="entries.length === 0" class="py-8 text-center text-xs text-muted-foreground">{{ t('providers.shared.noMappings') }}</p>

    <!-- Add new mapping -->
    <div class="flex items-center gap-2 pt-3 border-t">
      <Input v-model="newClientModel" :placeholder="t('providers.shared.clientModel')" class="h-8 flex-1 text-xs font-mono" @keydown.enter.prevent="handleAdd" />
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" class="shrink-0 text-muted-foreground/30"><path d="M1 6h10M8 3l3 3-3 3"/></svg>
      <Input v-model="newTargetModel" :placeholder="t('providers.shared.targetModel')" class="h-8 flex-1 text-xs font-mono" @keydown.enter.prevent="handleAdd" />
      <Button size="sm" variant="outline" class="h-8 shrink-0" :disabled="!canAdd || adding" @click="handleAdd">
        {{ adding ? t('common.saving') : t('providers.shared.add') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { api, getApiMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ModelMappingCard from '@/components/mappings/ModelMappingCard.vue'
import type { MappingEntry, MappingTarget } from '@/components/quick-setup/types'
import type { ProviderGroup } from '@/components/mappings/cascading-types'
import type { MappingGroup, Provider, Rule } from '@/types/mapping'
import { DEFAULT_CONTEXT_WINDOW } from '@/constants'

const { t } = useI18n()

// --- State ---
const groups = ref<MappingGroup[]>([])
const providersList = ref<Provider[]>([])
const entries = ref<MappingEntry[]>([])
const newClientModel = ref('')
const newTargetModel = ref('')
const adding = ref(false)

// --- Computed ---
const activeCount = computed(() => entries.value.filter(e => e.active).length)

const providerGroups = computed<ProviderGroup[]>(() =>
  providersList.value.map(p => ({
    provider: { id: p.id, name: p.name },
    models: (p.models ?? []).map(m => ({
      name: m.name,
      contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
    })),
  }))
)

const canAdd = computed(() => newClientModel.value.trim().length > 0 && newTargetModel.value.trim().length > 0)

// --- Build entries from DB ---
function buildEntries(): MappingEntry[] {
  return groups.value.map((g) => {
    let rule: Rule = {}
    try {
      const parsed = JSON.parse(g.rule)
      rule = parsed.default && !parsed.targets ? { targets: [parsed.default] } : parsed
    } catch { /* ignore */ }
    const targets: MappingTarget[] = (rule.targets ?? []).map((t: MappingTarget) => ({
      backend_model: t.backend_model || '',
      provider_id: t.provider_id || '',
      overflow_provider_id: t.overflow_provider_id,
      overflow_model: t.overflow_model,
    }))
    return {
      clientModel: g.client_model,
      targets: targets.length > 0 ? targets : [{ backend_model: '', provider_id: providersList.value[0]?.id ?? '' }],
      existing: true,
      existingId: g.id,
      tag: 'existing' as const,
      active: !!g.is_active,
      originalActive: !!g.is_active,
    }
  })
}

// --- Data loading ---
async function loadData() {
  const results = await Promise.allSettled([
    api.getMappingGroups(),
    api.getProviders(),
  ])
  if (results[0].status === 'fulfilled') groups.value = results[0].value
  if (results[1].status === 'fulfilled') providersList.value = results[1].value as Provider[]
  entries.value = buildEntries()
}

// --- Add new mapping ---
async function handleAdd() {
  const cm = newClientModel.value.trim()
  const tm = newTargetModel.value.trim()
  if (!cm || !tm) return
  adding.value = true
  try {
    await api.createMappingGroup({ client_model: cm, rule: JSON.stringify({ targets: [{ backend_model: tm, provider_id: providersList.value[0]?.id ?? '' }] }) })
    newClientModel.value = ''
    newTargetModel.value = ''
    await loadData()
    toast.success(t('common.saveSuccess'))
  } catch (e: unknown) {
    toast.error(getApiMessage(e, t('mappings.messages.saveFailed')))
  } finally {
    adding.value = false
  }
}

// --- Delete mapping ---
async function handleDelete(clientModel: string) {
  const entry = entries.value.find(e => e.clientModel === clientModel)
  if (entry?.existingId) {
    try {
      await api.deleteMappingGroup(entry.existingId)
      await loadData()
      toast.success(t('common.saveSuccess'))
    } catch (e: unknown) {
      toast.error(getApiMessage(e, t('mappings.messages.deleteFailed', { model: clientModel })))
    }
  }
}

onMounted(loadData)
</script>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/views/ModelMappings.vue
git commit -m "refactor: simplify ModelMappings page to use ModelMappingCard per-entry"
```

---

### Task 5: Update QuickSetup.vue import

**Files:**
- Modify: `frontend/src/views/QuickSetup.vue`

- [ ] **Step 1: Change the import path**

In `QuickSetup.vue`, make three changes:

**1. Change the import:**
```
import MappingList from '@/components/shared/MappingList.vue'
```
→
```
import QuickSetupMappingList from '@/components/shared/QuickSetupMappingList.vue'
```

**2. Update the template tag name and remove incompatible props:**

The new `QuickSetupMappingList` doesn't accept `show-delete`, `show-add-form`, or `remove` (delete is never needed in quick setup, add form is always shown). Change:
```html
<MappingList
  :entries="mappingEntries"
  :provider-groups="allProviderGroups"
  :show-delete="false"
  :show-add-form="true"
  @update:targets="updateMappingTargets"
  @toggle-active="toggleMappingActive"
  @add="addMappingEntry"
  @remove="removeMappingEntry"
/>
```
→
```html
<QuickSetupMappingList
  :entries="mappingEntries"
  :provider-groups="allProviderGroups"
  @update:targets="updateMappingTargets"
  @toggle-active="toggleMappingActive"
  @add="addMappingEntry"
/>
```

**3. Remove unused `removeMappingEntry` import if it becomes dead code:**

Check if `removeMappingEntry` (from `useQuickSetup`) is still referenced elsewhere. If not, remove it from the destructured import.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/views/QuickSetup.vue
git commit -m "refactor: switch QuickSetup to use QuickSetupMappingList"
```

---

### Task 6: Delete old components

**Files:**
- Delete: `frontend/src/components/mappings/MappingGroupFormDialog.vue`
- Delete: `frontend/src/components/mappings/MappingEditor.vue`
- Delete: `frontend/src/components/shared/MappingList.vue`

- [ ] **Step 1: Verify no remaining imports reference these files**

Run: `grep -rn "MappingGroupFormDialog\|MappingEditor\|shared/MappingList" frontend/src --include="*.vue" --include="*.ts"`

Expected: No results (all references already updated in previous tasks).

- [ ] **Step 2: Delete the files**

```bash
git rm frontend/src/components/mappings/MappingGroupFormDialog.vue
git rm frontend/src/components/mappings/MappingEditor.vue
git rm frontend/src/components/shared/MappingList.vue
git commit -m "chore: remove deprecated mapping components"
```

---

### Task 7: Verify and test

- [ ] **Step 1: Run frontend type check**

Run: `cd frontend && npx vue-tsc --noEmit`

Expected: No type errors.

- [ ] **Step 2: Run lint check**

Run: `cd frontend && npx eslint src/components/mappings/MappingEntryEditor.vue src/components/mappings/ModelMappingCard.vue src/components/shared/QuickSetupMappingList.vue src/views/ModelMappings.vue src/views/QuickSetup.vue`

Expected: No lint errors.

- [ ] **Step 3: Run dev server and manual smoke test**

Run: `cd frontend && npm run dev`

Manually verify:
1. Model Mappings page loads, shows entries with vertical pipeline display
2. Clicking a card expands to show editor with save/cancel
3. Save works per-entry (API call + refresh)
4. Switch toggles active state directly
5. Delete shows confirmation dialog, works correctly
6. Add new mapping form at bottom works
7. Quick Setup page still works with the new MappingList component
8. No global "edit" button exists on Model Mappings page

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address type/lint issues from refactor"
```
