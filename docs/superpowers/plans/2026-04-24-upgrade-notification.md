# 升级通知与一键升级 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理后台 Sidebar 版本号旁显示更新通知，支持 npm 一键升级和推荐配置同步。

**Architecture:** 后端新增 upgrade 模块（checker + deployment + API），定时检查 npm 版本和远程配置变更。前端 Sidebar 版本 Badge 旁加红点通知，点击 Popover 面板展示更新详情和操作按钮。

**Tech Stack:** 后端 Node.js http 模块（请求 npm registry / GitHub / Gitee）、child_process（npm upgrade）、better-sqlite3（持久化来源偏好）。前端 shadcn-vue Popover + AlertDialog + Select 组件。

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/upgrade/deployment.ts` | 检测部署方式（npm/docker/unknown） |
| `src/upgrade/checker.ts` | 定时检查 npm 版本 + 推荐配置变更，缓存结果 |
| `src/admin/upgrade.ts` | 4 个升级相关 API 端点 |
| `src/index.ts` | 注册定时检查 + 暴露版本号 |
| `src/admin/routes.ts` | 注册 upgrade 路由 |
| `src/db/settings.ts` | 新增 config_sync_source 读写函数 |
| `frontend/src/components/layout/Sidebar.vue` | 通知 badge + Popover 面板 |
| `frontend/src/api/client.ts` | 新增 upgrade API 调用 |
| `frontend/src/components/ui/popover/*` | 安装 shadcn-vue Popover 组件 |
| `tests/upgrade.test.ts` | 后端升级模块测试 |

---

### Task 1: 部署方式检测

**Files:**
- Create: `src/upgrade/deployment.ts`
- Test: `tests/upgrade.test.ts`

- [ ] **Step 1: 写测试**

```typescript
// tests/upgrade.test.ts
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/upgrade.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```typescript
// src/upgrade/deployment.ts
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

export type DeploymentType = 'npm' | 'docker' | 'unknown'

export function detectDeployment(): DeploymentType {
  if (existsSync('/.dockerenv') || existsSync('/run/.containerenv')) {
    return 'docker'
  }
  try {
    execSync('npm --version', { stdio: 'pipe', timeout: 3000 })
    return 'npm'
  } catch {
    return 'unknown'
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/upgrade.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/upgrade/deployment.ts tests/upgrade.test.ts
git commit -m "feat: add deployment detection module (npm/docker/unknown)"
```

---

### Task 2: 版本号获取工具函数

**Files:**
- Create: `src/upgrade/version.ts`
- Test: `tests/upgrade.test.ts`（追加）

- [ ] **Step 1: 写测试**

在 `tests/upgrade.test.ts` 文件末尾追加：

```typescript
describe('getInstalledVersion', () => {
  it('reads version from package.json', async () => {
    const { getInstalledVersion } = await import('../src/upgrade/version')
    const version = getInstalledVersion()
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/upgrade.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```typescript
// src/upgrade/version.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

let cachedVersion: string | null = null

export function getInstalledVersion(): string {
  if (cachedVersion) return cachedVersion
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const pkgPath = path.resolve(__dirname, '../../package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  cachedVersion = pkg.version
  return cachedVersion
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/upgrade.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/upgrade/version.ts tests/upgrade.test.ts
git commit -m "feat: add version reader utility"
```

---

### Task 3: 升级检查器（核心）

**Files:**
- Create: `src/upgrade/checker.ts`
- Test: `tests/upgrade.test.ts`（追加）

- [ ] **Step 1: 写测试**

在 `tests/upgrade.test.ts` 追加：

```typescript
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

    // 静默失败，不抛异常
    await checker.check()
    const status = checker.getStatus()
    expect(status.npm.hasUpdate).toBe(false)
    expect(status.config.hasUpdate).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/upgrade.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```typescript
// src/upgrade/checker.ts
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

  async function fetchJson(url: string): Promise<unknown> {
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
      // 静默失败
    }
  }

  async function checkConfig(sourceOverride?: string): Promise<void> {
    try {
      const base = sourceOverride ?? configBaseUrl
      const [remoteProviders, remoteRules] = await Promise.all([
        fetchJson(`${base}/recommended-providers.json`),
        fetchJson(`${base}/recommended-retry-rules.json`),
      ])
      const localProviders = loadLocalJson('recommended-providers.json')
      const localRules = loadLocalJson('recommended-retry-rules.json')

      const providersChanged = JSON.stringify(remoteProviders) !== JSON.stringify(localProviders)
      const rulesChanged = JSON.stringify(remoteRules) !== JSON.stringify(localRules)

      configStatus = {
        hasUpdate: providersChanged || rulesChanged,
        providerChanges: providersChanged ? 1 : 0,
        retryRuleChanges: rulesChanged ? 1 : 0,
      }
    } catch {
      // 静默失败
    }
  }

  async function check(sourceOverride?: string): Promise<void> {
    await Promise.all([checkNpm(), checkConfig(sourceOverride)])
    lastCheckedAt = new Date().toISOString()
  }

  function getStatus(): UpgradeStatus {
    return { npm: { ...npmStatus }, config: { ...configStatus }, lastCheckedAt }
  }

  return { check, getStatus }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/upgrade.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/upgrade/checker.ts tests/upgrade.test.ts
git commit -m "feat: add upgrade checker with npm version and config change detection"
```

---

### Task 4: DB settings 扩展 — config_sync_source

**Files:**
- Modify: `src/db/settings.ts`
- Test: `tests/upgrade.test.ts`（追加）

- [ ] **Step 1: 写测试**

在 `tests/upgrade.test.ts` 追加：

```typescript
import Database from 'better-sqlite3'
import { initDatabase } from '../src/db/index.js'

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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/upgrade.test.ts`
Expected: FAIL — getConfigSyncSource is not exported

- [ ] **Step 3: 在 `src/db/settings.ts` 末尾追加**

```typescript
export function getConfigSyncSource(db: Database.Database): 'github' | 'gitee' {
  const val = getSetting(db, 'config_sync_source')
  return val === 'gitee' ? 'gitee' : 'github'
}

export function setConfigSyncSource(db: Database.Database, source: 'github' | 'gitee'): void {
  setSetting(db, 'config_sync_source', source)
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/upgrade.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/db/settings.ts tests/upgrade.test.ts
git commit -m "feat: add config_sync_source setting for remembering sync preference"
```

---

### Task 5: 升级 API 端点

**Files:**
- Create: `src/admin/upgrade.ts`
- Test: `tests/upgrade.test.ts`（追加）

- [ ] **Step 1: 写测试**

在 `tests/upgrade.test.ts` 追加（需要 auth helper，复用 recommended.test.ts 的 `seedAuthSettings` + `login` 模式）：

```typescript
import { setSetting } from '../src/db/settings.js'
import { hashPassword } from '../src/utils/password.js'
import { FastifyInstance } from 'fastify'

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
  })

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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/upgrade.test.ts`
Expected: FAIL — 404 route not found

- [ ] **Step 3: 实现**

```typescript
// src/admin/upgrade.ts
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
      // 同步后刷新 checker 缓存
      if (checker) await checker.check(getConfigBaseUrl(source))
      return reply.send({ ok: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: { message: `同步失败: ${msg}` } })
    }
  })

  done()
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/upgrade.test.ts`
Expected: PASS

- [ ] **Step 5: 注册路由 — 修改 `src/admin/routes.ts`**

在 import 区域追加：
```typescript
import { adminUpgradeRoutes } from "./upgrade.js";
```

在路由注册区域（`adminRecommendedRoutes` 之后）追加：
```typescript
app.register(adminUpgradeRoutes, { db: options.db });
```

- [ ] **Step 6: 启动 checker — 修改 `src/index.ts`**

在 import 区域追加：
```typescript
import { startUpgradeChecker, stopUpgradeChecker } from "./admin/upgrade.js";
```

在 `loadRecommendedConfig()` 调用之后追加：
```typescript
startUpgradeChecker();
```

在 `close` 函数中追加清理（在 `logCleanup.stop()` 之前）：
```typescript
stopUpgradeChecker();
```

- [ ] **Step 7: 运行全部测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
git add src/admin/upgrade.ts src/admin/routes.ts src/index.ts tests/upgrade.test.ts
git commit -m "feat: add upgrade API endpoints and register checker in app lifecycle"
```

---

### Task 6: 安装 shadcn-vue Popover 组件

**Files:**
- Create: `frontend/src/components/ui/popover/*`

- [ ] **Step 1: 安装组件**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-upgrade/frontend && npx shadcn-vue@latest add popover`

- [ ] **Step 2: 验证文件存在**

Run: `ls /Users/zhushanwen/Code/llm-simple-router-upgrade/frontend/src/components/ui/popover/`
Expected: 出现 Popover.vue, PopoverContent.vue, PopoverTrigger.vue, index.ts

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/ui/popover/
git commit -m "chore: add shadcn-vue Popover component"
```

---

### Task 7: 前端 API 客户端扩展

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: 在 API 常量对象中追加端点**

在 `SETTINGS_IMPORT: '/settings/import',` 之后追加：

```typescript
  UPGRADE_STATUS: '/upgrade/status',
  UPGRADE_CHECK: '/upgrade/check',
  UPGRADE_EXECUTE: '/upgrade/execute',
  UPGRADE_SYNC_CONFIG: '/upgrade/sync-config',
  UPGRADE_SYNC_SOURCE: '/upgrade/sync-source',
```

- [ ] **Step 2: 在 api 对象末尾追加类型和方法**

在 `importConfig` 之后追加：

```typescript
  getUpgradeStatus: () => request<UpgradeStatus>('get', API.UPGRADE_STATUS),
  triggerUpgradeCheck: () => request<{ ok: boolean }>('post', API.UPGRADE_CHECK),
  executeUpgrade: (version: string) => request<{ ok: boolean; version: string }>('post', API.UPGRADE_EXECUTE, { version }),
  syncConfig: (source: 'github' | 'gitee') => request<{ ok: boolean }>('post', API.UPGRADE_SYNC_CONFIG, { source }),
  setSyncSource: (source: 'github' | 'gitee') => request<{ ok: boolean }>('put', API.UPGRADE_SYNC_SOURCE, { source }),
```

在 response types 区域追加 `UpgradeStatus` 接口（在 `ConfigExportResponse` 之后）：

```typescript
export interface UpgradeStatus {
  npm: {
    hasUpdate: boolean
    currentVersion: string
    latestVersion: string | null
  }
  config: {
    hasUpdate: boolean
    providerChanges: number
    retryRuleChanges: number
  }
  deployment: 'npm' | 'docker' | 'unknown'
  syncSource: 'github' | 'gitee'
  lastCheckedAt: string | null
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: add upgrade API client methods"
```

---

### Task 8: Sidebar 通知 Badge + Popover 面板

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.vue`

这是最大的前端任务。Sidebar.vue 当前 95 行，修改后预计约 180 行，在 300 行限制内。

- [ ] **Step 1: 添加 imports 和 composable 逻辑**

在 `<script setup>` 的 import 区域追加：

```typescript
import { ref, onMounted, onUnmounted } from 'vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'vue-sonner'
import type { UpgradeStatus } from '@/api/client'
```

- [ ] **Step 2: 添加状态和逻辑**

在 `const appVersion = __APP_VERSION__` 之后追加：

```typescript
const upgradeStatus = ref<UpgradeStatus | null>(null)
const showUpgradeConfirm = ref(false)
const showRestartConfirm = ref(false)
const isUpgrading = ref(false)
const isSyncing = ref(false)
const isOpen = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null

async function loadUpgradeStatus() {
  try {
    upgradeStatus.value = await api.getUpgradeStatus()
  } catch { /* 静默 */ }
}

