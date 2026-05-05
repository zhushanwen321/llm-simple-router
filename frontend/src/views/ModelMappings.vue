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
      <ArrowRight class="size-3 shrink-0 text-muted-foreground/30" />
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
import { ArrowRight } from 'lucide-vue-next'
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
