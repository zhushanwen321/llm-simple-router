<template>
  <div class="flex flex-col min-h-0 h-full">
    <div class="flex justify-end mb-1 flex-shrink-0">
      <Button variant="outline" size="xs" class="gap-1" @click="showRaw = !showRaw">
        <FileJson v-if="showRaw" class="size-3" />
        <FileText v-else class="size-3" />
        {{ showRaw ? 'Structured' : 'Raw JSON' }}
      </Button>
    </div>

    <ScrollArea class="flex-1 min-h-0">
      <!-- Raw JSON view -->
      <template v-if="showRaw">
        <div class="space-y-3">
          <div>
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              Client Request
            </div>
            <JsonCopyBlock :content="overview.clientRequest ?? '{}'" />
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              Upstream Request
            </div>
            <JsonCopyBlock :content="overview.upstreamRequest ?? '{}'" />
          </div>
        </div>
      </template>

      <!-- Structured view -->
      <template v-else>
        <div v-if="!upstreamParsed" class="text-[11px] text-muted-foreground py-4 text-center">
          No request data available
        </div>

        <div v-else class="space-y-4">
          <!-- Model mapping -->
          <div v-if="modelDiff.hasDiff">
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              Model Mapping
            </div>
            <div class="flex items-center gap-2 text-[11px]">
              <span class="font-mono text-muted-foreground">{{ modelDiff.from }}</span>
              <span class="text-muted-foreground">&rarr;</span>
              <span class="font-mono text-primary font-semibold">{{ modelDiff.to }}</span>
            </div>
          </div>

          <!-- System prompt -->
          <div v-if="systemPrompt">
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              System
            </div>
            <pre class="text-[11px] bg-muted/50 rounded-md px-2.5 py-2 overflow-y-auto whitespace-pre-wrap break-words max-h-40">{{ systemPrompt }}</pre>
          </div>

          <!-- Messages -->
          <div v-if="messages.length > 0">
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              Messages ({{ messages.length }})
            </div>
            <div class="space-y-1.5">
              <div
                v-for="(msg, i) in messages"
                :key="i"
                class="rounded-md border px-2.5 py-1.5 text-[11px]"
                :class="msg.modified ? 'diff-modified' : 'bg-background'"
              >
                <div class="flex items-center gap-1.5 mb-1">
                  <Badge
                    class="text-[9px] px-1.5 py-0"
                    :class="msg.role === 'user' ? 'badge-role-user' : msg.role === 'assistant' ? 'badge-role-assistant' : 'badge-role-thinking'"
                  >
                    {{ msg.role }}
                  </Badge>
                  <Badge v-if="msg.modified" class="badge-role-thinking text-[9px] px-1.5 py-0">
                    Modified
                  </Badge>
                </div>
                <div v-if="msg.modified && msg.removedText" class="diff-removed line-through mb-0.5">
                  {{ msg.removedText }}
                </div>
                <div class="text-foreground overflow-y-auto max-h-40">{{ msg.text }}</div>
              </div>
            </div>
          </div>

          <!-- Tools -->
          <div v-if="tools.length > 0">
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              Tools ({{ tools.length }})
            </div>
            <div class="space-y-1">
              <div
                v-for="(tool, i) in tools"
                :key="i"
                class="rounded-md border bg-background px-2.5 py-1.5 text-[11px]"
              >
                <Badge class="text-[9px] px-1.5 py-0 badge-role-tool">{{ tool.name }}</Badge>
              </div>
            </div>
          </div>

          <!-- stream_options injection -->
          <div v-if="streamOptionsInjected">
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              Stream Options
            </div>
            <div class="flex items-center gap-2 text-[11px]">
              <Badge class="badge-success text-[9px] px-1.5 py-0">Injected</Badge>
              <code class="font-mono diff-added">{ "include_usage": true }</code>
            </div>
          </div>

          <!-- Authorization replacement -->
          <div v-if="authDiff.hasDiff">
            <div class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              Auth Replacement
            </div>
            <div class="flex items-center gap-2 text-[11px]">
              <span class="font-mono diff-removed line-through">{{ authDiff.old }}</span>
              <Separator orientation="vertical" class="h-3" />
              <span class="font-mono diff-added font-medium">{{ authDiff.new }}</span>
            </div>
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
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const headers = (typeof parsed.headers === 'object' && parsed.headers !== null ? parsed.headers : {}) as Record<string, string>
    let body = parsed.body
    if (typeof body === 'string') {
      // eslint-disable-next-line taste/no-silent-catch -- body 可能是普通字符串
      try { body = JSON.parse(body) } catch { /* non-JSON body */ }
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
      .filter((b: unknown): b is Record<string, unknown> => typeof b === 'object' && b !== null && 'text' in b)
      .map(b => typeof b.text === 'string' ? b.text : '')
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

const modelDiff = computed(() => {
  const clientModel = clientParsed.value?.body?.model as string | undefined
  const upstreamModel = upstreamParsed.value?.body?.model as string | undefined
  const hasDiff = !!clientModel && !!upstreamModel && clientModel !== upstreamModel
  return { hasDiff, from: clientModel ?? '', to: upstreamModel ?? '' }
})

const systemPrompt = computed(() => {
  const body = upstreamParsed.value?.body
  if (!body) return null
  const sys = body.system
  if (typeof sys === 'string') return sys
  // Anthropic 格式：system 可能是 [{ type: 'text', text: '...' }]
  if (Array.isArray(sys)) {
    return sys
      .filter((s: unknown) => typeof s === 'object' && s !== null && 'text' in (s as Record<string, unknown>))
      .map((s: unknown) => (s as Record<string, unknown>).text as string)
      .join('\n')
  }
  // OpenAI 格式：messages 中 role=system 的第一条
  const msgs = body.messages as Record<string, unknown>[] | undefined
  if (Array.isArray(msgs)) {
    const sysMsg = msgs.find(m => m.role === 'system')
    if (sysMsg) return extractText(sysMsg)
  }
  return null
})

interface MessageView {
  role: string
  text: string
  removedText: string | null
  modified: boolean
}

const messages = computed<MessageView[]>(() => {
  const upstreamMsgs = (upstreamParsed.value?.body?.messages ?? []) as Record<string, unknown>[]
  const clientMsgs = (clientParsed.value?.body?.messages ?? []) as Record<string, unknown>[]
  if (upstreamMsgs.length === 0) return []

  const result: MessageView[] = []
  for (let i = 0; i < upstreamMsgs.length; i++) {
    const upstreamMsg = upstreamMsgs[i]
    const role = String(upstreamMsg.role ?? 'unknown')
    // 跳过 system 消息（已在 System 区展示）
    if (role === 'system') continue
    const upstreamText = extractText(upstreamMsg)
    const clientMsg = clientMsgs[i]
    const clientText = clientMsg ? extractText(clientMsg) : null
    const isModified = clientText !== null && upstreamText !== clientText

    result.push({
      role,
      text: upstreamText,
      removedText: isModified ? clientText : null,
      modified: isModified,
    })
  }
  return result
})

interface ToolView {
  name: string
}

const tools = computed<ToolView[]>(() => {
  const body = upstreamParsed.value?.body
  if (!body) return []
  const rawTools = body.tools as Record<string, unknown>[] | undefined
  if (!Array.isArray(rawTools)) return []
  return rawTools
    .filter(t => typeof t?.name === 'string')
    .map(t => ({ name: t.name as string }))
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
