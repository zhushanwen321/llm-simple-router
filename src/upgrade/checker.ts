import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { getInstalledVersion } from './version.js'
import { getConfigVersions } from '../config/recommended.js'

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
const HTTP_STATUS_REDIRECT_LOWER = 300
const HTTP_STATUS_REDIRECT_UPPER = 400
const HTTP_STATUS_OK_LOWER = 200

const MAX_REDIRECTS = 5;

export async function fetchJson(url: string, redirects = 0): Promise<unknown> {
  if (redirects > MAX_REDIRECTS) throw new Error('too many redirects')
  const mod = url.startsWith('https') ? https : http
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)
    mod.get(url, (res) => {
      if (res.statusCode && res.statusCode >= HTTP_STATUS_REDIRECT_LOWER && res.statusCode < HTTP_STATUS_REDIRECT_UPPER && res.headers.location) {
        clearTimeout(timer)
        res.resume()
        fetchJson(res.headers.location, redirects + 1).then(resolve, reject)
        return
      }
      if (res.statusCode && (res.statusCode < HTTP_STATUS_OK_LOWER || res.statusCode >= HTTP_STATUS_REDIRECT_LOWER)) {
        clearTimeout(timer)
        res.resume()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
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
      const remote = await fetchJson(`${base}/version.json`) as { providers?: number; retryRules?: number } | null

      // 远程无 version.json（老版本仓库）→ 视为无更新
      if (remote === null) {
        configStatus = { hasUpdate: false, providerChanges: 0, retryRuleChanges: 0 }
        return
      }
      const local = getConfigVersions()

      const providersChanged = (remote.providers ?? 0) > local.providers
      const rulesChanged = (remote.retryRules ?? 0) > local.retryRules

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
