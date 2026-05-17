# Backend Plan: 图片检测自动切换多模态模型

## 概述

在 failover 循环外新增 IR（Image Redirect）和重构 OF（Overflow）两个预计算层，循环简化为纯执行 + exclude。核心思想：**所有路由决策在 while(true) 之前完成，循环内零路由逻辑**。

## ADR

### ADR-1: 分层预计算 vs 循环内逐次决策

**背景**：当前 failover-loop.ts 的 while(true) 循环内包含 resolveMapping、overflow 检测、provider 查找等路由决策。新增 IR 层时如果继续在循环内做决策，会导致循环体膨胀、逻辑纠缠。

**决策**：采用分层预计算模型。resolveMapping → IR → OF 三层在循环外依次执行，产出完整的 target 列表。while(true) 简化为 filterExcluded → provider 查找 → transport 构建 → orchestrator.handle。

**备选方案**：在循环内逐次做 IR/OF 决策（首次迭代做 IR，每次迭代做 OF）。

**取舍理由**：预计算模型有四个优势——(1) 消除死循环风险（target 列表有限且固定），(2) 每层职责单一可独立测试，(3) 循环体极度简化（降低 bug 概率），(4) IR/OF 异常降级只需返回原列表。代价是 OF 层对每个 target 都要预计算 overflow（即使可能用不到），但 targets 数量通常 ≤ 4，性能开销可忽略。

### ADR-2: IR 层用纯函数而非 Pipeline Hook

**背景**：现有 overflow 等机制部分通过 Hook 实现。IR 层可以作为 Hook 也可以作为普通函数。

**决策**：IR 层实现为 `computeImageRedirectTargets()` 纯函数，在 failover-loop.ts 循环前直接调用。不注册为 Pipeline Hook，不新增 emit 调用点。

**备选方案**：注册 `post_route` Hook，在 pipeline emit 时执行。

**取舍理由**：IR 层只操作 target 列表（prepend），不涉及请求体变换或异步副作用。纯函数的接口更清晰（输入 targets + body，输出 targets），不需要 ctx/snapshot 的 emit 往返开销。Hook 适合需要跨多个调用点的横切关注点，IR 是单点调用，函数更直接。

### ADR-3: capabilities 运行时补充，不修改 DB 原始 JSON

**背景**：ModelEntry 新增 capabilities 字段，但已有 DB 中的 models JSON 不含此字段。

**决策**：parseModels() 解析时，对缺失 capabilities 的 ModelEntry 从 MODEL_CAPABILITIES 白名单查表补充。DB 中的原始 JSON 不做迁移。

**取舍理由**：零停机部署，无需 migration 脚本。用户通过 UI 编辑 capabilities 后才会写入 DB。白名单模式比黑名单更安全（未知模型默认不支持图片，不会误转发）。

---

## T1: Model capabilities 基础设施

**目标**：让系统能判断一个模型是否支持图片输入。

### 文件变更

| 文件 | 操作 | 预估行数 | 说明 |
|------|------|----------|------|
| `router/src/config/model-context.ts` | 修改 | +80 | ModelEntry/ModelInfo 加 capabilities 字段；新增 MODEL_CAPABILITIES 常量；parseModels() 查表补充；buildModelInfoList() 传递 capabilities |

### 详细设计

**1. ModelEntry 扩展**

```typescript
export interface ModelEntry {
  name: string
  context_window?: number
  patches?: string[]
  stream_timeout_ms?: number
  capabilities?: string[]  // 新增
}
```

**2. ModelInfo 扩展**

```typescript
export interface ModelInfo {
  name: string
  context_window: number | null
  patches: string[]
  stream_timeout_ms?: number
  capabilities?: string[]  // 新增
}
```

**3. MODEL_CAPABILITIES 白名单**

与 MODEL_CONTEXT_WINDOWS 同文件、同模式。硬编码已知支持图片的模型名。不在表中的模型默认 `["text"]`。

**4. parseModels() 改动**

