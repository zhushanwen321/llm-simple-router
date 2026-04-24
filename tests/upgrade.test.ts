import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('detectDeployment', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns docker when /.dockerenv exists', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: (p: string) => p === '/.dockerenv',
    }))
    const { detectDeployment } = await import('../src/upgrade/deployment')
    expect(detectDeployment()).toBe('docker')
  })

  it('returns docker when /run/.containerenv exists', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: (p: string) => p === '/run/.containerenv',
    }))
    const { detectDeployment } = await import('../src/upgrade/deployment')
    expect(detectDeployment()).toBe('docker')
  })

  it('returns npm when npm command is available', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: () => false,
    }))
    vi.doMock('node:child_process', () => ({
      execSync: (cmd: string) => {
        if (cmd.startsWith('npm --version')) return Buffer.from('10.0.0\n')
        throw new Error('not found')
      },
    }))
    const { detectDeployment } = await import('../src/upgrade/deployment')
    expect(detectDeployment()).toBe('npm')
  })

  it('returns unknown when no indicators match', async () => {
    vi.doMock('node:fs', () => ({
      existsSync: () => false,
    }))
    vi.doMock('node:child_process', () => ({
      execSync: () => { throw new Error('not found') },
    }))
    const { detectDeployment } = await import('../src/upgrade/deployment')
    expect(detectDeployment()).toBe('unknown')
  })
})

describe('getInstalledVersion', () => {
  it('reads version from package.json', async () => {
    // Restore real node:fs after previous tests mock it
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.doMock('node:fs', () => actualFs)
    const { getInstalledVersion } = await import('../src/upgrade/version')
    const version = getInstalledVersion()
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

import http from 'node:http'

function createMockRegistry(port: number, latestVersion: string) {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 'dist-tags': { latest: latestVersion } }))
  })
}

function createMockFileServer(port: number, providers: unknown, rules: unknown) {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (req.url?.includes('providers')) {
      res.end(JSON.stringify(providers))
    } else {
      res.end(JSON.stringify(rules))
    }
  })
}

describe('UpgradeChecker', () => {
  it('detects npm update available', async () => {
    const server = createMockRegistry(0, '99.0.0')
    await new Promise<void>(r => server.listen(0, () => r()))
    const port = (server.address() as any).port

    const { createUpgradeChecker } = await import('../src/upgrade/checker')
    const checker = createUpgradeChecker({
      npmRegistryUrl: `http://localhost:${port}`,
      configBaseUrl: 'http://localhost:1',
      configDir: '/nonexistent',
    })

    await checker.check()
    const status = checker.getStatus()
    expect(status.npm.hasUpdate).toBe(true)
    expect(status.npm.latestVersion).toBe('99.0.0')

    server.close()
  })

  it('detects no npm update needed', async () => {
    const { getInstalledVersion } = await import('../src/upgrade/version')
    const server = createMockRegistry(0, getInstalledVersion())
    await new Promise<void>(r => server.listen(0, () => r()))
    const port = (server.address() as any).port

    const { createUpgradeChecker } = await import('../src/upgrade/checker')
    const checker = createUpgradeChecker({
      npmRegistryUrl: `http://localhost:${port}`,
      configBaseUrl: `http://localhost:${port}`,
      configDir: '/nonexistent',
    })

    await checker.check()
    expect(checker.getStatus().npm.hasUpdate).toBe(false)

    server.close()
  })

  it('detects config changes', async () => {
    const { getInstalledVersion } = await import('../src/upgrade/version')
    const mockProviders = [{ group: 'Test', presets: [{ plan: 'API', presetName: 'Test-API', apiType: 'openai', baseUrl: 'https://test.api', models: ['test-model'] }] }]
    const mockRules = [{ name: 'New-Rule', status_code: 429, body_pattern: '', retry_strategy: 'exponential', retry_delay_ms: 5000, max_retries: 10, max_delay_ms: 60000 }]

    const fileServer = createMockFileServer(0, mockProviders, mockRules)
    await new Promise<void>(r => fileServer.listen(0, () => r()))
    const port = (fileServer.address() as any).port

    const npmServer = createMockRegistry(0, getInstalledVersion())
    await new Promise<void>(r => npmServer.listen(0, () => r()))
    const npmPort = (npmServer.address() as any).port

    const { createUpgradeChecker } = await import('../src/upgrade/checker')
    const checker = createUpgradeChecker({
      npmRegistryUrl: `http://localhost:${npmPort}`,
      configBaseUrl: `http://localhost:${port}`,
      configDir: '/nonexistent',
    })

    await checker.check()
    const status = checker.getStatus()
    expect(status.config.hasUpdate).toBe(true)

    fileServer.close()
    npmServer.close()
  })

  it('handles check failure gracefully', async () => {
    const { createUpgradeChecker } = await import('../src/upgrade/checker')
    const checker = createUpgradeChecker({
      npmRegistryUrl: 'http://localhost:1',
      configBaseUrl: 'http://localhost:1',
      configDir: '/nonexistent',
    })

    await checker.check()
    const status = checker.getStatus()
    expect(status.npm.hasUpdate).toBe(false)
    expect(status.config.hasUpdate).toBe(false)
  })
})

