<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MappingEntry, MappingTarget } from '@/components/quick-setup/types'
import type { ProviderGroup, SelectedValue } from '@/components/mappings/cascading-types'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Trash2, Plus } from 'lucide-vue-next'
import CascadingModelSelect from '@/components/mappings/CascadingModelSelect.vue'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  entries: MappingEntry[]
  providerGroups: ProviderGroup[]
  showDelete?: boolean
  showAddForm?: boolean
  editable?: boolean
}>(), {
  showDelete: false,
  showAddForm: true,
  editable: true,
})

const emit = defineEmits<{
  'update:targets': [index: number, targets: MappingTarget[]]
  'toggle-active': [index: number]
  'remove': [clientModel: string]
  'add': [clientModel: string, targetModel: string]
}>()

const newFrom = ref('')
const newTo = ref('')
const expandedEntries = ref<Record<string, boolean>>({})

function toggleExpand(clientModel: string) {
  expandedEntries.value = {
    ...expandedEntries.value,
    [clientModel]: !expandedEntries.value[clientModel],
  }
}

function isExpanded(clientModel: string) {
  return !!expandedEntries.value[clientModel]
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
  emit('update:targets', entryIndex, entry.targets.filter((_: MappingTarget, i: number) => i !== targetIndex))
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

function providerName(providerId: string): string {
  return props.providerGroups.find(p => p.provider.id === providerId)?.provider.name ?? providerId.slice(0, 6)
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

/** Split targets into lines of max 2 nodes each */
function chunkTargets(targets: MappingTarget[], size = 2): MappingTarget[][] {
  const chunks: MappingTarget[][] = []
  for (let i = 0; i < targets.length; i += size) {
    chunks.push(targets.slice(i, i + size))
  }
  return chunks
}
</script>

<template>
  <div class="rounded-xl border border-border bg-card overflow-hidden">
    <!-- Header -->
    <div v-if="entries.length > 0" class="flex items-center px-5 py-2.5 border-b border-border bg-muted/20 text-xs text-muted-foreground font-medium">
      <div class="w-[140px] shrink-0">{{ t('providers.shared.clientModel') }}</div>
      <div class="w-5 shrink-0"></div>
      <div class="flex-1">{{ t('providers.shared.targetChain') }}</div>
      <div class="shrink-0 w-[140px] text-right">{{ t('providers.shared.actions') }}</div>
    </div>

    <!-- Entries -->
    <div
      v-for="(entry, idx) in entries"
      :key="entry.clientModel"
      class="border-b border-border last:border-b-0 transition-colors"
      :class="{ 'opacity-40': !entry.active }"
    >
      <!-- Main row (click to expand) -->
      <div
        class="flex items-center px-5 py-3 cursor-pointer select-none hover:bg-muted/10"
        :class="{ 'cursor-default hover:bg-transparent': !editable }"
        @click="editable && toggleExpand(entry.clientModel)"
      >
        <!-- Client model -->
        <div class="w-[140px] shrink-0 mono text-sm font-semibold text-foreground truncate" :title="entry.clientModel">
          {{ entry.clientModel }}
        </div>

        <!-- Arrow -->
        <div class="w-5 shrink-0 flex items-center justify-center">
          <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted-foreground/30"><path d="M1 5h7M6 2l3 3-3 3"/></svg>
        </div>

        <!-- Target chain -->
        <div class="flex-1 min-w-0">
          <div v-for="(chunk, cIdx) in chunkTargets(entry.targets)" :key="cIdx" class="flex items-center gap-1 flex-wrap" :class="cIdx > 0 ? 'mt-0.5' : ''">
            <template v-for="(t, tIdx) in chunk" :key="tIdx">
              <!-- Connector between chunks -->
              <svg v-if="cIdx > 0 && tIdx === 0" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted-foreground/20 shrink-0"><path d="M3 1v6M0 4l3 3 3-3" stroke-dasharray="2 2"/></svg>
              <!-- Connector within chunk -->
              <svg v-else-if="tIdx > 0" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted-foreground/20 shrink-0"><path d="M3 1v6M0 4l3 3 3-3" stroke-dasharray="2 2"/></svg>

              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm mono min-w-[180px]"
                :class="tIdx === 0 && cIdx === 0
                  ? 'bg-primary/10 border border-primary/20 text-primary'
                  : 'bg-muted/30 border border-border text-muted-foreground'"
              >
                {{ t.backend_model }}
                <span class="text-[11px] px-1 py-px rounded bg-muted/50 text-muted-foreground/40">{{ providerName(t.provider_id) }}</span>
              </span>
            </template>
          </div>
          <!-- Overflow -->
          <div v-if="entry.targets[0]?.overflow_model" class="flex items-center gap-1 mt-1 pt-1 border-t border-dashed border-primary/10">
            <svg width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.5" class="text-primary/30 shrink-0"><path d="M3 1v4M1 3l2 2 2-2" stroke-dasharray="1 1"/></svg>
            <span class="text-xs text-primary/40">{{ t('providers.shared.overflow') }}</span>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm mono bg-primary/5 border border-primary/15 text-primary/70">
              {{ entry.targets[0].overflow_model }}
              <span class="text-[11px] px-1 py-px rounded bg-muted/50 text-muted-foreground/40">{{ providerName(entry.targets[0].overflow_provider_id ?? '') }}</span>
            </span>
          </div>
        </div>

        <!-- Actions -->
        <div class="shrink-0 w-[140px] flex items-center justify-end gap-1">
          <Badge v-if="entry.targets.length > 1" variant="outline" class="text-[11px] px-1.5 py-0 border-border text-muted-foreground/50 shrink-0">
            {{ t('providers.shared.level', { count: entry.targets.length }) }}
          </Badge>
          <span v-if="!editable" class="text-[11px] shrink-0" :class="entry.active ? 'text-primary/60' : 'text-muted-foreground/30'">{{ entry.active ? t('providers.shared.enabled') : t('providers.shared.disabled') }}</span>
          <Button v-if="showDelete && editable" variant="ghost" size="icon-xs" class="text-muted-foreground/40 hover:text-destructive shrink-0" @click.stop="emit('remove', entry.clientModel)">
            <Trash2 class="size-3" />
          </Button>
          <Switch
            v-if="editable"
            :model-value="entry.active"
            @update:model-value="emit('toggle-active', idx)"
            class="scale-75 shrink-0"
            @click.stop
          />
        </div>
      </div>

      <!-- Expanded: edit mode (only in non-readonly) -->
      <div v-if="editable && isExpanded(entry.clientModel)" class="border-t border-border bg-muted/5 mapping-edit-section">
        <div class="flex">
          <!-- Left: client model identity -->
          <div class="w-[140px] shrink-0 px-3 py-2 flex flex-col items-center justify-center border-r border-border bg-muted/10">
            <div class="mono text-xs font-semibold text-foreground">{{ entry.clientModel }}</div>
            <div class="text-[10px] text-muted-foreground/50 mt-0.5">{{ t('providers.shared.clientModel') }}</div>
          </div>

          <!-- Right: targets editor -->
          <div class="flex-1 px-3 py-2 space-y-1.5">
            <div v-for="(target, tIdx) in entry.targets" :key="tIdx">
              <div class="flex items-center gap-2">
                <span
                  class="text-xs font-medium shrink-0 w-10 px-1.5 py-0.5 rounded"
                  :class="tIdx === 0
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted/30 text-muted-foreground'"
                >
                  {{ tIdx === 0 ? t('providers.shared.primary') : t('providers.shared.backup', { n: tIdx }) }}
                </span>
                <div class="flex-1">
                  <CascadingModelSelect
                    :providers="providerGroups"
                    :model-value="{ provider_id: target.provider_id, model: target.backend_model }"
                    compact :placeholder="t('providers.shared.selectModel')"
                    @update:model-value="(v: SelectedValue) => updateTargetProvider(idx, tIdx, v)"
                  />
                </div>
                <Button
                  v-if="entry.targets.length > 1"
                  variant="ghost"
                  size="icon-xs"
                  class="shrink-0 text-muted-foreground/40 hover:text-destructive"
                  @click="removeTarget(idx, tIdx)"
                >
                  <Trash2 class="size-3" />
                </Button>
              </div>
              <div v-if="tIdx < entry.targets.length - 1" class="flex items-center gap-1 pl-10 text-[11px] text-muted-foreground/30 py-0.5">
                <span class="w-3 border-t border-muted-foreground/20"></span>
                <span>{{ t('providers.shared.switchOnFail') }}</span>
              </div>
            </div>

            <!-- Overflow edit -->
            <div class="flex items-center gap-2 pt-2 border-t border-dashed border-primary/15">
              <span class="text-[10px] w-10 text-center px-1.5 py-0.5 rounded bg-primary/10 text-primary/70 shrink-0">{{ t('providers.shared.overflow') }}</span>
              <div class="flex-1">
                <CascadingModelSelect
                  :providers="providerGroups"
                  :model-value="entry.targets[0]?.overflow_provider_id && entry.targets[0]?.overflow_model ? { provider_id: entry.targets[0].overflow_provider_id, model: entry.targets[0].overflow_model } : undefined"
                  compact :placeholder="t('providers.shared.overflowPlaceholder')"
                  @update:model-value="(v: SelectedValue | undefined) => updateOverflow(idx, v)"
                />
              </div>
            </div>

            <!-- Add failover button -->
            <Button variant="ghost" size="sm" class="w-full text-xs text-muted-foreground/50" @click="addTarget(idx)">
              <Plus class="w-3 h-3 mr-1" />
              {{ t('providers.shared.addFailover') }}
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="entries.length === 0" class="py-10 text-center text-xs text-muted-foreground/40">
      {{ t('providers.shared.noMappings') }}
    </div>

    <!-- Add mapping form -->
    <div v-if="showAddForm && editable" class="flex items-center gap-2 px-4 py-3 border-t border-border">
      <Input v-model="newFrom" :placeholder="t('providers.shared.clientModel')" class="h-8 flex-1 text-xs mono" @keydown="handleKeydown" />
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" class="shrink-0 text-muted-foreground/20"><path d="M1 6h10M8 3l3 3-3 3"/></svg>
      <Input v-model="newTo" :placeholder="t('providers.shared.targetModel')" class="h-8 flex-1 text-xs mono" @keydown="handleKeydown" />
      <Button size="sm" variant="outline" class="h-8 shrink-0" :disabled="!canAdd()" @click="addMapping">{{ t('providers.shared.add') }}</Button>
    </div>
  </div>
</template>

<style scoped>
</style>
