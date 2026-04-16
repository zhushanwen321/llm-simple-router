<template>
  <Tabs :default-value="mode ?? 'structured'" :model-value="mode" class="w-full">
    <!-- 外部控制模式时不渲染内部控制栏 -->
    <div v-if="!mode" class="flex items-center justify-between py-2 border-b mb-2">
      <TabsList>
        <TabsTrigger value="structured">结构化</TabsTrigger>
        <TabsTrigger value="raw">原始 JSON</TabsTrigger>
      </TabsList>
      <Button variant="ghost" size="xs" class="h-auto px-2 py-1 text-xs" @click="copyRaw">
        {{ copied ? '已复制' : '复制 JSON' }}
      </Button>
    </div>

    <TabsContent value="structured" class="space-y-3">
      <template v-if="parseError">
        <div class="text-destructive text-sm">解析失败，请切换到原始 JSON 查看</div>
      </template>
      <template v-else>
        <!-- Claude Code context card -->
        <Card v-if="isClaudeCode" class="border-border bg-info-light">
          <CardHeader class="pb-2">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-info-dark dark:text-info">Claude Code 请求</span>
              <Badge variant="secondary">{{ claudeMode }}</Badge>
            </div>
          </CardHeader>
          <CardContent class="flex flex-wrap gap-3 text-sm text-info-dark dark:text-info">
            <div v-if="thinkingBudget != null">Thinking budget: {{ thinkingBudget }}</div>
            <div v-if="toolsCount != null">Tools: {{ toolsCount }}</div>
          </CardContent>
        </Card>

        <!-- URL -->
        <div v-if="showUrl && parsed.url" class="text-xs text-muted-foreground break-all">
          {{ parsed.url }}
        </div>

        <!-- Parameter badges -->
        <div class="flex flex-wrap gap-2">
          <Badge v-if="(parsed.body as Record<string, unknown>)?.model" variant="outline">model: {{ String((parsed.body as Record<string, unknown>).model) }}</Badge>
          <Badge v-if="(parsed.body as Record<string, unknown>)?.stream != null" variant="outline">stream: {{ String((parsed.body as Record<string, unknown>).stream) }}</Badge>
          <Badge v-if="(parsed.body as Record<string, unknown>)?.max_tokens != null" variant="outline">max_tokens: {{ String((parsed.body as Record<string, unknown>).max_tokens) }}</Badge>
          <Badge v-if="(parsed.body as Record<string, unknown>)?.thinking != null" variant="outline">thinking</Badge>
        </div>

        <!-- Headers -->
        <Collapsible v-model:open="headersOpen">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" size="xs" class="px-0 h-auto text-xs">
              Headers ({{ headerEntries.length }} 个)
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="rounded-md border overflow-hidden mt-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-1/3">Key</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="[k, v] in headerEntries" :key="k">
                    <TableCell class="font-medium">{{ k }}</TableCell>
                    <TableCell class="break-all">{{ v }}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <!-- Messages -->
        <div v-if="messages.length" class="space-y-2">
          <div class="text-xs font-medium text-muted-foreground">Messages</div>
          <Card v-for="(msg, idx) in messages" :key="idx" class="bg-muted/40">
            <CardHeader class="pb-2 flex flex-row items-center gap-2">
              <Badge :class="roleClass(msg.role)">{{ msg.role }}</Badge>
              <span v-if="msg.blockSummary" class="text-xs text-muted-foreground">{{ msg.blockSummary }}</span>
            </CardHeader>
            <CardContent class="space-y-2">
              <div v-for="(block, bidx) in msg.blocks" :key="bidx">
                <!-- 纯文本 -->
                <div v-if="block.type === 'text'">
                  <div v-if="block.text.length > 120 && !expanded[`${idx}-${bidx}`]" class="text-sm">
                    {{ block.text.slice(0, 120) }}
                    <Button variant="link" size="xs" class="px-0 h-auto text-xs" @click="expanded[`${idx}-${bidx}`] = true">展开</Button>
                  </div>
                  <div v-else class="text-sm whitespace-pre-wrap break-all">{{ block.text }}</div>
                </div>
                <!-- 有内容的标签块：可折叠 -->
                <div v-else-if="block.text" class="text-xs text-muted-foreground">
                  <Collapsible>
                    <CollapsibleTrigger as-child>
                      <Button variant="ghost" size="xs" class="px-0 h-auto text-xs">
                        <Badge :class="tagClass(block.type)" class="mr-1">{{ block.label || block.type }}</Badge>
                        {{ formatSize(block.text) }}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre class="mt-1 whitespace-pre-wrap break-all text-[11px] bg-background rounded p-2 border">{{ block.text }}</pre>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
                <!-- 空内容：仅显示标签 Badge -->
                <div v-else class="text-xs">
                  <Badge :class="tagClass(block.type)" class="mr-1">{{ block.label || block.type }}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <!-- Tools -->
        <div v-if="toolNames.length">
          <div class="text-xs font-medium text-muted-foreground mb-1">Tools</div>
          <div class="flex flex-wrap gap-1">
            <Badge v-for="name in displayedToolNames" :key="name" variant="secondary">{{ name }}</Badge>
            <Button v-if="toolNames.length > 8" variant="ghost" size="xs" class="px-1 h-5 text-xs" @click="toolsExpanded = !toolsExpanded">
              {{ toolsExpanded ? '收起' : `+${toolNames.length - 8}` }}
            </Button>
          </div>
        </div>

        <!-- System (Anthropic root-level) -->
        <div v-if="systemBlocks.length">
          <div class="text-xs font-medium text-muted-foreground mb-1">System</div>
          <Card class="bg-muted/40">
            <CardContent class="space-y-2">
              <div v-for="(blk, sidx) in systemBlocks" :key="sidx" class="text-sm whitespace-pre-wrap break-all">
                <Badge variant="outline" class="mb-1">{{ blk.type }}</Badge>
                <div v-if="blk.text">{{ blk.text }}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <!-- Other fields -->
        <Collapsible v-if="otherFieldsKeys.length">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" size="xs" class="px-0 h-auto text-xs">
              其他字段
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre class="mt-1 whitespace-pre-wrap break-all text-xs bg-muted rounded p-2 border">{{ JSON.stringify(otherFields, null, 2) }}</pre>
          </CollapsibleContent>
        </Collapsible>
      </template>
    </TabsContent>

    <TabsContent value="raw">
      <JsonCopyBlock :content="raw" />
    </TabsContent>
  </Tabs>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import JsonCopyBlock from './JsonCopyBlock.vue'
