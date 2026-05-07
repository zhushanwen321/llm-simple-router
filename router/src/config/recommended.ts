import fs from 'fs'
import path from 'path'

export interface ProviderPreset {
  plan: string
  presetName: string
  apiType: 'openai' | 'openai-responses' | 'anthropic'
  baseUrl: string
  upstreamPath?: string
  /** 上游模型列表端点路径，如 /v1/models 或 /models；拼接在 baseUrl 后 */
  modelsEndpoint?: string
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
  providers?: string[]
}

export interface ConfigVersions {
  providers: number
  retryRules: number
}

let configDir = ''

export function loadRecommendedConfig(dir?: string) {
  configDir = dir ?? path.resolve(process.cwd(), 'config')
}

function loadJson<T>(filename: string): T {
  const filePath = path.join(configDir, filename)
  try {
    if (!fs.existsSync(filePath)) return [] as unknown as T
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch (err) {
    process.stderr.write(`[recommended] 加载 ${filename} 失败: ${err instanceof Error ? err.message : String(err)}\n`)
    return [] as unknown as T
  }
}

export function getRecommendedProviders(): ProviderGroup[] {
  return loadJson<ProviderGroup[]>('recommended-providers.json')
}

export function getRecommendedRetryRules(): RecommendedRetryRule[] {
  return loadJson<RecommendedRetryRule[]>('recommended-retry-rules.json')
}

/** 读取推荐配置的版本号（来自独立 version.json，历史版本代码不会读取此文件） */
export function getConfigVersions(): ConfigVersions {
  const filePath = path.join(configDir, 'version.json')
  try {
    if (!fs.existsSync(filePath)) return { providers: 0, retryRules: 0 }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ConfigVersions
  } catch (err) {
    process.stderr.write(`[recommended] 加载 version.json 失败: ${err instanceof Error ? err.message : String(err)}\n`)
    return { providers: 0, retryRules: 0 }
  }
}

// No-op: kept for backward compat (reload endpoint, upgrade flow)
// Config is now always read from disk, no caching.
export function reloadConfig() { /* no-op */ }
