<template>
  <div class="p-6 space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold text-foreground">{{ t('mappings.title') }}</h2>
        <div class="flex gap-2 mt-1">
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground">{{ t('mappings.totalMappings', { count: draftEntries.length }) }}</span>
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground">{{ t('mappings.enabledCount', { count: activeCount }) }}</span>
          <span v-if="hasChanges" class="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{{ t('mappings.unsavedChanges') }}</span>
        </div>
      </div>
      <Button v-if="!editing" size="sm" variant="outline" @click="enterEdit">
        <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        {{ t('common.edit') }}
      </Button>
      <div v-else class="flex gap-2">
        <Button size="sm" variant="outline" @click="cancelEdit">{{ t('common.cancel') }}</Button>
        <Button size="sm" :disabled="saving || !hasChanges" @click="saveAll">
          <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          {{ saving ? t('common.saving') : t('common.save') }}
        </Button>
      </div>
    </div>

    <!-- Mapping List -->
    <MappingList
      :entries="draftEntries"
      :provider-groups="providerGroups"
      :show-delete="editing"
      :show-add-form="editing"
      :editable="editing"
      @update:targets="updateDraftTargets"
      @toggle-active="toggleDraftActive"
      @remove="removeDraftEntry"
      @add="addDraftEntry"
    />

    <!-- Delete Confirm -->
    <AlertDialog :open="!!deleteTarget" @update:open="(val: boolean) => { if (!val) deleteTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('common.confirmDelete') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('mappings.confirmDeleteDesc', { model: deleteTarget?.clientModel }) }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <Button variant="destructive" @click="confirmDelete">{{ t('common.delete') }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { api, getApiMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import MappingList from '@/components/shared/MappingList.vue'
import type { MappingEntry, MappingTarget } from '@/components/quick-setup/types'
import type { ProviderGroup } from '@/components/mappings/cascading-types'
import type { MappingGroup, Provider, Rule } from '@/types/mapping'
import { DEFAULT_CONTEXT_WINDOW } from '@/constants'

const { t } = useI18n()

// --- State ---
const groups = ref<MappingGroup[]>([])
const providersList = ref<Provider[]>([])
const editing = ref(false)
const saving = ref(false)
const deleteTarget = ref<MappingEntry | null>(null)
const draftEntries = ref<MappingEntry[]>([])
const pendingDeletes = ref<string[]>([]) // clientModels to delete

// --- Computed ---
const activeCount = computed(() => draftEntries.value.filter(e => e.active).length)

const providerGroups = computed<ProviderGroup[]>(() =>
  providersList.value.map(p => ({
    provider: { id: p.id, name: p.name },
    models: (p.models ?? []).map(m => ({
      name: m.name,
      contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
    })),
  }))
)

const hasChanges = computed(() => {
  const original = buildEntriesFromGroups()
  if (original.length !== draftEntries.value.length) return true
  if (pendingDeletes.value.length > 0) return true
  for (let i = 0; i < original.length; i++) {
    const o = original[i], d = draftEntries.value[i]
    if (o.clientModel !== d.clientModel) return true
    if (o.active !== d.active) return true
    if (JSON.stringify(o.targets) !== JSON.stringify(d.targets)) return true
  }
  return false
})

// --- Build entries from DB groups ---
function buildEntriesFromGroups(): MappingEntry[] {
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
  draftEntries.value = buildEntriesFromGroups()
}

// --- Edit mode ---
function enterEdit() {
  draftEntries.value = buildEntriesFromGroups()
  pendingDeletes.value = []
  editing.value = true
}

function cancelEdit() {
  draftEntries.value = buildEntriesFromGroups()
  pendingDeletes.value = []
  editing.value = false
}

// --- Draft mutations (local only) ---
function updateDraftTargets(index: number, targets: MappingTarget[]) {
  const next = [...draftEntries.value]
  next[index] = { ...next[index], targets }
  draftEntries.value = next
}

function toggleDraftActive(index: number) {
  const next = [...draftEntries.value]
  next[index] = { ...next[index], active: !next[index].active }
  draftEntries.value = next
}

function removeDraftEntry(clientModel: string) {
  const entry = draftEntries.value.find(e => e.clientModel === clientModel)
  if (entry) deleteTarget.value = entry
}

function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  pendingDeletes.value.push(target.clientModel)
  draftEntries.value = draftEntries.value.filter(e => e.clientModel !== target.clientModel)
}

function addDraftEntry(clientModel: string, targetModel: string) {
  const firstProvider = providersList.value[0]
  draftEntries.value = [...draftEntries.value, {
    clientModel,
    targets: [{ backend_model: targetModel, provider_id: firstProvider?.id ?? '' }],
    existing: false,
    tag: 'cust' as const,
    active: true,
  }]
}

// --- Save all ---
async function saveAll() {
  saving.value = true
  const errors: string[] = []

  try {
    // 1. Delete pending entries
    for (const cm of pendingDeletes.value) {
      const entry = buildEntriesFromGroups().find(e => e.clientModel === cm)
      if (entry?.existingId) {
        try {
          await api.deleteMappingGroup(entry.existingId)
        } catch (e: unknown) {
          errors.push(`${t('mappings.messages.deleteFailed', { model: cm })}: ${getApiMessage(e, "")}`)
        }
      }
    }

    // 2. Create new entries
    const originalGroups = groups.value
    for (const entry of draftEntries.value) {
      const existing = originalGroups.find(g => g.client_model === entry.clientModel)

      if (!existing) {
        // New entry
        try {
          const ruleJson = JSON.stringify({ targets: entry.targets })
          const result = await api.createMappingGroup({ client_model: entry.clientModel, rule: ruleJson })
          // Toggle active if user set inactive (create defaults to active)
          if (!entry.active && result.id) {
            await api.toggleMappingGroup(result.id)
          }
        } catch (e: unknown) {
          errors.push(`${t('mappings.messages.createFailed', { model: entry.clientModel })}: ${getApiMessage(e, "")}`)
        }
      } else {
        // Existing entry — update rule if changed
        const originalEntry = buildEntriesFromGroups().find(e => e.clientModel === entry.clientModel)
        const ruleChanged = originalEntry && JSON.stringify(originalEntry.targets) !== JSON.stringify(entry.targets)
        const activeChanged = originalEntry && originalEntry.active !== entry.active

        if (ruleChanged && originalEntry?.existingId) {
          try {
            await api.updateMappingGroup(originalEntry.existingId, {
              client_model: entry.clientModel,
              rule: JSON.stringify({ targets: entry.targets }),
            })
          } catch (e: unknown) {
            errors.push(`${t('mappings.messages.updateFailed', { model: entry.clientModel })}: ${getApiMessage(e, "")}`)
          }
        }

        if (activeChanged && originalEntry?.existingId) {
          try {
            await api.toggleMappingGroup(originalEntry.existingId)
          } catch (e: unknown) {
            errors.push(`${t('mappings.messages.toggleFailed', { model: entry.clientModel })}: ${getApiMessage(e, "")}`)
          }
        }
      }
    }

    await loadData()
    editing.value = false

    if (errors.length > 0) {
      toast.error(t('mappings.messages.partialFail', { count: errors.length }))
    } else {
      toast.success(t('common.saveSuccess'))
    }
  } catch (e: unknown) {
    toast.error(getApiMessage(e, t('mappings.messages.saveFailed')))
  } finally {
    saving.value = false
  }
}

onMounted(loadData)
</script>
