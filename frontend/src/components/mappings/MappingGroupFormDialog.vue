<!-- eslint-disable vue/no-mutating-props -- form is a reactive object managed by parent component -->
<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ editingId ? t('mappings.editGroup') : t('mappings.addGroup') }}</DialogTitle>
        <DialogDescription>{{ t('mappings.configureMappingRule') }}</DialogDescription>
      </DialogHeader>
      <form @submit.prevent="handleSave" class="space-y-4">
        <div>
          <Label class="block text-sm font-medium text-foreground mb-1">{{ t('mappings.clientModel') }}</Label>
          <Input v-model="form.client_model" type="text" required @input="delete errors.client_model" />
          <p v-if="errors.client_model" class="text-sm text-destructive mt-1">{{ errors.client_model }}</p>
        </div>

        <div class="border rounded-lg p-3 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-foreground">{{ t('mappings.failoverChain') }}</span>
              <span v-if="form.targets.length > 1" class="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
                {{ t('mappings.enabled') }}
              </span>
              <span v-else class="text-xs text-muted-foreground">{{ t('mappings.addMoreToEnableFailover') }}</span>
            </div>
            <Button type="button" variant="outline" size="sm" @click="emit('addTarget')">{{ t('mappings.addBackup') }}</Button>
          </div>
          <p v-if="errors.targets" class="text-sm text-destructive">{{ errors.targets }}</p>
          <p class="text-xs text-muted-foreground">{{ t('mappings.failoverChainHint') }}</p>
          <div v-for="(target, idx) in form.targets" :key="idx" class="border rounded-md p-2 space-y-2">
            <div class="text-xs font-medium" :class="idx === 0 ? 'text-primary' : 'text-muted-foreground'">{{ idx === 0 ? t('mappings.primary') : t('mappings.backupLabel', { idx }) }}</div>
            <div class="flex gap-3">
              <div class="flex-1">
                <div class="text-xs text-muted-foreground mb-1">{{ t('mappings.model') }}</div>
                <CascadingModelSelect
                  :providers="providerGroups"
                  :model-value="{ provider_id: target.provider_id, model: target.backend_model }"
                  :placeholder="t('mappings.selectModel')"
                  @update:model-value="(v: SelectedValue) => { target.provider_id = v.provider_id; target.backend_model = v.model }"
                />
                <p v-if="errors[`target.${idx}.provider_id`] || errors[`target.${idx}.backend_model`]" class="text-sm text-destructive mt-1">
                  {{ errors[`target.${idx}.provider_id`] || errors[`target.${idx}.backend_model`] }}
                </p>
              </div>
              <div class="flex-1">
                <div class="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  {{ t('mappings.overflowModel') }}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <HelpCircle class="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>{{ t('mappings.overflowTooltip') }}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <CascadingModelSelect
                  :providers="overflowGroupsFor(idx)"
                  :model-value="target.overflow_provider_id && target.overflow_model ? { provider_id: target.overflow_provider_id, model: target.overflow_model } : undefined"
                  :placeholder="t('mappings.clickToSelectModel')"
                  @update:model-value="(v: SelectedValue | undefined) => onOverflowSelect(idx, v)"
                />
              </div>
            </div>
            <div v-if="overflowHintFor(idx)" class="text-xs text-primary">
              {{ overflowHintFor(idx) }}
            </div>
            <div class="flex justify-end gap-1">
              <Button type="button" variant="ghost" size="sm" :disabled="idx === 0" @click="emit('moveTargetUp', idx)">
                <ArrowUp class="w-4 h-4" />
              </Button>
              <Button type="button" variant="ghost" size="sm" :disabled="idx === form.targets.length - 1" @click="emit('moveTargetDown', idx)">
                <ArrowDown class="w-4 h-4" />
              </Button>
              <Button type="button" variant="ghost" size="sm" class="text-destructive shrink-0" @click="emit('removeTarget', idx)">{{ t('common.delete') }}</Button>
            </div>
            <div v-if="idx < form.targets.length - 1" class="flex justify-center pt-1">
              <div class="flex items-center gap-1 text-xs text-muted-foreground">
                <ChevronDown class="w-3.5 h-3.5" />
                <span>{{ t('mappings.switchOnFailAuto') }}</span>
                <ChevronDown class="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">{{ t('common.cancel') }}</Button>
          <Button type="submit">{{ t('common.save') }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUp, ArrowDown, ChevronDown, HelpCircle } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import CascadingModelSelect from '@/components/mappings/CascadingModelSelect.vue'
import type { SelectedValue, ProviderGroup } from '@/components/mappings/cascading-types'
import type { ProviderSummary, MappingTarget } from '@/types/mapping'
import { DEFAULT_CONTEXT_WINDOW, LARGE_CONTEXT_THRESHOLD } from '@/constants'

interface FormData {
  client_model: string
  targets: MappingTarget[]
}

const props = defineProps<{
  open: boolean
  editingId: string | null
  form: FormData
  providers: ProviderSummary[]
  providerGroups: ProviderGroup[]
  contextWindowMap: Map<string, number>
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
  (e: 'save'): void
  (e: 'addTarget'): void
  (e: 'removeTarget', idx: number): void
  (e: 'moveTargetUp', idx: number): void
  (e: 'moveTargetDown', idx: number): void
}>()

const { t } = useI18n()

function getTargetByKey(idx: number): MappingTarget | undefined {
  return props.form.targets[idx]
}

function getContextWindow(target: MappingTarget): number {
  const key = `${target.provider_id}:${target.backend_model}`
  return props.contextWindowMap.get(key) ?? DEFAULT_CONTEXT_WINDOW
}

function overflowGroupsFor(idx: number): ProviderGroup[] {
  const target = getTargetByKey(idx)
  if (!target?.backend_model) return props.providerGroups
  const cw = getContextWindow(target)
  return props.providerGroups
    .map(g => ({ ...g, models: g.models.filter(m => m.contextWindow >= cw) }))
    .filter(g => g.models.length > 0)
}

function overflowHintFor(idx: number): string {
  const target = getTargetByKey(idx)
  if (!target?.overflow_provider_id || !target?.overflow_model) return ''
  const cw = getContextWindow(target)
  if (cw >= LARGE_CONTEXT_THRESHOLD) return t('mappings.overflowHintNoNeed')
  const cwStr = cw >= 1000 ? `${cw / 1000}K` : `${cw}`
  return t('mappings.overflowHint', { model: target.backend_model, context: cwStr, overflowModel: target.overflow_model })
}

function onOverflowSelect(idx: number, val: SelectedValue | undefined) {
  const target = getTargetByKey(idx)
  if (!target) return
  if (val) {
    target.overflow_provider_id = val.provider_id
    target.overflow_model = val.model
  } else {
    target.overflow_provider_id = undefined
    target.overflow_model = undefined
  }
}

function handleSave() {
  if (!validate()) return
  emit('save')
}

const errors = ref<Record<string, string>>({})

function validate(): boolean {
  const errs: Record<string, string> = {}
  if (!props.form.client_model.trim()) errs.client_model = t('mappings.errorClientModelRequired')

  if (props.form.targets.length === 0) errs.targets = t('mappings.errorAtLeastOneTarget')
  props.form.targets.forEach((target, i) => {
    if (!target.provider_id) errs[`target.${i}.provider_id`] = t('mappings.errorSelectModel')
    if (!target.backend_model) errs[`target.${i}.backend_model`] = t('mappings.errorSelectModel')
  })

  errors.value = errs
  return Object.keys(errs).length === 0
}

watch(() => props.open, (v) => { if (v) errors.value = {} })
</script>