import { roleClass, tagClass } from './logColors'
import { extractBlocks } from './requestBlockParser'
import type { MsgBlock } from './requestBlockParser'

const props = defineProps<{
  raw: string
  apiType: 'openai' | 'anthropic'
  showUrl?: boolean
  /** 外部控制显示模式时传入，组件内部不渲染 tabs 和复制按钮 */
  mode?: 'structured' | 'raw'
}>()

const headersOpen = ref(false)
const expanded = reactive<Record<string, boolean>>({})
const toolsExpanded = ref(false)
const copied = ref(false)

const parsed = computed<Record<string, unknown>>(() => {
  try {
    return JSON.parse(props.raw) as Record<string, unknown>
  } catch {
    return {}
  }
})

const parseError = computed(() => {
  try {
    JSON.parse(props.raw)
    return false
  } catch {
    return true
  }
})

async function copyRaw() {
  try {
    await navigator.clipboard.writeText(props.raw)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000) // eslint-disable-line no-magic-numbers
  } catch { copied.value = false }
}

const headerEntries = computed(() => {
  const headers = (parsed.value.headers || {}) as Record<string, string>
  const ALLOWED_HEADER_KEYS = new Set(Object.keys(headers))
  return Object.entries(headers)
    .filter(([k]) => ALLOWED_HEADER_KEYS.has(k))
    .map(([k, v]) => {
    if (k.toLowerCase() === 'authorization') {
      return [k, 'Bearer sk-****'] as [string, string]
    }
    return [k, v] as [string, string]
  })
})