在 `.map()` 回调中，解析出 ModelEntry 后，检查 `capabilities` 字段：
- 有值 → 直接使用
- 无值 → 从 `MODEL_CAPABILITIES[entry.name]` 查表
- 查不到 → 默认 `["text"]`

改动位于现有 `parseModels()` 的 result 构建处，在 `if (obj.stream_timeout_ms ...)` 之后追加：

```typescript
entry.capabilities = obj.capabilities ?? MODEL_CAPABILITIES[modelName] ?? ["text"]
```

**5. buildModelInfoList() 改动**

在 info 构建处传递 capabilities：

```typescript
info.capabilities = entry.capabilities
```

### 数据消费者检查

新增 `capabilities` 字段的完整消费点：

| 消费者 | 文件 | 用途 |
|--------|------|------|
| `parseModels()` | model-context.ts | 解析 + 运行时补充 |
| `buildModelInfoList()` | model-context.ts | 构建含 capabilities 的 ModelInfo |
| Provider GET API | admin/providers.ts | 返回含 capabilities 的模型列表给前端 |
| Provider PUT API | admin/providers.ts | 保存用户编辑的 capabilities |
| `computeImageRedirectTargets()` | routing/image-redirect.ts（T2 新建） | 判断 targets[0] 是否支持图片 |
| Provider 管理前端 | Providers.vue | 展示 + 编辑 capabilities |

### 验收标准

| AC# | 条件 | 验证方式 |
|-----|------|----------|
| AC5 | ModelEntry 含 capabilities 时，parseModels() 正确解析 | 单元测试 |
| AC6 | ModelEntry 无 capabilities 时，parseModels() 从 MODEL_CAPABILITIES 补充 | 单元测试 |

### 风险点

- `parseModels()` 有缓存（`modelsCache`），缓存 key 是 raw 字符串引用。capabilities 补充在缓存之前完成，不会出现缓存不一致。
- capabilities 字段可选，不破坏任何现有 API 消费者（缺失时 undefined，但 IR 层查 capabilities 时用 `?? ["text"]` 兜底）。

### 依赖

无外部依赖，是其他所有 task 的前置。

---

## T2: computeImageRedirectTargets() 工具函数

**目标**：实现 IR 层的核心逻辑——检测请求中的图片，判断首 target 的能力，必要时 prepend fallback target。

### 文件变更

| 文件 | 操作 | 预估行数 | 说明 |
|------|------|----------|------|
| `router/src/proxy/routing/image-redirect.ts` | 新建 | ~120 | IR 层纯函数 + 图片检测辅助函数 |

### 详细设计

**函数签名**

```typescript
export function computeImageRedirectTargets(
  db: Database.Database,
  targets: Target[],
  clientModel: string,
  body: Record<string, unknown>,
  snapshot: PipelineSnapshot,
): Target[]
```

**处理流程**

```
1. hasImage(body) → false → return targets（no-op）
2. targets 为空 → return targets
3. 首个 target 的 capabilities 查询（从 DB 查 provider → parseModels → 找到对应 ModelEntry → 读 capabilities）
4. capabilities 含 "image" → return targets（已支持）
5. 从 mapping group rule 中提取 image_fallback（需要传 clientModel 查 group → parse rule JSON）
6. 无 image_fallback → return targets
7. fallback provider 查 DB → 不存在或非 active → return targets
8. prepend fallback target → snapshot.add() → return [fallback, ...targets]
```

**为什么需要查 mapping group rule 而不是直接传入 image_fallback**：调用方 failover-loop.ts 已经通过 resolveMapping() 查过 DB 拿到了 targets，但 resolveMapping 只返回 Target[] 不返回 rule 原始 JSON。有两种方案：(a) 在 failover-loop 中额外查一次 group 获取 image_fallback，传给 IR 函数；(b) IR 函数内部自己查。选择 (b)——让 IR 函数自包含，调用方不需要理解 image_fallback 的数据来源。额外 DB 查询一次 mapping group（by clientModel）性能开销可忽略。

