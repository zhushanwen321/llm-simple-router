<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ArrowRight } from 'lucide-vue-next'
import MappingEntryEditor from '@/components/mappings/MappingEntryEditor.vue'
import type { MappingTarget, MappingEntry } from '@/components/quick-setup/types'
import type { ProviderGroup } from '@/components/mappings/cascading-types'

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
