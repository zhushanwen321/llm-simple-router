import fs from "node:fs"
import path from "node:path"

export interface ModelInfo {
  name: string
  context_window: number | null
  patches: string[]
  stream_timeout_ms?: number
  capabilities?: string[]
}

export interface ModelEntry {
  name: string
  context_window?: number
  patches?: string[]
  stream_timeout_ms?: number
  capabilities?: string[]
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

/** 已知支持图片输入的模型白名单。不在表中的模型默认 [\"text\"]。 */
export const MODEL_CAPABILITIES: Record<string, string[]> = {
  // ── OpenAI ── 文档确认支持 image_url
  "gpt-4o": ["text", "image"],
  "gpt-4o-mini": ["text", "image"],
  "gpt-4-turbo": ["text", "image"],
  "gpt-4.1": ["text", "image"],
  "gpt-4.1-mini": ["text", "image"],
  "gpt-4.1-nano": ["text", "image"],
  "o1": ["text", "image"],
  "o1-pro": ["text", "image"],
  "o3": ["text", "image"],
  "o3-mini": ["text", "image"],
  "o4-mini": ["text", "image"],
  // ── Anthropic ── 文档确认支持 image content block
  "claude-3.5-sonnet": ["text", "image"],
  "claude-3.5-haiku": ["text", "image"],
  "claude-3-opus": ["text", "image"],
  "claude-4-sonnet": ["text", "image"],
  "claude-4-opus": ["text", "image"],
  // ── DeepSeek ──
  // V3/V4 不接受 OpenAI image_url 格式（API 返回 unknown variant 'image_url'）
  // 只有专用视觉模型 deepseek-vl2 支持
  "deepseek-vl2": ["text", "image"],
  // ── 智谱 ──
  // GLM-5/5.1 是纯文本 LLM；GLM-5V-Turbo / GLM-4.5V 才是视觉模型
  // 文档确认视觉模型支持 image_url 格式
  "glm-5v-turbo": ["text", "image"],
  "glm-4.5v": ["text", "image"],
  "glm-4v-plus": ["text", "image"],
  "glm-4v-flash": ["text", "image"],
  // ── 月之暗面 ── 原生多模态架构，全部支持 image_url
  "moonshot-v1-128k": ["text", "image"],
  "moonshot-v1-32k": ["text", "image"],
  "moonshot-v1-8k": ["text", "image"],
  "kimi-k2.6": ["text", "image"],
  "kimi-k2.5": ["text", "image"],
  "kimi-k2-turbo-preview": ["text", "image"],
  "kimi-k2-thinking": ["text", "image"],
  "kimi-for-coding": ["text", "image"],
  // ── 阿里云 Qwen ── 百炼文档确认 qwen3.6-plus/qwen3.5-plus/flash 支持 image_url
  "qwen-vl-max": ["text", "image"],
  "qwen-vl-plus": ["text", "image"],
  "qwen3.6-plus": ["text", "image"],
  "qwen3.5-plus": ["text", "image"],
  "qwen3.5-flash": ["text", "image"],
  // ── 火山引擎 ── Doubao Seed 2.0 Pro 规格：Input Text, Images, Video
  "doubao-seed-2-0-pro-260215": ["text", "image"],
  // ── 小米 MiMo ── 只有 omni 版本支持图片，pro 版本是纯文本
  "mimo-v2-omni": ["text", "image"],
  "mimo-v2.5": ["text", "image"],
}

export const DEFAULT_CONTEXT_WINDOW = 200000
export const OVERFLOW_THRESHOLD = 1000000

// ---------- model-directory.json 运行时加载 ----------

/** 从 ai-model-directory 提取的精简数据结构 */
interface ModelDirectoryData {
  capabilities: Record<string, string[]>
  context_windows: Record<string, number>
}

let directoryCapabilities: Record<string, string[]> = {}
let directoryContextWindows: Record<string, number> = {}

/**
 * 加载 config/model-directory.json（由 sync-model-directory.sh 生成）。
 * 加载失败时不覆盖默认值，fallback 到硬编码白名单。
 */
export function loadModelDirectory(configDir?: string): void {
  try {
    const dir = configDir ?? path.resolve(process.cwd(), "config")
    const filePath = path.join(dir, "model-directory.json")
    const raw = fs.readFileSync(filePath, "utf-8")
    const data: ModelDirectoryData = JSON.parse(raw)
    if (data.capabilities && typeof data.capabilities === "object") {
      directoryCapabilities = data.capabilities
    }
    if (data.context_windows && typeof data.context_windows === "object") {
      directoryContextWindows = data.context_windows
    }
  // eslint-disable-next-line taste/no-silent-catch -- 加载失败不影响启动，使用硬编码白名单兆底。但记录到 stderr 供诊断
  } catch (err: unknown) {
  // 加载失败不影响启动，使用硬编码白名单兆底。但记录到 stderr 供诊断
    console.error('loadModelDirectory: failed to load, using hardcoded fallback', err)
  }
}

/** 查询模型 capabilities：显式配置 > model-directory.json > 硬编码白名单 > ["text"] */
export function lookupCapabilities(modelName: string): string[] {
  return MODEL_CAPABILITIES[modelName]
  ?? directoryCapabilities[modelName]
  ?? ["text"]
}

/** 查询模型上下文窗口：model-directory.json > 硬编码表 > 默认值 */
export function lookupContextWindow(modelName: string): number {
  return MODEL_CONTEXT_WINDOWS[modelName]
  ?? directoryContextWindows[modelName]
  ?? DEFAULT_CONTEXT_WINDOW
}

/** 标准化 patch 名称：连字符 → 下划线 */
export function normalizePatchName(name: string): string {
  return name.replace(/-/g, "_")
}

/**
 * 解析 providers.models 的 JSON 文本。
 *
 * 这是解析 providers.models 字段的唯一合法入口。
 * 禁止直接 JSON.parse(provider.models) —— 数据格式已从 string[] 演进为 ModelEntry[]，
 * 直接 JSON.parse 会得到对象数组而非字符串数组，导致运行时错误。
 *
 * ESLint 规则 taste/no-raw-json-parse-models 会强制执行此约束。
 */
/** 旧 patch ID 到新 patch ID 的迁移映射 */
const PATCH_ID_MIGRATION: Record<string, string> = {
  thinking_param: "thinking_consistency",
  thinking_blocks: "thinking_consistency",
  non_ds_tools: "thinking_consistency",
  cache_control: "thinking_consistency",
};

// parseModels 缓存，key 为 raw 字符串引用
const modelsCache = new Map<string, ModelEntry[]>();

/** 清除缓存（仅供测试使用） */
export function clearModelsCache(): void {
  modelsCache.clear();
}

export function parseModels(raw: string): ModelEntry[] {
  if (!raw) return []
  const cached = modelsCache.get(raw)
  if (cached) return cached
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const result = parsed.map((item: unknown): ModelEntry | null => {
      if (typeof item === 'string') {
        return item
          ? { name: item, patches: [], capabilities: lookupCapabilities(item) }
          : null
      }
      const obj = item as { name?: string; id?: string; patches?: string[]; stream_timeout_ms?: number; capabilities?: string[] } | null
      if (!obj) return null
      const modelName = obj.name ?? obj.id
      if (!modelName) return null
      const rawPatches = (obj.patches ?? []).map(normalizePatchName);
      const migrated = rawPatches.map(p => PATCH_ID_MIGRATION[p] ?? p);
      const patches = [...new Set(migrated)];
      const entry: ModelEntry = {
        name: modelName,
        patches,
      }
      if (obj.stream_timeout_ms != null) entry.stream_timeout_ms = obj.stream_timeout_ms
      // capabilities: 显式 > model-directory > 硬编码白名单 > 默认 ["text"]
      entry.capabilities = obj.capabilities ?? lookupCapabilities(modelName)
      return entry
    }).filter((e): e is ModelEntry => e !== null)
    modelsCache.set(raw, result)
    return result
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
    if (entry.capabilities != null) info.capabilities = entry.capabilities
    return info
  })
}
