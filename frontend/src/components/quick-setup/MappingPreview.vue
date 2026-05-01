<script setup lang="ts">
import { ref } from 'vue'
import type { MappingPreviewItem } from './types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-vue-next'

const props = defineProps<{
  mappings: MappingPreviewItem[]
  availableModels: string[]
}>()

const emit = defineEmits<{
  'remove': [from: string]
  'add': [from: string, to: string]
}>()

const newFrom = ref('')
const newTo = ref('')

const tagLabels: Record<string, string> = {
  def: '默认',
  auto: '自动',
  cust: '自定义',
}

const tagVariants: Record<string, 'outline' | 'secondary' | 'default'> = {
  def: 'outline',
  auto: 'secondary',
  cust: 'default',
}

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
    addMapping()
  }
}
</script>

<template>
  <div class="space-y-2">
    <!-- Existing mappings -->
    <div
      v-for="item in mappings"
      :key="item.from"
      class="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
    >
      <span class="min-w-0 flex-1 truncate font-mono text-xs text-[var(--foreground)]">{{ item.from }}</span>
      <svg
        class="size-3.5 shrink-0 text-[var(--muted-foreground)]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <span class="min-w-0 flex-1 truncate font-mono text-xs text-[var(--foreground)]">{{ item.to }}</span>
      <Badge :variant="tagVariants[item.tag] || 'outline'" class="shrink-0 text-[10px]">
        {{ tagLabels[item.tag] || item.tag }}
      </Badge>
      <Button
        variant="ghost"
        size="icon-xs"
        class="shrink-0 text-[var(--muted-foreground)] hover:text-destructive"
        @click="$emit('remove', item.from)"
      >
        <X class="size-3" />
      </Button>
    </div>

    <!-- Empty state -->
    <p v-if="mappings.length === 0" class="py-2 text-center text-xs text-[var(--muted-foreground)]">
      暂无映射配置
    </p>

    <!-- Add new mapping -->
    <div class="flex items-center gap-2">
      <div class="flex flex-1 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5">
        <Input
          v-model="newFrom"
          placeholder="原始模型名"
          class="h-7 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
          @keydown="handleKeydown"
        />
        <svg
          class="size-3.5 shrink-0 text-[var(--muted-foreground)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <Input
          v-model="newTo"
          placeholder="目标模型名"
          class="h-7 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
          @keydown="handleKeydown"
        />
      </div>
      <Button
        size="sm"
        :disabled="!canAdd()"
        @click="addMapping"
      >
        添加
      </Button>
    </div>
  </div>
</template>
