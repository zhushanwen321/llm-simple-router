# 快速配置 + 模型维度补丁 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构前端菜单，新增快速配置页面（5步引导一键完成配置），将兼容性补丁从全局自动检测改为模型维度配置（存储在 providers.models JSON 中），供应商编辑改为卡片式模型编辑。

**Architecture:** providers.models JSON 扩展为 `{ name, context_window?, patches? }[]`，后端 patch 逻辑从 DB 读取补丁配置（无配置则 fallback 自动检测）。前端快速配置页和供应商编辑页共用模型卡片组件。

**Tech Stack:** Vue 3 + TypeScript + shadcn-vue + Tailwind CSS (前端), Fastify + better-sqlite3 (后端)

---

## File Structure

### 后端新增
- `src/admin/quick-setup.ts` — 快速配置聚合 API

### 后端修改
- `src/proxy/patch/index.ts` — patch 逻辑从 DB models JSON 读取
- `src/config/model-context.ts` — parseModels/buildModelInfoList 兼容新格式
- `src/db/providers.ts` — 无结构变更（models 字段仍是 TEXT JSON）
- `src/db/model-info.ts` — 无变更（context_window 仍独立存储）
- `src/admin/providers.ts` — Create/Update schema 支持新格式
- `src/admin/routes.ts` — 注册 quick-setup 路由

### 前端新增
- `frontend/src/views/QuickSetup.vue` — 快速配置页面
- `frontend/src/components/quick-setup/ClientSelector.vue` — 客户端选择器
- `frontend/src/components/quick-setup/ModelCard.vue` — 模型卡片（名称+上下文+补丁）
- `frontend/src/components/quick-setup/PatchChips.vue` — 补丁多选芯片
- `frontend/src/components/quick-setup/MappingPreview.vue` — 映射预览
- `frontend/src/components/quick-setup/types.ts` — 类型定义
- `frontend/src/composables/useQuickSetup.ts` — 快速配置逻辑

### 前端修改
- `frontend/src/components/layout/Sidebar.vue` — 二级菜单
- `frontend/src/router/index.ts` — 新增路由
- `frontend/src/api/client.ts` — 新增 API 函数 + 类型
- `frontend/src/views/Providers.vue` — 供应商编辑改为卡片式模型编辑
- `frontend/src/types/mapping.ts` — ModelInfo 增加 patches 字段

---

## Task 1: 扩展 models JSON 格式（后端）

**Files:**
- Modify: `src/config/model-context.ts`

**Purpose:** 让 `parseModels` 和 `buildModelInfoList` 兼容新格式 `{ name, context_window?, patches? }`。旧格式（纯字符串数组）继续支持。

- [ ] **Step 1: 扩展 ModelInfo 接口**

在 `src/config/model-context.ts` 中：

```typescript
export interface ModelInfo {
  name: string
  context_window: number | null
  patches: string[]  // 新增
}
```

- [ ] **Step 2: 修改 parseModels 支持新格式**

```typescript
export interface ModelEntry {
  name: string
  context_window?: number
  patches?: string[]
}

export function parseModels(raw: string): ModelEntry[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item: unknown) => {
      if (typeof item === 'string') return { name: item, patches: [] }
      const obj = item as Record<string, unknown>
      return {
        name: (obj.name as string) ?? '',
        context_window: obj.context_window as number | undefined,
        patches: (obj.patches as string[]) ?? [],
      }
    }).filter(e => e.name)
  } catch {
    return []
  }
}
```

注意：旧调用方使用 `parseModels` 获取模型名列表的地方，需改为 `parseModels(raw).map(e => e.name)`。

- [ ] **Step 3: 修改 buildModelInfoList**

```typescript
export function buildModelInfoList(
  modelEntries: ModelEntry[],
  overrides: Map<string, number>,
): ModelInfo[] {
  return modelEntries.map(entry => ({
    name: entry.name,
    context_window: entry.context_window ?? overrides.get(entry.name) ?? lookupContextWindow(entry.name),
    patches: entry.patches ?? [],
  }))
}
```

- [ ] **Step 4: 搜索所有 parseModels 调用点，适配新返回类型**

```bash
grep -rn "parseModels" src/
```

