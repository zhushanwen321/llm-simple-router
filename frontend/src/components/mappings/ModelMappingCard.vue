<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Trash2 } from 'lucide-vue-next'
import { api, getApiMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import MappingEntryEditor from '@/components/mappings/MappingEntryEditor.vue'
import type { MappingTarget, MappingEntry } from '@/components/quick-setup/types'
import type { ProviderGroup } from '@/components/mappings/cascading-types'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  entry: MappingEntry
  providerGroups: ProviderGroup[]
  editableClientModel?: boolean
  defaultExpanded?: boolean
}>(), {
  defaultExpanded: false,
})

const emit = defineEmits<{
  'saved': []
  'deleted': [clientModel: string]
  'cancel-add': []
}>()

const localClientModel = ref('')

// Sync localClientModel from entry for new-card mode
watch(() => props.entry.clientModel, (val) => {
  localClientModel.value = val
}, { immediate: true })

const expanded = ref(props.defaultExpanded)
const localTargets = ref<MappingTarget[]>([])
const saving = ref(false)
const showDeleteConfirm = ref(false)

// When expanding, snapshot current targets as local edit copy
watch(expanded, (val) => {
  if (val) {
    localTargets.value = props.entry.targets.map(t => ({ ...t }))
  }
})

// Sync localTargets when parent refreshes data while card is expanded
watch(() => props.entry.targets, (newTargets) => {
  if (expanded.value) {
    localTargets.value = newTargets.map(t => ({ ...t }))
  }
}, { deep: true })

const workingEntry = computed<MappingEntry>(() =>
  expanded.value
    ? { ...props.entry, targets: localTargets.value }
    : props.entry
)

function handleUpdateTargets(targets: MappingTarget[]) {
  localTargets.value = targets
}

function handleUpdateClientModel(val: string) {
  localClientModel.value = val
}

async function handleSave() {
  saving.value = true
  try {
    const clientModel = props.editableClientModel ? localClientModel.value.trim() : props.entry.clientModel
    if (!clientModel) return
    const ruleJson = JSON.stringify({ targets: localTargets.value })
    if (props.entry.existingId) {
      await api.updateMappingGroup(props.entry.existingId, {
        client_model: clientModel,
        rule: ruleJson,
      })
    } else {
      await api.createMappingGroup({ client_model: clientModel, rule: ruleJson })
    }
    expanded.value = false
    emit('saved')
    toast.success(t('common.saveSuccess'))
  } catch (e: unknown) {
    console.error('mappingCard.save:', e)
    toast.error(getApiMessage(e, t('mappings.messages.saveFailed')))
  } finally {
    saving.value = false
  }
}

function handleCancel() {
  if (props.editableClientModel) {
    emit('cancel-add')
  } else {
    expanded.value = false
  }
}

async function handleToggleActive() {
  try {
    if (props.entry.existingId) {
      await api.toggleMappingGroup(props.entry.existingId)
    }
    emit('saved')
  } catch (e: unknown) {
    console.error('mappingCard.toggle:', e)
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
          :entry="workingEntry"
          :provider-groups="providerGroups"
          :expanded="expanded"
          :editable="true"
          :editable-client-model="editableClientModel"
          @update:targets="handleUpdateTargets"
          @update:client-model="handleUpdateClientModel"
        />
      </div>

      <!-- Right actions: always visible -->
      <div class="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
        <div class="flex items-center gap-2">
          <span v-if="entry.targets.length > 1" class="text-[10px] px-1.5 py-0.5 rounded border border-orange-400/30 text-orange-400/60">
            {{ t('providers.shared.level', { count: entry.targets.length }) }}
          </span>
          <Button
            v-if="!editableClientModel"
            variant="ghost"
            size="icon-xs"
            class="text-muted-foreground/40 hover:text-destructive"
            @click.stop="showDeleteConfirm = true"
          >
            <Trash2 class="size-3" />
          </Button>
          <Switch
            v-if="!editableClientModel"
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
