<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div v-if="!isStream" class="text-sm text-muted-foreground py-2 text-center">
    非流式请求
  </div>
  <div v-else class="space-y-3">
    <!-- 流式指标卡片 -->
    <div class="grid grid-cols-2 gap-2 text-sm">
      <!-- Input Tokens -->
      <div class="bg-muted/50 rounded px-2 py-1.5">
        <p class="text-xs text-muted-foreground">Input Tokens</p>
        <p class="font-medium text-foreground">{{ metrics?.inputTokens ?? '--' }}</p>
      </div>
      <!-- Output Tokens：有值显示值，无值但有流内容则估算 -->
      <div class="bg-muted/50 rounded px-2 py-1.5">
        <p class="text-xs text-muted-foreground">Output Tokens</p>
        <p class="font-medium text-foreground">{{ outputDisplay }}</p>
      </div>
      <!-- TTFT -->
      <div class="bg-muted/50 rounded px-2 py-1.5">
        <p class="text-xs text-muted-foreground">TTFT</p>
        <p class="font-medium text-foreground">
          {{ metrics?.ttftMs != null ? `${metrics.ttftMs.toFixed(0)}ms` : '--' }}
        </p>
      </div>
      <!-- 状态 / 已接收 -->
      <div class="bg-muted/50 rounded px-2 py-1.5">
        <p class="text-xs text-muted-foreground">{{ metrics?.isComplete ? '已完成' : '状态' }}</p>
        <div class="flex items-center gap-1.5 mt-0.5">
          <template v-if="metrics?.isComplete">
            <Badge variant="secondary">已完成</Badge>
            <Badge v-if="metrics.stopReason" variant="outline">
              {{ metrics.stopReason }}
            </Badge>
          </template>
          <template v-else>
            <Badge>{{ streamContent?.totalChars ? `进行中 · ${formatChars(streamContent.totalChars)} 字符` : '进行中' }}</Badge>
          </template>
        </div>
      </div>
    </div>

    <!-- 流内容区域 -->
    <template v-if="streamContent">
      <!-- 结构化内容展示（优先使用 blocks） -->
      <div v-if="hasBlocks" class="space-y-2">
        <p class="text-xs text-muted-foreground">响应内容</p>
        <template v-for="(block, i) in streamContent!.blocks" :key="i">
          <!-- Thinking 块：可折叠 -->
          <Collapsible v-if="block.type === 'thinking' && block.content" v-model:open="thinkingOpen[i]">
            <CollapsibleTrigger as-child>
              <Button variant="ghost" size="sm" class="h-auto p-1 text-xs text-muted-foreground gap-1">
                <ChevronRight class="h-3 w-3 transition-transform" :class="{ 'rotate-90': thinkingOpen[i] }" />
                <Brain class="h-3 w-3" />
                Thinking ({{ block.content.length }} 字符)
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre class="text-xs bg-muted/50 rounded p-2 overflow-y-auto whitespace-pre-wrap break-words max-h-60 text-muted-foreground italic"><code>{{ block.content }}</code></pre>
            </CollapsibleContent>
          </Collapsible>
          <!-- Text 块：直接展示 -->
          <div v-else-if="block.type === 'text' && block.content">
            <pre ref="textContentRefs" class="text-xs bg-muted/50 rounded p-2 overflow-y-auto whitespace-pre-wrap break-words max-h-60"><code>{{ block.content }}</code></pre>
          </div>
          <!-- Tool use 块：可折叠 -->
          <Collapsible v-else-if="block.type === 'tool_use' && block.content" v-model:open="toolOpen[i]">
            <CollapsibleTrigger as-child>
              <Button variant="ghost" size="sm" class="h-auto p-1 text-xs text-muted-foreground gap-1">
                <ChevronRight class="h-3 w-3 transition-transform" :class="{ 'rotate-90': toolOpen[i] }" />
                <Wrench class="h-3 w-3" />
                Tool Use
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre class="text-xs bg-muted/50 rounded p-2 overflow-y-auto whitespace-pre-wrap break-words max-h-60"><code>{{ block.content }}</code></pre>
            </CollapsibleContent>
          </Collapsible>
        </template>
      </div>
      <!-- 回退：无 blocks 时使用 textContent -->
      <div v-else-if="streamContent.textContent" class="space-y-1">
        <p class="text-xs text-muted-foreground">内容摘要</p>
        <pre
          ref="textContentRef"
          class="text-xs bg-muted/50 rounded p-2 overflow-y-auto whitespace-pre-wrap break-words max-h-60"
        ><code>{{ streamContent.textContent }}</code></pre>
      </div>

      <!-- 原始 SSE（可折叠） -->
      <Collapsible v-if="streamContent.rawChunks" v-model:open="rawOpen">
        <div class="flex items-center gap-2">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" size="sm" class="h-auto p-1 text-xs text-muted-foreground">
              <ChevronRight class="h-3 w-3 transition-transform" :class="{ 'rotate-90': rawOpen }" />
              原始 SSE
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <pre
            class="text-xs bg-muted/50 rounded p-2 overflow-y-auto whitespace-pre-wrap break-words max-h-60"
          ><code>{{ streamContent.rawChunks }}</code></pre>
        </CollapsibleContent>
      </Collapsible>
    </template>
  </div>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Brain, ChevronRight, Wrench } from 'lucide-vue-next'

interface StreamMetricsSnapshot {
  inputTokens: number | null
  outputTokens: number | null
  ttftMs: number | null
  stopReason: string | null
  isComplete: boolean
}

interface StreamContentSnapshot {
  rawChunks: string
  textContent: string
  totalChars: number
  blocks?: Array<{ type: 'thinking' | 'text' | 'tool_use'; content: string }>
}

const props = defineProps<{
  metrics: StreamMetricsSnapshot | null
  isStream: boolean
  streamContent?: StreamContentSnapshot
}>()

const rawOpen = ref(false)
const textContentRef = ref<HTMLPreElement | null>(null)
const textContentRefs = ref<HTMLPreElement[]>([])
const thinkingOpen = ref<Record<number, boolean>>({})
const toolOpen = ref<Record<number, boolean>>({})

const hasBlocks = computed(() => {
  const blocks = props.streamContent?.blocks
  return Boolean(blocks && blocks.length > 0 && blocks.some(b => b.content.length > 0))
})

// 文本内容更新时自动滚到底部
watch(
  () => props.streamContent?.textContent,
  () => {
    nextTick(() => {
      if (textContentRef.value) {
        textContentRef.value.scrollTop = textContentRef.value.scrollHeight
      }
      for (const el of textContentRefs.value) {
        el.scrollTop = el.scrollHeight
      }
    })
  },
)

// 粗略估算：约 4 字符 = 1 token
const CHARS_PER_TOKEN = 4

function estimateTokens(totalChars: number): number {
  return Math.round(totalChars / CHARS_PER_TOKEN)
}

const outputDisplay = computed(() => {
  if (props.metrics?.outputTokens != null) return String(props.metrics.outputTokens)
  const chars = props.streamContent?.totalChars
  if (chars && chars > 0) return `~${estimateTokens(chars)} (估)`
  return '--'
})

function formatChars(count: number): string {
  if (count < 1024) return String(count)
  return `${(count / 1024).toFixed(1)}K`
}
</script>
