export interface ModelInfo {
  name: string
  context_window: number | null
  patches: string[]
  stream_timeout_ms?: number
}

export interface ModelEntry {
  name: string
  context_window?: number
  patches?: string[]
  stream_timeout_ms?: number
}

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // DeepSeek
  "deepseek-chat": 1000000,
  "deepseek-reasoner": 1000000,
  "deepseek-v3": 1000000,
  "deepseek-r1": 1000000,
  "deepseek-v4-flash": 1000000,
  "deepseek-v4-pro": 1000000,
  "deepseek-v3.2": 128000,
  // 智谱
  "glm-5.1": 200000,
  "glm-5": 200000,
  "glm-5-turbo": 200000,
  "glm-4.7": 200000,
  "glm-4.7-flash": 200000,
  "glm-4.6": 200000,
  "glm-4.5-air": 128000,
  // KIMI
  "kimi-for-coding": 256000,
  "kimi-k2.6": 256000,
  "kimi-k2.5": 256000,
  "kimi-k2-turbo-preview": 256000,
  "kimi-k2-thinking": 256000,
  "moonshot-v1-128k": 128000,
  // 阿里云 Qwen
  "qwen3.6-plus": 1000000,
  "qwen3.5-plus": 1000000,
  "qwen3-max": 256000,
  "qwen3.5-flash": 1000000,
  "qwen3-coder-plus": 1000000,
  "qwen3-coder-next": 256000,
  // MiniMax
  "MiniMax-M2.7": 200000,
  "MiniMax-M2.7-highspeed": 200000,
  "MiniMax-M2.5": 200000,
  "MiniMax-M2.5-highspeed": 200000,
  "MiniMax-M2.1": 200000,
  "MiniMax-M2": 200000,
  // 百度千帆
  "ernie-4.0-8k": 8000,
  "ernie-4.0-turbo-8k": 8000,
  "ernie-3.5-8k": 8000,
  "ernie-speed-8k": 8000,
  "ernie-lite-8k": 8000,
  "ernie-x1-32k-preview": 32000,
  // 科大讯飞
  "4.0Ultra": 32000,
  "generalv3.5": 8000,
  "max-32k": 32000,
  "generalv3": 8000,
  "pro-128k": 128000,
  "lite": 8000,
  // 火山引擎
  "ark-code-latest": 256000,
  "doubao-seed-2.0-code": 256000,
  "doubao-seed-2-0-pro-260215": 256000,
  "doubao-seed-1-8-251228": 256000,
  "doubao-seed-code-preview-251028": 256000,
  // 腾讯云
  "tc-code-latest": 256000,
  "hunyuan-2.0-instruct": 128000,
  "hunyuan-2.0-thinking": 128000,
  "hunyuan-turbos": 32000,
  "hunyuan-t1": 32000,
  "hunyuan-a13b": 256000,
  // 阶跃星辰
  "step-3.5-flash": 256000,
  "step-3.5-flash-2603": 256000,
  "step-3": 64000,
  "step-2-16k": 16000,
  "step-1-8k": 8000,
  "step-1-32k": 32000,
  // 硅基流动
  "deepseek-ai/DeepSeek-V3.2-Exp": 128000,
  "deepseek-ai/DeepSeek-R1": 128000,
  "Qwen/Qwen3-8B": 128000,
  "Qwen/Qwen2.5-72B-Instruct": 128000,
  "Qwen/Qwen2.5-Coder-32B-Instruct": 128000,
  "moonshotai/Kimi-K2-Instruct": 128000,
  "moonshotai/Kimi-K2.5": 256000,
}

export const DEFAULT_CONTEXT_WINDOW = 200000
export const OVERFLOW_THRESHOLD = 1000000

export function lookupContextWindow(modelName: string): number {
  return MODEL_CONTEXT_WINDOWS[modelName] ?? DEFAULT_CONTEXT_WINDOW
}

/** 标准化 patch 名称：连字符 → 下划线 */
export function normalizePatchName(name: string): string {
  return name.replace(/-/g, "_")
}

export function parseModels(raw: string): ModelEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item: unknown): ModelEntry | null => {
      if (typeof item === 'string') {
        return item ? { name: item, patches: [] } : null
      }
      const obj = item as { name?: string; patches?: string[]; stream_timeout_ms?: number } | null
      if (!obj || !obj.name) return null
      const result: ModelEntry = {
        name: obj.name,
        patches: (obj.patches ?? []).map(normalizePatchName),
      }
      if (obj.stream_timeout_ms != null) result.stream_timeout_ms = obj.stream_timeout_ms
      return result
    }).filter((e): e is ModelEntry => e !== null)
  } catch {
    return []
  }
}

export function buildModelInfoList(
  modelEntries: ModelEntry[],
  overrides: Map<string, number>,
): ModelInfo[] {
  return modelEntries.map(entry => {
    const info: ModelInfo = {
      name: entry.name,
      context_window: overrides.get(entry.name) ?? lookupContextWindow(entry.name),
      patches: entry.patches ?? [],
    }
    if (entry.stream_timeout_ms != null) info.stream_timeout_ms = entry.stream_timeout_ms
    return info
  })
}
