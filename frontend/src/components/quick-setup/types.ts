export type ClientType = 'claude-code' | 'pi' | 'codex' | 'openai-sdk' | 'anthropic-sdk'

export interface ClientMeta {
  id: ClientType
  name: string
  icon: string
  iconClass: string
  format: 'anthropic' | 'openai'
  defaultProvider: string
  defaultPlan: string
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
  { id: 'claude-code', name: 'Claude Code', icon: 'C', iconClass: 'cc', format: 'anthropic', defaultProvider: 'DeepSeek', defaultPlan: 'Anthropic' },
  { id: 'pi', name: 'Pi', icon: 'P', iconClass: 'pi', format: 'anthropic', defaultProvider: 'DeepSeek', defaultPlan: 'Anthropic' },
  { id: 'codex', name: 'Codex CLI', icon: 'Cx', iconClass: 'cx', format: 'openai', defaultProvider: 'DeepSeek', defaultPlan: 'OpenAI' },
  { id: 'openai-sdk', name: 'OpenAI SDK', icon: 'OA', iconClass: 'oa', format: 'openai', defaultProvider: 'DeepSeek', defaultPlan: 'OpenAI' },
  { id: 'anthropic-sdk', name: 'Anthropic SDK', icon: 'AN', iconClass: 'an', format: 'anthropic', defaultProvider: 'DeepSeek', defaultPlan: 'Anthropic' },
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

// Default mapping names for coding clients
export const DEFAULT_CLIENT_MAPPINGS: Record<string, string[]> = {
  'claude-code': ['claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4', 'claude-sonnet-4-thinking'],
  'pi': ['claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4', 'claude-sonnet-4-thinking'],
  'codex': ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
}
