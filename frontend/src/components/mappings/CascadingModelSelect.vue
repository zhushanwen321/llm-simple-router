<script setup lang="ts">
import { computed } from 'vue'
import CascadingSelect from '@/components/ui/cascading-select/CascadingSelect.vue'
import type { CascadingGroup, CascadingSelectedValue } from '@/components/ui/cascading-select'
import type { ProviderGroup, SelectedValue } from './cascading-types'

const props = withDefaults(defineProps<{
  providers: ProviderGroup[]
  modelValue?: SelectedValue
  placeholder?: string
  compact?: boolean
}>(), {
  placeholder: '选择供应商 / 模型',
})

const emit = defineEmits<{
  'update:modelValue': [value: SelectedValue]
}>()

function formatContextWindow(cw: number): string {
  if (cw >= 1000000) return `${cw / 1000000}M`
  return `${cw / 1000}K`
}

const groups = computed<CascadingGroup[]>(() =>
  props.providers.map(g => ({
    key: g.provider.id,
    label: g.provider.name,
    badge: g.isNew ? '新' : undefined,
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
    :placeholder="placeholder"
    :compact="compact"
    @update:model-value="onUpdate"
  />
</template>
