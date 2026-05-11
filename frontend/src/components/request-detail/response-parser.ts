import type { ContentBlock } from '@/types/monitor'

const JSON_INDENT = 2

export function parseAnthropicContent(content: unknown[]): ContentBlock[] {
  return content.map((block: unknown) => {
    const b = block as Record<string, unknown>
    if (b.type === 'thinking') return { type: 'thinking' as const, content: typeof b.thinking === 'string' ? b.thinking : '' }
    if (b.type === 'text') return { type: 'text' as const, content: typeof b.text === 'string' ? b.text : '' }
    if (b.type === 'tool_use') return { type: 'tool_use' as const, content: JSON.stringify(b.input ?? {}, null, JSON_INDENT), name: typeof b.name === 'string' ? b.name : '' }
    if (b.type === 'tool_result') return { type: 'tool_result', content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) }
    return { type: 'text' as const, content: JSON.stringify(b) }
  })
}

export function parseOpenAIChoices(choices: unknown[]): ContentBlock[] {
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
        if (p.type === 'text') result.push({ type: 'text', content: typeof p.text === 'string' ? p.text : '' })
        else if (p.type === 'tool_use' || p.type === 'function') {
          const fn = (p.function ?? p.input ?? {}) as Record<string, unknown>
          result.push({ type: 'tool_use', content: JSON.stringify(fn, null, JSON_INDENT), name: typeof p.name === 'string' ? p.name : (typeof fn.name === 'string' ? fn.name : '') })
        }
      }
    }
  }
  return result
}

export function tryDirectParse(
  responseBody: string | null,
  upstreamResponse: string | null,
  apiType: 'openai' | 'anthropic',
): ContentBlock[] {
  const raw = responseBody || upstreamResponse
  if (!raw) return []

  let data: unknown
  try { data = JSON.parse(raw) } catch { /* 响应体不是合法 JSON，直接返回空数组 */ return [] }

  const outer = data as Record<string, unknown>
  if (typeof outer.body === 'string') {
    try { data = JSON.parse(outer.body) } catch { /* use outer data */ data = data }
  }

  const parsed = data as Record<string, unknown>

  if (apiType === 'anthropic' && Array.isArray(parsed.content)) {
    return parseAnthropicContent(parsed.content)
  }

  if (apiType === 'openai' && Array.isArray(parsed.choices)) {
    return parseOpenAIChoices(parsed.choices)
  }

  return []
}
