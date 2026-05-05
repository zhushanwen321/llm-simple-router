<script setup lang="ts">
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
      <span class="min-w-[90px] font-mono text-sm font-semibold text-foreground shrink-0 truncate" :title="entry.clientModel">
        {{ entry.clientModel }}
      </span>
      <svg width="14" height="14" class="mt-0.5 shrink-0 text-muted-foreground/30">
        <line x1="0" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.5"/>
        <polyline points="8,3 12,7 8,11" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <div class="flex-1 flex flex-col gap-0 min-w-0">
        <div v-for="(target, tIdx) in entry.targets" :key="tIdx">
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
          <div v-if="tIdx < entry.targets.length - 1" class="flex items-center gap-1 pl-5 py-0.5">
            <div class="w-px h-1.5 bg-orange-400/30"></div>
            <span class="text-[9px] text-orange-400/50">{{ t('providers.shared.switchOnFail') }}</span>
          </div>
        </div>
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
        <div v-if="tIdx < entry.targets.length - 1" class="flex items-center gap-1 pl-8 py-0.5">
          <div class="w-px h-1.5 bg-orange-400/30"></div>
          <span class="text-[9px] text-orange-400/50">{{ t('providers.shared.switchOnFail') }}</span>
        </div>
      </div>

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

      <Button variant="ghost" size="sm" class="w-full text-xs text-muted-foreground/50" @click="addTarget">
        <Plus class="w-3 h-3 mr-1" />
        {{ t('providers.shared.addFailover') }}
      </Button>
    </div>
  </div>
</template>
