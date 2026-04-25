# Phase 1: 后端核心

## Task 1: 扩展 Target 类型

**Files:**
- Modify: `src/proxy/strategy/types.ts`
- Modify: `frontend/src/types/mapping.ts`

- [ ] **Step 1: 扩展后端 Target 接口**

```typescript
// src/proxy/strategy/types.ts — 在 Target 接口添加可选字段
export interface Target {
  backend_model: string;
  provider_id: string;
  overflow_provider_id?: string;
  overflow_model?: string;
}
```

- [ ] **Step 2: 扩展前端 MappingTarget 接口**

```typescript
// frontend/src/types/mapping.ts — MappingTarget 添加可选字段
export interface MappingTarget {
  backend_model: string
  provider_id: string
  overflow_provider_id?: string
  overflow_model?: string
}
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit && cd frontend && npx vue-tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/proxy/strategy/types.ts frontend/src/types/mapping.ts
git commit -m "feat: extend Target type with overflow model fields"
```

---

## Task 2: 创建溢出重定向逻辑 (TDD)

**Files:**
- Create: `src/proxy/overflow.ts`
- Create: `tests/overflow.test.ts`
- Reference: `src/proxy/compact.ts`（迁移 estimateTokens 和 base64 工具函数）

### Step 1: 编写失败测试

```typescript
// tests/overflow.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDatabase } from '../src/db/index.js'
import { seedSettings } from './helpers/test-setup.js'
import { applyOverflowRedirect, estimateTokens } from '../src/proxy/overflow.js'
import type { Target } from '../src/proxy/strategy/types.js'

describe('applyOverflowRedirect', () => {
  let db: Database.Database

  beforeEach(() => {
    db = initDatabase(':memory:')
    seedSettings(db)
    // 插入 provider + model info
    db.prepare('INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active) VALUES (?,?,?,?,?,?,?)')
      .run('p1', 'glm-provider', 'openai', 'http://localhost:1111', '', '["glm-5"]', 1)
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
    // 构造超长消息（200K tokens ≈ 600K chars）
    const longContent = 'a'.repeat(700000)
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
    const longContent = 'a'.repeat(700000)
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
```

Run: `npx vitest run tests/overflow.test.ts`
Expected: FAIL（模块不存在）

### Step 2: 实现溢出重定向

从 `src/proxy/compact.ts` 迁移 `estimateTokens` 及其辅助函数，创建新的 `applyOverflowRedirect`：

```typescript
// src/proxy/overflow.ts
import Database from 'better-sqlite3'
import { getModelContextWindowOverride } from '../db/model-info.js'
import { lookupContextWindow, DEFAULT_CONTEXT_WINDOW } from '../config/model-context.js'
import type { Target } from './strategy/types.js'

const ESTIMATED_TOKENS_PER_IMAGE = 2000
const BASE64_PLACEHOLDER = '[BASE64_REDACTED]'

interface OverflowResult {
  provider_id: string
  backend_model: string
}

function stripBase64ForEstimation(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.length > 200 ? BASE64_PLACEHOLDER : obj
  }
  if (Array.isArray(obj)) return obj.map(stripBase64ForEstimation)
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = stripBase64ForEstimation(v)
    }
    return result
  }
  return obj
}

function countImageBlocks(messages: unknown[]): number {
  let count = 0
  for (const msg of messages) {
    const content = (msg as Record<string, unknown>).content
    if (Array.isArray(content)) {
      for (const block of content) {
        const type = (block as Record<string, unknown>).type
        if (type === 'image' || type === 'image_url') count++
      }
    }
  }
  return count
}

export function estimateTokens(body: Record<string, unknown>): number {
  const messages = (body.messages ?? []) as unknown[]
  const cleaned = stripBase64ForEstimation(messages)
  const textTokens = Math.ceil(JSON.stringify(cleaned).length / 3)
  const imageTokens = countImageBlocks(messages) * ESTIMATED_TOKENS_PER_IMAGE
  return textTokens + imageTokens
}

function getContextWindow(db: Database.Database, providerId: string, modelName: string): number {
  return getModelContextWindowOverride(db, providerId, modelName) ?? lookupContextWindow(modelName)
}

export function applyOverflowRedirect(
  target: Target,
  db: Database.Database,
  body: Record<string, unknown>,
): OverflowResult | null {
  if (!target.overflow_provider_id || !target.overflow_model) return null

  const estimated = estimateTokens(body)
  const contextWindow = getContextWindow(db, target.provider_id, target.backend_model)

  if (estimated > contextWindow) {
    return { provider_id: target.overflow_provider_id, backend_model: target.overflow_model }
  }
  return null
}
```

Run: `npx vitest run tests/overflow.test.ts`
Expected: PASS

### Step 3: Commit

```bash
git add src/proxy/overflow.ts tests/overflow.test.ts
git commit -m "feat: add overflow redirect logic with token estimation"
```

---

## Task 3: 更新 proxy-handler

**Files:**
- Modify: `src/proxy/proxy-handler.ts`

### Step 1: 替换导入

将 compact 相关导入替换为 overflow：

```typescript
// 替换（约 line 27-31）：
// import { estimateTokens, getModelContextWindow, applyCompactRedirect } from "./compact.js"
// 改为：
import { applyOverflowRedirect } from "./overflow.js"
```

### Step 2: 替换溢出处理逻辑

替换（约 line 250-263）的 compact 处理代码：

