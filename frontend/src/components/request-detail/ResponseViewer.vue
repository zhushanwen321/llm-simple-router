<template>
  <div class="flex flex-col gap-2 min-h-0 flex-1">
    <div class="flex items-center justify-between flex-shrink-0">
      <span class="text-xs font-medium text-muted-foreground">响应内容</span>
      <Button size="sm" variant="outline" class="h-6 gap-1 text-xs" @click="showRaw = !showRaw">
        <component :is="showRaw ? FileText : FileJson" class="h-3 w-3" />
        {{ showRaw ? '结构化' : (props.isStream ? '原始 SSE' : '原始 JSON') }}
      </Button>
    </div>

    <!-- Structured view -->
    <div v-if="!showRaw" class="relative flex-1 min-h-0">
      <div ref="structuredRef" class="flex-1 min-h-0 overflow-y-auto" @scroll="onStructuredScroll">
        <template v-if="blocks.length > 0">
          <div class="flex flex-col gap-2">
            <ContentBlockRenderer
              v-for="(block, i) in blocks"
              :key="i"
              :type="block.type"
              :content="block.content"
              :name="block.name"
              :show-cursor="props.status === 'pending' && i === blocks.length - 1"
              :auto-scroll="props.status === 'pending' && i === blocks.length - 1"
            />
          </div>
        </template>
        <p v-else-if="props.status === 'pending'" class="text-xs text-muted-foreground">等待响应数据...</p>
        <p v-else-if="props.source === 'history' && props.isStream && !hasAnyResponseData" class="text-xs text-muted-foreground">流式响应内容未持久化存储</p>
        <p v-else class="text-xs text-muted-foreground">无响应内容</p>
      </div>
      <!-- Scroll to bottom button -->
      <Button
        v-if="isUserScrolling"
        variant="outline"
        size="icon"
        class="absolute bottom-2 right-2 h-7 w-7 rounded-full shadow-md opacity-80 hover:opacity-100"
        @click="scrollToBottom"
      >
        <ArrowDown class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- Raw view -->
    <ScrollArea v-else class="flex-1 min-h-0 rounded-md border">
      <pre class="p-3 text-[11px] whitespace-pre-wrap break-words">{{ rawContent }}</pre>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileJson, FileText, ArrowDown } from 'lucide-vue-next'
import ContentBlockRenderer from './ContentBlockRenderer.vue'
import { tryDirectParse } from './response-parser'
import type { DataSource } from './types'
import type { ContentBlock, StreamContentSnapshot } from '@/types/monitor'
import { useSSEParsing } from '@/components/log-viewer/useSSEParsing'
import { mergeUpstreamData } from './upstream-merge'

const structuredRef = ref<HTMLElement | null>(null)

const props = withDefaults(defineProps<{
  source: DataSource
  apiType: 'openai' | 'anthropic'
  isStream: boolean
  streamContent?: StreamContentSnapshot | null
  nonStreamBody?: string | null
  responseBody?: string | null
  upstreamResponse?: string | null
  status: 'pending' | 'completed' | 'failed'
}>(), {
  streamContent: null,
  nonStreamBody: null,
  responseBody: null,
  upstreamResponse: null,
})

const showRaw = ref(false)

const hasAnyResponseData = computed(() => !!(props.responseBody || props.upstreamResponse))

// SSE composable must be called unconditionally; pass empty for realtime mode
const sseBodyForParsing = computed(() => {
  if (props.source !== 'history') return ''
  const raw = props.responseBody || props.upstreamResponse || ''
  try {
    const parsed = JSON.parse(raw)
    return parsed.body || raw
  } catch { /* not JSON */ return raw }
})

const { assembledBlocks } = useSSEParsing(
  sseBodyForParsing,
  props.isStream,
  props.apiType,
)

// Unified blocks computed
const blocks = computed<ContentBlock[]>(() => {
  if (props.source === 'realtime') {
    const streamBlocks = props.streamContent?.blocks
    if (streamBlocks && streamBlocks.length > 0) return streamBlocks
    if (props.responseBody) {
      const direct = tryDirectParse(props.responseBody, null, props.apiType)
      if (direct.length > 0) return direct
    }
    return []
  }

  const direct = tryDirectParse(props.responseBody ?? null, props.upstreamResponse ?? null, props.apiType)
  if (direct.length > 0) return direct

  // 流式请求的纯文本回退：responseBody 不是 JSON 时，直接作为 text block 展示
  if (props.responseBody && props.responseBody.trim().length > 0) {
    return [{ type: 'text' as const, content: props.responseBody }]
  }

  const validTypes = ['thinking', 'text', 'tool_use', 'tool_result'] as const
  return assembledBlocks.value.map(b => ({
    type: validTypes.includes(b.type as typeof validTypes[number]) ? b.type as ContentBlock['type'] : 'text' as const,
    content: b.content,
    ...(b.toolName ? { name: b.toolName } : {}),
  }))
})

// Raw content for raw view: merge upstreamResponse (headers) with responseBody (stream_text_content)
const rawContent = computed(() => {
  if (props.source === 'realtime') {
    return props.streamContent?.rawChunks || props.responseBody || ''
  }
  return mergeUpstreamData(props.upstreamResponse ?? null, props.responseBody ?? null)
})

// --- Auto-scroll logic ---
const isUserScrolling = ref(false)
const SCROLL_THRESHOLD = 50

function onStructuredScroll() {
  const el = structuredRef.value
  if (!el) return
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  isUserScrolling.value = distanceFromBottom > SCROLL_THRESHOLD
}

function scrollToBottom() {
  const el = structuredRef.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(blocks, () => {
  if (isUserScrolling.value) return
  nextTick(() => scrollToBottom())
}, { deep: true })
</script>
