<template>
  <div class="flex flex-col h-full">
    <div class="flex justify-end mb-1">
      <Button variant="outline" size="xs" class="gap-1" @click="showRaw = !showRaw">
        <FileJson v-if="showRaw" class="size-3" />
        <FileText v-else class="size-3" />
        {{ showRaw ? '结构化' : '原始 JSON' }}
      </Button>
    </div>

    <ScrollArea class="flex-1">
      <!-- Raw JSON view -->
      <template v-if="showRaw">
        <div class="space-y-3">
          <div>
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              客户端请求
            </div>
            <JsonCopyBlock :content="overview.clientRequest ?? '{}'" />
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              上游请求
            </div>
            <JsonCopyBlock :content="overview.upstreamRequest ?? '{}'" />
          </div>
        </div>
      </template>

      <!-- Structured diff view -->
      <template v-else>
        <div v-if="!hasDiff" class="text-[11px] text-muted-foreground py-4 text-center">
          暂无请求详情数据
        </div>

        <div v-else class="space-y-4">
          <!-- Model mapping -->
          <div v-if="modelDiff.hasDiff">
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              模型映射
            </div>
            <div class="flex items-center gap-2 text-[11px]">
              <span class="font-mono text-muted-foreground">{{ modelDiff.from }}</span>
              <span class="text-muted-foreground">&rarr;</span>
              <span class="font-mono text-primary font-semibold">{{ modelDiff.to }}</span>
            </div>
          </div>

          <!-- Messages diff -->
          <div v-if="messagesDiff.length > 0">
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              消息变更
            </div>
            <div class="space-y-2">
              <div
                v-for="(msg, i) in messagesDiff"
                :key="i"
                class="rounded-md border px-2.5 py-1.5 text-[11px]"
                :class="msg.modified ? 'bg-amber-50 border-amber-200' : 'bg-background'"
              >
                <div class="flex items-center gap-1.5 mb-1">
                  <Badge
                    class="text-[9px] px-1.5 py-0"
                    :class="msg.role === 'user' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'"
                  >
                    {{ msg.role }}
                  </Badge>
                  <Badge v-if="msg.modified" class="bg-amber-100 text-amber-700 text-[9px] px-1.5 py-0">
                    已修改
                  </Badge>
                </div>
                <div v-if="msg.modified && msg.removedText" class="text-red-500 line-through mb-0.5">
                  {{ msg.removedText }}
                </div>
                <div class="text-foreground">{{ msg.text }}</div>
              </div>
            </div>
          </div>

          <!-- stream_options injection -->
          <div v-if="streamOptionsInjected">
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              流选项注入
            </div>
            <div class="flex items-center gap-2 text-[11px]">
              <Badge class="bg-green-100 text-green-700 text-[9px] px-1.5 py-0">注入</Badge>
              <code class="font-mono text-green-700">{ "include_usage": true }</code>
            </div>
          </div>

          <!-- Authorization replacement -->
          <div v-if="authDiff.hasDiff">
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              认证替换
            </div>
            <div class="flex items-center gap-2 text-[11px]">
              <span class="font-mono text-red-500 line-through">{{ authDiff.old }}</span>
              <Separator orientation="vertical" class="h-3" />
              <span class="font-mono text-green-600 font-medium">{{ authDiff.new }}</span>
            </div>
            <Badge class="mt-1 bg-amber-100 text-amber-700 text-[9px] px-1.5 py-0">已替换</Badge>
          </div>
        </div>
      </template>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { FileJson, FileText } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import JsonCopyBlock from '@/components/log-viewer/JsonCopyBlock.vue'
import type { UnifiedRequestOverview } from './types'

const props = defineProps<{ overview: UnifiedRequestOverview }>()
const showRaw = ref(false)

interface ParsedRequest {
  headers: Record<string, string>
  body: Record<string, unknown>
}

function parseRequest(raw: string | null): ParsedRequest | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const headers = (parsed.headers ?? {}) as Record<string, string>
    let body = parsed.body
    if (typeof body === 'string') {
      // eslint-disable-next-line taste/no-silent-catch -- body 可能是普通字符串，保持原样即可
      try { body = JSON.parse(body) } catch { /* non-JSON body, keep as-is */ }
    }
    return { headers, body: (body ?? {}) as Record<string, unknown> }
  } catch {
    return null
  }
}

function extractText(msg: Record<string, unknown>): string {
  const content = msg.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: unknown) => typeof b === 'object' && b !== null && 'text' in (b as Record<string, unknown>))
      .map((b: unknown) => (b as Record<string, unknown>).text as string)
      .join('')
  }
  return String(content ?? '')
}

const MASK_PREFIX_LEN = 4

function maskKey(val: string | undefined): string {
  if (!val) return ''
  const key = val.replace(/^Bearer\s+/i, '')
  if (key.length <= MASK_PREFIX_LEN) return '***'
  return `${key.slice(0, MASK_PREFIX_LEN)}***`
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

const clientParsed = computed(() => parseRequest(props.overview.clientRequest))
const upstreamParsed = computed(() => parseRequest(props.overview.upstreamRequest))

const hasDiff = computed(() => clientParsed.value != null || upstreamParsed.value != null)

const modelDiff = computed(() => {
  const clientModel = clientParsed.value?.body?.model as string | undefined
  const upstreamModel = upstreamParsed.value?.body?.model as string | undefined
  const hasDiff = !!clientModel && !!upstreamModel && clientModel !== upstreamModel
  return { hasDiff, from: clientModel ?? '', to: upstreamModel ?? '' }
})

interface MessageDiff {
  role: string
  text: string
  removedText: string | null
  modified: boolean
}

const messagesDiff = computed<MessageDiff[]>(() => {
  const clientMsgs = (clientParsed.value?.body?.messages ?? []) as Record<string, unknown>[]
  const upstreamMsgs = (upstreamParsed.value?.body?.messages ?? []) as Record<string, unknown>[]
  if (upstreamMsgs.length === 0) return []

  const result: MessageDiff[] = []
  let anyModified = false

  for (let i = 0; i < upstreamMsgs.length; i++) {
    const upstreamMsg = upstreamMsgs[i]
    const clientMsg = clientMsgs[i]
    const upstreamText = extractText(upstreamMsg)
    const clientText = clientMsg ? extractText(clientMsg) : null
    const isModified = clientText !== null && upstreamText !== clientText

    if (isModified) anyModified = true

    result.push({
      role: String(upstreamMsg.role ?? 'unknown'),
      text: upstreamText,
      removedText: isModified ? clientText : null,
      modified: isModified,
    })
  }

  // Only show when there are actual differences
  return anyModified ? result : []
})

const streamOptionsInjected = computed(() => {
  const clientHas = clientParsed.value?.body?.stream_options != null
  const upstreamHas = upstreamParsed.value?.body?.stream_options != null
  return !clientHas && upstreamHas
})

const authDiff = computed(() => {
  if (!clientParsed.value?.headers || !upstreamParsed.value?.headers) {
    return { hasDiff: false, old: '', new: '' }
  }
  const clientAuth = getHeader(clientParsed.value.headers, 'authorization')
  const upstreamAuth = getHeader(upstreamParsed.value.headers, 'authorization')
  const hasDiff = !!clientAuth && !!upstreamAuth && clientAuth !== upstreamAuth
  return { hasDiff, old: maskKey(clientAuth), new: maskKey(upstreamAuth) }
})
</script>