**图片检测函数**

```typescript
function hasImage(body: Record<string, unknown>): boolean
```

检测三种 API 格式：

| API 格式 | 检测路径 |
|----------|----------|
| OpenAI | `messages[].content` 为数组 → 检查 `type === "image_url"` |
| Anthropic | `content[].type === "image"`（注意 Anthropic 的 messages 结构：`body.messages` 中每条 message 的 `content` 是数组） |
| Responses API | `input[]` 中 `type === "message"` 的项的 `content[]` 中 `type === "input_image"`；以及 `input[]` 中顶层 `type === "input_image"` |

短路优化：检测到第一个图片块即返回 true。

**capabilities 查询策略**

给定 target（provider_id + backend_model），获取 capabilities：
1. `getProviderById(db, target.provider_id)` → provider
2. `parseModels(provider.models)` → ModelEntry[]
3. 找到 `entry.name === target.backend_model` → `entry.capabilities ?? ["text"]`

**image_fallback 解析**

```typescript
function getImageFallback(db: Database.Database, clientModel: string): Target | null
```

1. `getMappingGroup(db, clientModel)` → group
2. `JSON.parse(group.rule)` → rule
3. `rule.image_fallback` → 检查 `backend_model` 和 `provider_id`
4. 返回 `{ backend_model, provider_id }` 或 null

### 验收标准

| AC# | 条件 | 验证方式 |
|-----|------|----------|
| AC1 | 含图片 + 首target不支持 + 有 fallback → prepend | 单元测试 |
| AC2 | 含图片 + 首target已支持 → 不扩展 | 单元测试 |
| AC3 | 含图片 + 首target不支持 + 无 fallback → 不扩展 | 单元测试 |
| AC4 | 不含图片 → 不扩展 | 单元测试 |
| AC7 | fallback provider 非 active → 不扩展 | 单元测试 |
| AC8 | fallback provider_id 不存在 → 不扩展 | 单元测试 |
| AC9 | 触发时记录 StageRecord | 单元测试 |
| AC10 | IR 层异常降级返回原列表 | 单元测试 |
| AC13 | OpenAI 格式检测 | 单元测试 |
| AC14 | Anthropic 格式检测 | 单元测试 |
| AC15 | OpenAI content 为 string 时不触发 | 单元测试 |
| AC16 | Responses API 格式检测 | 单元测试 |

### 风险点

- **Anthropic 格式区分**：Anthropic 的 messages 在 body.messages 还是 body.content？实际看 Anthropic API：请求体顶层有 `messages` 数组，每个 message 的 `content` 是 content_block 数组。图片在 `content[].type === "image"`。需确认 body 结构。
- **Responses API 嵌套**：`input[]` 可能是 `type: "message"` 嵌套 `content[]` 中含 `input_image`，也可能是顶层直接 `type: "input_image"`。两种都要检测。
- **异常安全**：整个函数用 try-catch 包裹，异常时返回原 targets。图片检测子函数内部也做防御性编程（类型检查后才访问字段）。

### 依赖

- T1（MODEL_CAPABILITIES + parseModels 的 capabilities 补充）
- 现有 `getProviderById`、`getMappingGroup`、`parseModels`、`PipelineSnapshot`

---

## T3: failover-loop.ts 重构

**目标**：将 while(true) 循环内的路由决策代码移到循环外，循环简化为纯执行 + exclude。

### 文件变更

| 文件 | 操作 | 预估行数 | 说明 |
|------|------|----------|------|
| `router/src/proxy/handler/failover-loop.ts` | 重构 | -40/+30 | 移除循环内 resolveMapping/overflow；循环前新增 IR/OF 预计算；循环体简化 |

### 详细设计

**当前循环内的路由决策代码**（需移除）：

