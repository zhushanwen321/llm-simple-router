<template>
  <Tabs :default-value="mode ?? 'structured'" :model-value="mode" class="w-full">
    <div v-if="!mode" class="mb-2">
      <TabsList>
        <TabsTrigger value="structured">结构化</TabsTrigger>
        <TabsTrigger value="raw">{{ isStream ? '原始 SSE 文本' : '原始 JSON' }}</TabsTrigger>
      </TabsList>
    </div>

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
                <Badge v-for="(block, idx) in anthropicContentBlocks" :key="idx" :class="blockClass(block.type)">{{ block.type }}</Badge>
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

        <!-- Streaming: 水平 tabs 在顶部 -->
        <template v-else>
          <div class="space-y-3">
            <div class="flex gap-1">
              <Button variant="ghost" :class="streamTab === 'assembled' ? 'bg-secondary' : ''" size="xs" class="h-auto px-2 py-1 text-xs" @click="streamTab = 'assembled'">完整响应</Button>
              <Button variant="ghost" :class="streamTab === 'raw-events' ? 'bg-secondary' : ''" size="xs" class="h-auto px-2 py-1 text-xs" @click="streamTab = 'raw-events'">原始事件流</Button>
            </div>

            <!-- 完整响应 -->
            <template v-if="streamTab === 'assembled'">
              <!-- Anthropic SSE 组装 -->
              <template v-if="apiType === 'anthropic'">
                <div class="flex flex-wrap gap-2">
                  <Badge v-if="sseMeta.id" variant="outline">id: {{ sseMeta.id }}</Badge>
                  <Badge v-if="sseMeta.model" variant="outline">model: {{ sseMeta.model }}</Badge>
                  <Badge variant="outline">input: {{ sseMeta.inputTokens }}</Badge>
                </div>
                <div v-for="(blk, idx) in assembledBlocks" :key="idx" :class="['rounded-md border p-3', blockBorderClass(blk.type)]">
                  <div class="flex items-center gap-2 mb-2">
                    <Badge :class="blockClass(blk.type)">{{ blk.type }}</Badge>
                    <span class="text-xs text-muted-foreground">{{ blk.eventCount }} 个 delta 事件</span>
                    <span v-if="blk.toolName" class="text-xs font-mono">{{ blk.toolName }}</span>
                  </div>
                  <template v-if="blk.content.length > 500 && !expandedBlock[idx]">
                    <pre class="whitespace-pre-wrap break-all text-sm">{{ blk.content.slice(0, 500) }}...</pre>
                    <Button variant="link" size="xs" class="px-0" @click="expandedBlock[idx] = true">展开全部</Button>
                  </template>
                  <pre v-else class="whitespace-pre-wrap break-all text-sm max-h-[40vh] overflow-auto">{{ blk.content }}</pre>
                </div>
                <div class="flex gap-2 text-xs text-muted-foreground">
                  <span>stop_reason: {{ sseMeta.stopReason || '-' }}</span>
                  <span>output_tokens: {{ sseMeta.outputTokens || '-' }}</span>
                </div>
              </template>

              <!-- OpenAI SSE 组装 -->
              <template v-if="apiType === 'openai' && openaiAssembled">
                <div class="flex flex-wrap gap-2">
                  <Badge v-if="openaiAssembled.role" variant="outline">role: {{ openaiAssembled.role }}</Badge>
                  <Badge variant="outline">{{ openaiAssembled.contentEventCount }} 个 content delta</Badge>
                  <Badge v-if="openaiAssembled.finishReason" variant="outline">finish: {{ openaiAssembled.finishReason }}</Badge>
                </div>
                <div :class="['rounded-md border p-3', blockBorderClass('text')]">
                  <pre class="whitespace-pre-wrap break-all text-sm max-h-[40vh] overflow-auto">{{ openaiAssembled.content }}</pre>
                </div>
                <div v-if="openaiAssembled.usage" class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Card class="bg-muted/40"><CardContent class="py-2 px-3 text-xs">
                    <div class="text-muted-foreground">prompt_tokens</div>
                    <div class="font-medium">{{ openaiAssembled.usage.prompt_tokens ?? '-' }}</div>
                  </CardContent></Card>
                  <Card class="bg-muted/40"><CardContent class="py-2 px-3 text-xs">
                    <div class="text-muted-foreground">completion_tokens</div>
                    <div class="font-medium">{{ openaiAssembled.usage.completion_tokens ?? '-' }}</div>
                  </CardContent></Card>
                  <Card class="bg-muted/40"><CardContent class="py-2 px-3 text-xs">
                    <div class="text-muted-foreground">total_tokens</div>
                    <div class="font-medium">{{ openaiAssembled.usage.total_tokens ?? '-' }}</div>
                  </CardContent></Card>
                </div>
              </template>
            </template>

            <!-- 原始事件流 -->
            <template v-if="streamTab === 'raw-events'">
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
                  <Card class="bg-muted/40"><CardContent class="py-2 px-3 text-xs">
                    <div class="text-muted-foreground">prompt_tokens</div>
                    <div class="font-medium">{{ openaiSseUsage.prompt_tokens ?? '-' }}</div>
                  </CardContent></Card>
                  <Card class="bg-muted/40"><CardContent class="py-2 px-3 text-xs">
                    <div class="text-muted-foreground">completion_tokens</div>
                    <div class="font-medium">{{ openaiSseUsage.completion_tokens ?? '-' }}</div>
                  </CardContent></Card>
                  <Card class="bg-muted/40"><CardContent class="py-2 px-3 text-xs">
                    <div class="text-muted-foreground">total_tokens</div>
                    <div class="font-medium">{{ openaiSseUsage.total_tokens ?? '-' }}</div>
                  </CardContent></Card>
                  <Card class="bg-muted/40"><CardContent class="py-2 px-3 text-xs">
                    <div class="text-muted-foreground">cached_tokens</div>
                    <div class="font-medium">{{ openaiSseUsage.cached_tokens ?? '-' }}</div>
                  </CardContent></Card>
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
                <div v-if="anthropicMessageDelta" class="text-sm bg-warning-light rounded p-2">
                  <span class="text-muted-foreground">message_delta:</span> output_tokens={{ anthropicMessageDelta.output_tokens }} stop_reason={{ anthropicMessageDelta.stop_reason }}
                </div>
                <div v-if="anthropicMessageStop" class="text-sm text-muted-foreground">流结束</div>
              </template>
            </template>
          </div>
        </template>
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
import { blockClass, blockBorderClass } from './logColors'
import { useSSEParsing } from './useSSEParsing'

