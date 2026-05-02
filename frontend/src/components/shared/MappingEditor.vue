<script setup lang="ts">
import { ref } from 'vue'
import type { MappingEntry, MappingTarget } from '@/components/quick-setup/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, ChevronDown, Trash2, ArrowRight } from 'lucide-vue-next'
import CascadingModelSelect from '@/components/mappings/CascadingModelSelect.vue'
import { Switch } from '@/components/ui/switch'
import type { ProviderGroup } from '@/components/mappings/cascading-types'
import type { SelectedValue } from '@/components/mappings/cascading-types'

const props = withDefaults(defineProps<{
  entries: MappingEntry[]
  providerGroups: ProviderGroup[]
  showDelete?: boolean
  showAddForm?: boolean
}>(), {
  showDelete: false,
  showAddForm: true,
})

const emit = defineEmits<{
  'update:targets': [index: number, targets: MappingTarget[]]
  'toggle-active': [index: number]
  'add': [clientModel: string, targetModel: string]
  'remove': [clientModel: string]
}>()

const newFrom = ref('')
const newTo = ref('')
const expandedEntries = ref<Set<string>>(new Set())

function toggleExpand(clientModel: string) {
  const next = new Set(expandedEntries.value)
  if (next.has(clientModel)) next.delete(clientModel)
  else next.add(clientModel)
  expandedEntries.value = next
}

function isExpanded(clientModel: string): boolean {
  return expandedEntries.value.has(clientModel)
}

function addTarget(entryIndex: number) {
  const entry = props.entries[entryIndex]
  if (!entry) return
  const firstProvider = props.providerGroups[0]
  const newTargets = [...entry.targets, {
    backend_model: firstProvider?.models[0]?.name ?? '',
    provider_id: firstProvider?.provider.id ?? '',
  }]
  emit('update:targets', entryIndex, newTargets)
}

function removeTarget(entryIndex: number, targetIndex: number) {
  const entry = props.entries[entryIndex]
  if (!entry || entry.targets.length <= 1) return
  emit('update:targets', entryIndex, entry.targets.filter((_t: MappingTarget, i: number) => i !== targetIndex))
}

function updateTargetProvider(entryIndex: number, targetIndex: number, val: SelectedValue) {
  const entry = props.entries[entryIndex]
  if (!entry) return
  const newTargets = [...entry.targets]
  newTargets[targetIndex] = { ...newTargets[targetIndex], provider_id: val.provider_id, backend_model: val.model }
  emit('update:targets', entryIndex, newTargets)
}

function updateOverflow(entryIndex: number, val: SelectedValue | undefined) {
  const entry = props.entries[entryIndex]
  if (!entry) return
  const newTargets = entry.targets.map((t: MappingTarget, i: number) => {
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
</script>

<template>
  <div class="space-y-1.5">
    <!-- Mapping entries -->
    <div
      v-for="(entry, idx) in entries"
      :key="entry.clientModel"
      class="rounded-md border"
      :class="entry.existing ? 'bg-primary/5 border-primary/20' : 'bg-card border-border'"
    >
      <!-- Header row -->
      <div
        class="flex items-center gap-2 px-2.5 py-2 cursor-pointer select-none"
        @click="toggleExpand(entry.clientModel)"
      >
        <span class="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">
          {{ entry.clientModel }}
        </span>
        <Badge
          variant="default"
          class="shrink-0 text-[9px] px-1.5 py-0"
          :class="entry.tag === 'existing' ? 'bg-green-600 text-white hover:bg-green-600' : 'bg-secondary text-secondary-foreground'"
        >
          {{ tagLabels[entry.tag] || entry.tag }}
        </Badge>
        <span class="text-xs text-muted-foreground shrink-0">
          → {{ entry.targets[0]?.backend_model ?? '?' }}
        </span>
        <Badge
          v-if="entry.targets.length > 1"
          variant="outline"
          class="shrink-0 text-[9px] px-1 py-0 border-orange-400 text-orange-500"
        >
          {{ entry.targets.length }}级
        </Badge>
        <Badge
          v-if="entry.targets[0]?.overflow_model"
          variant="outline"
          class="shrink-0 text-[9px] px-1 py-0 border-blue-400 text-blue-500"
        >
          溢出
        </Badge>
        <ChevronDown
          class="size-3.5 shrink-0 text-muted-foreground transition-transform"
          :class="isExpanded(entry.clientModel) ? 'rotate-0' : '-rotate-90'"
        />
        <Switch
          :checked="entry.active"
          @update:checked="emit('toggle-active', idx)"
          class="scale-75"
          @click.stop
        />
        <Button
          v-if="showDelete"
          variant="ghost"
          size="icon-xs"
          class="shrink-0 text-muted-foreground hover:text-destructive"
          @click.stop="emit('remove', entry.clientModel)"
        >
          <Trash2 class="size-3" />
        </Button>
      </div>

      <!-- Expanded detail -->
      <div v-if="isExpanded(entry.clientModel)" class="border-t px-3 py-2 space-y-1.5">
        <div
          v-for="(target, tIdx) in entry.targets"
          :key="tIdx"
        >
          <!-- Target row -->
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-medium shrink-0 w-6" :class="tIdx === 0 ? 'text-primary' : 'text-muted-foreground'">
              {{ tIdx === 0 ? '首选' : `备${tIdx}` }}
            </span>
            <div class="flex-1">
              <CascadingModelSelect
                :providers="providerGroups"
                :model-value="{ provider_id: target.provider_id, model: target.backend_model }"
                placeholder="选择模型..."
                @update:model-value="(v: SelectedValue) => updateTargetProvider(idx, tIdx, v)"
              />
            </div>
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

          <!-- Failover arrow -->
          <div v-if="tIdx < entry.targets.length - 1" class="flex items-center gap-1 pl-8 text-[10px] text-muted-foreground py-0.5">
            <span class="w-3 border-t border-muted-foreground/30"></span>
            <span>失败时切换</span>
          </div>
        </div>

        <!-- Overflow model (bottom, separated by border) -->
        <div class="flex items-center gap-2 pt-2 mt-1 border-t border-border">
          <span class="text-[10px] text-muted-foreground shrink-0">溢出模型</span>
          <div class="flex-1">
            <CascadingModelSelect
              :providers="providerGroups"
              :model-value="entry.targets[0]?.overflow_provider_id && entry.targets[0]?.overflow_model ? { provider_id: entry.targets[0].overflow_provider_id, model: entry.targets[0].overflow_model } : undefined"
              placeholder="可选，上下文超限时切换..."
              @update:model-value="(v: SelectedValue | undefined) => updateOverflow(idx, v)"
            />
          </div>
        </div>

        <!-- Add failover -->
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
    <p v-if="entries.length === 0" class="py-3 text-center text-xs text-muted-foreground">暂无映射</p>

    <!-- Add new mapping -->
    <div v-if="showAddForm" class="flex items-center gap-2 pt-2 border-t mt-2">
      <Input v-model="newFrom" placeholder="客户端模型" class="h-8 flex-1 text-xs font-mono" @keydown="handleKeydown" />
      <ArrowRight class="size-3 shrink-0 text-muted-foreground" />
      <Input v-model="newTo" placeholder="目标模型" class="h-8 flex-1 text-xs font-mono" @keydown="handleKeydown" />
      <Button size="sm" variant="outline" class="h-8 shrink-0" :disabled="!canAdd()" @click="addMapping">添加</Button>
    </div>
  </div>
</template>
