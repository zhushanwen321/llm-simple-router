<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span class="text-xs font-medium text-muted-foreground">响应内容</span>
      <Button size="sm" variant="outline" class="h-6 gap-1 text-xs" @click="showRaw = !showRaw">
        <component :is="showRaw ? FileText : FileJson" class="h-3 w-3" />
        {{ showRaw ? '结构化' : (props.isStream ? '原始 SSE' : '原始 JSON') }}
      </Button>
    </div>

    <!-- Structured view -->
    <div v-if="!showRaw">
      <template v-if="blocks.length > 0">
        <div class="flex flex-col gap-2">
          <ContentBlockRenderer
            v-for="(block, i) in blocks"
            :key="i"
            :type="block.type"
            :content="block.content"
            :name="block.name"
            :show-cursor="props.status === 'pending' && i === blocks.length - 1"
          />
        </div>
      </template>
      <p v-else-if="props.status === 'pending'" class="text-xs text-muted-foreground">等待响应数据...</p>
      <p v-else-if="props.source === 'history' && props.isStream && !hasAnyResponseData" class="text-xs text-muted-foreground">流式响应内容未持久化存储</p>
      <p v-else class="text-xs text-muted-foreground">无响应内容</p>
    </div>

    <!-- Raw view -->
    <ScrollArea v-else class="max-h-96 rounded-md border">
      <pre class="p-3 text-[11px] whitespace-pre-wrap break-words">{{ rawContent }}</pre>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileJson, FileText } from 'lucide-vue-next'
import ContentBlockRenderer from './ContentBlockRenderer.vue'
import { tryDirectParse } from './response-parser'
import type { DataSource } from './types'
import type { ContentBlock, StreamContentSnapshot } from '@/types/monitor'
import { useSSEParsing } from '@/components/log-viewer/useSSEParsing'

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

  return assembledBlocks.value.map(b => ({
    type: (['thinking', 'text', 'tool_use'].includes(b.type) ? b.type : 'text') as ContentBlock['type'],
    content: b.content,
    ...(b.toolName ? { name: b.toolName } : {}),
  }))
})

// Raw content for raw view
const rawContent = computed(() => {
  if (props.source === 'realtime') {
    return props.streamContent?.rawChunks || props.responseBody || ''
  }
  return props.responseBody || props.upstreamResponse || ''
})
</script>
