import fs from 'fs'
import path from 'path'

export interface ProviderPreset {
  plan: string
  presetName: string
  apiType: 'openai' | 'anthropic'
  baseUrl: string
  models: string[]
}

export interface ProviderGroup {
  group: string
  presets: ProviderPreset[]
}

export interface RecommendedRetryRule {
  name: string
  status_code: number
  body_pattern: string
  retry_strategy: 'fixed' | 'exponential'
  retry_delay_ms: number
  max_retries: number
  max_delay_ms: number
}

let cachedProviders: ProviderGroup[] = []
let cachedRetryRules: RecommendedRetryRule[] = []
let configDir = ''

export function loadRecommendedConfig(dir?: string) {
  configDir = dir ?? path.resolve(process.cwd(), 'config')
  cachedProviders = loadJson<ProviderGroup[]>('recommended-providers.json')
  cachedRetryRules = loadJson<RecommendedRetryRule[]>('recommended-retry-rules.json')
}

export function getRecommendedProviders(): ProviderGroup[] {
  return cachedProviders
}

export function getRecommendedRetryRules(): RecommendedRetryRule[] {
  return cachedRetryRules
}

export function reloadConfig() {
  loadRecommendedConfig(configDir)
}

function loadJson<T>(filename: string): T {
  const filePath = path.join(configDir, filename)
  try {
    if (!fs.existsSync(filePath)) return [] as unknown as T
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return [] as unknown as T
  }
}
