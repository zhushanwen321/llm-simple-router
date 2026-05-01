export type ClientType = 'claude-code' | 'pi' | 'codex' | 'openai-sdk' | 'anthropic-sdk'

export interface ClientMeta {
  id: ClientType
  name: string
  icon: string
  iconClass: string
  format: 'anthropic' | 'openai'
  defaultProvider: string
  defaultPlan: string
  description: string
}

export interface PatchOption {
  id: string
  name: string
  desc: string
}

export interface PatchGroup {
  key: string
  label: string
  items: PatchOption[]
}

export interface ModelConfig {
  name: string
  contextWindow: number
  enabled: boolean
  patches: string[]
}

export interface MappingPreviewItem {
  from: string
  to: string
  tag: 'def' | 'auto' | 'cust'
}

export const CLIENTS: ClientMeta[] = [
  { id: 'claude-code', name: 'Claude Code', icon: 'C', iconClass: 'cc', format: 'anthropic', defaultProvider: 'DeepSeek', defaultPlan: 'Anthropic', description: 'Anthropic 官方 CLI 编程助手' },
  { id: 'pi', name: 'Pi', icon: 'P', iconClass: 'pi', format: 'anthropic', defaultProvider: 'DeepSeek', defaultPlan: 'Anthropic', description: '通用编程 Agent 框架' },
  { id: 'codex', name: 'Codex CLI', icon: 'Cx', iconClass: 'cx', format: 'openai', defaultProvider: 'DeepSeek', defaultPlan: 'OpenAI', description: 'OpenAI 官方 CLI 编程助手' },
  { id: 'openai-sdk', name: 'OpenAI SDK', icon: 'OA', iconClass: 'oa', format: 'openai', defaultProvider: 'DeepSeek', defaultPlan: 'OpenAI', description: 'OpenAI API 直接调用' },
  { id: 'anthropic-sdk', name: 'Anthropic SDK', icon: 'AN', iconClass: 'an', format: 'anthropic', defaultProvider: 'DeepSeek', defaultPlan: 'Anthropic', description: 'Anthropic API 直接调用' },
]

export const PATCH_GROUPS: PatchGroup[] = [
  {
    key: 'deepseek_anthropic',
    label: 'DeepSeek 兼容 (Anthropic)',
    items: [
      { id: 'thinking-param', name: 'Thinking 参数', desc: '自动补 thinking 参数' },
      { id: 'cache-control', name: 'Cache Control', desc: '剥离 cache_control' },
      { id: 'thinking-blocks', name: 'Thinking Blocks', desc: '补缺失的 thinking block' },
      { id: 'orphan-tool-results', name: '孤儿 Tool Result', desc: '清理孤儿 tool_result' },
    ],
  },
  {
    key: 'deepseek_openai',
    label: 'DeepSeek 兼容 (OpenAI)',
    items: [
      { id: 'non-ds-tools', name: '非DS Tool 降级', desc: '将非DS生成的 tool_calls 降级为 text' },
      { id: 'orphan-tool-results-oa', name: '孤儿 Tool Result', desc: 'OpenAI 格式孤儿处理' },
    ],
  },
  {
    key: 'general',
    label: '通用兼容',
    items: [
      { id: 'developer-role', name: 'Developer Role', desc: 'developer role 转 system' },
    ],
  },
]

/**
 * Default model name mappings for coding clients.
 * Claude Code expects: claude-sonnet-4-20250514, claude-opus-4-20250116, claude-haiku-4-20250414 etc.
 * But the short aliases are also accepted: opus, sonnet, haiku.
 * We use short names for cleaner mapping display.
 *
 * For Pi: models are 1:1 with provider models (dynamic).
 * For Codex CLI: expects OpenAI model names like codex-mini, o3, o4-mini, gpt-4.1
 */
export const DEFAULT_CLIENT_MAPPINGS: Record<string, string[]> = {
  'claude-code': ['sonnet', 'opus', 'haiku'],
  'codex': ['codex-mini', 'o3', 'o4-mini', 'gpt-4.1'],
  'openai-sdk': ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
  'anthropic-sdk': ['claude-sonnet-4-20250514', 'claude-opus-4-20250116', 'claude-haiku-4-20250414'],
}
// Pi is special: DEFAULT_CLIENT_MAPPINGS['pi'] is dynamic = provider's model names

/** Context window options for model config */
export const CONTEXT_WINDOW_OPTIONS = [
  { label: '8K', value: 8192 },
  { label: '32K', value: 32768 },
  { label: '64K', value: 65536 },
  { label: '128K', value: 131072 },
  { label: '256K', value: 262144 },
  { label: '1M', value: 1048576 },
]