1. **resolveMapping 调用**（~30行）：含 BP-H2 缓存逻辑。整个 if/else 分支移到循环前。
2. **overflow 内联代码**（~8行）：`applyOverflowRedirect()` 调用 + provider 替换逻辑。移到循环前。
3. **allowed_models 检查**（~6行）：移到循环前，只检查一次。

**重构后的代码结构**：

```typescript
// === 循环前：路由决策 ===

// 1. resolveMapping（只调一次）
let resolveResult = resolveMapping(db, clientModel, { now: new Date(), excludeTargets: [] });
if (!resolveResult) {
  // ...返回 model not found 错误
}
let allTargets = resolveResult.allTargets ?? [resolveResult.target];
const concurrencyOverride = resolveResult.concurrency_override;

// allowed_models 检查（只检查首个 target 即可，因为所有 target 属于同一映射）
const allowedModels = request.routerKey?.allowed_models;
if (allowedModels && allowedModels.length > 0 && !allowedModels.includes(allTargets[0].backend_model)) {
  // ...返回 model not allowed 错误
}

// 2. IR 层
allTargets = computeImageRedirectTargets(db, allTargets, clientModel, ctx.body, iterationSnapshot);

// 3. OF 层：为每个 target 计算 overflow，prepend
allTargets = expandOverflowTargets(allTargets, db, ctx.body);

// 预计算完成，缓存
cachedTargets = allTargets;
cachedConcurrencyOverride = concurrencyOverride;

// === while(true)：纯执行循环 ===
while (true) {
  // 选第一个非 excluded target
  const filtered = filterExcluded(cachedTargets, excludeTargets);
  if (filtered.length === 0) {
  return rejectAndReply(..., "All targets exhausted");
  }
  const resolved = filtered[0];
  const isFailover = cachedTargets.length > 1;

  // provider 查找 + active 检查
  const provider = getProviderById(db, resolved.provider_id);
  if (!provider || !provider.is_active) {
  return rejectAndReply(..., "Provider unavailable");  // 保持原有行为：直接返回错误
  }

  // ... 后续代码不变：format transform、plugin adjustments、provider patches、
  //     API key decrypt、transport build、orchestrator.handle
  // ... 失败时 excludeTargets.push(resolved); continue
}
```

**关键改动点**：

1. **resolveMapping 调用点**：从循环内第一个 if/else 移到循环前。去掉 `excludeTargets` 参数传入（预计算不考虑 exclude，exclude 在循环内处理）。
2. **overflow 代码**：从循环内 `applyOverflowRedirect(resolved, db, currentBody)` 移到循环前 `expandOverflowTargets(allTargets, db, ctx.body)`。
3. **allowed_models 检查**：从循环内（仅首次迭代）移到循环前。只检查 allTargets[0]，因为 IR fallback target 是 admin 在 mapping group 中显式配置的，视为已授权，不额外受 allowed_models 限制（spec D4 已决策）。
4. **provider inactive 处理**：保持原有行为——provider 不存在或 inactive 时直接返回错误（`rejectAndReply`），不使用 exclude+continue。这是 spec 的显式约束，避免语义变化。

**注意：resolveMapping 的 excludeTargets 语义变化**

当前 resolveMapping 接收 excludeTargets 用于在 DB 查询时过滤。重构后，resolveMapping 在循环外只调一次，不传 excludeTargets。exclude 逻辑在循环内通过 filterExcluded 处理。这和当前后续迭代的 BP-H2 缓存路径行为一致（缓存 targets 后，后续迭代也是 filterExcluded 而非重新查 DB）。

### 验收标准

| AC# | 条件 | 验证方式 |
|-----|------|----------|
| AC18 | 分层路由：IR 层 + OF 层正确扩展 target 列表 | 单元测试 |
| AC19 | IR_F 失败后 exclude，不重复选择，无死循环 | 集成测试 |
| AC20 | while 循环内无 resolveMapping/overflow 调用 | 代码审查 |

### 风险点