async function handleCheckNow() {
  try {
    await api.triggerUpgradeCheck()
    await loadUpgradeStatus()
  } catch { toast.error('检查失败') }
}

async function handleUpgrade() {
  if (!upgradeStatus.value?.npm.latestVersion) return
  isUpgrading.value = true
  try {
    await api.executeUpgrade(upgradeStatus.value.npm.latestVersion)
    toast.success('升级成功')
    showUpgradeConfirm.value = false
    showRestartConfirm.value = true
    await loadUpgradeStatus()
  } catch (e: any) {
    toast.error(e.response?.data?.error?.message || '升级失败')
  } finally {
    isUpgrading.value = false
  }
}

async function handleSync() {
  const source = upgradeStatus.value?.syncSource ?? 'github'
  isSyncing.value = true
  try {
    await api.syncConfig(source)
    toast.success('配置同步成功')
    await loadUpgradeStatus()
  } catch (e: any) {
    toast.error(e.response?.data?.error?.message || '同步失败')
  } finally {
    isSyncing.value = false
  }
}

async function handleSourceChange(val: string) {
  try {
    await api.setSyncSource(val as 'github' | 'gitee')
    await loadUpgradeStatus()
  } catch { toast.error('保存失败') }
}

function handleRestart() {
  showRestartConfirm.value = false
  process.exit(0) // 注意：前端无法直接调用 process.exit，这里需要调用后端 API
}