const body = computed(() => {
  const raw = parsed.value.body
  // upstream_request 中 body 是二次 JSON 编码的字符串，需要再 parse 一次
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown> } catch { return {} }
  }
  return (raw || {}) as Record<string, unknown>
})

const isClaudeCode = computed(() => {
  const ua = (parsed.value.headers as Record<string, string> | undefined)?.['user-agent'] || ''
  return ua.includes('claude-cli')
})

const claudeMode = computed(() => {
  const ua = (parsed.value.headers as Record<string, string> | undefined)?.['user-agent'] || ''
  const match = ua.match(/claude-cli\/[^\s]+\s+\(([^)]+)\)/)
  return match ? match[1] : 'external, cli'
})

const thinkingBudget = computed(() => {
  const t = body.value.thinking as Record<string, unknown> | undefined
  return t && typeof t.budget_tokens === 'number' ? t.budget_tokens : undefined
})

const toolsCount = computed(() => {
  const tools = body.value.tools as unknown[] | undefined
  return Array.isArray(tools) ? tools.length : undefined
})

const messages = computed<MsgBlock[]>(() => {
  const msgs = (body.value.messages || []) as Array<{ role: string; content: unknown }>
  return msgs.map((m) => {
    const blocks = extractBlocks(m.content)
    // 统计非 text 的 block 类型和数量
    const tagCounts: Record<string, number> = {}
    for (const b of blocks) {
      if (b.type !== 'text' && b.text) {
        tagCounts[b.type] = (tagCounts[b.type] || 0) + 1
      }
    }
    const ALLOWED_TAG_KEYS = new Set(Object.keys(tagCounts))
    const blockSummary = Object.entries(tagCounts)
      .filter(([k]) => ALLOWED_TAG_KEYS.has(k))
      .map(([t, c]) => `${t}${c > 1 ? ` x${c}` : ''}`)
      .join(', ') || undefined
    return { role: m.role, blocks, blockSummary }
  })
})


const toolNames = computed(() => {
  const tools = (body.value.tools || []) as Array<{ function?: { name?: string }; name?: string }>
  return tools.map((t) => t.function?.name || t.name || 'unknown').filter(Boolean)
})

const TOOL_PREVIEW_COUNT = 8

const displayedToolNames = computed(() => {
  return toolsExpanded.value ? toolNames.value : toolNames.value.slice(0, TOOL_PREVIEW_COUNT)
})

const systemBlocks = computed(() => {
  const sys = body.value.system
  if (!sys) return [] as { type: string; text: string }[]
  if (Array.isArray(sys)) {
    return (sys as Array<{ type?: string; text?: string }>).map((s) => ({ type: s.type || 'text', text: s.text || '' }))
  }
  if (typeof sys === 'string') {
    return [{ type: 'text', text: sys }]
  }
  return [{ type: 'unknown', text: JSON.stringify(sys) }]
})

const knownKeys = new Set([
  'model',
  'stream',
  'max_tokens',
  'thinking',
  'messages',
  'tools',
  'system',
])

const otherFields = computed(() => {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(body.value)) {
    if (!knownKeys.has(key)) {
      result[key] = body.value[key]
    }
  }
  return result
})

const otherFieldsKeys = computed(() => Object.keys(otherFields.value))

const BYTES_PER_KB = 1024

function formatSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  if (bytes < BYTES_PER_KB) return `${bytes}B`
  return `${(bytes / BYTES_PER_KB).toFixed(1)}KB`
}
</script>
