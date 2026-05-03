import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../src/db/index.js'
import { seedSettings } from './helpers/test-setup.js'
import { applyOverflowRedirect, estimateTokens } from '../src/proxy/routing/overflow.js'
import type { Target } from '../src/proxy/strategy/types.js'

describe('applyOverflowRedirect', () => {
  let db: Database.Database

  beforeEach(() => {
    db = initDatabase(':memory:')
    seedSettings(db)
    db.prepare('INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('p1', 'glm-provider', 'openai', 'http://localhost:1111', '', '["glm-5"]', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    db.prepare('INSERT INTO provider_model_info (provider_id, model_name, context_window) VALUES (?,?,?)')
      .run('p1', 'glm-5', 200000)
  })

  it('未配置溢出模型时返回 null', () => {
    const target: Target = { provider_id: 'p1', backend_model: 'glm-5' }
    const body = { messages: [{ role: 'user', content: 'hi' }] }
    expect(applyOverflowRedirect(target, db, body)).toBeNull()
  })

  it('上下文未超限时返回 null', () => {
    const target: Target = {
      provider_id: 'p1', backend_model: 'glm-5',
      overflow_provider_id: 'p2', overflow_model: 'deepseek-v4',
    }
    const body = { messages: [{ role: 'user', content: 'short message' }] }
    expect(applyOverflowRedirect(target, db, body)).toBeNull()
  })

  it('上下文超限时返回溢出目标', () => {
    const target: Target = {
      provider_id: 'p1', backend_model: 'glm-5',
      overflow_provider_id: 'p2', overflow_model: 'deepseek-v4',
    }
    // 'a' 字符 BPE 压缩率高（~0.125 tokens/char），需要更多字符才能超 200K
    const longContent = 'a'.repeat(2000000)
    const body = { messages: [{ role: 'user', content: longContent }] }
    const result = applyOverflowRedirect(target, db, body)
    expect(result).toEqual({
      provider_id: 'p2',
      backend_model: 'deepseek-v4',
    })
  })

  it('overflow_provider_id 存在但 overflow_model 为空时返回 null', () => {
    const target: Target = {
      provider_id: 'p1', backend_model: 'glm-5',
      overflow_provider_id: 'p2',
    }
    const longContent = 'a'.repeat(2000000)
    const body = { messages: [{ role: 'user', content: longContent }] }
    expect(applyOverflowRedirect(target, db, body)).toBeNull()
  })
})

describe('estimateTokens', () => {
  it('估算短消息的 token 数', () => {
    const body = { messages: [{ role: 'user', content: 'hello' }] }
    const tokens = estimateTokens(body)
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(100)
  })

  it('包含 base64 图片时仍能估算', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(10000) } },
        ],
      }],
    }
    const tokens = estimateTokens(body)
    expect(tokens).toBeGreaterThan(0)
  })
})
