/**
 * 合并 upstreamResponse 包装和 responseBody（来自 stream_text_content）。
 *
 * SSE 流的 upstream_response 存储格式为 {"statusCode":200, "headers":..., "body":null}，
 * 而实际的 SSE 文本内容存储在 stream_text_content 字段（通过 responseBody 传入）。
 * 此函数将二者合并，确保原始数据视图展示完整信息。
 */
export function mergeUpstreamData(
  upstreamResponse: string | null,
  responseBody: string | null,
): string {
  // 没有 upstreamResponse 包装，直接用 responseBody
  if (!upstreamResponse) return responseBody || ''

  // 有 upstreamResponse，尝试解析并合并
  try {
    const parsed = JSON.parse(upstreamResponse)
    if (typeof parsed.statusCode === 'number' && (parsed.headers || parsed.body !== undefined)) {
      // body 为 null 但有 responseBody（来自 stream_text_content），合并
      if (parsed.body === null && responseBody) {
        return JSON.stringify({ ...parsed, body: responseBody }, null, 2)
      }
      // body 有值（非流式），直接格式化展示
      return JSON.stringify(parsed, null, 2)
    }
    // 不是 wrapper 格式，直接返回
    return upstreamResponse
  } catch {
    return upstreamResponse
  }
}

/**
 * 从 LLM 响应体中移除内容字段（choices/content），
 * 只保留元数据（model, id, usage, headers 等）。
 */
const CONTENT_KEYS: ReadonlySet<string> = new Set(['choices', 'content'])

export function extractResponseMetadata(
  upstreamResponse: string | null,
  responseBody: string | null,
): string {
  if (!upstreamResponse && !responseBody) return ''

  // 尝试从 upstreamResponse 中提取 wrapper
  const wrapper = parseWrapper(upstreamResponse)
  const headers = wrapper?.headers
  const bodyStr = wrapper?.body ?? responseBody

  if (headers) {
    // 有 headers，展示 headers + body 元数据
    const result: Record<string, unknown> = { headers }
    if (bodyStr) {
      result.body = parseAndStripContent(bodyStr)
    }
    return JSON.stringify(result, null, 2)
  }

  // 没有 headers，直接从 body 中提取元数据
  if (bodyStr) {
    const stripped = parseAndStripContent(bodyStr)
    return JSON.stringify(stripped, null, 2)
  }

  return ''
}

function parseWrapper(raw: string | null): { headers: Record<string, unknown>; body: string | null } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed.statusCode === 'number' && (parsed.headers || parsed.body !== undefined)) {
      return {
        headers: parsed.headers ?? {},
        body: typeof parsed.body === 'string' ? parsed.body : (parsed.body != null ? JSON.stringify(parsed.body) : null),
      }
    }
    return null
  } catch {
    return null
  }
}

function parseAndStripContent(bodyStr: string): unknown {
  try {
    const obj = JSON.parse(bodyStr)
    if (typeof obj === 'object' && obj !== null) {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (!CONTENT_KEYS.has(key)) {
          result[key] = value
        }
      }
      return result
    }
    return bodyStr
  } catch {
    // 非 JSON（如 SSE 文本），原样返回
    return bodyStr
  }
}