import Database from 'better-sqlite3'
import { initDatabase } from '../src/db/index.js'
import { setSetting } from '../src/db/settings.js'
import { hashPassword } from '../src/utils/password.js'
import { buildApp } from '../src/index.js'
import type { FastifyInstance } from 'fastify'

describe('config sync source settings', () => {
  let db: Database.Database

  beforeEach(() => {
    db = initDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('defaults to github when not set', async () => {
    const { getConfigSyncSource } = await import('../src/db/settings')
    expect(getConfigSyncSource(db)).toBe('github')
  })

  it('persists and reads gitee preference', async () => {
    const { setConfigSyncSource, getConfigSyncSource } = await import('../src/db/settings')
    setConfigSyncSource(db, 'gitee')
    expect(getConfigSyncSource(db)).toBe('gitee')
  })
})

function seedAuth(db: Database.Database) {
  setSetting(db, 'encryption_key', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
  setSetting(db, 'jwt_secret', 'test-jwt-secret')
  setSetting(db, 'admin_password_hash', hashPassword('test-pass'))
  setSetting(db, 'initialized', 'true')
}

async function adminLogin(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/api/login',
    payload: { password: 'test-pass' },
  })
  const setCookie = res.headers['set-cookie'] as string
  const match = setCookie.match(/admin_token=([^;]+)/)
  return `admin_token=${match![1]}`
}

describe('upgrade API endpoints', () => {
  let app: FastifyInstance
  let db: Database.Database
  let cookie: string
  let close: () => Promise<void>

  beforeEach(async () => {
    db = initDatabase(':memory:')
    seedAuth(db)
    const result = await buildApp({ db })
    app = result.app
    close = result.close
    cookie = await adminLogin(app)
  })

  afterEach(async () => {
    await close()
  })

  it('GET /upgrade/status returns upgrade status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/api/upgrade/status',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('npm')
    expect(body).toHaveProperty('config')
    expect(body).toHaveProperty('deployment')
    expect(body).toHaveProperty('syncSource')
    expect(body).toHaveProperty('lastCheckedAt')
  })

  it('POST /upgrade/check triggers immediate check', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/api/upgrade/check',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
  }, 15_000)

  it('PUT /upgrade/sync-source updates preference', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/api/upgrade/sync-source',
      headers: { cookie },
      payload: { source: 'gitee' },
    })
    expect(res.statusCode).toBe(200)
    const status = await app.inject({
      method: 'GET',
      url: '/admin/api/upgrade/status',
      headers: { cookie },
    })
    expect(JSON.parse(status.body).syncSource).toBe('gitee')
  })
})
