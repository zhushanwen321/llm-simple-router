/**
 * 请求体内容块解析工具。
 * 将 Anthropic/OpenAI 请求中的 messages.content 解析为结构化的 Block 数组，
 * 支持 XML 标签识别（thinking、function_calls 等）。
 */

const JSON_INDENT = 2

export interface Block {
  type: string
  text: string
  label?: string
}

export interface MsgBlock {
  role: string
  blocks: Block[]
  blockSummary?: string
}

const XML_TAG_RE = /<([a-zA-Z][a-zA-Z0-9:_-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g

/** 将含 XML 标签的文本拆分为 Block 数组 */
export function parseTaggedContent(text: string): Block[] {
  const regex = new RegExp(XML_TAG_RE.source, 'g')
  const segments: Block[] = []
  let lastIndex = 0

  let match
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim()
    if (before) segments.push({ type: 'text', text: before })

    segments.push({ type: match[1], text: match[2] })
    lastIndex = regex.lastIndex
  }

  const remaining = text.slice(lastIndex).trim()
  if (remaining) segments.push({ type: 'text', text: remaining })

  return segments.length > 0 ? segments : [{ type: 'text', text }]
}

/** 将 Anthropic content 数组或字符串解析为 Block 数组 */
export function extractBlocks(content: unknown): Block[] {
  if (typeof content === 'string') {
    return parseTaggedContent(content)
  }
  if (Array.isArray(content)) {
    return content.flatMap((item: unknown) => {
      const block = item as Record<string, unknown>
      const blockType = String(block.type || 'unknown')

      if (blockType === 'text' && typeof block.text === 'string') {
        return parseTaggedContent(block.text)
      }
      if (blockType === 'image') {
        return [{ type: 'image', text: '' }]
      }
      if (blockType === 'tool_use') {
        const name = String(block.name || '')
        const input = block.input ? JSON.stringify(block.input, null, JSON_INDENT) : ''
        return [{ type: 'tool_use', text: input || JSON.stringify(block, null, JSON_INDENT), label: name || undefined }]
      }
      if (blockType === 'tool_result') {
        const c = block.content
        let text = ''
        if (typeof c === 'string') text = c
        else if (Array.isArray(c)) {
          text = c.map((b: Record<string, unknown>) =>
            typeof b.text === 'string' ? b.text : JSON.stringify(b),
          ).join('\n')
        }
        return [{ type: 'tool_result', text: text || JSON.stringify(block, null, JSON_INDENT) }]
      }
      if (blockType === 'thinking') {
        return [{ type: 'thinking', text: String(block.thinking || '') }]
      }
      return [{ type: blockType, text: typeof block.text === 'string' ? block.text : '' }]
    })
  }
  return [{ type: 'text', text: String(content ?? '') }]
}
