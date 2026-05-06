export type ClientType = 'claude-code' | 'pi' | 'openai-sdk' | 'anthropic-sdk'

export interface ClientMeta {
  id: ClientType
  name: string
  icon: string
  iconClass: string
  format: 'anthropic' | 'openai'
  defaultProvider: string
  defaultPlan: string
  descriptionKey: string
}

export interface PatchOption {
  id: string
  nameKey: string
  descKey: string
}

export interface PatchGroup {
  key: string
  labelKey: string
  items: PatchOption[]
}

export interface ModelConfig {
  name: string
  contextWindow: number
  enabled: boolean
  patches: string[]
}

export interface MappingTarget {
  backend_model: string
  provider_id: string
  overflow_provider_id?: string
  overflow_model?: string
}

export const CLIENTS: ClientMeta[] = [
  { id: 'claude-code', name: 'Claude Code', icon: 'C', iconClass: 'cc', format: 'anthropic', defaultProvider: 'DeepSeek', defaultPlan: 'Anthropic', descriptionKey: 'quickSetup.client.claudeCodeDesc' },
  { id: 'pi', name: 'Pi', icon: 'P', iconClass: 'pi', format: 'anthropic', defaultProvider: 'DeepSeek', defaultPlan: 'Anthropic', descriptionKey: 'quickSetup.client.piDesc' },
  { id: 'openai-sdk', name: 'OpenAI SDK', icon: 'OA', iconClass: 'oa', format: 'openai', defaultProvider: 'DeepSeek', defaultPlan: 'OpenAI', descriptionKey: 'quickSetup.client.openaiSdkDesc' },
  { id: 'anthropic-sdk', name: 'Anthropic SDK', icon: 'AN', iconClass: 'an', format: 'anthropic', defaultProvider: 'DeepSeek', defaultPlan: 'Anthropic', descriptionKey: 'quickSetup.client.anthropicSdkDesc' },
]

export const PATCH_GROUPS: PatchGroup[] = [
  {
    key: 'deepseek_anthropic',
    labelKey: 'quickSetup.patch.deepseekAnthropic',
    items: [
      { id: 'thinking-param', nameKey: 'quickSetup.patch.thinkingParam', descKey: 'quickSetup.patch.thinkingParamDesc' },
      { id: 'cache-control', nameKey: 'quickSetup.patch.cacheControl', descKey: 'quickSetup.patch.cacheControlDesc' },
      { id: 'thinking-blocks', nameKey: 'quickSetup.patch.thinkingBlocks', descKey: 'quickSetup.patch.thinkingBlocksDesc' },
      { id: 'orphan-tool-results', nameKey: 'quickSetup.patch.orphanToolResult', descKey: 'quickSetup.patch.orphanToolResultDesc' },
    ],
  },
  {
    key: 'deepseek_openai',
    labelKey: 'quickSetup.patch.deepseekOpenai',
    items: [
      { id: 'non-ds-tools', nameKey: 'quickSetup.patch.nonDsTools', descKey: 'quickSetup.patch.nonDsToolsDesc' },
      { id: 'orphan-tool-results-oa', nameKey: 'quickSetup.patch.orphanToolResultOa', descKey: 'quickSetup.patch.orphanToolResultOaDesc' },
    ],
  },
  {
    key: 'general',
    labelKey: 'quickSetup.patch.general',
    items: [
      { id: 'developer-role', nameKey: 'quickSetup.patch.developerRole', descKey: 'quickSetup.patch.developerRoleDesc' },
    ],
  },
]

/** Context window options */
export const CONTEXT_WINDOW_OPTIONS = [
  { label: '8K', value: 8000 },
  { label: '16K', value: 16000 },
  { label: '32K', value: 32000 },
  { label: '64K', value: 64000 },
  { label: '128K', value: 128000 },
  { label: '160K', value: 160000 },
  { label: '200K', value: 200000 },
  { label: '256K', value: 256000 },
  { label: '1M', value: 1000000 },
]