每个调用点从 `parseModels(raw): string[]` 改为 `parseModels(raw).map(e => e.name): string[]`。涉及文件：
- `src/admin/providers.ts` — `extractModelOverrides` 内部逻辑，Create/Update handler
- `src/config/model-context.ts` — 自身
- 其他引用处

- [ ] **Step 5: 运行后端测试确认无回归**

```bash
npx vitest run tests/ --reporter=verbose 2>&1 | tail -30
```

- [ ] **Step 6: Commit**

```bash
git add src/config/model-context.ts src/admin/providers.ts
git commit -m "refactor(model-context): extend models JSON format with patches field, backward compatible"
```

---

## Task 2: 迁移 patch 逻辑到 DB 驱动

**Files:**
- Modify: `src/proxy/patch/index.ts`
- Modify: `src/proxy/handler/proxy-handler.ts`

**Purpose:** `applyProviderPatches` 从仅靠自动检测改为：先从 provider.models JSON 读取每个模型的 patches 配置，无 patches 配置时 fallback 到现有自动检测逻辑。

- [ ] **Step 1: 修改 ProviderInfo 接口**

```typescript
export interface ProviderInfo {
  base_url: string;
  api_type: string;
  models?: Array<{ name: string; patches?: string[] }>;  // 新增
}
```

- [ ] **Step 2: 重写 applyProviderPatches**

```typescript
export function applyProviderPatches(
  body: Record<string, unknown>,
  provider: ProviderInfo,
): { body: Record<string, unknown>; meta: ProviderPatchMeta } {
  const patches: string[] = [];
  let cloned = false;
  let patched: Record<string, unknown> | undefined;

  const ensureCloned = (): Record<string, unknown> => {
    if (!cloned) {
      patched = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
      cloned = true;
    }
    return patched!;
  };

  const model = (body.model as string) ?? "";

  // 优先从 DB models JSON 读取
  const modelEntry = provider.models?.find(m => m.name === model);
  const configuredPatches = modelEntry?.patches;

  if (configuredPatches && configuredPatches.length > 0) {
    // DB 有配置 → 按配置执行
    if (configuredPatches.includes("developer_role") && hasDeveloperRole(body)) {
      patchDeveloperRole(ensureCloned());
      patches.push("developer_role");
    }

    const dsAnthropicPatches = ["thinking-param", "cache-control", "thinking-blocks", "orphan-tool-results"];
    const dsOpenaiPatches = ["non-ds-tools", "orphan-tool-results-oa"];

    const needsDsAnthropic = configuredPatches.some(p => dsAnthropicPatches.includes(p));
    const needsDsOpenai = configuredPatches.some(p => dsOpenaiPatches.includes(p));

    if (needsDsAnthropic && provider.api_type === "anthropic") {
      applyDeepSeekPatches(ensureCloned(), "anthropic");
      patches.push("deepseek");
    }
    if (needsDsOpenai && provider.api_type === "openai") {
      applyDeepSeekPatches(ensureCloned(), "openai");
      patches.push("deepseek");
    }
  } else {
    // 无配置 → fallback 到自动检测（向后兼容）
    if (provider.api_type === "openai" && !isOpenAIOrigin(provider.base_url)) {
      if (hasDeveloperRole(body)) {
        patchDeveloperRole(ensureCloned());
        patches.push("developer_role");
      }
    }
    if (needsDeepSeekPatch(body, provider)) {
      applyDeepSeekPatches(ensureCloned(), provider.api_type as "openai" | "anthropic");
      patches.push("deepseek");
    }
  }

  return { body: patched ?? body, meta: { types: patches } };
}
```

- [ ] **Step 3: 在 proxy-handler.ts 调用处传入 models**

找到 `applyProviderPatches(currentBody, provider)` 调用点，确认 `provider` 对象包含 models 信息。当前 proxy-handler 中的 `provider` 来自 `getProviderById`，其 `models` 字段已是 JSON 字符串，需在调用前解析：

```typescript
// 在 applyProviderPatches 调用前
const providerModels = parseModels(provider.models);
const { body: patchedBody, meta: patchMeta } = applyProviderPatches(currentBody, {
  base_url: provider.base_url,
  api_type: provider.api_type,
  models: providerModels,
});
```

- [ ] **Step 4: 运行后端测试**

```bash
npx vitest run tests/patch.test.ts tests/proxy-handler.test.ts tests/integration.test.ts --reporter=verbose
```

