import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { getInstalledVersion } from './version.js'

export interface NpmStatus {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string | null
}

export interface ConfigStatus {
  hasUpdate: boolean
  providerChanges: number
  retryRuleChanges: number
}

export interface UpgradeStatus {
  npm: NpmStatus
  config: ConfigStatus
  lastCheckedAt: string | null
}

export interface CheckerOptions {
  npmRegistryUrl?: string
  configBaseUrl?: string
  configDir?: string
}

const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org/llm-simple-router'
const DEFAULT_GITHUB_CONFIG_BASE = 'https://raw.githubusercontent.com/zhushanwen321/llm-simple-router/main/config'
const CHECK_TIMEOUT_MS = 5000

export async function fetchJson(url: string): Promise<unknown> {
  const mod = url.startsWith('https') ? https : http
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)
    mod.get(url, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk })
      res.on('end', () => {
        clearTimeout(timer)
        try { resolve(JSON.parse(data)) }
        catch { reject(new Error('invalid json')) }
      })
    }).on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

export function createUpgradeChecker(options?: CheckerOptions) {
  const npmRegistryUrl = options?.npmRegistryUrl ?? DEFAULT_NPM_REGISTRY
  const configBaseUrl = options?.configBaseUrl ?? DEFAULT_GITHUB_CONFIG_BASE
  const configDir = options?.configDir ?? path.resolve(process.cwd(), 'config')

  let npmStatus: NpmStatus = {
    hasUpdate: false,
    currentVersion: getInstalledVersion(),
    latestVersion: null,
  }
  let configStatus: ConfigStatus = {
    hasUpdate: false,
    providerChanges: 0,
    retryRuleChanges: 0,
  }
  let lastCheckedAt: string | null = null

  function loadLocalJson(filename: string): unknown {
    const filePath = path.join(configDir, filename)
    try {
      if (!fs.existsSync(filePath)) return null
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    } catch {
      return null
    }
  }

  async function checkNpm(): Promise<void> {
    try {
      const data = await fetchJson(npmRegistryUrl) as { 'dist-tags'?: { latest?: string } }
      const latest = data?.['dist-tags']?.latest ?? null
      npmStatus = {
        hasUpdate: latest !== null && latest !== npmStatus.currentVersion,
        currentVersion: npmStatus.currentVersion,
        latestVersion: latest,
      }
    } catch {
      process.stderr.write('[upgrade] failed to check npm version\n')
    }
  }

  async function checkConfig(sourceOverride?: string): Promise<void> {
    try {
      const base = sourceOverride ?? configBaseUrl
      const [providersResult, rulesResult] = await Promise.allSettled([
        fetchJson(`${base}/recommended-providers.json`),
        fetchJson(`${base}/recommended-retry-rules.json`),
      ])
      const remoteProviders = providersResult.status === 'fulfilled' ? providersResult.value : null
      const remoteRules = rulesResult.status === 'fulfilled' ? rulesResult.value : null
      if (!remoteProviders && !remoteRules) {
        throw new Error('both providers and rules fetch failed')
      }
      const localProviders = loadLocalJson('recommended-providers.json')
      const localRules = loadLocalJson('recommended-retry-rules.json')

      const providersChanged = remoteProviders !== null && JSON.stringify(remoteProviders) !== JSON.stringify(localProviders)
      const rulesChanged = remoteRules !== null && JSON.stringify(remoteRules) !== JSON.stringify(localRules)

      configStatus = {
        hasUpdate: providersChanged || rulesChanged,
        providerChanges: providersChanged ? 1 : 0,
        retryRuleChanges: rulesChanged ? 1 : 0,
      }
    } catch {
      process.stderr.write('[upgrade] failed to check config update\n')
    }
  }

  async function check(sourceOverride?: string): Promise<void> {
    await Promise.allSettled([checkNpm(), checkConfig(sourceOverride)])
    lastCheckedAt = new Date().toISOString()
  }

  function getStatus(): UpgradeStatus {
    return { npm: { ...npmStatus }, config: { ...configStatus }, lastCheckedAt }
  }

  return { check, getStatus }
}
