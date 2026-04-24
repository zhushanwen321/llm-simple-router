import { FastifyPluginCallback } from 'fastify'
import Database from 'better-sqlite3'
import { getConfigSyncSource, setConfigSyncSource } from '../db/settings.js'
import { detectDeployment } from '../upgrade/deployment.js'
import { createUpgradeChecker, fetchJson, CheckerOptions } from '../upgrade/checker.js'
import { reloadConfig } from '../config/recommended.js'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { HTTP_BAD_REQUEST, HTTP_INTERNAL_ERROR } from '../constants.js'

const GITHUB_CONFIG_BASE = 'https://raw.githubusercontent.com/zhushanwen321/llm-simple-router/main/config'
const GITEE_CONFIG_BASE = 'https://gitee.com/zzzzswszzzz/llm-simple-router/raw/main/config'
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // eslint-disable-line no-magic-numbers
const JSON_INDENT = 2

interface UpgradeRoutesOptions {
  db: Database.Database
}

// 模块级单例：checker 和定时器
let checker: ReturnType<typeof createUpgradeChecker> | null = null
let intervalId: ReturnType<typeof setInterval> | null = null

export function startUpgradeChecker(opts?: CheckerOptions) {
  if (checker) return checker
  checker = createUpgradeChecker(opts)
  // 启动时检查一次，之后每小时
  checker.check()
  intervalId = setInterval(() => checker!.check(), CHECK_INTERVAL_MS)
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
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: 'source must be github or gitee' } })
    }
    setConfigSyncSource(db, source)
    return reply.send({ ok: true })
  })

  app.post('/admin/api/upgrade/execute', async (req, reply) => {
    const deployment = detectDeployment()
    if (deployment !== 'npm') {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: '仅支持 npm 全局安装模式下自动升级' } })
    }
    const { version } = req.body as { version: string }
    if (!version) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: 'version is required' } })
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: '无效版本号格式' } })
    }
    try {
      execSync(`npm install -g llm-simple-router@${version}`, {
        stdio: 'pipe',
        timeout: 120_000,
      })
      return reply.send({ ok: true, version })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(HTTP_INTERNAL_ERROR).send({ error: { message: `升级失败: ${msg}` } })
    }
  })

  app.post('/admin/api/upgrade/sync-config', async (req, reply) => {
    const { source } = req.body as { source: 'github' | 'gitee' }
    if (source !== 'github' && source !== 'gitee') {
      return reply.code(HTTP_BAD_REQUEST).send({ error: { message: 'source must be github or gitee' } })
    }
    const base = getConfigBaseUrl(source)
    const configDir = path.resolve(process.cwd(), 'config')
    try {
      fs.mkdirSync(configDir, { recursive: true })
      const [providersResult, rulesResult] = await Promise.allSettled([
        fetchJson(`${base}/recommended-providers.json`),
        fetchJson(`${base}/recommended-retry-rules.json`),
      ])
      if (providersResult.status === 'fulfilled') {
        fs.writeFileSync(path.join(configDir, 'recommended-providers.json'), JSON.stringify(providersResult.value, null, JSON_INDENT))
      }
      if (rulesResult.status === 'fulfilled') {
        fs.writeFileSync(path.join(configDir, 'recommended-retry-rules.json'), JSON.stringify(rulesResult.value, null, JSON_INDENT))
      }
      if (providersResult.status === 'rejected' && rulesResult.status === 'rejected') {
        throw new Error('同步失败: 无法获取 providers 和 retry-rules 配置')
      }
      reloadConfig()
      if (checker) await checker.check(getConfigBaseUrl(source))
      return reply.send({ ok: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(HTTP_INTERNAL_ERROR).send({ error: { message: `同步失败: ${msg}` } })
    }
  })

  done()
}
