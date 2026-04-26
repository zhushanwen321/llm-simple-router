/** 模型信息（含上下文窗口大小） */
export interface ModelInfo {
  name: string
  context_window: number | null
}

/** 映射组（列表项，rule 为 JSON 字符串） */
export interface MappingGroup {
  id: string
  client_model: string
  strategy: string
  rule: string
  is_active: number
  created_at: string
}

/** Provider 完整信息（Providers 页面使用） */
export interface Provider {
  id: string
  name: string
  api_type: string
  base_url: string
  api_key: string
  models: ModelInfo[]
  is_active: number
  max_concurrency: number
  queue_timeout_ms: number
  max_queue_size: number
}

/** Provider 精简信息（映射配置、下拉选择等场景使用） */
export interface ProviderSummary {
  id: string
  name: string
}

/** 映射目标（backend_model + provider_id 对） */
export interface MappingTarget {
  backend_model: string
  provider_id: string
  overflow_provider_id?: string
  overflow_model?: string
}

/** 定时策略的时间窗口 */
export interface RuleWindow {
  start: string
  end: string
  target: MappingTarget
}

/** 映射组 rule 字段解析后的结构 */
export interface Rule {
  default?: MappingTarget
  windows?: RuleWindow[]
  targets?: MappingTarget[]
}