const CONTEXT_1M = 1_000_000
const CONTEXT_256K = 256_000
const CONTEXT_200K = 200_000
const CONTEXT_128K = 128_000
const CONTEXT_32K = 32_000
const CONTEXT_16K = 16_000
const CONTEXT_8K = 8_000

/** Default context window per model name pattern */
export function getDefaultContextWindow(modelName: string): number {
  const m = modelName.toLowerCase()
  // 1M context window models
  if (
    m.includes('v4') ||           // DeepSeek v4
    m.includes('v3.2') ||         // DeepSeek V3.2
    m.includes('r1') ||           // DeepSeek R1
    m.includes('reasoner') ||     // OpenAI reasoner
    m.includes('qwen3.6')         // Qwen 3.6 series
  ) return CONTEXT_1M
  // 256K context window models
  if (
    m.includes('kimi') ||         // Kimi K2/K2.5/K2.6/coding
    m.includes('moonshotai') ||   // moonshotai/Kimi-K2 on SiliconFlow
    m.includes('hunyuan-2.0') ||  // 混元 2.0 (instruct/thinking)
    m.includes('hunyuan-a13b') || // 混元 A13B
    m.includes('hunyuan-t1') ||   // 混元 T1
    m.includes('step-3.5') ||     // 阶跃星辰 Step 3.5 Flash
    m.includes('step-3') ||       // 阶跃星辰 Step 3
    m.includes('qwen3.5-plus') || // Qwen 3.5 Plus
    m.includes('qwen3-max') ||    // Qwen 3 Max
    m.includes('doubao') ||       // 豆包 Seed 系列 (1.6+ 256K)
    m.includes('ark-code') ||     // 火山引擎 Coding Plan
    m.includes('tc-code')         // 腾讯云 Coding Plan
  ) return CONTEXT_256K
  // 200K context window models
  if (
    m.includes('glm-5') ||        // GLM-5.1, GLM-5, GLM-5-Turbo
    m.includes('glm-4.7') ||      // GLM-4.7, GLM-4.7-Flash
    m.includes('minimax')         // MiniMax M2 series (204,800 tokens)
  ) return CONTEXT_200K
  // Named context sizes
  if (m.includes('128k')) return CONTEXT_128K
  if (m.includes('32k')) return CONTEXT_32K
  if (m.includes('16k')) return CONTEXT_16K
  if (m.includes('8k')) return CONTEXT_8K
  return CONTEXT_128K
}

/** 映射目标（与后端 MappingTarget 对齐） */
export interface MappingTarget {
  backend_model: string
  provider_id: string
  overflow_provider_id?: string
  overflow_model?: string
}

/** 映射条目：合并了新建映射和已有映射的统一结构 */
export interface MappingEntry {
  /** 客户端模型名 */
  clientModel: string
  /** 映射目标链（故障转移） */
  targets: MappingTarget[]
  /** 是否为已有映射（来自 DB） */
  existing: boolean
  /** 已有映射的 DB id，用于 updateMappingGroup */
  existingId?: string
  /** 来源标签 */
  tag: 'def' | 'auto' | 'cust' | 'existing'
  /** 是否启用 */
  active: boolean
  /** 已有映射的原始 active 状态，用于判断是否需要 toggle */
  originalActive?: boolean
}

/**
 * Default model name mappings for coding clients.
 * Claude Code expects short aliases: opus, sonnet, haiku
 * Pi: models are 1:1 with provider models (dynamic)
 * Codex CLI: expects OpenAI model names like codex-mini, o3, o4-mini
 */
export const DEFAULT_CLIENT_MAPPINGS: Record<string, string[]> = {
  'claude-code': ['sonnet', 'opus', 'haiku'],
  'openai-sdk': ['gpt-5.1', 'gpt-4.1', 'o3', 'o4-mini'],
  'anthropic-sdk': ['claude-sonnet-4-20250514', 'claude-opus-4-20250116', 'claude-haiku-4-20250414'],
}