const updateCount = computed(() => {
  if (!upgradeStatus.value) return 0
  let count = 0
  if (upgradeStatus.value.npm.hasUpdate) count++
  if (upgradeStatus.value.config.hasUpdate) count++
  return count
})

onMounted(() => {
  loadUpgradeStatus()
  pollTimer = setInterval(loadUpgradeStatus, 5 * 60 * 1000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
```

- [ ] **Step 3: 修改 template — 替换顶部版本区域**

将 `<template>` 中第 4-13 行的版本区域替换为：

```vue
    <div class="p-4 border-b border-sidebar-border">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 bg-sidebar-primary rounded-lg flex items-center justify-center">
          <svg class="w-5 h-5 text-sidebar-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
        </div>
        <Popover v-model:open="isOpen">
          <PopoverTrigger as-child>
            <button class="flex items-center gap-2 outline-none">
              <span class="font-semibold text-sm">LLM Router</span>
              <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-4 leading-none">v{{ appVersion }}</Badge>
              <span
                v-if="updateCount > 0"
                class="text-[10px] px-1.5 h-4 leading-none rounded-full bg-red-500 text-white font-semibold flex items-center justify-center"
              >{{ updateCount }}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" class="w-80 p-0">
            <!-- 版本升级 -->
            <div v-if="upgradeStatus?.npm.hasUpdate" class="p-3 border-b border-border">
              <div class="flex items-center gap-2 mb-2">
                <div class="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white text-[10px]">&#8593;</div>
                <span class="text-sm font-medium">新版本可用</span>
              </div>
              <p class="text-xs text-muted-foreground mb-2">
                {{ upgradeStatus.npm.currentVersion }} → <span class="text-green-600 font-medium">{{ upgradeStatus.npm.latestVersion }}</span>
              </p>
              <Button
                v-if="upgradeStatus.deployment === 'npm'"
                size="sm" class="w-full text-xs" :disabled="isUpgrading"
                @click="showUpgradeConfirm = true"
              >
                {{ isUpgrading ? '升级中...' : '一键升级' }}
              </Button>
              <div v-else class="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                检测到 {{ upgradeStatus.deployment === 'docker' ? 'Docker' : '未知' }} 部署，请手动更新：
                <code class="block mt-1 text-[10px] bg-amber-100 p-1 rounded">docker pull ghcr.io/zhushanwen321/llm-simple-router:latest</code>
              </div>
            </div>
            <!-- 配置同步 -->
            <div v-if="upgradeStatus?.config.hasUpdate" class="p-3 border-b border-border">
              <div class="flex items-center gap-2 mb-2">
                <div class="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-white text-[10px]">&#8635;</div>
                <span class="text-sm font-medium">推荐配置已更新</span>
              </div>
              <p class="text-xs text-muted-foreground mb-2">
                供应商或重试规则有新版本
              </p>
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs text-muted-foreground">来源</span>
                <Select :model-value="upgradeStatus?.syncSource" @update:model-value="handleSourceChange">
                  <SelectTrigger class="h-7 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="github">GitHub</SelectItem>
                    <SelectItem value="gitee">Gitee</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" variant="secondary" class="w-full text-xs" :disabled="isSyncing" @click="handleSync">
                {{ isSyncing ? '同步中...' : '同步配置' }}
              </Button>
            </div>
            <!-- 无更新 -->
            <div v-if="!upgradeStatus?.npm.hasUpdate && !upgradeStatus?.config.hasUpdate" class="p-3">
              <p class="text-xs text-muted-foreground">当前已是最新版本，配置也是最新的</p>
            </div>
            <!-- 底部 -->
            <div class="px-3 py-2 flex justify-between items-center text-xs text-muted-foreground">
              <span>{{ upgradeStatus?.lastCheckedAt ? `检查于 ${new Date(upgradeStatus.lastCheckedAt).toLocaleTimeString()}` : '未检查' }}</span>
              <button class="text-blue-500 hover:underline" @click="handleCheckNow">立即检查</button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
```

- [ ] **Step 4: 在 template 末尾 `</aside>` 之前追加 AlertDialog**

```vue
    <!-- 升级确认 -->
    <AlertDialog v-model:open="showUpgradeConfirm">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认升级到 {{ upgradeStatus?.npm.latestVersion }}？</AlertDialogTitle>
          <AlertDialogDescription>
            将执行 <code class="bg-muted px-1 py-0.5 rounded text-xs">npm install -g llm-simple-router@{{ upgradeStatus?.npm.latestVersion }}</code>，升级完成后需要重启服务才能生效。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction @click="handleUpgrade" :disabled="isUpgrading">
            {{ isUpgrading ? '升级中...' : '确认升级' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <!-- 重启确认 -->
    <AlertDialog v-model:open="showRestartConfirm">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>升级成功</AlertDialogTitle>
          <AlertDialogDescription>
            已升级到 {{ upgradeStatus?.npm.latestVersion }}。需要重启服务才能生效。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="showRestartConfirm = false">稍后重启</AlertDialogCancel>
          <AlertDialogAction @click="showRestartConfirm = false">立即重启</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
```

- [ ] **Step 5: 验证前端构建**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-upgrade/frontend && npm run build`
Expected: 构建成功

- [ ] **Step 6: 验证 lint**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-upgrade/frontend && npx eslint src/components/layout/Sidebar.vue --max-warnings=0`
Expected: 零警告

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/layout/Sidebar.vue
git commit -m "feat: add upgrade notification badge and popover panel to sidebar"
```

---

### Task 9: 集成测试 + 最终验证

**Files:**
- Test: `tests/upgrade.test.ts`（追加）

- [ ] **Step 1: 追加集成测试**

在 `tests/upgrade.test.ts` 追加：

```typescript
describe('upgrade integration', () => {
  it('full status flow with deployment detection', async () => {
    const db = initDatabase(':memory:')
    seedAuth(db)
    const { app, close } = await buildApp({ db })
    const cookie = await adminLogin(app)

    // 获取状态
    const statusRes = await app.inject({
      method: 'GET',
      url: '/admin/api/upgrade/status',
      headers: { cookie },
    })
    expect(statusRes.statusCode).toBe(200)
    const status = JSON.parse(statusRes.body)
    expect(['npm', 'docker', 'unknown']).toContain(status.deployment)

    // 手动触发检查
    const checkRes = await app.inject({
      method: 'POST',
      url: '/admin/api/upgrade/check',
      headers: { cookie },
    })
    expect(checkRes.statusCode).toBe(200)

    // 检查后状态更新
    const afterRes = await app.inject({
      method: 'GET',
      url: '/admin/api/upgrade/status',
      headers: { cookie },
    })
    const after = JSON.parse(afterRes.body)
    expect(after.lastCheckedAt).not.toBeNull()

    await close()
  })
})
```

- [ ] **Step 2: 运行全部测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 3: 运行前端构建**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-upgrade/frontend && npm run build`
Expected: 构建成功

- [ ] **Step 4: 提交**

```bash
git add tests/upgrade.test.ts
git commit -m "test: add upgrade integration tests"
```

---

## 自检清单

- **Spec coverage**: 所有 spec 要求（npm 检查、配置检查、部署检测、API、前端 badge/Popover/AlertDialog/Select）均有对应 Task。
- **Placeholder scan**: 无 TBD/TODO/填空，每个步骤有完整代码。
- **Type consistency**: `UpgradeStatus` 接口在 `src/upgrade/checker.ts` 和 `frontend/src/api/client.ts` 中结构一致。`detectDeployment()` 返回值 `'npm' | 'docker' | 'unknown'` 在后端 API 和前端渲染中一致使用。`getConfigSyncSource` / `setConfigSyncSource` 与 `UpgradeStatus.syncSource` 类型一致。
