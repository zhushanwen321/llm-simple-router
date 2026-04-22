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
import type { DataSource } from './types'
import type { ContentBlock, StreamContentSnapshot } from '@/types/monitor'
import { useSSEParsing } from '@/components/log-viewer/useSSEParsing'

const JSON_INDENT = 2

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

// Parse Anthropic content array into ContentBlock[]
function parseAnthropicContent(content: unknown[]): ContentBlock[] {
  return content.map((block: unknown) => {
    const b = block as Record<string, unknown>
    if (b.type === 'thinking') return { type: 'thinking' as const, content: String(b.thinking ?? '') }
    if (b.type === 'text') return { type: 'text' as const, content: String(b.text ?? '') }
    if (b.type === 'tool_use') return { type: 'tool_use' as const, content: JSON.stringify(b.input ?? {}, null, JSON_INDENT), name: String(b.name ?? '') }
    if (b.type === 'tool_result') return { type: 'tool_result' as 'tool_use', content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) }
    return { type: 'text' as const, content: JSON.stringify(b) }
  })
}

// Parse OpenAI choices into ContentBlock[]
function parseOpenAIChoices(choices: unknown[]): ContentBlock[] {
  const result: ContentBlock[] = []
  for (const choice of choices) {
    const c = choice as Record<string, unknown>
    const msg = c.message as Record<string, unknown> | undefined
    if (!msg) continue
    const content = msg.content
    if (typeof content === 'string' && content) {
      result.push({ type: 'text', content })
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const p = part as Record<string, unknown>
        if (p.type === 'text') result.push({ type: 'text', content: String(p.text ?? '') })
        else if (p.type === 'tool_use' || p.type === 'function') {
          const fn = (p.function ?? p.input ?? {}) as Record<string, unknown>
          result.push({ type: 'tool_use', content: JSON.stringify(fn, null, JSON_INDENT), name: String(p.name ?? (fn.name as string | undefined) ?? '') })
        }
      }
    }
  }
  return result
}

// Try direct JSON parse of history response body
function tryDirectParse(): ContentBlock[] {
  if (props.source !== 'history') return []
  const raw = props.responseBody || props.upstreamResponse
  if (!raw) return []

  let data: unknown
  try { data = JSON.parse(raw) } catch { /* not valid JSON */ return [] }

  // If wrapped in { body: "..." }, unwrap
  const outer = data as Record<string, unknown>
  if (typeof outer.body === 'string') {
    try { data = JSON.parse(outer.body) } catch { /* use outer data */ data = data }
  }

  const parsed = data as Record<string, unknown>

  if (props.apiType === 'anthropic' && Array.isArray(parsed.content)) {
    return parseAnthropicContent(parsed.content)
  }

  if (props.apiType === 'openai' && Array.isArray(parsed.choices)) {
    return parseOpenAIChoices(parsed.choices)
  }

  return []
}

// Unified blocks computed
const blocks = computed<ContentBlock[]>(() => {
  // Realtime: use streamContent blocks directly
  if (props.source === 'realtime') {
    return props.streamContent?.blocks ?? []
  }

  // History: try direct parse, fall back to SSE composable
  const direct = tryDirectParse()
  if (direct.length > 0) return direct

  return assembledBlocks.value.map(b => ({
    type: (['thinking', 'text', 'tool_use'].includes(b.type) ? b.type : 'text') as ContentBlock['type'],
    content: b.content,
    ...(b.toolName ? { name: b.toolName } : {}),
  }))
})

// Raw content for raw view
const rawContent = computed(() => {
  if (props.source === 'realtime') {
    return props.streamContent?.rawChunks ?? ''
  }
  return props.responseBody || props.upstreamResponse || ''
})
</script>
