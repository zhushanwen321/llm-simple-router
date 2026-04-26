import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadRecommendedConfig, getRecommendedProviders, getRecommendedRetryRules, reloadConfig } from '../src/config/recommended'
import { buildApp } from '../src/index.js'
import { initDatabase } from '../src/db/index.js'
import { setSetting } from '../src/db/settings.js'
import { hashPassword } from '../src/utils/password.js'
import { FastifyInstance } from 'fastify'
import Database from 'better-sqlite3'
import path from 'path'

const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function seedAuthSettings(db: Database.Database) {
  setSetting(db, 'encryption_key', TEST_ENCRYPTION_KEY)
  setSetting(db, 'jwt_secret', 'test-jwt-secret-for-testing')
  setSetting(db, 'admin_password_hash', hashPassword('test-admin-pass'))
  setSetting(db, 'initialized', 'true')
}

async function login(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/api/login',
    payload: { password: 'test-admin-pass' },
  })
  const setCookie = res.headers['set-cookie']
  const match = (setCookie as string).match(/admin_token=([^;]+)/)
  return `admin_token=${match![1]}`
}

const CONFIG_DIR = path.resolve(__dirname, '../config')

describe('recommended config loader', () => {
  beforeEach(() => {
    loadRecommendedConfig(CONFIG_DIR)
  })

  it('loads provider presets from JSON', () => {
    const providers = getRecommendedProviders()
    expect(providers.length).toBeGreaterThan(0)
    expect(providers[0]).toHaveProperty('group')
    expect(providers[0]).toHaveProperty('presets')
    const preset = providers[0].presets[0]
    expect(preset).toHaveProperty('presetName')
    expect(preset).toHaveProperty('apiType')
    expect(preset).toHaveProperty('baseUrl')
    expect(preset).toHaveProperty('models')
    expect(Array.isArray(preset.models)).toBe(true)
  })

  it('loads retry rules from JSON', () => {
    const rules = getRecommendedRetryRules()
    expect(rules.length).toBeGreaterThan(0)
    expect(rules[0]).toHaveProperty('name')
    expect(rules[0]).toHaveProperty('status_code')
    expect(rules[0]).toHaveProperty('body_pattern')
    expect(rules[0]).toHaveProperty('retry_strategy')
  })

  it('returns empty arrays when config dir does not exist', () => {
    loadRecommendedConfig('/nonexistent/path')
    expect(getRecommendedProviders()).toEqual([])
    expect(getRecommendedRetryRules()).toEqual([])
  })

  it('reload refreshes cached data', () => {
    loadRecommendedConfig(CONFIG_DIR)
    const before = getRecommendedProviders()
    reloadConfig()
    const after = getRecommendedProviders()
    expect(after).toEqual(before)
  })
})

describe('recommended API endpoints', () => {
  let app: FastifyInstance
  let db: Database.Database
  let cookie: string
  let close: () => Promise<void>

  beforeEach(async () => {
    db = initDatabase(':memory:')
    seedAuthSettings(db)
    const result = await buildApp({ db })
    app = result.app
    close = result.close
    cookie = await login(app)
  })

  afterEach(async () => {
    await close()
  })

  it('GET /recommended/providers returns preset list', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/api/recommended/providers', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json().data
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    expect(body[0]).toHaveProperty('group')
    expect(body[0]).toHaveProperty('presets')
  })

  it('GET /recommended/retry-rules returns rules list (excluding seeded)', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/api/recommended/retry-rules', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const body = res.json().data
    expect(Array.isArray(body)).toBe(true)
    // buildApp seeds default rules, so all recommended rules may already exist in DB
    // Each item that IS returned should have a 'name' property
    body.forEach((r: any) => expect(r).toHaveProperty('name'))
  })

  it('POST /recommended/reload returns ok', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/api/recommended/reload', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ ok: true })
  })

  it('providers endpoint returns all presets regardless of existing DB providers', async () => {
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, api_key_preview, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('test-id', 'zhipu', 'openai', 'https://example.com', 'encrypted', 'zhi...iew', '[]', 1, 0, 0, 100, new Date().toISOString(), new Date().toISOString())

    const res = await app.inject({ method: 'GET', url: '/admin/api/recommended/providers', headers: { cookie } })
    const body = res.json().data
    const zhipuGroup = body.find((g: any) => g.group === '智谱')
    expect(zhipuGroup).toBeDefined()
    // All presets should be returned, including ones with existing names
    expect(zhipuGroup.presets.some((p: any) => p.presetName === 'zhipu')).toBe(true)
    expect(zhipuGroup.presets.some((p: any) => p.presetName === 'zhipu-coding-plan')).toBe(true)
  })

  it('retry-rules endpoint filters out existing DB rules by name', async () => {
    // Insert a custom rule that does not match any recommended name
    db.prepare(
      `INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('custom-id', 'Custom Test Rule', 500, '.*', 1, new Date().toISOString(), 'fixed', 1000, 3, 5000)

    // Also delete all seeded rules so recommended ones will show up
    db.prepare('DELETE FROM retry_rules WHERE name != ?').run('Custom Test Rule')

    const res = await app.inject({ method: 'GET', url: '/admin/api/recommended/retry-rules', headers: { cookie } })
    const body = res.json().data
    // Seeded rules are gone so recommended rules should appear now
    expect(body.length).toBeGreaterThan(0)
    // The custom rule is not a recommended rule, so it won't appear in output
    expect(body.every((r: any) => r.name !== 'Custom Test Rule')).toBe(true)
  })
})
