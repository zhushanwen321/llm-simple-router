<script setup lang="ts">
import { ref } from 'vue'
import type { ModelConfig } from './types'
import PatchChips from './PatchChips.vue'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDown, Trash2 } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

const props = defineProps<{
  model: ModelConfig
  apiType: string
  isDeepSeek: boolean
  isNonOpenaiEndpoint: boolean
}>()

const emit = defineEmits<{
  'update:model': [value: ModelConfig]
  'remove': []
}>()

const open = ref(false)

function toggleEnabled() {
  emit('update:model', { ...props.model, enabled: !props.model.enabled })
}

function updateContextWindow(value: string) {
  const num = parseInt(value, 10)
  if (!isNaN(num) && num >= 0) {
    emit('update:model', { ...props.model, contextWindow: num })
  }
}

function updatePatches(patches: string[]) {
  emit('update:model', { ...props.model, patches })
}
</script>

<template>
  <div
    :class="cn(
      'rounded-lg border px-4 py-3 transition-colors',
      model.enabled
        ? 'border-[var(--border)] bg-[var(--card)]'
        : 'border-[var(--border)]/50 bg-[var(--muted)]/30 opacity-60',
    )"
  >
    <div class="flex items-start gap-3">
      <!-- Checkbox -->
      <div class="flex h-7 items-center pt-0.5">
        <Checkbox
          :checked="model.enabled"
          @update:checked="toggleEnabled"
        />
      </div>

      <!-- Main area -->
      <div class="min-w-0 flex-1">
        <!-- Row 1: name + badge + context window -->
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="truncate text-sm font-medium text-[var(--foreground)]">{{ model.name }}</span>
            <span
              v-if="isDeepSeek"
              class="inline-flex items-center rounded-sm bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--primary)] leading-none"
            >
              DeepSeek
            </span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <label class="text-xs text-[var(--muted-foreground)] whitespace-nowrap">最大上下文</label>
            <Input
              :model-value="String(model.contextWindow)"
              type="number"
              min="0"
              class="h-7 w-24 text-xs text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              @update:model-value="updateContextWindow($event as string)"
            />
          </div>
        </div>

        <!-- Expander: PatchChips -->
        <Collapsible v-if="model.enabled" v-model:open="open" class="mt-1">
          <CollapsibleTrigger as-child>
            <button
              type="button"
              class="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors cursor-pointer select-none"
            >
              <ChevronDown
                :class="cn(
                  'size-3 transition-transform',
                  open ? 'rotate-0' : '-rotate-90',
                )"
              />
              {{ open ? '收起补丁' : `补丁 (${model.patches.length})` }}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent class="pt-2">
            <PatchChips
              :api-type="apiType"
              :is-deep-seek="isDeepSeek"
              :is-non-openai-endpoint="isNonOpenaiEndpoint"
              :model-value="model.patches"
              @update:model-value="updatePatches"
            />
          </CollapsibleContent>
        </Collapsible>
      </div>

      <!-- Remove button -->
      <div class="flex h-7 items-center pt-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          class="text-[var(--muted-foreground)] hover:text-destructive"
          @click="$emit('remove')"
        >
          <Trash2 class="size-3.5" />
        </Button>
      </div>
    </div>
  </div>
</template>
