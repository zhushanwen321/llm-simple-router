import type { ProviderSummary } from '@/types/mapping'

export interface ModelOption {
  name: string
  contextWindow: number
  streamTimeoutMs?: number | null
}

export interface ProviderGroup {
  provider: ProviderSummary
  models: ModelOption[]
  isNew?: boolean
}

export interface SelectedValue {
  provider_id: string
  model: string
}
