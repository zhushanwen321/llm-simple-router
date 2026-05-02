<template>
  <!-- Text blocks are always open, no collapsible -->
  <div v-if="type === 'text'" class="rounded-md border bg-card">
    <div class="flex items-center gap-1.5 px-2.5 py-1.5 border-b">
      <MessageSquare class="h-3.5 w-3.5 diff-added" />
      <span class="text-xs font-medium">{{ t('requestDetail.reply') }}</span>
    </div>
    <div class="px-2.5 py-2">
      <pre ref="contentRef" class="text-xs overflow-y-auto whitespace-pre-wrap break-words" style="max-height: 300px"><code>{{ content }}<span v-if="showCursor" class="inline-block w-1.5 h-3.5 dot-success animate-pulse ml-0.5 align-text-bottom" /></code></pre>
    </div>
  </div>

  <!-- Thinking / Tool Use / Tool Result: collapsible -->
  <Collapsible v-else v-model:open="isOpen" class="rounded-md border" :class="wrapperClass">
    <CollapsibleTrigger as-child>
      <div class="flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer hover:brightness-95 rounded-t-md">
        <ChevronDown class="h-3 w-3 transition-transform duration-200" :class="{ 'rotate-180': !isOpen }" />
        <component :is="headerIcon" class="h-3.5 w-3.5" :class="iconColorClass" />
        <span class="text-xs font-medium">{{ headerLabel }}</span>
        <span v-if="type === 'thinking'" class="text-xs text-muted-foreground">({{ t('requestDetail.charCount', { count: content.length }) }})</span>
        <Badge v-if="type === 'tool_use' && name" variant="secondary" class="text-xs">{{ name }}</Badge>
      </div>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div class="px-2.5 pb-2">
        <pre ref="contentRef" class="text-xs rounded p-2 overflow-y-auto whitespace-pre-wrap break-words" style="max-height: 300px" :class="contentClass"><code>{{ content || placeholder }}</code></pre>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { Brain, ChevronDown, CheckCircle, MessageSquare, Wrench } from 'lucide-vue-next'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result'
  content: string
  name?: string
  defaultOpen?: boolean
  showCursor?: boolean
  autoScroll?: boolean
}>(), {
  name: undefined,
  defaultOpen: true,
  showCursor: false,
  autoScroll: false,
})

const isOpen = ref(props.type === 'text' ? true : props.defaultOpen)
const contentRef = ref<HTMLElement | null>(null)

const wrapperClass = computed(() => {
  switch (props.type) {
    case 'thinking': return 'block-thinking'
    case 'tool_use': return 'block-tool-use'
    case 'tool_result': return 'block-tool-result'
    default: return 'bg-card'
  }
})

const contentClass = computed(() => {
  switch (props.type) {
    case 'thinking': return 'block-thinking-content italic'
    case 'tool_use': return 'block-tool-use-content'
    case 'tool_result': return 'block-tool-result-content'
    default: return 'bg-muted/50'
  }
})

const headerIcon = computed(() => {
  switch (props.type) {
    case 'thinking': return Brain
    case 'tool_use': return Wrench
    case 'tool_result': return CheckCircle
    default: return MessageSquare
  }
})

const iconColorClass = computed(() => {
  switch (props.type) {
    case 'thinking': return 'text-[var(--color-role-thinking)]'
    case 'tool_use': return 'text-[var(--color-role-tool)]'
    case 'tool_result': return 'text-[var(--color-role-user)]'
    default: return 'text-muted-foreground'
  }
})

const headerLabel = computed(() => {
  switch (props.type) {
    case 'thinking': return t('requestDetail.thinking')
    case 'tool_use': return t('requestDetail.toolUse')
    case 'tool_result': return t('requestDetail.toolResultLabel')
    default: return ''
  }
})

const placeholder = computed(() => {
  if (props.type === 'tool_use') return t('requestDetail.waitingData')
  if (props.type === 'tool_result') return t('requestDetail.noReturnData')
  return ''
})

// Auto-scroll: when autoScroll is on and content grows, scroll <pre> to bottom
watch(() => props.content, () => {
  if (!props.autoScroll) return
  nextTick(() => {
    const el = contentRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
})
</script>
