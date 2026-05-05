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
      <Button v-if="!showAddCard" size="sm" variant="outline" @click="showAddCard = true">
        <Plus class="w-3.5 h-3.5 mr-1" />
        {{ t('providers.shared.add') }}
      </Button>
    </div>

    <!-- Mapping Cards Grid -->
    <div class="grid grid-cols-3 gap-3">
      <ModelMappingCard
        v-for="entry in entries"
        :key="entry.clientModel"
        :entry="entry"
        :provider-groups="providerGroups"
        @saved="loadData"
        @deleted="handleDelete"
      />

      <!-- Add new mapping card -->
      <ModelMappingCard
        v-if="showAddCard"
        :entry="newEntry"
        :provider-groups="providerGroups"
        :editable-client-model="true"
        :default-expanded="true"
        @saved="handleAddSaved"
        @cancel-add="showAddCard = false"
      />
    </div>

    <!-- Empty state -->
    <p v-if="entries.length === 0 && !showAddCard" class="py-8 text-center text-xs text-muted-foreground">{{ t('providers.shared.noMappings') }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Plus } from 'lucide-vue-next'
import { api, getApiMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
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
const showAddCard = ref(false)

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

const newEntry = computed<MappingEntry>(() => ({
  clientModel: '',
  targets: [{ backend_model: '', provider_id: providersList.value[0]?.id ?? '' }],
  existing: false,
  tag: 'cust' as const,
  active: true,
}))

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

// --- After add card saved ---
function handleAddSaved() {
  showAddCard.value = false
  loadData()
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