- **最大风险**：这是改动面最大的 task。循环逻辑变更可能引入回归。缓解措施：现有集成测试（integration.test.ts、proxy-semaphore.test.ts、retry-integration.test.ts 等）覆盖了完整的 failover 路径，重构后必须全部通过。
- **resolveMapping 签名不变**：resolveMapping 函数本身不修改，只是调用时机从循环内移到循环外。
- **BP-H2 缓存简化**：重构后不再需要请求级缓存逻辑（cachedTargets/cachedConcurrencyOverride 的 if/else 分支），因为 resolveMapping 只调一次。

### 依赖

- T2（computeImageRedirectTargets）
- T4（expandOverflowTargets）

---

## T4: overflow.ts 扩展

**目标**：新增 `expandOverflowTargets()` 包装函数，将单个 target 的 overflow 预计算应用到整个 target 列表。

### 文件变更

| 文件 | 操作 | 预估行数 | 说明 |
|------|------|----------|------|
| `router/src/proxy/routing/overflow.ts` | 修改 | +25 | 新增 `expandOverflowTargets()` 函数 |

### 详细设计

```typescript
export function expandOverflowTargets(
  targets: Target[],
  db: Database.Database,
  body: Record<string, unknown>,
): Target[]
```

逻辑：

```typescript
const expanded: Target[] = [];
for (const t of targets) {
  try {
  const ofResult = applyOverflowRedirect(t, db, body);
  if (ofResult) {
    expanded.push({
    backend_model: ofResult.backend_model,
    provider_id: ofResult.provider_id,
    });
  }
  } catch {
  // overflow 计算异常不影响主流程
  }
  expanded.push(t);
}
return expanded;
```

**IR fallback target 的 overflow 行为**：image_fallback target 不含 overflow_provider_id/overflow_model 字段，因此 `applyOverflowRedirect()` 对它返回 null，不会 prepend overflow target。这符合 spec 约束："IR fallback target 不参与 overflow 重定向"。

**为什么不用更复杂的 target 标记机制**：Target 类型已有 overflow_provider_id 和 overflow_model 可选字段。如果 target 没有这两个字段，applyOverflowRedirect 直接返回 null。无需引入额外的标记。

### 验收标准

- 对 [A(有overflow), B(无overflow)] 调用，返回 [OF_A, A, B]
- 对 [IR_F(无overflow), A(有overflow), B] 调用，返回 [IR_F, OF_A, A, B]（IR_F 不触发 overflow）

### 风险点

- applyOverflowRedirect 调用 estimateTokens，对每个 target 都会执行一次 token 估算。targets 数量通常 ≤ 8（原始 2-4 个 × OF 层最多翻倍），性能可接受。
- 异常安全：单个 target 的 overflow 计算异常不应影响其他 target，用 per-target try-catch。

### 依赖

- 现有 `applyOverflowRedirect()` 函数（不修改）

---

## T5: StageRecord + PipelineSnapshot 扩展

**目标**：扩展 StageRecord union type 以记录 IR 层事件。

### 文件变更

| 文件 | 操作 | 预估行数 | 说明 |
|------|------|----------|------|
| `router/src/proxy/pipeline-snapshot.ts` | 修改 | +1 | StageRecord 新增 `"image-redirect"` 变体 |

### 详细设计

在 StageRecord union 中追加：

```typescript
export type StageRecord =
  | { stage: "tool_round_limit"; action: string; rounds: number }
  | { stage: "tool_guard"; action: string; tool: string }
  | { stage: "routing"; client_model: string; backend_model: string; provider_id: string; strategy: string }
  | { stage: "overflow"; triggered: boolean; redirect_to?: string; redirect_provider?: string }
  | { stage: "provider_patch"; types: string[] }
  | { stage: "image-redirect"; triggered: boolean; original_model: string; redirect_to: string; redirect_provider: string; reason: string }
```

**数据消费者影响检查**：

