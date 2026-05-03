import { FastifyPluginCallback } from 'fastify'
import Database from 'better-sqlite3'
import { getConfigSyncSource, setConfigSyncSource } from '../db/settings.js'
import { detectDeployment, hasProcessManager, resolveRestartBinPath, getRestartMethod } from '../upgrade/deployment.js'
import { createUpgradeChecker, fetchJson, CheckerOptions } from '../upgrade/checker.js'
import { reloadConfig } from '../config/recommended.js'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { HTTP_BAD_REQUEST, HTTP_INTERNAL_ERROR } from '../core/constants.js'
import { API_CODE, apiError } from './api-response.js'

const GITHUB_CONFIG_BASE = 'https://raw.githubusercontent.com/zhushanwen321/llm-simple-router/main/config'
const GITEE_CONFIG_BASE = 'https://gitee.com/zzzzswszzzz/llm-simple-router/raw/main/config'
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // eslint-disable-line no-magic-numbers
const JSON_INDENT = 2

interface UpgradeRoutesOptions {
  db: Database.Database
  closeFn: () => Promise<void>
}

// 模块级单例：checker、configDir 和定时器
let checker: ReturnType<typeof createUpgradeChecker> | null = null
let configDir: string = ''
let intervalId: ReturnType<typeof setInterval> | null = null

export function startUpgradeChecker(opts?: CheckerOptions) {
  if (checker) return checker
  configDir = opts?.configDir ?? path.resolve(process.cwd(), 'config')
  checker = createUpgradeChecker({ ...opts, configDir })
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
    const restartMethod = getRestartMethod()
    return reply.send({ ...c.getStatus(), deployment, syncSource, restartMethod })
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
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, 'source must be github or gitee'))
    }
    setConfigSyncSource(db, source)
    return reply.send({ ok: true })
  })

  app.post('/admin/api/upgrade/execute', async (req, reply) => {
    const deployment = detectDeployment()
    if (deployment !== 'npm') {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, '仅支持 npm 全局安装模式下自动升级'))
    }
    const { version } = req.body as { version: string }
    if (!version) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, 'version is required'))
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, '无效版本号格式'))
    }
    try {
      execSync(`npm install -g llm-simple-router@${version}`, {
        stdio: 'pipe',
        timeout: 120_000,
      })
      return reply.send({ ok: true, version })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(HTTP_INTERNAL_ERROR).send(apiError(API_CODE.INTERNAL_ERROR, `升级失败: ${msg}`))
    }
  })

  app.post('/admin/api/upgrade/restart', async (req, reply) => {
    const managed = hasProcessManager()
    const method = getRestartMethod()

    // 先回复客户端，再执行重启（否则客户端收不到响应）
    reply.send({ ok: true, method })

    // 给响应发送窗口
    await new Promise((resolve) => setTimeout(resolve, 300)) // eslint-disable-line no-magic-numbers

    try {
      req.log.info({ method, managed }, 'Restarting server...')

      // 优雅关闭（释放端口、等待活跃请求完成）
      await options.closeFn()

      if (!managed) {
        // 无进程管理器（npx / 手动 node）：自 spawn 新进程
        const binPath = resolveRestartBinPath()
        const args = process.argv.slice(2) // eslint-disable-line no-magic-numbers
        req.log.info({ binPath, args }, 'Spawning new process before exit')
        const child = spawn(binPath, args, {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env },
        })
        child.unref()
      }

      req.log.info('Exiting current process')
      process.exit(0)
    } catch (err) {
      // 重启失败时记录错误，保持服务运行
      const msg = err instanceof Error ? err.message : String(err)
      req.log.error({ err }, `Restart failed: ${msg}`)
    }
  })

  app.post('/admin/api/upgrade/sync-config', async (req, reply) => {
    const { source } = req.body as { source: 'github' | 'gitee' }
    if (source !== 'github' && source !== 'gitee') {
      return reply.code(HTTP_BAD_REQUEST).send(apiError(API_CODE.BAD_REQUEST, 'source must be github or gitee'))
    }
    const base = getConfigBaseUrl(source)
    const syncConfigDir = configDir || path.resolve(process.cwd(), 'config')
    try {
      fs.mkdirSync(syncConfigDir, { recursive: true })
      const [providersResult, rulesResult] = await Promise.allSettled([
        fetchJson(`${base}/recommended-providers.json`),
        fetchJson(`${base}/recommended-retry-rules.json`),
      ])
      if (providersResult.status === 'fulfilled') {
        fs.writeFileSync(path.join(syncConfigDir, 'recommended-providers.json'), JSON.stringify(providersResult.value, null, JSON_INDENT))
      }
      if (rulesResult.status === 'fulfilled') {
        fs.writeFileSync(path.join(syncConfigDir, 'recommended-retry-rules.json'), JSON.stringify(rulesResult.value, null, JSON_INDENT))
      }
      if (providersResult.status === 'rejected' && rulesResult.status === 'rejected') {
        throw new Error('同步失败: 无法获取 providers 和 retry-rules 配置')
      }
      reloadConfig()
      if (checker) await checker.check(getConfigBaseUrl(source))
      return reply.send({ ok: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(HTTP_INTERNAL_ERROR).send(apiError(API_CODE.INTERNAL_ERROR, `同步失败: ${msg}`))
    }
  })

  done()
}
