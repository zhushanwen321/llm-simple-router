<template>
  <Tabs default-value="structured" class="w-full">
    <TabsList class="mb-2">
      <TabsTrigger value="structured">结构化</TabsTrigger>
      <TabsTrigger value="raw">{{ isStream ? '原始 SSE 文本' : '原始 JSON' }}</TabsTrigger>
    </TabsList>

    <TabsContent value="structured" class="space-y-3">
      <template v-if="parseError">
        <div class="text-destructive text-sm">解析失败，请切换到原始 JSON 查看</div>
      </template>
      <template v-else>
        <!-- Status -->
        <div class="flex items-center gap-2">
          <Badge :variant="statusVariant">status: {{ parsed!.statusCode }}</Badge>
        </div>

        <!-- Headers -->
        <Collapsible>
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

        <!-- Non-streaming structured view -->
        <template v-if="!isStream">
          <template v-if="apiType === 'openai'">
            <div class="flex flex-wrap gap-2">
              <Badge v-if="parsedBody.id" variant="outline">id: {{ String(parsedBody.id) }}</Badge>
              <Badge v-if="parsedBody.model" variant="outline">model: {{ String(parsedBody.model) }}</Badge>
              <Badge v-if="parsedBody.system_fingerprint" variant="outline">fingerprint: {{ String(parsedBody.system_fingerprint) }}</Badge>
            </div>
            <div v-if="openaiChoices.length" class="space-y-2">
              <div class="text-xs font-medium text-muted-foreground">Choices</div>
              <Card v-for="(choice, idx) in openaiChoices" :key="idx" class="bg-muted/40">
                <CardHeader class="pb-2 flex flex-row items-center gap-2">
                  <Badge variant="secondary">{{ choice.role || 'assistant' }}</Badge>
                  <Badge v-if="choice.finish_reason" variant="outline">{{ choice.finish_reason }}</Badge>
                </CardHeader>
                <CardContent>
                  <Collapsible>
                    <CollapsibleTrigger as-child>
                      <Button variant="ghost" size="xs" class="px-0 h-auto text-xs">内容</Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre class="mt-1 whitespace-pre-wrap break-all text-xs bg-background rounded p-2 border">{{ choice.content }}</pre>
                    </CollapsibleContent>
                  </Collapsible>
                </CardContent>
              </Card>
            </div>
            <div v-if="openaiUsage" class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">prompt_tokens</div>
                  <div class="font-medium">{{ openaiUsage.prompt_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">completion_tokens</div>
                  <div class="font-medium">{{ openaiUsage.completion_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">total_tokens</div>
                  <div class="font-medium">{{ openaiUsage.total_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">cached_tokens</div>
                  <div class="font-medium">{{ openaiUsage.cached_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
            </div>
          </template>

          <template v-if="apiType === 'anthropic'">
            <div class="flex flex-wrap gap-2">
              <Badge v-if="parsedBody.id" variant="outline">id: {{ String(parsedBody.id) }}</Badge>
              <Badge v-if="parsedBody.type" variant="outline">type: {{ String(parsedBody.type) }}</Badge>
              <Badge v-if="parsedBody.model" variant="outline">model: {{ String(parsedBody.model) }}</Badge>
              <Badge v-if="parsedBody.stop_reason" variant="outline">stop_reason: {{ String(parsedBody.stop_reason) }}</Badge>
            </div>
            <div v-if="anthropicContentBlocks.length" class="space-y-2">
              <div class="text-xs font-medium text-muted-foreground">Content</div>
              <div class="flex flex-wrap gap-2">
                <Badge v-for="(block, idx) in anthropicContentBlocks" :key="idx" :class="contentBadgeClass(block.type)">{{ block.type }}</Badge>
              </div>
            </div>
            <div v-if="anthropicUsage" class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">input_tokens</div>
                  <div class="font-medium">{{ anthropicUsage.input_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">output_tokens</div>
                  <div class="font-medium">{{ anthropicUsage.output_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">cache_creation</div>
                  <div class="font-medium">{{ anthropicUsage.cache_creation_input_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">cache_read</div>
                  <div class="font-medium">{{ anthropicUsage.cache_read_input_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
            </div>
          </template>
        </template>

        <!-- Streaming structured view -->
        <template v-else>
          <template v-if="apiType === 'openai'">
            <div v-if="openaiSseRole" class="text-sm">
              <span class="text-muted-foreground">role:</span> {{ openaiSseRole }}
            </div>
            <div v-if="openaiSseFirstContent" class="text-sm">
              <span class="text-muted-foreground">first content delta:</span> {{ openaiSseFirstContent }}
            </div>
            <div v-if="openaiSseFinishReason" class="text-sm">
              <span class="text-muted-foreground">finish_reason:</span> {{ openaiSseFinishReason }}
            </div>
            <div v-if="openaiSseCollapsedCount > 0" class="text-xs text-muted-foreground">
              +{{ openaiSseCollapsedCount }} 个 delta 事件已折叠
            </div>
            <div v-if="openaiSseUsage" class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">prompt_tokens</div>
                  <div class="font-medium">{{ openaiSseUsage.prompt_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">completion_tokens</div>
                  <div class="font-medium">{{ openaiSseUsage.completion_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">total_tokens</div>
                  <div class="font-medium">{{ openaiSseUsage.total_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
              <Card class="bg-muted/40">
                <CardContent class="py-2 px-3 text-xs">
                  <div class="text-muted-foreground">cached_tokens</div>
                  <div class="font-medium">{{ openaiSseUsage.cached_tokens ?? '-' }}</div>
                </CardContent>
              </Card>
            </div>
          </template>

          <template v-if="apiType === 'anthropic'">
            <div v-if="anthropicMessageStart" class="text-sm">
              <span class="text-muted-foreground">message_start:</span> id={{ anthropicMessageStart.id }} model={{ anthropicMessageStart.model }} input_tokens={{ anthropicMessageStart.input_tokens }}
            </div>
            <div v-if="anthropicContentBlockStarts.length" class="space-y-1">
              <div v-for="(item, idx) in anthropicContentBlockStarts" :key="idx" class="text-sm">
                <span class="text-muted-foreground">content_block_start[{{ item.index }}]:</span> {{ item.type }}
              </div>
            </div>
            <div v-if="anthropicDeltaGroups.length" class="space-y-1">
              <div v-for="(group, idx) in anthropicDeltaGroups" :key="idx" class="text-sm">
                <Badge variant="outline">{{ group.deltaType }}</Badge>
                <span class="ml-2">keep {{ group.kept }} 个</span>
                <span v-if="group.folded > 0" class="text-muted-foreground ml-2">+{{ group.folded }} 个 {{ group.deltaType }} 事件已折叠 ({{ group.foldedChars }} 字符)</span>
              </div>
            </div>
            <div v-if="anthropicMessageDelta" class="text-sm bg-yellow-50 dark:bg-yellow-900/30 rounded p-2">
              <span class="text-muted-foreground">message_delta:</span> output_tokens={{ anthropicMessageDelta.output_tokens }} stop_reason={{ anthropicMessageDelta.stop_reason }}
            </div>
            <div v-if="anthropicMessageStop" class="text-sm text-muted-foreground">流结束</div>
          </template>
        </template>
      </template>
    </TabsContent>

    <TabsContent value="raw">
      <JsonCopyBlock :content="raw" />
    </TabsContent>
  </Tabs>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import JsonCopyBlock from './JsonCopyBlock.vue'

const props = defineProps<{
  raw: string
  apiType: 'openai' | 'anthropic'
  isStream: boolean
}>()

const parsed = computed(() => {
  try {
    return JSON.parse(props.raw) as { statusCode?: number; headers?: Record<string, string>; body?: string }
  } catch {
    return null
  }
})

const parseError = computed(() => parsed.value === null)

const statusVariant = computed(() => {
  const code = parsed.value?.statusCode ?? 0
  return code >= 400 ? 'destructive' : 'default'
})

const headerEntries = computed(() => {
  const headers = parsed.value?.headers || {}
  return Object.entries(headers)
})

const parsedBody = computed(() => {
  if (!props.isStream && parsed.value?.body) {
    try {
      return JSON.parse(parsed.value.body) as Record<string, unknown>
    } catch {
      return {} as Record<string, unknown>
    }
  }
  return {} as Record<string, unknown>
})

// OpenAI non-stream
const openaiChoices = computed(() => {
  const choices = (parsedBody.value.choices || []) as Array<{
    index?: number
    message?: { role?: string; content?: string }
    finish_reason?: string
  }>
  return choices.map((c) => ({
    role: c.message?.role || 'assistant',
    content: c.message?.content || '',
    finish_reason: c.finish_reason || '',
  }))
})

const openaiUsage = computed(() => {
  const u = parsedBody.value.usage as Record<string, number> | undefined
  if (!u) return null
  return {
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: u.total_tokens,
    cached_tokens: (u as Record<string, unknown>).cached_tokens ?? ((u as Record<string, unknown>).prompt_tokens_details as Record<string, number> | undefined)?.cached_tokens,
  }
})

// Anthropic non-stream
const anthropicContentBlocks = computed(() => {
  const content = (parsedBody.value.content || []) as Array<{ type: string; text?: string }>
  return content
})

function contentBadgeClass(type: string): string {
  const map: Record<string, string> = {
    text: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    thinking: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    tool_use: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  }
  return map[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
}

const anthropicUsage = computed(() => {
  const u = parsedBody.value.usage as Record<string, number> | undefined
  if (!u) return null
  return {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_creation_input_tokens: u.cache_creation_input_tokens,
    cache_read_input_tokens: u.cache_read_input_tokens,
  }
})

// SSE parsing helpers
const sseEvents = computed(() => {
  if (!props.isStream || !parsed.value?.body) return []
  const lines = parsed.value.body.split('\n')
  const events: Array<{ type: string; data: unknown }> = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') {
      events.push({ type: 'done', data: payload })
      continue
    }
    try {
      const data = JSON.parse(payload) as Record<string, unknown>
      events.push({ type: 'data', data })
    } catch {
      events.push({ type: 'raw', data: payload })
    }
  }
  return events
})

// OpenAI SSE
const openaiSseRole = computed(() => {
  for (const ev of sseEvents.value) {
    if (ev.type !== 'data') continue
    const d = ev.data as Record<string, unknown>
    const choices = (d.choices || []) as Array<Record<string, unknown>>
    const delta = choices[0]?.delta as Record<string, unknown> | undefined
    if (delta?.role) return String(delta.role)
  }
  return null
})

const openaiSseFirstContent = computed(() => {
  for (const ev of sseEvents.value) {
    if (ev.type !== 'data') continue
    const d = ev.data as Record<string, unknown>
    const choices = (d.choices || []) as Array<Record<string, unknown>>
    const delta = choices[0]?.delta as Record<string, unknown> | undefined
    if (delta?.content) return String(delta.content)
  }
  return null
})

const openaiSseFinishReason = computed(() => {
  for (const ev of sseEvents.value) {
    if (ev.type !== 'data') continue
    const d = ev.data as Record<string, unknown>
    const choices = (d.choices || []) as Array<Record<string, unknown>>
    const reason = choices[0]?.finish_reason
    if (reason) return String(reason)
  }
  return null
})

const openaiSseCollapsedCount = computed(() => {
  let count = 0
  let foundFirstContent = false
  for (const ev of sseEvents.value) {
    if (ev.type !== 'data') continue
    const d = ev.data as Record<string, unknown>
    const choices = (d.choices || []) as Array<Record<string, unknown>>
    const delta = choices[0]?.delta as Record<string, unknown> | undefined
    if (!foundFirstContent) {
      if (delta?.content) foundFirstContent = true
      continue
    }
    if (delta?.content || delta?.role) count++
  }
  return count
})

const openaiSseUsage = computed(() => {
  for (let i = sseEvents.value.length - 1; i >= 0; i--) {
    const ev = sseEvents.value[i]
    if (ev.type !== 'data') continue
    const d = ev.data as Record<string, unknown>
    const u = d.usage as Record<string, number> | undefined
    if (u) {
      return {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
        cached_tokens: (u as Record<string, unknown>).cached_tokens ?? ((u as Record<string, unknown>).prompt_tokens_details as Record<string, number> | undefined)?.cached_tokens,
      }
    }
  }
  return null
})

// Anthropic SSE
const anthropicMessageStart = computed(() => {
  for (const ev of sseEvents.value) {
    if (ev.type !== 'data') continue
    const d = ev.data as Record<string, unknown>
    if (d.type === 'message_start') {
      const msg = d.message as Record<string, unknown> | undefined
      return {
        id: String(msg?.id || ''),
        model: String(msg?.model || ''),
        input_tokens: Number((msg?.usage as Record<string, number> | undefined)?.input_tokens ?? 0),
      }
    }
  }
  return null
})

const anthropicContentBlockStarts = computed(() => {
  const results: { index: number; type: string }[] = []
  for (const ev of sseEvents.value) {
    if (ev.type !== 'data') continue
    const d = ev.data as Record<string, unknown>
    if (d.type === 'content_block_start') {
      const block = d.content_block as Record<string, unknown> | undefined
      results.push({ index: Number(d.index ?? 0), type: String(block?.type || '') })
    }
  }
  return results
})

type DeltaGroup = { deltaType: string; kept: number; folded: number; foldedChars: number }

const anthropicDeltaGroups = computed(() => {
  const groups: Record<string, DeltaGroup> = {}
  for (const ev of sseEvents.value) {
    if (ev.type !== 'data') continue
    const d = ev.data as Record<string, unknown>
    if (d.type !== 'content_block_delta') continue
    const delta = d.delta as Record<string, unknown> | undefined
    const dt = String(delta?.type || 'unknown')
    if (!groups[dt]) {
      groups[dt] = { deltaType: dt, kept: 0, folded: 0, foldedChars: 0 }
    }
    const g = groups[dt]
    if (g.kept < 3) {
      g.kept++
    } else {
      g.folded++
      // thinking_delta 用 delta.thinking，text_delta 用 delta.text
      const d = delta as Record<string, string>
      const text = String(d.thinking || d.text || d.partial_json || '')
      g.foldedChars += text.length
    }
  }
  return Object.values(groups).filter((g) => g.kept > 0 || g.folded > 0)
})

const anthropicMessageDelta = computed(() => {
  for (const ev of sseEvents.value) {
    if (ev.type !== 'data') continue
    const d = ev.data as Record<string, unknown>
    if (d.type === 'message_delta') {
      const delta = d.delta as Record<string, unknown> | undefined
      const usage = d.usage as Record<string, number> | undefined
      return {
        output_tokens: Number(usage?.output_tokens ?? 0),
        stop_reason: String(delta?.stop_reason || ''),
      }
    }
  }
  return null
})

const anthropicMessageStop = computed(() => {
  return sseEvents.value.some((ev) => ev.type === 'data' && (ev.data as Record<string, unknown>).type === 'message_stop')
})
</script>
