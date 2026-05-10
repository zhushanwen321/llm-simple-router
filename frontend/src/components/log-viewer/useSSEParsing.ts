import { computed, type Ref } from 'vue'

const SSE_DATA_PREFIX_LEN = 5
const JSON_INDENT = 2

interface SSEEvent {
  type: 'data' | 'done' | 'raw'
  data: unknown
}

export interface AssembledBlock {
  type: string
  content: string
  eventCount: number
  toolName?: string
}

export interface SSEMeta {
  id: string
  model: string
  inputTokens: number
  outputTokens: number
  stopReason: string
}

export interface OpenAIAssembled {
  role: string
  content: string
  contentEventCount: number
  finishReason: string
  usage: Record<string, number> | null
}

export interface DeltaGroup {
  deltaType: string
  kept: number
  folded: number
  foldedChars: number
}

const MAX_VISIBLE_DELTAS = 3

export function useSSEParsing(body: Ref<string | undefined>, isStream: boolean, apiType: 'openai' | 'anthropic') {
  const sseEvents = computed<SSEEvent[]>(() => {
    if (!isStream || !body.value) return []
    const lines = body.value.split('\n')
    const events: SSEEvent[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(SSE_DATA_PREFIX_LEN).trim()
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

  // Anthropic SSE 组装：将 delta 事件拼接为完整 content block
  const assembledBlocks = computed<AssembledBlock[]>(() => {
    if (!isStream || !body.value) return []
    const blocks: AssembledBlock[] = []
    let cur: AssembledBlock | null = null
    for (const ev of sseEvents.value) {
      if (ev.type !== 'data') continue
      const d = ev.data as Record<string, unknown>
      if (d.type === 'content_block_start') {
        const blk = d.content_block as Record<string, unknown>
        cur = { type: typeof blk?.type === 'string' ? blk.type : '', content: '', eventCount: 0, toolName: typeof blk?.name === 'string' ? blk.name : undefined }
        if (cur.type === 'tool_use' && blk?.input) {
          const inputObj = blk.input as Record<string, unknown>
          if (Object.keys(inputObj).length > 0) cur.content = JSON.stringify(inputObj, null, JSON_INDENT)
        }
        continue
      }
      if (d.type === 'content_block_delta' && cur) {
        const delta = d.delta as Record<string, string>
        cur.content += delta.thinking || delta.text || delta.partial_json || ''
        cur.eventCount++; continue
      }
      if (d.type === 'content_block_stop' && cur) { blocks.push(cur); cur = null }
    }
    if (cur) blocks.push(cur)
    return blocks
  })

  const sseMeta = computed<SSEMeta>(() => {
    let id = '', model = '', inputTokens = 0, outputTokens = 0, stopReason = ''
    for (const ev of sseEvents.value) {
      if (ev.type !== 'data') continue
      const d = ev.data as Record<string, unknown>
      if (d.type === 'message_start') {
        const msg = d.message as Record<string, unknown>
        id = typeof msg?.id === 'string' ? msg.id : ''; model = typeof msg?.model === 'string' ? msg.model : ''
        inputTokens = Number((msg?.usage as Record<string, number>)?.input_tokens ?? 0)
      }
      if (d.type === 'message_delta') {
        const delta = d.delta as Record<string, unknown>
        const usage = d.usage as Record<string, number>
        stopReason = typeof delta?.stop_reason === 'string' ? delta.stop_reason : ''; outputTokens = Number(usage?.output_tokens ?? 0)
      }
    }
    return { id, model, inputTokens, outputTokens, stopReason }
  })

  const openaiAssembled = computed<OpenAIAssembled | null>(() => {
    if (apiType !== 'openai' || !isStream) return null
    let role = '', content = '', finishReason = ''
    let usage: Record<string, number> | null = null
    let contentEventCount = 0
    for (const ev of sseEvents.value) {
      if (ev.type !== 'data') continue
      const d = ev.data as Record<string, unknown>
      const choices = (d.choices || []) as Array<Record<string, unknown>>
      const delta = choices[0]?.delta as Record<string, unknown> | undefined
      if (delta?.role) role = delta.role as string
      if (delta?.content) { content += delta.content as string; contentEventCount++ }
      if (choices[0]?.finish_reason) finishReason = choices[0].finish_reason as string
      if (d.usage) usage = d.usage as Record<string, number>
    }
    return { role, content, contentEventCount, finishReason, usage }
  })

  // Anthropic SSE 原始事件解析（非流式直接返回）
  const anthropicMessageStart = computed(() => {
    if (!isStream) return null
    for (const ev of sseEvents.value) {
      if (ev.type !== 'data') continue
      const d = ev.data as Record<string, unknown>
      if (d.type === 'message_start') {
        const msg = d.message as Record<string, unknown> | undefined
        return {
          id: typeof msg?.id === 'string' ? msg.id : '',
          model: typeof msg?.model === 'string' ? msg.model : '',
          input_tokens: Number((msg?.usage as Record<string, number> | undefined)?.input_tokens ?? 0),
        }
      }
    }
    return null
  })

  const anthropicContentBlockStarts = computed(() => {
    if (!isStream) return []
    const results: { index: number; type: string }[] = []
    for (const ev of sseEvents.value) {
      if (ev.type !== 'data') continue
      const d = ev.data as Record<string, unknown>
      if (d.type === 'content_block_start') {
        const block = d.content_block as Record<string, unknown> | undefined
        results.push({ index: Number(d.index ?? 0), type: typeof block?.type === 'string' ? block.type : '' })
      }
    }
    return results
  })

  const anthropicDeltaGroups = computed<DeltaGroup[]>(() => {
    if (!isStream) return []
    const groups: Record<string, DeltaGroup> = {}
    for (const ev of sseEvents.value) {
      if (ev.type !== 'data') continue
      const d = ev.data as Record<string, unknown>
      if (d.type !== 'content_block_delta') continue
      const delta = d.delta as Record<string, unknown> | undefined
      const dt = typeof delta?.type === 'string' ? delta.type : 'unknown'
      if (!groups[dt]) {
        groups[dt] = { deltaType: dt, kept: 0, folded: 0, foldedChars: 0 }
      }
      const g = groups[dt]
      if (g.kept < MAX_VISIBLE_DELTAS) {
        g.kept++
      } else {
        g.folded++
        const deltaFields = delta as Record<string, string>
        const text = deltaFields.thinking || deltaFields.text || deltaFields.partial_json || ''
        g.foldedChars += text.length
      }
    }
    return Object.values(groups).filter((g) => g.kept > 0 || g.folded > 0)
  })

  const anthropicMessageDelta = computed(() => {
    if (!isStream) return null
    for (const ev of sseEvents.value) {
      if (ev.type !== 'data') continue
      const d = ev.data as Record<string, unknown>
      if (d.type === 'message_delta') {
        const delta = d.delta as Record<string, unknown> | undefined
        const usage = d.usage as Record<string, number> | undefined
        return {
          output_tokens: Number(usage?.output_tokens ?? 0),
          stop_reason: typeof delta?.stop_reason === 'string' ? delta.stop_reason : '',
        }
      }
    }
    return null
  })

  const anthropicMessageStop = computed(() => {
    if (!isStream) return false
    return sseEvents.value.some((ev) => ev.type === 'data' && (ev.data as Record<string, unknown>).type === 'message_stop')
  })

  // OpenAI SSE 原始事件解析（非流式直接返回）
  const openaiSseRole = computed(() => {
    if (!isStream) return null
    for (const ev of sseEvents.value) {
      if (ev.type !== 'data') continue
      const d = ev.data as Record<string, unknown>
      const choices = (d.choices || []) as Array<Record<string, unknown>>
      const delta = choices[0]?.delta as Record<string, unknown> | undefined
      if (delta?.role) return delta.role as string
    }
    return null
  })

  const openaiSseFirstContent = computed(() => {
    if (!isStream) return null
    for (const ev of sseEvents.value) {
      if (ev.type !== 'data') continue
      const d = ev.data as Record<string, unknown>
      const choices = (d.choices || []) as Array<Record<string, unknown>>
      const delta = choices[0]?.delta as Record<string, unknown> | undefined
      if (delta?.content) return delta.content as string
    }
    return null
  })

  const openaiSseFinishReason = computed(() => {
    if (!isStream) return null
    for (const ev of sseEvents.value) {
      if (ev.type !== 'data') continue
      const d = ev.data as Record<string, unknown>
      const choices = (d.choices || []) as Array<Record<string, unknown>>
      const reason = choices[0]?.finish_reason
      if (reason) return reason as string
    }
    return null
  })

  const openaiSseCollapsedCount = computed(() => {
    if (!isStream) return 0
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
    if (!isStream) return null
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

  return {
    sseEvents,
    assembledBlocks,
    sseMeta,
    openaiAssembled,
    anthropicMessageStart,
    anthropicContentBlockStarts,
    anthropicDeltaGroups,
    anthropicMessageDelta,
    anthropicMessageStop,
    openaiSseRole,
    openaiSseFirstContent,
    openaiSseFinishReason,
    openaiSseCollapsedCount,
    openaiSseUsage,
  }
}
