<script setup lang="ts">
import { ref, computed } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { ProviderGroup, ModelOption, SelectedValue } from './cascading-types'

const props = withDefaults(defineProps<{
  providers: ProviderGroup[]
  modelValue?: SelectedValue
  placeholder?: string
  filterFn?: (model: ModelOption) => boolean
}>(), {
  placeholder: '选择供应商 / 模型',
})

const emit = defineEmits<{
  'update:modelValue': [value: SelectedValue]
}>()

const open = ref(false)
const hoveredProviderId = ref<string | null>(null)
const triggerRef = ref<HTMLElement | null>(null)

onClickOutside(triggerRef, () => {
  open.value = false
})

const displayText = computed(() => {
  if (!props.modelValue) return ''
  const group = props.providers.find(p => p.provider.id === props.modelValue!.provider_id)
  if (!group) return ''
  return `${group.provider.name} / ${props.modelValue.model}`
})

function formatContextWindow(cw: number): string {
  if (cw >= 1000000) return `${cw / 1000000}M`
  return `${cw / 1000}K`
}

function getFilteredModels(group: ProviderGroup): ModelOption[] {
  if (!props.filterFn) return group.models
  return group.models.filter(props.filterFn)
}

function selectModel(providerId: string, modelName: string) {
  emit('update:modelValue', { provider_id: providerId, model: modelName })
  open.value = false
}

function toggleOpen() {
  open.value = !open.value
  if (!open.value) {
    hoveredProviderId.value = null
  }
}
</script>

<template>
  <div ref="triggerRef" class="relative">
    <!-- Trigger -->
    <div
      class="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background cursor-pointer hover:bg-accent hover:text-accent-foreground"
      :class="{ 'ring-2 ring-ring ring-offset-2': open }"
      @click="toggleOpen"
    >
      <span :class="displayText ? 'text-foreground' : 'text-muted-foreground'">
        {{ displayText || placeholder }}
      </span>
      <ChevronDown class="h-4 w-4 shrink-0 opacity-50" />
    </div>

    <!-- Dropdown -->
    <div
      v-if="open"
      class="absolute z-50 mt-1"
    >
      <!-- Level 1: Provider list -->
      <div class="min-w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        <div
          v-for="group in providers"
          :key="group.provider.id"
          class="relative flex cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
          :class="{ 'bg-accent text-accent-foreground': hoveredProviderId === group.provider.id }"
          @mouseenter="hoveredProviderId = group.provider.id"
          @click.stop
        >
          <span class="truncate">{{ group.provider.name }}</span>
          <ChevronRight class="ml-1 h-4 w-4 shrink-0 opacity-50" />

          <!-- Level 2: Model list -->
          <div
            v-if="hoveredProviderId === group.provider.id && getFilteredModels(group).length > 0"
            class="absolute left-full top-0 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          >
            <div
              v-for="model in getFilteredModels(group)"
              :key="model.name"
              class="flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              :class="{
                'bg-accent text-accent-foreground': modelValue?.provider_id === group.provider.id && modelValue?.model === model.name,
              }"
              @click.stop="selectModel(group.provider.id, model.name)"
            >
              <span class="truncate">{{ model.name }}</span>
              <span class="shrink-0 text-xs text-muted-foreground">{{ formatContextWindow(model.contextWindow) }}</span>
            </div>
          </div>
        </div>

        <div
          v-if="providers.length === 0"
          class="px-2 py-1.5 text-sm text-muted-foreground"
        >
          暂无可用供应商
        </div>
      </div>
    </div>
  </div>
</template>
