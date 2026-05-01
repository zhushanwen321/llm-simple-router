<script setup lang="ts">
import { ref, watch } from 'vue'
import type { MappingPreviewItem } from './types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, ArrowRight } from 'lucide-vue-next'

const props = defineProps<{
  mappings: MappingPreviewItem[]
  availableModels: string[]
}>()

const emit = defineEmits<{
  'update:mappings': [value: MappingPreviewItem[]]
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

function removeMapping(from: string) {
  emit('remove', from)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && canAdd()) {
    e.preventDefault()
    addMapping()
  }
}

// Auto-fill target model when typing source model
watch(newTo, (val) => {
  // If user clears the target and there's a source, auto-suggest first available
  if (!val && newFrom.value.trim() && props.availableModels.length > 0) {
    // Don't auto-fill, let user pick
  }
})
</script>

<template>
  <div class="space-y-1.5">
    <!-- Header -->
    <div class="flex items-center gap-2 text-[10px] text-muted-foreground px-1">
      <span class="flex-1">客户端模型</span>
      <span class="w-4"></span>
      <span class="flex-1">目标模型</span>
      <span class="w-14"></span>
      <span class="w-6"></span>
    </div>

    <!-- Existing mappings -->
    <div
      v-for="item in mappings"
      :key="item.from"
      class="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm"
    >
      <span class="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{{ item.from }}</span>
      <ArrowRight class="size-3 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{{ item.to }}</span>
      <Badge :variant="tagVariants[item.tag] || 'outline'" class="shrink-0 text-[9px] px-1.5 py-0">
        {{ tagLabels[item.tag] || item.tag }}
      </Badge>
      <Button
        variant="ghost"
        size="icon-xs"
        class="shrink-0 text-muted-foreground hover:text-destructive"
        @click="removeMapping(item.from)"
      >
        <X class="size-3" />
      </Button>
    </div>

    <!-- Empty state -->
    <p v-if="mappings.length === 0" class="py-3 text-center text-xs text-muted-foreground">
      暂无映射
    </p>

    <!-- Add new mapping -->
    <div class="flex items-center gap-2 pt-1">
      <Input
        v-model="newFrom"
        placeholder="客户端模型"
        class="h-8 flex-1 text-xs font-mono"
        @keydown="handleKeydown"
      />
      <ArrowRight class="size-3 shrink-0 text-muted-foreground" />
      <Input
        v-model="newTo"
        placeholder="目标模型"
        class="h-8 flex-1 text-xs font-mono"
        @keydown="handleKeydown"
      />
      <Button
        size="sm"
        variant="outline"
        class="h-8 shrink-0"
        :disabled="!canAdd()"
        @click="addMapping"
      >
        添加
      </Button>
    </div>
  </div>
</template>