| 消费者 | 影响 | 处理 |
|--------|------|------|
| `snapshot.toJSON()` | 无影响（JSON.stringify 对 union type 透明） | 无需改动 |
| 日志写入（log-helpers.ts） | 无影响（写入的是 JSON 字符串） | 无需改动 |
| SSE 实时监控（request-tracker.ts） | 无影响（广播 JSON 字符串） | 无需改动 |
| Admin API 日志查询（admin/logs.ts） | 无影响（返回 JSON 字符串） | 无需改动 |
| 前端日志详情页 | 如果前端解析 snapshot JSON 展示，需适配 | 前端 task |

### 验收标准

- StageRecord 类型编译通过
- T2 中的 `snapshot.add({ stage: "image-redirect", ... })` 类型检查通过

### 风险点

- 这是一个纯类型变更，风险极低。StageRecord 是 union type，新增变体不影响已有的 discriminated union 分支。

### 依赖

无。

---

## T6: Admin API validation 扩展

**目标**：`validateRule()` 扩展，验证 mapping group rule 中新增的 `image_fallback` 字段。

### 文件变更

| 文件 | 操作 | 预估行数 | 说明 |
|------|------|----------|------|
| `router/src/admin/groups.ts` | 修改 | +25 | validateRule() 扩展验证 image_fallback |

### 详细设计

在 `validateRule()` 函数末尾（targets 验证之后），新增 `image_fallback` 验证：

```typescript
// 验证 image_fallback（可选字段）
if (r.image_fallback !== undefined) {
  const fb = r.image_fallback as { backend_model?: string; provider_id?: string };
  if (!fb.backend_model || !fb.provider_id) {
  return "image_fallback requires both backend_model and provider_id";
  }
  const fbProvider = getProviderById(db, fb.provider_id);
  if (!fbProvider) {
  return `image_fallback.provider_id '${fb.provider_id}' not found`;
  }
  if (!fbProvider.is_active) {
  return `image_fallback.provider_id '${fb.provider_id}' is not active`;
  }
}
```

**为什么验证 provider active 状态**：spec 约束 "fallback provider 必须是 active 状态"。在 API 层做验证可以在配置时就告知用户问题，而不是等到运行时静默跳过。这与 validateOverflow 中验证 overflow_provider_id 存在性的模式一致。

**注意**：不验证 fallback provider 的 models 字段是否包含 backend_model。这与 targets 的验证策略一致（targets 的 validateRule 也不验证 provider.models 是否包含 backend_model，因为 models 配置可能异步更新）。运行时 computeImageRedirectTargets 会通过 parseModels 检查 capabilities。

### 验收标准

| AC# | 条件 | 验证方式 |
|-----|------|----------|
| AC17 | validateRule 验证 image_fallback provider_id 存在且 active | 单元测试 |

### 风险点

- 向后兼容：image_fallback 是可选字段，旧 rule JSON（不含此字段）不受影响。validateRule 只在 `r.image_fallback !== undefined` 时进入验证。

### 依赖

无。

---

## T7: Tests

### 文件变更

| 文件 | 操作 | 预估行数 | 说明 |
|------|------|----------|------|
| `router/tests/image-redirect.test.ts` | 新建 | ~200 | IR 层纯函数单元测试 |
| `router/tests/model-capabilities.test.ts` | 新建 | ~60 | capabilities 解析/补充测试 |
| `router/tests/overflow-expand.test.ts` | 新建 | ~50 | expandOverflowTargets 测试 |
| `router/tests/layered-routing.test.ts` | 新建 | ~100 | 分层路由集成测试（IR + OF 联合） |
| `router/tests/admin-groups.test.ts` | 修改 | +40 | image_fallback 验证测试 |

### 测试分组

**1. model-capabilities.test.ts（覆盖 AC5, AC6）**

- ModelEntry 有 capabilities → parseModels 返回原值
- ModelEntry 无 capabilities → 从 MODEL_CAPABILITIES 补充
- 未知模型 → 默认 ["text"]
- buildModelInfoList 传递 capabilities

**2. image-redirect.test.ts（覆盖 AC1-4, AC7-10, AC13-16）**

