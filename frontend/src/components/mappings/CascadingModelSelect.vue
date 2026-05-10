<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import CascadingSelect from '@/components/ui/cascading-select/CascadingSelect.vue'
import type { CascadingGroup, CascadingSelectedValue } from '@/components/ui/cascading-select'
import type { ProviderGroup, SelectedValue } from './cascading-types'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  providers: ProviderGroup[]
  modelValue?: SelectedValue
  placeholder?: string
  compact?: boolean
}>(), {
  placeholder: '',
})

const resolvedPlaceholder = computed(() => props.placeholder || t('mappings.selectProviderModel'))

const emit = defineEmits<{
  'update:modelValue': [value: SelectedValue]
}>()

const CONTEXT_MILLION = 1_000_000
const CONTEXT_THOUSAND = 1_000

function formatContextWindow(cw: number): string {
  if (cw >= CONTEXT_MILLION) return `${cw / CONTEXT_MILLION}M`
  return `${cw / CONTEXT_THOUSAND}K`
}

const groups = computed<CascadingGroup[]>(() =>
  props.providers.map(g => ({
    key: g.provider.id,
    label: g.provider.name,
    badge: g.isNew ? t('common.new') : undefined,
    options: g.models.map(m => ({
      value: m.name,
      label: m.name,
      tag: formatContextWindow(m.contextWindow),
    })),
  })),
)

const selectedValue = computed<CascadingSelectedValue | undefined>(() =>
  props.modelValue
    ? { groupKey: props.modelValue.provider_id, value: props.modelValue.model }
    : undefined,
)

function onUpdate(val: CascadingSelectedValue) {
  emit('update:modelValue', { provider_id: val.groupKey, model: val.value })
}
</script>

<template>
  <CascadingSelect
    :groups="groups"
    :model-value="selectedValue"
    :placeholder="resolvedPlaceholder"
    :compact="compact"
    @update:model-value="onUpdate"
  />
</template>
