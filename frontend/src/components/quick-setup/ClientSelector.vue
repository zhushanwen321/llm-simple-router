<script setup lang="ts">
import type { ClientType, ClientMeta } from './types'
import { CLIENTS } from './types'
import { cn } from '@/lib/utils'

defineProps<{
  modelValue: ClientType
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ClientType]
}>()

function select(client: ClientMeta) {
  emit('update:modelValue', client.id)
}
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="client in CLIENTS"
      :key="client.id"
      type="button"
      :class="cn(
        'group flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-all cursor-pointer select-none',
        modelValue === client.id
          ? 'border-[var(--ring)] bg-[var(--accent)]'
          : 'border-[var(--border)] bg-transparent hover:bg-[var(--accent)] hover:border-[var(--muted-foreground)]',
      )"
      @click="select(client)"
    >
      <!-- Icon badge -->
      <span
        :class="cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold',
          modelValue === client.id ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]',
        )"
      >
        {{ client.icon }}
      </span>

      <!-- Name -->
      <span class="font-medium text-[var(--foreground)] whitespace-nowrap">{{ client.name }}</span>

      <!-- Format tag -->
      <span
        :class="cn(
          'rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none',
          client.format === 'anthropic'
            ? 'bg-[var(--color-info-light)] text-[var(--color-info)]'
            : 'bg-[var(--color-warning-light)] text-[var(--color-warning-dark)]',
          modelValue === client.id && client.format === 'anthropic'
            ? 'dark:bg-[var(--color-info-dark)] dark:text-[var(--color-info-light)]'
            : '',
          modelValue === client.id && client.format === 'openai'
            ? 'dark:bg-[var(--color-warning)] dark:text-[var(--color-warning-light)]'
            : '',
        )"
      >
        {{ client.format === 'anthropic' ? 'Anthropic' : 'OpenAI' }}
      </span>
    </button>
  </div>
</template>