图片检测子函数测试：
- OpenAI 格式：content 数组含 image_url → true
- OpenAI 格式：content 为 string → false
- OpenAI 格式：content 数组无 image_url → false
- Anthropic 格式：content 含 type="image" → true
- Responses API 格式：input 含 type="input_image" → true
- Responses API 格式：message content 含 input_image → true
- 空 body → false

IR 主函数测试：
- 含图片 + 首target不支持 + 有fallback → prepend（AC1）
- 含图片 + 首target已支持 → 不扩展（AC2）
- 含图片 + 不支持 + 无fallback → 不扩展（AC3）
- 不含图片 → 不扩展（AC4）
- fallback provider 非 active → 不扩展（AC7）
- fallback provider_id 不存在 → 不扩展（AC8）
- 触发时 snapshot 含 image-redirect record（AC9）
- 异常降级返回原列表（AC10）

**3. overflow-expand.test.ts**

- [A(有overflow)] → [OF_A, A]
- [A(无overflow)] → [A]
- [A(有overflow), B(无overflow)] → [OF_A, A, B]
- 空 targets → 空

**4. layered-routing.test.ts（覆盖 AC18, AC19）**

- targets=[A(不支持图片)], body含图片, 有fallback, A有overflow → IR 层输出 [IR_F, A], OF 层输出 [IR_F, OF_A, A]（AC18）
- 完整 failover 场景：IR_F 失败 → exclude → OF_A 失败 → exclude → A 成功（AC19）
- 所有 target 耗尽 → 返回错误

**5. admin-groups.test.ts 追加（覆盖 AC17）**

- 创建 group 含 image_fallback + provider 存在且 active → 201
- image_fallback 缺 backend_model → 400
- image_fallback provider_id 不存在 → 400
- image_fallback provider inactive → 400
- image_fallback 为空对象 → 400

### 测试模式

遵循项目现有模式：
- `initDatabase(":memory:")` 创建内存 DB
- 直接构造测试数据（不通过 API）
- IR/OF 层纯函数测试直接调用函数，集成测试通过 `buildApp()` + `app.inject()`

### 依赖

- T1-T6 全部完成后才能编写完整测试
- 纯函数测试（图片检测、capabilities）可与 T1/T2 同步开发

---

## Task 依赖关系

```
T5 (StageRecord) ─────────────────────────┐
                       │
T1 (Model capabilities) ──┬───────────────┤
              │               │
T6 (Admin validation) ────┤               │
              ▼               ▼
T2 (IR 函数) ─────────────┼───────────────┤
              │               │
T4 (OF 扩展) ─────────────┤               │
              ▼               ▼
          T3 (failover 重构) ◄───┘
              │
              ▼
          T7 (Tests)
```

T1 和 T6 无依赖关系，可并行。T2 依赖 T1（parseModels 的 capabilities）。T3 依赖 T2 和 T4。T7 依赖全部。

## 实现顺序建议

1. T5（StageRecord 类型扩展）— 1行改动，零风险
2. T1（Model capabilities）— 基础设施，无破坏性
3. T6（Admin validation）— 独立，可与 T1 并行
4. T4（overflow expand）— 小函数，独立
5. T2（IR 函数）— 核心逻辑
6. T3（failover 重构）— 最后执行，因为依赖最多
7. T7（Tests）— 全部通过后补全测试

## 总变更量估算

| 文件 | 新增行 | 修改行 | 删除行 |
|------|--------|--------|--------|
| `model-context.ts` | ~80 | ~10 | 0 |
| `image-redirect.ts` (新) | ~120 | 0 | 0 |
| `failover-loop.ts` | ~30 | ~40 | ~40 |
| `overflow.ts` | ~25 | 0 | 0 |
| `pipeline-snapshot.ts` | ~1 | 0 | 0 |
| `groups.ts` | ~25 | 0 | 0 |
| 测试文件 (5个) | ~450 | ~40 | 0 |
| **合计** | **~730** | **~90** | **~40** |
