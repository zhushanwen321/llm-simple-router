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
