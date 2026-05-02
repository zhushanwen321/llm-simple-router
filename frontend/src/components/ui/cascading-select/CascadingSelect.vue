<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { CascadingGroup, CascadingSelectedValue } from './types'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  groups: CascadingGroup[]
  modelValue?: CascadingSelectedValue
  placeholder?: string
  compact?: boolean
}>(), {
  placeholder: '',
  compact: false,
})

const resolvedPlaceholder = computed(() => props.placeholder || t('common.selectPlaceholder'))

const emit = defineEmits<{
  'update:modelValue': [value: CascadingSelectedValue]
}>()

const open = ref(false)
const hoveredGroupKey = ref<string | null>(null)

const displayText = computed(() => {
  if (!props.modelValue) return ''
  const group = props.groups.find(g => g.key === props.modelValue!.groupKey)
  if (!group) return ''
  const option = group.options.find(o => o.value === props.modelValue!.value)
  if (!option) return ''
  return `${group.label} / ${option.label}`
})

function selectOption(groupKey: string, value: string) {
  emit('update:modelValue', { groupKey, value })
  open.value = false
}

function onOpenChange(val: boolean) {
  open.value = val
  if (!val) hoveredGroupKey.value = null
}
</script>

<template>
  <Popover :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <div
        class="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background cursor-pointer hover:bg-accent hover:text-accent-foreground"
        :class="[compact ? 'h-8 text-xs px-2.5 py-1' : 'h-10 text-sm px-3 py-2', { 'ring-2 ring-ring ring-offset-2': open }]"
      >
        <span class="truncate" :class="modelValue ? 'text-foreground' : 'text-muted-foreground'">
          {{ displayText || resolvedPlaceholder }}
        </span>
        <ChevronDown class="h-4 w-4 shrink-0 opacity-50" />
      </div>
    </PopoverTrigger>

    <!-- z-[200] > dialog overlay z-modal(100) -->
    <PopoverContent :align="'start'" :side-offset="4" class="z-[200] w-auto min-w-56 overflow-visible p-1">
      <div
        v-for="group in groups"
        :key="group.key"
        class="relative flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
        :class="{ 'bg-accent text-accent-foreground z-10': hoveredGroupKey === group.key }"
        @mouseenter="hoveredGroupKey = group.key"
      >
        <span class="truncate max-w-40">{{ group.label }}</span>
        <span v-if="group.badge" class="ml-1 text-[10px] px-1 py-px rounded bg-emerald-500/15 text-emerald-400 shrink-0">{{ group.badge }}</span>
        <ChevronRight class="ml-1 h-4 w-4 shrink-0 opacity-50" />

        <!-- Level 2 -->
        <div
          v-if="hoveredGroupKey === group.key && group.options.length > 0"
          class="absolute left-full top-0 ml-0.5 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          @mouseenter="hoveredGroupKey = group.key"
        >
          <div
            v-for="option in group.options"
            :key="option.value"
            class="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            :class="{
              'bg-accent text-accent-foreground': modelValue?.groupKey === group.key && modelValue?.value === option.value,
            }"
            @click="selectOption(group.key, option.value)"
          >
            <span class="truncate">{{ option.label }}</span>
            <span v-if="option.tag" class="shrink-0 text-xs text-muted-foreground">{{ option.tag }}</span>
          </div>
        </div>
      </div>

      <div v-if="groups.length === 0" class="px-2 py-1.5 text-sm text-muted-foreground">
        {{ t('common.noOptions') }}
      </div>
    </PopoverContent>
  </Popover>
</template>