- [ ] **Step 5: Commit**

```bash
git add src/proxy/patch/index.ts src/proxy/handler/proxy-handler.ts
git commit -m "feat(patch): read patch config from DB models JSON, fallback to auto-detection"
```

---

## Task 3: 后端快速配置聚合 API

**Files:**
- Create: `src/admin/quick-setup.ts`
- Modify: `src/admin/routes.ts`

- [ ] **Step 1: 创建 `src/admin/quick-setup.ts`**

POST `/admin/api/quick-setup`，在一个 SQLite 事务中：
1. 创建 provider（models JSON 含 patches）
2. 批量创建 mapping groups
3. 批量创建 retry rules
4. 返回 `{ success: true, provider_id, mapping_ids, retry_rule_ids }`

Schema：
```typescript
const QuickSetupSchema = Type.Object({
  provider: Type.Object({
    name: Type.String(),
    api_type: Type.Union([Type.Literal("openai"), Type.Literal("anthropic")]),
    base_url: Type.String(),
    api_key: Type.String(),
    models: Type.Array(Type.Object({
      name: Type.String(),
      context_window: Type.Optional(Type.Number()),
      patches: Type.Optional(Type.Array(Type.String())),
    })),
  }),
  mappings: Type.Array(Type.Object({
    client_model: Type.String(),
    backend_model: Type.String(),
  })),
  retry_rules: Type.Array(Type.Object({
    name: Type.String(),
    status_code: Type.Number(),
    body_pattern: Type.String(),
    retry_strategy: Type.Union([Type.Literal("fixed"), Type.Literal("exponential")]),
    retry_delay_ms: Type.Number(),
    max_retries: Type.Number(),
    max_delay_ms: Type.Number(),
  })),
});
```

- [ ] **Step 2: 在 routes.ts 注册**

```typescript
import { adminQuickSetupRoutes } from "./quick-setup.js";
// 在注册函数中：
app.register(adminQuickSetupRoutes, { db, stateRegistry, tracker, adaptiveController });
```

- [ ] **Step 3: 运行后端测试确认**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

- [ ] **Step 4: Commit**

```bash
git add src/admin/quick-setup.ts src/admin/routes.ts
git commit -m "feat(api): quick-setup aggregated endpoint with transactional create"
```

---

## Task 4: 前端类型和 API 函数

**Files:**
- Modify: `frontend/src/types/mapping.ts` — ModelInfo 增加 patches
- Modify: `frontend/src/api/client.ts` — 新增 API + 类型

- [ ] **Step 1: 修改 `frontend/src/types/mapping.ts`**

```typescript
export interface ModelInfo {
  name: string
  context_window: number | null
  patches: string[]  // 新增
}
```

- [ ] **Step 2: 在 `frontend/src/api/client.ts` 新增类型和 API**

```typescript
// 新增类型
export interface QuickSetupPayload {
  provider: {
    name: string
    api_type: string
    base_url: string
    api_key: string
    models: Array<{ name: string; context_window?: number; patches?: string[] }>
  }
  mappings: Array<{ client_model: string; backend_model: string }>
  retry_rules: Array<{
    name: string
    status_code: number
    body_pattern: string
    retry_strategy: string
    retry_delay_ms: number
    max_retries: number
    max_delay_ms: number
  }>
}

// API 常量新增
QUICK_SETUP: "/quick-setup",

// api 对象新增
quickSetup: (data: QuickSetupPayload) =>
  request<{ success: boolean; provider_id: string }>("post", API.QUICK_SETUP, data),
```

- [ ] **Step 3: 搜索前端所有使用 ModelInfo 的地方，适配 patches 字段**

```bash
grep -rn "ModelInfo" frontend/src/ --include="*.ts" --include="*.vue"
```

涉及：Providers.vue、ModelMappings.vue、cascading-types.ts 等。这些文件中 `models.map(m => ({ name: m.name, context_window: ... }))` 需加上 `patches: m.patches ?? []`。

- [ ] **Step 4: 前端类型检查**

```bash
cd frontend && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/mapping.ts frontend/src/api/client.ts
git commit -m "feat(frontend): add patches to ModelInfo, quick-setup API types"
```

---

## Task 5: 前端快速配置子组件

