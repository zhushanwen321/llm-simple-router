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

/** Default context window per model name pattern */
export function getDefaultContextWindow(modelName: string): number {
  const m = modelName.toLowerCase()
  if (m.includes('v4') || m.includes('v3.2') || m.includes('r1') || m.includes('reasoner')) return 1000000
  if (m.includes('128k')) return 128000
  if (m.includes('32k')) return 32000
  if (m.includes('8k')) return 8000
  return 128000
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
