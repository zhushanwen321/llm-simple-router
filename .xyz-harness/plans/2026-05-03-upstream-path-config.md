# Upstream Path 配置 + 推荐供应商修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 provider 增加 `upstream_path` 可配置字段，解决百度千帆等非标准路径供应商的 URL 拼接问题；同时修复所有推荐供应商的 baseUrl 错误和 OpenCode Go 模型缺失。

**Architecture:** 在 provider DB 表增加 `upstream_path` 可选字段（默认 NULL），路由器 proxy 时优先使用此字段替代硬编码的 `/v1/chat/completions` 或 `/v1/messages`。前端 QuickSetup 页面在 Base URL 旁增加可编辑的 Upstream Path 输入框，选择推荐预设时自动填充默认值。百度千帆等非标准供应商设置非默认的 `upstream_path`。

**Tech Stack:** SQLite migration, Fastify/TypeBox, Vue 3 + shadcn-vue

---

## File Structure

| Operation | File | Responsibility |
|-----------|------|----------------|
| Create | `router/src/db/migrations/038_add_upstream_path.sql` | DB migration: 添加 `upstream_path` 列 |
| Modify | `router/src/db/providers.ts` | Provider interface + CRUD 支持 `upstream_path` |
| Modify | `router/src/proxy/handler/proxy-handler.ts` | proxy 时使用 `provider.upstream_path` |
| Modify | `router/src/proxy/proxy-core.ts` | `buildUpstreamUrl` 支持自定义 upstreamPath |
| Modify | `router/src/proxy/transform/transform-coordinator.ts` | `getUpstreamPath` 支持外部覆盖 |
| Modify | `router/src/admin/providers.ts` | provider CRUD API schema 支持 `upstream_path` |
| Modify | `router/src/admin/quick-setup.ts` | quick-setup API schema 支持 `upstream_path` |
| Modify | `router/config/recommended-providers.json` | 修复 baseUrl + 添加 upstreamPath + 更新模型 |
| Modify | `router/src/config/recommended.ts` | ProviderPreset 接口添加 `upstreamPath` |
| Modify | `frontend/src/types/mapping.ts` | Provider 类型添加 `upstream_path` |
| Modify | `frontend/src/api/client.ts` | 前端 API 类型添加 `upstream_path` |
| Modify | `frontend/src/composables/useQuickSetup.ts` | composable 支持 upstreamPath |
| Modify | `frontend/src/views/QuickSetup.vue` | UI: 添加 Upstream Path 输入框 |
| Modify | `frontend/src/views/Providers.vue` | Provider 编辑表单支持 upstream_path |
| Modify | `docs/provider/doc_url.json` | 同步文档 URL |

---

### Task 1: DB Migration — 添加 `upstream_path` 列

**Files:**
- Create: `router/src/db/migrations/038_add_upstream_path.sql`

- [ ] **Step 1: 创建 migration SQL**

```sql
-- Add upstream_path column to providers table.
-- When NULL, the router uses the default path based on api_type:
--   openai / openai-responses → /v1/chat/completions or /v1/responses
--   anthropic → /v1/messages
-- When set, this value overrides the default upstream path.

ALTER TABLE providers ADD COLUMN upstream_path TEXT DEFAULT NULL;
```

- [ ] **Step 2: 验证 migration 被自动加载**

Run: `cd router && grep -n "migrations" src/db/index.ts | head -5`

确认 migration runner 会自动扫描 `migrations/` 目录按编号执行。

---

### Task 2: 后端 Provider 类型 + CRUD 支持 `upstream_path`

**Files:**
- Modify: `router/src/db/providers.ts`

- [ ] **Step 1: Provider interface 添加 `upstream_path`**

在 `Provider` interface 的 `base_url` 之后添加:

```typescript
export interface Provider {
  id: string;
  name: string;
  api_type: "openai" | "openai-responses" | "anthropic";
  base_url: string;
  upstream_path: string | null;  // ← 新增
  api_key: string;
  // ... 其余不变
}
```

- [ ] **Step 2: `PROVIDER_FIELDS` 添加 `"upstream_path"`**

