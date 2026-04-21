<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div v-if="!isStream" class="flex items-center justify-center h-full text-sm text-muted-foreground">
    非流式请求无实时内容
  </div>
  <div v-else-if="!streamContent" class="flex items-center justify-center h-full text-sm text-muted-foreground">
    等待流数据...
  </div>
  <Tabs v-else :default-value="hasBlocks ? 'structured' : 'raw'" class="flex flex-col h-full">
    <TabsList class="w-fit">
      <TabsTrigger value="structured">响应内容</TabsTrigger>
      <TabsTrigger value="raw">原始 SSE</TabsTrigger>
    </TabsList>
    <TabsContent value="structured" class="flex-1 overflow-y-auto mt-2">
      <div v-if="hasBlocks" class="space-y-2">
        <template v-for="(block, i) in streamContent!.blocks" :key="i">
          <!-- Thinking: 可折叠，默认展开 -->
          <Collapsible
            v-if="block.type === 'thinking' && block.content"
            :open="thinkingOpen[i] ?? true"
            @update:open="thinkingOpen[i] = $event"
          >
            <div class="rounded-md border bg-card">
              <CollapsibleTrigger as-child>
                <div class="flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer hover:bg-muted/50 rounded-t-md">
                  <ChevronRight class="h-3 w-3 transition-transform" :class="{ 'rotate-90': thinkingOpen[i] ?? true }" />
                  <Brain class="h-3.5 w-3.5 text-muted-foreground" />
                  <span class="text-xs font-medium">Thinking</span>
                  <span class="text-xs text-muted-foreground">({{ block.content.length }} 字符)</span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div class="px-2.5 pb-2">
                  <pre class="text-xs bg-muted/50 rounded p-2 overflow-y-auto whitespace-pre-wrap break-words max-h-60 text-muted-foreground italic"><code>{{ block.content }}</code></pre>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
          <!-- Text: "Reply" 标题 -->
          <div v-else-if="block.type === 'text' && block.content" class="rounded-md border bg-card">
            <div class="flex items-center gap-1.5 px-2.5 py-1.5 border-b">
              <MessageSquare class="h-3.5 w-3.5 text-muted-foreground" />
              <span class="text-xs font-medium">Reply</span>
            </div>
            <div class="px-2.5 py-2">
              <pre ref="textContentRefs" class="text-xs overflow-y-auto whitespace-pre-wrap break-words max-h-60"><code>{{ block.content }}</code></pre>
            </div>
          </div>
          <!-- Tool Use: 可折叠，默认折叠但显示工具名 -->
          <Collapsible v-else-if="block.type === 'tool_use'" :open="toolOpen[i] ?? false" @update:open="toolOpen[i] = $event">
            <div class="rounded-md border bg-card">
              <CollapsibleTrigger as-child>
                <div class="flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer hover:bg-muted/50 rounded-t-md">
                  <ChevronRight class="h-3 w-3 transition-transform" :class="{ 'rotate-90': toolOpen[i] ?? false }" />
                  <Wrench class="h-3.5 w-3.5 text-muted-foreground" />
                  <span class="text-xs font-medium">Tool Use</span>
                  <Badge v-if="block.name" variant="outline" class="text-xs">{{ block.name }}</Badge>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div class="px-2.5 pb-2">
                  <pre class="text-xs bg-muted/50 rounded p-2 overflow-y-auto whitespace-pre-wrap break-words max-h-60"><code>{{ block.content || '(等待数据...)' }}</code></pre>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </template>
      </div>
      <!-- 回退：无 blocks 时展示 textContent -->
      <div v-else-if="streamContent.textContent">
        <div class="rounded-md border bg-card">
          <div class="flex items-center gap-1.5 px-2.5 py-1.5 border-b">
            <MessageSquare class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="text-xs font-medium">Reply</span>
          </div>
          <div class="px-2.5 py-2">
            <pre
              ref="textContentRef"
              class="text-xs overflow-y-auto whitespace-pre-wrap break-words max-h-80"
            ><code>{{ streamContent.textContent }}</code></pre>
          </div>
        </div>
      </div>
      <div v-else class="text-sm text-muted-foreground py-4 text-center">
        暂无内容
      </div>
    </TabsContent>
    <TabsContent value="raw" class="flex-1 overflow-y-auto mt-2">
      <pre
        v-if="streamContent.rawChunks"
        class="text-xs bg-muted/50 rounded p-2 overflow-y-auto whitespace-pre-wrap break-words max-h-[60vh]"
      ><code>{{ streamContent.rawChunks }}</code></pre>
      <div v-else class="text-sm text-muted-foreground py-4 text-center">
        暂无数据
      </div>
    </TabsContent>
  </Tabs>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Badge } from '@/components/ui/badge'
import type { StreamMetricsSnapshot, StreamContentSnapshot } from '@/types/monitor'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Brain, ChevronRight, MessageSquare, Wrench } from 'lucide-vue-next'

const props = defineProps<{
  metrics: StreamMetricsSnapshot | null
  isStream: boolean
  streamContent?: StreamContentSnapshot
}>()

const textContentRef = ref<HTMLPreElement | null>(null)
const textContentRefs = ref<HTMLPreElement[]>([])
const thinkingOpen = ref<Record<number, boolean>>({})
const toolOpen = ref<Record<number, boolean>>({})

const hasBlocks = computed(() => {
  const blocks = props.streamContent?.blocks
  return Boolean(blocks && blocks.length > 0 && blocks.some(b => b.type !== 'text' || b.content.length > 0))
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
</script>
