<script setup lang="ts">
import { computed } from 'vue'
import { PATCH_GROUPS } from './types'
import type { PatchGroup } from './types'
import { cn } from '@/lib/utils'

const props = defineProps<{
  apiType: string
  isDeepSeek: boolean
  isNonOpenaiEndpoint: boolean
  modelValue: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const visibleGroups = computed<PatchGroup[]>(() => {
  return PATCH_GROUPS.filter((g) => {
    if (g.key === 'deepseek_anthropic') return props.isDeepSeek && props.apiType === 'anthropic'
    if (g.key === 'deepseek_openai') return props.isDeepSeek && props.apiType === 'openai'
    if (g.key === 'general') return props.apiType === 'openai' && props.isNonOpenaiEndpoint
    return true
  })
})

function toggle(patchId: string) {
  const next = props.modelValue.includes(patchId)
    ? props.modelValue.filter((id) => id !== patchId)
    : [...props.modelValue, patchId]
  emit('update:modelValue', next)
}

function isActive(patchId: string): boolean {
  return props.modelValue.includes(patchId)
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="group in visibleGroups" :key="group.key">
      <p class="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">{{ group.label }}</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="item in group.items"
          :key="item.id"
          type="button"
          :title="item.desc"
          :class="cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-all cursor-pointer select-none',
            isActive(item.id)
              ? 'border-[var(--ring)] bg-[var(--primary)]/10 text-[var(--primary)]'
              : 'border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:border-[var(--muted-foreground)] hover:text-[var(--foreground)]',
          )"
          @click="toggle(item.id)"
        >
          <span
            :class="cn(
              'size-1.5 rounded-full transition-colors',
              isActive(item.id) ? 'bg-[var(--primary)]' : 'bg-[var(--border)]',
            )"
          />
          {{ item.name }}
        </button>
      </div>
    </div>
  </div>
</template>