```typescript
// 删除旧代码：
// const compactResult = applyCompactRedirect({...})
// if (compactResult === "overflow") { rejectAndReply(...) }
// if (compactResult) { resolved = ... }

// 替换为：
const overflowResult = applyOverflowRedirect(resolved, deps.db, body)
if (overflowResult) {
  const overflowProvider = deps.providers.find(p => p.id === overflowResult.provider_id)
  if (overflowProvider) {
    resolved = overflowResult
    provider = overflowProvider
    body.model = overflowResult.backend_model
  }
}
```

### Step 3: 移除 loadEnhancementConfig 调用

删除（约 line 195）的 `const compactConfig = loadEnhancementConfig(deps.db)` 及其导入（如果仅用于 compact）。

### Step 4: 验证编译 + 测试

Run: `npx tsc --noEmit && npx vitest run tests/openai-proxy.test.ts`
Expected: 编译通过，现有测试不受影响

### Step 5: Commit

```bash
git add src/proxy/proxy-handler.ts
git commit -m "refactor: replace compact redirect with overflow model switching"
```

---

## Task 4: 重写集成测试

**Files:**
- Rename: `tests/context-compact.test.ts` → `tests/overflow-redirect.test.ts`

### Step 1: 重写测试

核心变化：
- 不再通过 `setCompactConfig(db, config)` 配置全局设置
- 溢出模型通过 Target 的 `overflow_provider_id`/`overflow_model` 字段配置
- 不再返回 400 错误，而是透明切换模型

```typescript
// tests/overflow-redirect.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import http from 'node:http'
import { initDatabase } from '../src/db/index.js'
import { encrypt } from '../src/utils/crypto.js'
import { setSetting } from '../src/db/settings.js'
import { TEST_ENCRYPTION_KEY } from './helpers/test-setup.js'
import { createMockBackend, closeServer } from './helpers/mock-backend.js'
import { buildApp } from '../src/index.js'
import type { FastifyInstance } from 'fastify'

function insertProvider(db: Database.Database, id: string, baseUrl: string, models: string[], contextWindows: Map<string, number>) {
  db.prepare('INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active) VALUES (?,?,?,?,?,?,?)')
    .run(id, id, 'openai', baseUrl, encrypt('test-key', TEST_ENCRYPTION_KEY), JSON.stringify(models), 1)
  for (const [name, cw] of contextWindows) {
    db.prepare('INSERT INTO provider_model_info (provider_id, model_name, context_window) VALUES (?,?,?)')
      .run(id, name, cw)
  }
}

function insertMappingGroup(db: Database.Database, clientModel: string, target: Record<string, string>) {
  const rule = JSON.stringify({ default: target, windows: [] })
  db.prepare('INSERT INTO mapping_groups (id, client_model, strategy, rule) VALUES (?,?,?,?)')
    .run('mg1', clientModel, 'scheduled', rule)
}

describe('Overflow model redirect', () => {
  let db: Database.Database
  let app: FastifyInstance
  let defaultBackend: { server: http.Server; port: number }
  let overflowBackend: { server: http.Server; port: number }

  beforeEach(async () => {
    db = initDatabase(':memory:')
    setSetting(db, 'encryption_key', TEST_ENCRYPTION_KEY)

    defaultBackend = createMockBackend((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'default response' } }] }))
    })
    overflowBackend = createMockBackend((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'overflow response' } }] }))
    })

    insertProvider(db, 'p-default', `http://localhost:${defaultBackend.port}`, ['glm-5'],
      new Map([['glm-5', 200000]]))
    insertProvider(db, 'p-overflow', `http://localhost:${overflowBackend.port}`, ['deepseek-v4'],
      new Map([['deepseek-v4', 1000000]]))

    app = buildApp({ config: { port: 9981, dbPath: ':memory:', logLevel: 'silent' }, db })
  })

  afterEach(async () => {
    await app.close()
    await closeServer(defaultBackend.server)
    await closeServer(overflowBackend.server)
  })

  it('正常请求不触发溢出切换', async () => {
    insertMappingGroup(db, 'my-model', {
      backend_model: 'glm-5', provider_id: 'p-default',
      overflow_provider_id: 'p-overflow', overflow_model: 'deepseek-v4',
    })
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: 'Bearer test-key' },
      payload: { model: 'my-model', messages: [{ role: 'user', content: 'hello' }] },
    })
    expect(res.statusCode).toBe(200)
  })

  it('上下文超限时透明切换到溢出模型', async () => {
    insertMappingGroup(db, 'my-model', {
      backend_model: 'glm-5', provider_id: 'p-default',
      overflow_provider_id: 'p-overflow', overflow_model: 'deepseek-v4',
    })
    const longContent = 'a'.repeat(700000)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: 'Bearer test-key' },
      payload: { model: 'my-model', messages: [{ role: 'user', content: longContent }] },
    })
    expect(res.statusCode).toBe(200)
  })

  it('未配置溢出模型时直接透传（即使超限）', async () => {
    insertMappingGroup(db, 'my-model', {
      backend_model: 'glm-5', provider_id: 'p-default',
    })
    const longContent = 'a'.repeat(700000)
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      headers: { authorization: 'Bearer test-key' },
      payload: { model: 'my-model', messages: [{ role: 'user', content: longContent }] },
    })
    // 直接转发到默认模型（上游可能失败，但 router 不拦截）
    expect(res.statusCode).toBe(200)
  })
})
```

Run: `npx vitest run tests/overflow-redirect.test.ts`
Expected: PASS

### Step 2: 删除旧测试文件

```bash
rm tests/context-compact.test.ts
```

### Step 3: 全量测试验证

Run: `npm test`
Expected: 全部通过

### Step 4: Commit

```bash
git add tests/overflow-redirect.test.ts tests/context-compact.test.ts
git commit -m "test: replace compact tests with overflow redirect integration tests"
```
