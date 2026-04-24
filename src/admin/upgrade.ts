import { FastifyPluginCallback } from 'fastify'
import Database from 'better-sqlite3'
import { getConfigSyncSource, setConfigSyncSource } from '../db/settings.js'
import { detectDeployment } from '../upgrade/deployment.js'
import { createUpgradeChecker } from '../upgrade/checker.js'
import { reloadConfig } from '../config/recommended.js'
import { execSync } from 'node:child_process'
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const GITHUB_CONFIG_BASE = 'https://raw.githubusercontent.com/zhushanwen321/llm-simple-router/main/config'
const GITEE_CONFIG_BASE = 'https://gitee.com/zzzzswszzzz/llm-simple-router/raw/main/config'

interface UpgradeRoutesOptions {
  db: Database.Database
}

// 模块级单例：checker 和定时器
let checker: ReturnType<typeof createUpgradeChecker> | null = null
let intervalId: ReturnType<typeof setInterval> | null = null

export function startUpgradeChecker() {
  if (checker) return checker
  checker = createUpgradeChecker()
  // 启动时检查一次，之后每小时
  checker.check()
  intervalId = setInterval(() => checker!.check(), 60 * 60 * 1000)
  return checker
}

export function stopUpgradeChecker() {
  if (intervalId) clearInterval(intervalId)
  checker = null
  intervalId = null
}

function getConfigBaseUrl(source: 'github' | 'gitee'): string {
  return source === 'gitee' ? GITEE_CONFIG_BASE : GITHUB_CONFIG_BASE
}

async function fetchRemoteJson(url: string): Promise<unknown> {
  const mod = url.startsWith('https') ? https : http
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 5000)
    mod.get(url, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk })
      res.on('end', () => {
        clearTimeout(timer)
        try { resolve(JSON.parse(data)) } catch { reject(new Error('invalid json')) }
      })
    }).on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

export const adminUpgradeRoutes: FastifyPluginCallback<UpgradeRoutesOptions> = (app, options, done) => {
  const { db } = options

  app.get('/admin/api/upgrade/status', async (_req, reply) => {
    const c = checker ?? createUpgradeChecker()
    const deployment = detectDeployment()
    const syncSource = getConfigSyncSource(db)
    return reply.send({ ...c.getStatus(), deployment, syncSource })
  })

  app.post('/admin/api/upgrade/check', async (_req, reply) => {
    const c = checker ?? createUpgradeChecker()
    const syncSource = getConfigSyncSource(db)
    await c.check(getConfigBaseUrl(syncSource))
    return reply.send({ ok: true })
  })

  app.put('/admin/api/upgrade/sync-source', async (req, reply) => {
    const { source } = req.body as { source: 'github' | 'gitee' }
    if (source !== 'github' && source !== 'gitee') {
      return reply.code(400).send({ error: { message: 'source must be github or gitee' } })
    }
    setConfigSyncSource(db, source)
    return reply.send({ ok: true })
  })

  app.post('/admin/api/upgrade/execute', async (req, reply) => {
    const deployment = detectDeployment()
    if (deployment !== 'npm') {
      return reply.code(400).send({ error: { message: '仅支持 npm 全局安装模式下自动升级' } })
    }
    const { version } = req.body as { version: string }
    if (!version) {
      return reply.code(400).send({ error: { message: 'version is required' } })
    }
    try {
      execSync(`npm install -g llm-simple-router@${version}`, {
        stdio: 'pipe',
        timeout: 120_000,
      })
      return reply.send({ ok: true, version })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: { message: `升级失败: ${msg}` } })
    }
  })

  app.post('/admin/api/upgrade/sync-config', async (req, reply) => {
    const { source } = req.body as { source: 'github' | 'gitee' }
    if (source !== 'github' && source !== 'gitee') {
      return reply.code(400).send({ error: { message: 'source must be github or gitee' } })
    }
    const base = getConfigBaseUrl(source)
    const configDir = path.resolve(process.cwd(), 'config')
    try {
      fs.mkdirSync(configDir, { recursive: true })
      const [providers, rules] = await Promise.all([
        fetchRemoteJson(`${base}/recommended-providers.json`),
        fetchRemoteJson(`${base}/recommended-retry-rules.json`),
      ])
      fs.writeFileSync(path.join(configDir, 'recommended-providers.json'), JSON.stringify(providers, null, 2))
      fs.writeFileSync(path.join(configDir, 'recommended-retry-rules.json'), JSON.stringify(rules, null, 2))
      reloadConfig()
      if (checker) await checker.check(getConfigBaseUrl(source))
      return reply.send({ ok: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: { message: `同步失败: ${msg}` } })
    }
  })

  done()
}