**Files:**
- Create: `frontend/src/components/quick-setup/types.ts`
- Create: `frontend/src/components/quick-setup/ClientSelector.vue`
- Create: `frontend/src/components/quick-setup/PatchChips.vue`
- Create: `frontend/src/components/quick-setup/ModelCard.vue`
- Create: `frontend/src/components/quick-setup/MappingPreview.vue`

**Purpose:** 快速配置和供应商编辑共用的子组件。

### types.ts

```typescript
export type ClientType = 'claude-code' | 'pi' | 'codex' | 'openai-sdk' | 'anthropic-sdk'

export interface ClientMeta {
  id: ClientType
  name: string
  icon: string
  iconClass: string
  format: 'anthropic' | 'openai'
  defaultProvider: string
  defaultPlan: string
}

export interface PatchOption {
  id: string
  name: string
  desc: string
}

export interface PatchGroup {
  key: string
  label: string
  items: PatchOption[]
}

export interface ModelConfig {
  name: string
  contextWindow: number
  enabled: boolean
  patches: string[]
}

export interface MappingPreviewItem {
  from: string
  to: string
  tag: 'def' | 'auto' | 'cust'
}
```

### PatchChips.vue

Props: `apiType, isDeepSeek, isNonOpenaiEndpoint, modelValue: string[]`
Emits: `update:modelValue`

按 patch 分组渲染可点击芯片。补丁定义：

```typescript
const PATCH_GROUPS: PatchGroup[] = [
  {
    key: 'deepseek_anthropic',
    label: 'DeepSeek 兼容 (Anthropic)',
    items: [
      { id: 'thinking-param', name: 'Thinking 参数', desc: '自动补 thinking 参数' },
      { id: 'cache-control', name: 'Cache Control', desc: '剥离 cache_control' },
      { id: 'thinking-blocks', name: 'Thinking Blocks', desc: '补缺失的 thinking block' },
      { id: 'orphan-tool-results', name: '孤儿 Tool Result', desc: '清理孤儿 tool_result' },
    ],
  },
  {
    key: 'deepseek_openai',
    label: 'DeepSeek 兼容 (OpenAI)',
    items: [
      { id: 'non-ds-tools', name: '非DS Tool 降级', desc: '将非DS生成的 tool_calls 降级为 text' },
      { id: 'orphan-tool-results-oa', name: '孤儿 Tool Result', desc: 'OpenAI 格式孤儿处理' },
    ],
  },
  {
    key: 'general',
    label: '通用兼容',
    items: [
      { id: 'developer-role', name: 'Developer Role', desc: 'developer role 转 system' },
    ],
  },
]
```

显示逻辑：DeepSeek 模型显示对应格式的 DeepSeek 补丁组，非 OpenAI 官方端点显示通用补丁组。

### ModelCard.vue

Props: `model: ModelConfig, apiType: string, isDeepSeek: boolean, isNonOpenaiEndpoint: boolean`
Emits: `update:model, remove`

布局：
- 左侧 checkbox（启用/禁用）
- 中间主区域：
  - 第一行：模型名称 + DeepSeek 标签(如有) + 最大上下文输入框（右对齐）
  - 可展开区：PatchChips 组件

### ClientSelector.vue

Props: `modelValue: ClientType`
Emits: `update:modelValue`

5 个 chip，渲染 CLIENTS 数组。

### MappingPreview.vue

Props: `mappings: MappingPreviewItem[], availableModels: string[]`
Emits: `remove(from), add(from, to)`

- [ ] **Step 6: Commit 所有子组件**

```bash
git add frontend/src/components/quick-setup/
git commit -m "feat(quick-setup): shared sub-components - ClientSelector, ModelCard, PatchChips, MappingPreview"
```

---

## Task 6: 快速配置 Composable

**Files:**
- Create: `frontend/src/composables/useQuickSetup.ts`

**Purpose:** 封装快速配置页全部状态和联动逻辑。

核心逻辑：
1. `onMounted` 加载 recommended providers
2. `selectClient(type)` → 联动设置默认 provider/plan
3. `onProviderChange()` → 更新 plan 选项、模型列表、补丁默认值
4. `onPlanChange()` → 更新 apiType、baseURL、模型补丁
5. 模型补丁默认规则：模型名含 `deepseek` → 自动选中对应格式补丁
6. 映射默认规则：claude-code/pi → sonnet/opus/haiku/thinking，codex → gpt 系列，其他一一映射
7. `submit()` → 组装 payload 调用 api.quickSetup()