const props = defineProps<{
  raw: string
  apiType: 'openai' | 'anthropic'
  isStream: boolean
  /** 外部控制显示模式时传入 */
  mode?: 'structured' | 'raw'
}>()

const parsed = computed(() => {
  try {
    return JSON.parse(props.raw) as { statusCode?: number; headers?: Record<string, string>; body?: string }
  } catch {
    return null
  }
})

const parseError = computed(() => parsed.value === null)

const HTTP_ERROR_THRESHOLD = 400

const statusVariant = computed(() => {
  const code = parsed.value?.statusCode ?? 0
  return code >= HTTP_ERROR_THRESHOLD ? 'destructive' : 'default'
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

// Non-streaming OpenAI
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

// Non-streaming Anthropic
const anthropicContentBlocks = computed(() => {
  const content = (parsedBody.value.content || []) as Array<{ type: string; text?: string }>
  return content
})

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

// SSE 解析（composable）
const bodyForSSE = computed(() => parsed.value?.body)
const {
  assembledBlocks, sseMeta, openaiAssembled,
  anthropicMessageStart, anthropicContentBlockStarts, anthropicDeltaGroups,
  anthropicMessageDelta, anthropicMessageStop,
  openaiSseRole, openaiSseFirstContent, openaiSseFinishReason,
  openaiSseCollapsedCount, openaiSseUsage,
} = useSSEParsing(bodyForSSE, props.isStream, props.apiType)

const expandedBlock = reactive<Record<number, boolean>>({})
const streamTab = ref<'assembled' | 'raw-events'>('assembled')
</script>
