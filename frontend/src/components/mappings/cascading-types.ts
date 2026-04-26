import type { ProviderSummary } from '@/types/mapping'

export interface ModelOption {
  name: string
  contextWindow: number
}

export interface ProviderGroup {
  provider: ProviderSummary
  models: ModelOption[]
}

export interface SelectedValue {
  provider_id: string
  model: string
}
