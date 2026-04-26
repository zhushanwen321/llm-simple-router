# Phase 2: 后端清理

## Task 5: 移除 compact 代码

**Files:**
- Delete: `src/proxy/compact.ts`
- Delete: `src/config/compact-prompt.ts`
- Modify: `src/proxy/enhancement-config.ts`
- Modify: `src/admin/proxy-enhancement.ts`
- Modify: `src/config/model-context.ts`
- Check: `src/proxy/enhancement/enhancement-handler.ts`（使用 `loadEnhancementConfig`，需确认兼容）

---

### Step 1: 清理 enhancement-config.ts

移除 compact 相关字段，只保留 `claude_code_enabled`：

```typescript
// src/proxy/enhancement-config.ts
import Database from 'better-sqlite3'
import { getSetting } from '../db/settings.js'

export interface EnhancementConfig {
  claude_code_enabled: boolean
}

const DEFAULT_CONFIG: EnhancementConfig = {
  claude_code_enabled: false,
}

export function loadEnhancementConfig(db: Database.Database): EnhancementConfig {
  const raw = getSetting(db, 'proxy_enhancement')
  if (!raw) return { ...DEFAULT_CONFIG }
  try {
    const parsed = JSON.parse(raw)
    return {
      claude_code_enabled: parsed.claude_code_enabled ?? false,
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}
```

### Step 2: 清理 admin/proxy-enhancement.ts

移除 compact 相关 schema 字段、endpoint 和导入：

- 移除 `context_compact_enabled`、`compact_provider_id`、`compact_model` schema 字段（约 line 13-15）
- 移除 `UpdateProxyEnhancementSchema` 中的 compact 字段
- 移除 GET handler 中的 `compact_provider_id`、`compact_model`、`custom_prompt_enabled`、`custom_prompt`、`default_compact_prompt` 返回值
- 移除 PUT handler 中的 compact 字段保存
- 删除 `/admin/api/proxy-enhancement/compact-models` 端点（约 line 73-89）
- 移除 `COMPACT_THRESHOLD` 和 `DEFAULT_COMPACT_PROMPT` 导入
- 移除 `parseModels`、`lookupContextWindow`、`getActiveProvidersWithModels`、`getAllModelInfo` 导入（如果仅被 compact-models 端点使用）

简化后的 GET handler：

```typescript
app.get('/admin/api/proxy-enhancement', async (_request, reply) => {
  const config = loadEnhancementConfig(db)
  return reply.send({ claude_code_enabled: config.claude_code_enabled })
})
```

简化后的 PUT schema：

```typescript
const UpdateProxyEnhancementSchema = Type.Object({
  claude_code_enabled: Type.Boolean(),
})
```

简化后的 PUT handler：

```typescript
app.put('/admin/api/proxy-enhancement', { schema: { body: UpdateProxyEnhancementSchema } }, async (request, reply) => {
  const body = request.body as Static<typeof UpdateProxyEnhancementSchema>
  const config = { claude_code_enabled: body.claude_code_enabled }
  setSetting(db, 'proxy_enhancement', JSON.stringify(config))
  return reply.send({ success: true })
})
```

### Step 3: 清理 model-context.ts

重命名 `COMPACT_THRESHOLD` 为 `OVERFLOW_THRESHOLD`：

```typescript
// line 86: 替换
export const OVERFLOW_THRESHOLD = 1000000
```

全局搜索替换所有引用 `COMPACT_THRESHOLD` 的地方改为 `OVERFLOW_THRESHOLD`。主要是：
- `src/admin/proxy-enhancement.ts`（如 Step 2 中已删除该端点，则无需改）
- `tests/model-context.test.ts`（更新断言）

### Step 4: 删除文件

```bash
rm src/proxy/compact.ts
rm src/config/compact-prompt.ts
```

### Step 5: 更新 model-context 测试

```typescript
// tests/model-context.test.ts — 替换 COMPACT_THRESHOLD 为 OVERFLOW_THRESHOLD
it('OVERFLOW_THRESHOLD 为 1M', () => {
  const { OVERFLOW_THRESHOLD } = await import('../src/config/model-context.js')
  expect(OVERFLOW_THRESHOLD).toBe(1000000)
})
```

### Step 6: 全量验证

Run: `npm test && npm run lint`
Expected: 全部通过，零警告

### Step 7: Commit

```bash
git add -A
git commit -m "refactor: remove compact code, rename COMPACT_THRESHOLD to OVERFLOW_THRESHOLD"
```