```typescript
const PROVIDER_FIELDS = new Set([
  "name", "api_type", "base_url", "upstream_path", "api_key", "api_key_preview", "models", "is_active", "max_concurrency", "queue_timeout_ms", "max_queue_size", "adaptive_enabled",
]);
```

- [ ] **Step 3: `createProvider` 函数签名和 SQL 添加 `upstream_path`**

`createProvider` 参数对象添加:
```typescript
upstream_path?: string | null;
```

INSERT SQL 改为:
```sql
INSERT INTO providers (id, name, api_type, base_url, upstream_path, api_key, api_key_preview, models, is_active, max_concurrency, queue_timeout_ms, max_queue_size, adaptive_enabled, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

对应的 `.run()` 参数在 `base_url` 之后添加 `provider.upstream_path ?? null`。

- [ ] **Step 4: `updateProvider` 的 `Partial<Pick<Provider, ...>>` 联合类型添加 `"upstream_path"`**

```typescript
export function updateProvider(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<Provider, "name" | "api_type" | "base_url" | "upstream_path" | "api_key" | "api_key_preview" | "models" | "is_active" | "max_concurrency" | "queue_timeout_ms" | "max_queue_size" | "adaptive_enabled">>,
): void {
```

- [ ] **Step 5: 验证编译**

Run: `cd router && npx tsc --noEmit 2>&1 | grep "providers.ts" | head -5`

---

### Task 3: 后端 API Schema — providers 路由支持 `upstream_path`

**Files:**
- Modify: `router/src/admin/providers.ts`

- [ ] **Step 1: Create schema 添加 `upstream_path` 可选字段**

找到 `base_url: Type.String({ minLength: 1 })` 行，在其后添加:

```typescript
upstream_path: Type.Optional(Type.String({ minLength: 1 })),
```

- [ ] **Step 2: Update schema 添加 `upstream_path` 可选字段**

找到 Update schema 中的 `base_url: Type.Optional(...)` 行，在其后添加:

```typescript
upstream_path: Type.Optional(Type.String({ minLength: 1 })),
```

- [ ] **Step 3: Create handler 传递 `upstream_path`**

找到 `createProvider(db, {` 调用，在 `base_url: body.base_url,` 之后添加:

```typescript
upstream_path: body.upstream_path ?? null,
```

- [ ] **Step 4: Update handler 传递 `upstream_path`**

找到 `if (body.base_url !== undefined) fields.base_url = body.base_url;` 行，在其后添加:

```typescript
if (body.upstream_path !== undefined) fields.upstream_path = body.upstream_path || null;
```

- [ ] **Step 5: 验证编译**

Run: `cd router && npx tsc --noEmit 2>&1 | grep "providers.ts" | head -5`

---

### Task 4: 后端 API Schema — quick-setup 路由支持 `upstream_path`

**Files:**
- Modify: `router/src/admin/quick-setup.ts`

- [ ] **Step 1: QuickSetupProviderSchema 添加 `upstream_path`**

在 `base_url: Type.String({ minLength: 1 })` 之后添加:

```typescript
upstream_path: Type.Optional(Type.String({ minLength: 1 })),
```

- [ ] **Step 2: createProvider 调用传递 `upstream_path`**

找到 `createProvider(db, {` 调用中的 `base_url: body.provider.base_url,` 行，在其后添加:

```typescript
upstream_path: body.provider.upstream_path ?? null,
```

- [ ] **Step 3: 验证编译**

Run: `cd router && npx tsc --noEmit 2>&1 | grep "quick-setup" | head -5`

---

### Task 5: 推荐配置接口 — ProviderPreset 添加 `upstreamPath`

**Files:**
- Modify: `router/src/config/recommended.ts`

- [ ] **Step 1: ProviderPreset interface 添加 `upstreamPath` 可选字段**

```typescript
export interface ProviderPreset {
  plan: string
  presetName: string
  apiType: 'openai' | 'openai-responses' | 'anthropic'
  baseUrl: string
  upstreamPath?: string  // ← 新增，覆盖默认的 upstream path
  models: string[]
}
```

---

### Task 6: 路由器 Proxy — 使用 `provider.upstream_path` 覆盖默认路径

**Files:**
- Modify: `router/src/proxy/proxy-core.ts`
- Modify: `router/src/proxy/handler/proxy-handler.ts`

- [ ] **Step 1: proxy-handler.ts — 在 `effectiveUpstreamPath` 计算之后注入自定义路径**

找到以下代码段（约 line 300-307）:

```typescript
let effectiveUpstreamPath = upstreamPath;

if (needsTransform) {
  const transformed = coordinator.transformRequest(currentBody, apiType, provider.api_type, resolved.backend_model);
  // 用转换后的结果替换 currentBody
  currentBody = transformed.body as Record<string, unknown>;
  effectiveUpstreamPath = transformed.upstreamPath;
  effectiveApiType = provider.api_type;
}
```

在 `if (needsTransform)` 块之后（约 line 308），添加自定义 upstream_path 覆盖逻辑:

```typescript
// Provider 自定义 upstream_path 覆盖默认路径（例如百度千帆 /chat/completions）
if (provider.upstream_path) {
  effectiveUpstreamPath = provider.upstream_path;
}
```

- [ ] **Step 2: 验证编译**

Run: `cd router && npx tsc --noEmit 2>&1 | grep "proxy-handler" | head -5`

---

### Task 7: 修复推荐配置 JSON — baseUrl + upstreamPath + 模型

**Files:**
- Modify: `router/config/recommended-providers.json`

这是数据修复任务，需要修改以下供应商的配置：

- [ ] **Step 1: 硅基流动 — 去掉 baseUrl 的 `/v1`**

```
baseUrl: "https://api.siliconflow.cn/v1" → "https://api.siliconflow.cn"
```

- [ ] **Step 2: 科大讯飞 — 去掉 baseUrl 的 `/v1`**

```
baseUrl: "https://spark-api-open.xf-yun.com/v1" → "https://spark-api-open.xf-yun.com"
```

- [ ] **Step 3: 阶跃星辰 API — 去掉 baseUrl 的 `/v1`**

```
baseUrl: "https://api.stepfun.com/v1" → "https://api.stepfun.com"
```

- [ ] **Step 4: 百度千帆 — 保持 baseUrl，添加 `upstreamPath: "/chat/completions"`**

```
baseUrl 保持 "https://qianfan.baidubce.com/v2"
添加 upstreamPath: "/chat/completions"
```

因为路由器默认拼接 `/v1/chat/completions`，百度千帆的正确路径是 `/v2/chat/completions`。
设置 `baseUrl = "https://qianfan.baidubce.com/v2"` + `upstreamPath = "/chat/completions"` → 最终 URL = `https://qianfan.baidubce.com/v2/chat/completions`。

- [ ] **Step 5: OpenCode Go — 更新模型列表 + 修正 baseUrl**

当前 baseUrl `https://opencode.ai/zen/go/v1/chat/completions` 虽然能工作（buildUpstreamUrl 去重），但不符合常规做法。改为标准形式：

Go OpenAI preset:
```json
{
  "plan": "Go OpenAI",
  "presetName": "opencode-go-openai",
  "apiType": "openai",
  "baseUrl": "https://opencode.ai/zen/go/v1/chat/completions",
  "models": [
    "glm-5.1", "glm-5",
    "kimi-k2.5", "kimi-k2.6",
    "deepseek-v4-pro", "deepseek-v4-flash",
    "mimo-v2-pro", "mimo-v2-omni", "mimo-v2.5-pro", "mimo-v2.5",
    "qwen3.6-plus", "qwen3.5-plus"
  ]
}
```

Go Anthropic preset:
```json
{
  "plan": "Go Anthropic",
  "presetName": "opencode-go-anthropic",
  "apiType": "anthropic",
  "baseUrl": "https://opencode.ai/zen/go/v1/messages",
  "models": [
    "minimax-m2.7", "minimax-m2.5"
  ]
}
```

- [ ] **Step 6: 用 python 脚本一次性执行所有 JSON 修改**

```python
import json

with open('router/config/recommended-providers.json') as f:
    data = json.load(f)

for g in data:
    # 硅基流动: 去掉 /v1
    if g['group'] == '硅基流动':
        for p in g['presets']:
            if p['baseUrl'] == 'https://api.siliconflow.cn/v1':
                p['baseUrl'] = 'https://api.siliconflow.cn'

    # 科大讯飞: 去掉 /v1
    if g['group'] == '科大讯飞':
        for p in g['presets']:
            if p['baseUrl'] == 'https://spark-api-open.xf-yun.com/v1':
                p['baseUrl'] = 'https://spark-api-open.xf-yun.com'

    # 阶跃星辰 API: 去掉 /v1
    if g['group'] == '阶跃星辰':
        for p in g['presets']:
            if p['apiType'] == 'openai' and p['baseUrl'] == 'https://api.stepfun.com/v1':
                p['baseUrl'] = 'https://api.stepfun.com'

    # 百度千帆: 添加 upstreamPath
    if g['group'] == '百度千帆':
        for p in g['presets']:
            p['upstreamPath'] = '/chat/completions'

    # OpenCode: 更新模型
    if g['group'] == 'OpenCode':
        for p in g['presets']:
            if p['presetName'] == 'opencode-go-openai':
                p['models'] = [
                    'glm-5.1', 'glm-5',
                    'kimi-k2.5', 'kimi-k2.6',
                    'deepseek-v4-pro', 'deepseek-v4-flash',
                    'mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2.5-pro', 'mimo-v2.5',
                    'qwen3.6-plus', 'qwen3.5-plus',
                ]
            elif p['presetName'] == 'opencode-go-anthropic':
                p['models'] = ['minimax-m2.7', 'minimax-m2.5']

with open('router/config/recommended-providers.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
```

- [ ] **Step 7: 验证 JSON 语法正确**

Run: `python3 -c "import json; json.load(open('router/config/recommended-providers.json'))"` 

---

### Task 8: 前端类型 — 添加 `upstream_path` 支持

**Files:**
- Modify: `frontend/src/types/mapping.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: `mapping.ts` — Provider interface 添加 `upstream_path`**

```typescript
export interface Provider {
  id: string
  name: string
  api_type: string
  base_url: string
  upstream_path: string | null  // ← 新增
  api_key: string
  // ... 其余不变
}
```

- [ ] **Step 2: `client.ts` — ProviderPreset 添加 `upstreamPath`**

```typescript
export interface ProviderPreset {
  plan: string;
  presetName: string;
  apiType: "openai" | "openai-responses" | "anthropic";
  baseUrl: string;
  upstreamPath?: string;  // ← 新增
  models: string[];
}
```

- [ ] **Step 3: `client.ts` — QuickSetupPayload.provider 添加 `upstream_path`**

在 `base_url: string` 之后添加:

```typescript
upstream_path?: string  // ← 新增
```

- [ ] **Step 4: `client.ts` — ProviderPayload 添加 `upstream_path`**

在 `base_url: string` 之后添加:

```typescript
upstream_path?: string  // ← 新增
```

---

### Task 9: 前端 Composable — `useQuickSetup.ts` 支持 upstreamPath

**Files:**
- Modify: `frontend/src/composables/useQuickSetup.ts`

- [ ] **Step 1: 添加 `upstreamPath` 状态**

在 `const customBaseUrl = ref('')` 之后添加:

```typescript
const customUpstreamPath = ref('')
```

- [ ] **Step 2: 添加 `upstreamPath` computed**

在 `const baseUrl = computed(...)` 之后添加:

```typescript
const upstreamPath = computed(() => {
  if (isCustomProvider.value) return customUpstreamPath.value
  const preset = currentPreset.value
  if (!preset) return ''
  // 默认路径由 apiType 决定，只有非默认值才需要返回
  const defaultPath = preset.apiType === 'anthropic' ? '/v1/messages'
    : preset.apiType === 'openai-responses' ? '/v1/responses'
    : '/v1/chat/completions'
  if (preset.upstreamPath && preset.upstreamPath !== defaultPath) return preset.upstreamPath
  return ''
})
```

- [ ] **Step 3: `submit()` 中 payload 添加 `upstream_path`**

在 `base_url: baseUrl.value,` 之后添加:

```typescript
upstream_path: upstreamPath.value || undefined,
```

- [ ] **Step 4: `onProviderChange` 中重置 `customUpstreamPath`**

在 `customBaseUrl.value = ''` 之后添加:

```typescript
customUpstreamPath.value = ''
```

- [ ] **Step 5: return 中导出 `upstreamPath` 和 `customUpstreamPath`**

在 return 对象中添加:

```typescript
upstreamPath, customUpstreamPath,
```

---

### Task 10: 前端 UI — QuickSetup 页面添加 Upstream Path 输入框

**Files:**
- Modify: `frontend/src/views/QuickSetup.vue`

- [ ] **Step 1: 在解构导入中添加 `upstreamPath, customUpstreamPath`**

找到:
```
baseUrl, availablePlans, isNonOpenaiEndpoint,
```
在其后添加:
```
upstreamPath, customUpstreamPath,
```

- [ ] **Step 2: 在 Preset 模式的 Base URL 之后添加 Upstream Path 输入框**

找到（约 line 97）:
```html
<Input :model-value="baseUrl" readonly class="font-mono md:text-xs h-7" />
```

在其 `</div>` 关闭标签之后（Base URL 的 `w-72` div 之后），添加:

```html
<!-- 非默认 upstream path（如百度千帆） -->
<div v-if="upstreamPath" class="w-48 space-y-1">
  <Label class="text-xs text-muted-foreground">Upstream Path</Label>
  <Input :model-value="upstreamPath" readonly class="font-mono md:text-xs h-7" />
</div>
```

- [ ] **Step 3: 在 Custom 模式的 Base URL 之后添加 Upstream Path 输入框**

找到 customBaseUrl 的 Input 行，在其后（同一个 template #else 分支内），添加:

```html
<div class="w-48 space-y-1">
  <Label class="text-xs text-muted-foreground">Upstream Path</Label>
  <Input v-model="customUpstreamPath" placeholder="/v1/chat/completions" class="font-mono md:text-xs h-7" />
</div>
```

---

### Task 11: 前端 UI — Providers 页面支持 `upstream_path`

**Files:**
- Modify: `frontend/src/views/Providers.vue`

- [ ] **Step 1: 表格列显示 `upstream_path`（可选，在 base_url 旁）**

找到 `{{ p.base_url }}` 的 TableCell，在其后添加:

```html
<TableCell class="text-muted-foreground text-xs">{{ p.upstream_path || (p.api_type === 'anthropic' ? '/v1/messages' : '/v1/chat/completions') }}</TableCell>
```

同时更新 TableHead 部分，在 Base URL 表头之后添加:
```html
<TableHead class="text-xs">Path</TableHead>
```

- [ ] **Step 2: 编辑表单添加 `upstream_path` 字段**

找到 `base_url` 的 Input 行（约 line 144），在其表单项之后添加:

```html
<div>
  <Label class="text-xs">Upstream Path</Label>
  <Input v-model="form.upstream_path" placeholder="默认: /v1/chat/completions 或 /v1/messages" class="mt-1 font-mono text-xs" />
  <p class="text-xs text-muted-foreground mt-0.5">留空使用 API 类型默认路径</p>
</div>
```

- [ ] **Step 3: `DEFAULT_FORM` 添加 `upstream_path`**

找到 `DEFAULT_FORM` 定义，在 `base_url: ''` 之后添加:

```typescript
upstream_path: '' as string,
```

- [ ] **Step 4: `openEdit` 函数中从 provider 填充 `upstream_path`**

找到 `form.value = { name: p.name,` 那个赋值块，在 `base_url: p.base_url,` 之后添加:

```typescript
upstream_path: p.upstream_path || '',
```

- [ ] **Step 5: `ProviderFormPayload` 类型和提交逻辑添加 `upstream_path`**

找到 `type ProviderFormPayload = Pick<...>` 那行，在 `'base_url'` 之后添加 `'upstream_path'`:

```typescript
type ProviderFormPayload = Pick<ProviderPayload, 'name' | 'api_type' | 'base_url' | 'upstream_path' | 'models' | 'is_active' | ...>
```

在提交时 `base_url: form.value.base_url,` 之后添加:

```typescript
upstream_path: form.value.upstream_path || null,
```

---

### Task 12: 更新 `doc_url.json` 同步 baseUrl 变更

**Files:**
- Modify: `docs/provider/doc_url.json`

- [ ] **Step 1: 用 python 脚本同步 baseUrl 到 doc_url.json**

```python
import json

with open('router/config/recommended-providers.json') as f:
    providers = json.load(f)

with open('docs/provider/doc_url.json') as f:
    docs = json.load(f)

# 同步 baseUrl 变更
baseUrl_map = {}
for g in providers:
    for p in g['presets']:
        if 'presetName' in p:
            baseUrl_map[p['presetName']] = p['baseUrl']

mapping = {
    'siliconflow': 'siliconflow',
    'iflytek-spark': 'iflytek-spark',
    'stepfun': 'stepfun',
    'qianfan': 'qianfan',
    'opencode-go-openai': 'opencode-go-openai',
    'opencode-go-anthropic': 'opencode-go-anthropic',
}

for doc_key, preset_name in mapping.items():
    if doc_key in docs and preset_name in baseUrl_map:
        docs[doc_key]['baseUrl'] = baseUrl_map[preset_name]
        print(f"Updated {doc_key}: {baseUrl_map[preset_name]}")

with open('docs/provider/doc_url.json', 'w') as f:
    json.dump(docs, f, indent=2, ensure_ascii=False)
    f.write('\n')
```

---

### Task 13: 验证 + 构建 + 提交

**Files:** 无新增

- [ ] **Step 1: 编译 core 包**

Run: `cd core && npm run build`

- [ ] **Step 2: 编译 router 后端**

Run: `cd router && npx tsc --noEmit`

- [ ] **Step 3: 编译前端**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | tail -20`

- [ ] **Step 4: 用 curl 验证百度千帆修复后的 URL 拼接**

```bash
# 模拟 buildUpstreamUrl("https://qianfan.baidubce.com/v2", "/chat/completions")
# = "https://qianfan.baidubce.com/v2/chat/completions"
curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"user","content":"hi"}]}' \
  "https://qianfan.baidubce.com/v2/chat/completions"
# Expected: 401
```

- [ ] **Step 5: 用 curl 验证其他修复的 baseUrl**

```bash
# 硅基流动: buildUpstreamUrl("https://api.siliconflow.cn", "/v1/chat/completions")
# = "https://api.siliconflow.cn/v1/chat/completions"
curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" \
  -d '{"model":"test"}' "https://api.siliconflow.cn/v1/chat/completions"
# Expected: 401

# 阶跃星辰: buildUpstreamUrl("https://api.stepfun.com", "/v1/chat/completions")
# = "https://api.stepfun.com/v1/chat/completions"
curl -s -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" \
  -d '{"model":"test"}' "https://api.stepfun.com/v1/chat/completions"
# Expected: 401
```

- [ ] **Step 6: 提交所有修改**

```bash
git add router/src/db/migrations/038_add_upstream_path.sql \
       router/src/db/providers.ts \
       router/src/admin/providers.ts \
       router/src/admin/quick-setup.ts \
       router/src/config/recommended.ts \
       router/src/proxy/handler/proxy-handler.ts \
       router/config/recommended-providers.json \
       frontend/src/types/mapping.ts \
       frontend/src/api/client.ts \
       frontend/src/composables/useQuickSetup.ts \
       frontend/src/views/QuickSetup.vue \
       frontend/src/views/Providers.vue \
       docs/provider/doc_url.json

# 使用 zcommit skill 提交
```

建议分为两个 commit:
1. `feat: 为 provider 添加 upstream_path 自定义上游路径配置` (Task 1-6, 8-11)
2. `fix: 修复推荐供应商 baseUrl 错误和模型缺失` (Task 7, 12)

---

## Self-Review Checklist

- [x] **Spec coverage:** 每个需求都有对应 Task
  - upstream_path 配置: Task 1-6, 8-11
  - baseUrl 修复 (硅基流动/科大讯飞/阶跃星辰): Task 7
  - 百度千帆特殊路径: Task 1-6 (upstream_path) + Task 7 (配置)
  - OpenCode Go 模型更新: Task 7
  - 前端 UI: Task 10-11
- [x] **Placeholder scan:** 所有步骤都有完整代码，无 TBD/TODO
- [x] **Type consistency:** `upstream_path` (snake_case, DB/API) / `upstreamPath` (camelCase, JSON/config/frontend) 命名一致