- [ ] **Step 1: 实现 composable**（参照 v4 mockup 的 JS 逻辑）

- [ ] **Step 2: Commit**

```bash
git add frontend/src/composables/useQuickSetup.ts
git commit -m "feat(quick-setup): core composable with client-provider-plan linkage"
```

---

## Task 7: 快速配置页面 + 路由

**Files:**
- Create: `frontend/src/views/QuickSetup.vue`
- Modify: `frontend/src/router/index.ts` — 添加 quick-setup 路由
- Modify: `frontend/src/components/layout/Sidebar.vue` — 二级菜单

### Sidebar 二级菜单

navItems 替换为分组结构：
```
仪表盘
代理配置（可展开）
  快速配置
  供应商
  模型映射
  API 密钥
  重试规则
监控
  实时监控
  请求日志
系统设置
```

代理增强（实验性）从菜单移除（路由保留，URL 可直接访问）。

### QuickSetup.vue

5 个 cfg card 区域 + 底部提交栏。使用 `useQuickSetup()` composable。

### 路由

添加 `{ path: '/quick-setup', name: 'quick-setup', component: QuickSetupVue, meta: { requiresAuth: true } }`

- [ ] **Step 1: 实现三个文件**

- [ ] **Step 2: 浏览器验证联动交互**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/QuickSetup.vue frontend/src/router/index.ts frontend/src/components/layout/Sidebar.vue
git commit -m "feat(quick-setup): page, route, and sidebar 2-level menu"
```

---

## Task 8: 供应商编辑改为卡片式模型编辑

**Files:**
- Modify: `frontend/src/views/Providers.vue`

**Purpose:** 供应商编辑弹窗中的"可用模型"区域，从"逗号分隔输入+Badge列表"改为 ModelCard 卡片列表，每个模型一行（名称+最大上下文+补丁多选）。

- [ ] **Step 1: 在 Providers.vue 中引入 ModelCard 和 PatchChips**

复用 Task 5 中创建的 `ModelCard.vue` 和 `PatchChips.vue`。

- [ ] **Step 2: 修改编辑弹窗的模型区域**

将现有的：
```
[输入模型名称] [上下文选择] [添加] → Badge 列表
```

替换为：
```
ModelCard 列表（每个模型含 checkbox/名称/最大上下文/补丁折叠区）
[输入模型名称] [添加]
```

- [ ] **Step 3: 修改 buildPayload 中的 models 格式**

```typescript
models: form.models.map(m => ({
  name: m.name,
  context_window: m.context_window ?? undefined,
  patches: m.patches ?? [],
}))
```

- [ ] **Step 4: 修改 openCreate/openEdit 初始化逻辑**

快速配置（preset 选择）时，根据 preset.models 创建 ModelConfig 数组，自动设置补丁默认值。

编辑已有供应商时，从 `provider.models` 读取（已含 patches 字段）。

- [ ] **Step 5: 浏览器验证**

创建/编辑供应商，确认模型卡片正确显示、补丁可切换、保存后 patches 持久化。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/Providers.vue
git commit -m "refactor(providers): card-based model editing with per-model patch config"
```

---

## Task 9: 端到端验证 + 清理

**Files:**
- Delete: `frontend/quick-setup-*.html`

- [ ] **Step 1: 删除 mockup 文件**

```bash
rm -f frontend/quick-setup-mockup.html frontend/quick-setup-v2.html frontend/quick-setup-v3.html frontend/quick-setup-v4.html
```

- [ ] **Step 2: 前端类型检查**

```bash
cd frontend && npm run typecheck
```

- [ ] **Step 3: 后端全量测试**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

- [ ] **Step 4: 浏览器完整流程验证**

1. 登录 → 仪表盘
2. 代理配置 → 快速配置
3. Claude Code + DeepSeek (Anthropic) → 填 Key → 测试连接
4. 模型卡片：确认 DeepSeek 补丁已默认选中
5. 映射预览正确
6. 重试规则推荐选中
7. 保存 → 验证供应商/映射/重试规则已创建
8. 进入供应商编辑 → 确认模型卡片含补丁配置
9. 编辑补丁 → 保存 → 发送请求 → 验证补丁生效/不生效

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: cleanup mockups, e2e verification complete"
```
