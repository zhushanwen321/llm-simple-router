# 图片检测自动切换多模态模型

## 目标

请求含图片但当前映射模型不支持图片理解时，自动切换到支持多模态的 fallback 模型，避免上游返回错误。

## 背景

客户端（ChatGPT-Next-Web、LobeChat 等）在对话中混合文本和图片。路由器按映射规则将请求转发到上游模型，但纯文本模型（如 glm-5.1、deepseek-v4-flash）收到图片会报错。当前没有任何图片检测或模型能力判断机制。

## 方案

### 1. 模型能力标记

**数据模型**：`ModelEntry` 扩展 `capabilities` 字段。

```typescript
// router/src/config/model-context.ts
export interface ModelEntry {
  name: string
  context_window?: number
  patches?: string[]
  stream_timeout_ms?: number
  capabilities?: string[]  // 新增：["text", "image"]
}
```

`ModelInfo` 同步扩展 `capabilities` 字段：

```typescript
export interface ModelInfo {
  name: string
  context_window: number | null
  patches: string[]
  stream_timeout_ms?: number
  capabilities?: string[]  // 新增
}
```

默认值 `["text"]`（纯文本）。支持图片的模型标记为 `["text", "image"]`。

**已知模型能力表**：新增 `MODEL_CAPABILITIES` 常量，采用**白名单模式**——只列出确认支持图片的模型，不在表中的模型默认 `["text"]`。

```typescript
// router/src/config/model-context.ts
export const MODEL_CAPABILITIES: Record<string, string[]> = {
  // 智谱
  "glm-4.5-air": ["text", "image"],
  "glm-4v-plus": ["text", "image"],
  "glm-4v-flash": ["text", "image"],
  // 月之暗面
  "moonshot-v1-128k": ["text", "image"],
  "moonshot-v1-32k": ["text", "image"],
  "moonshot-v1-8k": ["text", "image"],
  "kimi-k2.6": ["text", "image"],
  "kimi-k2.5": ["text", "image"],
  "kimi-k2-turbo-preview": ["text", "image"],
  "kimi-k2-thinking": ["text", "image"],
  "kimi-for-coding": ["text", "image"],
  // 阿里云 Qwen
  "qwen-vl-max": ["text", "image"],
  "qwen-vl-plus": ["text", "image"],
  "qwen3.6-plus": ["text", "image"],
  "qwen3.5-plus": ["text", "image"],
  "qwen3.5-flash": ["text", "image"],
  // MiniMax
  "MiniMax-M2.7": ["text", "image"],
  "MiniMax-M2.7-highspeed": ["text", "image"],
  "MiniMax-M2.5": ["text", "image"],
  "MiniMax-M2.5-highspeed": ["text", "image"],
  // 百度千帆
  "ernie-4.0-8k": ["text", "image"],
  "ernie-4.0-turbo-8k": ["text", "image"],
  "ernie-3.5-8k": ["text", "image"],
  // 火山引擎
  "doubao-seed-2-0-pro-260215": ["text", "image"],
  "doubao-seed-1-8-251228": ["text", "image"],
  // 腾讯云
  "hunyuan-2.0-instruct": ["text", "image"],
  "hunyuan-2.0-thinking": ["text", "image"],
  // 科大讯飞
  "4.0Ultra": ["text", "image"],
  "generalv3.5": ["text", "image"],
  // 硅基流动
  "deepseek-ai/DeepSeek-V3.2-Exp": ["text", "image"],
  // 阶跃星辰
  "step-3.5-flash": ["text", "image"],
  "step-3.5-flash-2603": ["text", "image"],
  // OpenCode
  "mimo-v2-pro": ["text", "image"],
  "mimo-v2-omni": ["text", "image"],
  "mimo-v2.5-pro": ["text", "image"],
  "mimo-v2.5": ["text", "image"],
}
```

**数据迁移**：运行时补充，不修改 DB。`parseModels()` 解析 provider 的 models JSON 时，如果 ModelEntry 没有 `capabilities` 字段，从 `MODEL_CAPABILITIES` 查表填充；查不到则默认 `["text"]`。DB 中的原始 JSON 不变。

**Provider 管理 UI**：模型列表中每个模型增加能力多选（text/image），用户可手动修改。编辑后写入 DB 的 models JSON。

### 2. Fallback 配置

**映射组扩展**：`mapping_groups.rule` 的 JSON 结构中新增 `image_fallback` 字段：

```json
{
  "targets": [
  { "backend_model": "glm-5.1", "provider_id": "zhipu",
    "overflow_provider_id": "zhipu", "overflow_model": "glm-4.5-air-128k" },
  { "backend_model": "glm-5.1", "provider_id": "siliconflow" }
  ],
  "image_fallback": {
  "backend_model": "moonshot-v1-128k",
  "provider_id": "kimi"
  }
}
```

`image_fallback` 可选。未配置时，图片检测生效但不切换（请求照常发到原模型，由上游返回错误）。

**验证**：`router/src/admin/groups.ts` 的 `validateRule()` 需扩展，验证 `image_fallback.provider_id` 在 DB 中存在且对应的 provider 是 active 状态。验证失败返回 400 错误。

**前端**：映射组编辑表单中新增「图片 Fallback」区域，选择 provider + model。

### 3. 分层路由模型（核心架构）

所有路由机制不在 `failover-loop.ts` 的 `while(true)` 循环内部逐次决策，而是在循环外预计算完整的 target 列表，然后循环仅做顺序执行 + exclude。

#### 分层顺序

```
resolveMapping(db, clientModel)          → [A, B, C]   ← 基础 targets（含时段替换、failover 链）
  ↓
imageRedirectLayer([A, B, C], body)      → [IR_F, A, B, C]  ← 若 A 不支持图片 + 有 fallback，prepend
  ↓
overflowLayer([IR_F, A, B, C], body)     → [OF_IRF?, IR_F, OF_A, A, OF_B, B, OF_C, C]  ← 每个 target 计算溢出
  ↓
while(true):                             ← 简化为纯执行循环
  选第一个非 excluded target
  构建 transport → orchestrator.handle()
  成功 → return
  失败 → excludeTargets.push(target); continue
```

**每层仅扩展列表，不修改请求体**。fallback 切换通过替换 `resolved` 实现，溢出通过替换每个 target 实现。

#### 各层职责

| 层 | 输入 | 输出 | 副作用 |
|----|------|------|--------|
| resolveMapping | clientModel | `[A, B, C]` + concurrencyOverride | 查 DB：mapping group、schedule。**allowed_models 检查在此层之后、IR 层之前执行**（只检查原始 client model 对应的 target，IR fallback 由 admin 配置视为已授权） |
| imageRedirectLayer | `[A, B, C]` + body | `[IR_F, A, B, C]` 或不变 | 查 DB：group rule 的 image_fallback；记录 StageRecord |
| overflowLayer | targets + body | prepend 各 target 的 overflow | 查 DB：每个 target 的 overflow_provider/model |
| failover 循环 | 完整 targets | 响应或错误 | semaphore、transport、retry、日志。**provider 不存在或 inactive 时直接返回错误（保持原有行为，非 exclude+continue）** |

#### 实现位置

- resolveMapping：已有，不修改（`mapping-resolver.ts`）
- imageRedirectLayer：新增工具函数 `computeImageRedirectTargets()`，在 `router/src/proxy/routing/` 下
- overflowLayer：复用现有 `applyOverflowRedirect()`，在 failover-loop.ts 循环外调用
- failover 循环：`failover-loop.ts` 的 `while(true)` 重构——移除循环内的路由决策代码，简化为纯执行 + exclude 循环

#### imageRedirectLayer 函数签名

```typescript
// router/src/proxy/routing/image-redirect.ts
function computeImageRedirectTargets(
  db: Database,
  targets: Target[],
  clientModel: string,
  body: Record<string, unknown>,
  snapshot: PipelineSnapshot,
): Target[]
```

逻辑：
1. 检查 body 是否含图片（OpenAI/Anthropic/Responses API 三种格式）
2. 不含图片 → 返回原 targets（no-op）
3. 含图片 → 检查 targets[0] 的 capabilities
4. 已支持图片 → 返回原 targets
5. 不支持 + 未配置 image_fallback → 返回原 targets
6. 不支持 + 有 image_fallback → 检查 fallback provider 存在且 active → prepend 到 targets
7. 记录 StageRecord

图片检测格式：

| API 格式 | 检测路径 |
|----------|----------|
| OpenAI | `messages[].content` 为数组时，检查是否存在 `type === "image_url"` 的项 |
| Anthropic | `content[].type === "image"` |
| Responses API | `input[]` 中 `type === "message"` 的项，其 `content[]` 中 `type === "input_image"` 的项；以及 `input[]` 中顶层 `type === "input_image"` 的项 |

不检测的场景：

- `messages[].content` 为 string 类型（纯文本消息）
- 已在映射层面指定了支持图片的模型（capabilities 含 "image"）

#### overflowLayer 在循环外的调用方式

```typescript
// failover-loop.ts 中，while(true) 之前
let allTargets = targetsFromMapping;
// IR layer
allTargets = computeImageRedirectTargets(db, allTargets, clientModel, currentBody, iterationSnapshot);
// OF layer: 为每个 target 计算 overflow，prepend overflow target
const expanded: Target[] = [];
for (const t of allTargets) {
  const ofResult = applyOverflowRedirect(t, db, currentBody);
  if (ofResult) expanded.push({ backend_model: ofResult.backend_model, provider_id: ofResult.provider_id });
  expanded.push(t);
}
allTargets = expanded;
cachedTargets = allTargets;
```

#### failover 循环简化

重构后的 `while(true)` 循环仅保留：

1. 从 `cachedTargets` 中 `filterExcluded` 取第一个 target
2. `provider = getProviderById(db, target.provider_id)` + active 检查
3. `resolveUpstreamPath` + `plugin adjustments` + `provider patches`（不变）
4. 构建 transport + `orchestrator.handle()`
5. 成功 → return；失败 → excludeTargets.push(target); continue

**移除**：循环内的 `resolveMapping()` 调用（第一次迭代的 resolve 移到循环外）、overflow 内联代码（移到循环外）、image 检测逻辑（移到循环外）。

### 4. 日志记录

**StageRecord 扩展**：在 `router/src/proxy/pipeline-snapshot.ts` 的 `StageRecord` union type 中新增变体：

```typescript
export type StageRecord =
  | { stage: "tool_round_limit"; action: string; rounds: number }
  | { stage: "tool_guard"; action: string; tool: string }
  | { stage: "routing"; client_model: string; backend_model: string; provider_id: string; strategy: string }
  | { stage: "overflow"; triggered: boolean; redirect_to?: string; redirect_provider?: string }
  | { stage: "provider_patch"; types: string[] }
  | { stage: "image-redirect"; triggered: boolean; original_model: string; redirect_to: string; redirect_provider: string; reason: string };  // 新增
```

**Snapshot 记录**：

```typescript
snapshot.add({
  stage: "image-redirect",
  triggered: true,
  original_model: "glm-5.1",
  redirect_to: "moonshot-v1-128k",
  redirect_provider: "kimi",
  reason: "image_detected_model_not_capable",
});
```

### 5. 对现有 Pipeline Hook 的影响

**不需要新增 post_route emit 调用点**。本 feature 不通过 Hook 实现。需要变更的 Hook 注册项：

- `image-redirect` Hook：**不需要注册**（改用工具函数直接调用）
- `overflow-redirect` Hook：保持不变（将来可移除内联逻辑改为纯 Hook 驱动，本次不重构）
- 其他 Hook 无影响

## 范围

### In-scope

- `ModelEntry.capabilities` + `ModelInfo.capabilities` 字段扩展 + `parseModels()`/`buildModelInfoList()` 适配
- `MODEL_CAPABILITIES` 已知模型能力白名单
- `mapping_groups.rule` 增加 `image_fallback` 配置 + `validateRule()` 扩展
- `computeImageRedirectTargets()` 工具函数（预计算 IR 层）
- failover-loop.ts 重构：循环外预计算 IR/OF 层，循环内简化为纯执行
- `StageRecord` union type 扩展
- Provider 管理前端：模型能力编辑
- 映射组管理前端：image_fallback 配置 UI
- 单元测试：图片检测逻辑、能力判断、分层路由

### Out-of-scope

- 音频/视频检测（capabilities 字段设计预留但本次不实现）
- Session 粘性（切换后不保持，下次无图片请求回到原模型）
- 自动从上游 `/v1/models` 端点获取能力信息
- 独立的模型能力管理页面
- 移除 overflow 内联逻辑改为纯 Hook 驱动（本次不重构）

## 约束

- **性能**：图片检测 O(n)，n = messages 数；预计算 O(targets)，targets 通常 ≤ 4
- **兼容性**：`capabilities` 字段可选，缺失时默认 `["text"]`
- **循环简化**：failover while 循环不再做路由决策，仅执行 + exclude
- **无阻塞**：imageRedirectLayer、overflowLayer 异常时返回原列表不扩展

## 已做决策

| # | 决策 | 理由 | 可推翻？ |
|---|------|------|---------|
| D1 | 方案 A：显式 fallback 配置 | 用户完全可控，语义清晰 | 否（用户已确认） |
| D2 | capabilities 运行时补充，不修改 DB 原始 JSON | 避免迁移脚本，零停机部署 | 是 |
| D3 | 已知模型能力白名单常量 | 与 MODEL_CONTEXT_WINDOWS 模式一致 | 是 |
| D4 | 分层路由模型（resolveMapping→IR→OF→Failover） | 每层仅扩展 target 列表，逻辑独立；消除死循环；与现有 failover 机制兼容 | 否 |
| D5 | 不做 session 粘性 | 简化实现，下次无图请求自动回到原模型 | 是 |
| D6 | 不通过 Pipeline Hook 实现 | 路由预计算不需要 emit/ctx 往返，直接用工具函数更简洁；也不需要新增 post_route emit 调用点 | 否 |

## 行为约束

| 级别 | 约束 |
|------|------|
| Always | 图片检测只检查消息结构，不下载/解析图片内容本身 |
| Always | `image_fallback` 未配置时，检测到图片也不切换（no-op） |
| Always | fallback provider 必须是 active 状态，否则不切换 |
| Always | fallback provider_id 必须在 DB 中存在，否则不切换 |
| Always | 每请求仅执行一次 IR 层计算（不含图片时直接 skip） |
| Always | 分层计算异常降级为返回原列表，不阻塞请求 |
| Never | 不修改请求体中的图片数据（URL/base64 原样转发） |
| Never | 不在 DB 中持久化运行时补充的 capabilities |
| Never | 不在 failover 循环内做路由决策（所有决策在循环外预计算） |
| Never | IR fallback target 不参与 overflow 重定向（`image_fallback` 不含 overflow 字段，`applyOverflowRedirect()` 对它返回 null——IR fallback 模型通常已是大上下文模型） |

## 已有基础设施

| 组件 | 位置 | 复用方式 |
|------|------|----------|
| `resolveMapping()` | `router/src/proxy/routing/mapping-resolver.ts` | 不改动，仍返回基础 targets |
| `applyOverflowRedirect()` | `router/src/proxy/routing/overflow.ts` | 新增 `expandOverflowTargets()` 包装函数 |
| `failover-loop.ts` | `router/src/proxy/handler/failover-loop.ts` | 循环简化，移除循环内路由逻辑 |
| `parseModels()` | `router/src/config/model-context.ts` | 扩展解析 `capabilities` 字段 |
| `MODEL_CONTEXT_WINDOWS` | `router/src/config/model-context.ts` | 同文件新增 `MODEL_CAPABILITIES` |
| `StageRecord` union | `router/src/proxy/pipeline-snapshot.ts` | 新增 `"image-redirect"` 变体 |
| 映射组 rule 验证 | `router/src/admin/groups.ts` | `validateRule()` 扩展验证 `image_fallback` |
| Provider 管理 UI | `frontend/src/views/Providers.vue` | 扩展模型列表编辑 |
| 映射组管理 UI | `frontend/src/views/ModelMappings.vue` | 扩展 fallback 配置 |

## 验收标准

| AC# | 条件 | 验证方式 |
|-----|------|----------|
| AC1 | 请求含图片 + 当前模型不支持 + 配置了 fallback → IR 层 prepend fallback target | 单元测试 |
| AC2 | 请求含图片 + 当前模型已支持 → IR 层不扩展 | 单元测试 |
| AC3 | 请求含图片 + 当前模型不支持 + 未配置 fallback → IR 层不扩展 | 单元测试 |
| AC4 | 请求不含图片 → IR 层不扩展（no-op） | 单元测试 |
| AC5 | `ModelEntry` 含 `capabilities` 字段时，`parseModels()` 正确解析 | 单元测试 |
| AC6 | `ModelEntry` 无 `capabilities` 字段时，`parseModels()` 从 `MODEL_CAPABILITIES` 补充 | 单元测试 |
| AC7 | fallback provider 非 active → IR 层不扩展 | 单元测试 |
| AC8 | fallback provider_id 在 DB 中不存在 → IR 层不扩展 | 单元测试 |
| AC9 | 切换事件记录到 StageRecord（含 original_model、redirect_to、reason） | 单元测试 |
| AC10 | IR/OF 层异常降级为返回原列表，不阻塞请求 | 单元测试 |
| AC11 | Provider 管理前端可编辑模型 capabilities | 手动验证 |
| AC12 | 映射组管理前端可配置 image_fallback | 手动验证 |
| AC13 | OpenAI 格式（content 数组中 type=image_url）正确检测 | 单元测试 |
| AC14 | Anthropic 格式（content 中 type=image）正确检测 | 单元测试 |
| AC15 | OpenAI content 为 string 时不触发检测 | 单元测试 |
| AC16 | Responses API 格式（input 中 type=input_image）正确检测 | 单元测试 |
| AC17 | `validateRule()` 验证 image_fallback 的 provider_id 存在且 active | 单元测试 |
| AC18 | 分层路由：输入 targets=[A,B]，A 不支持图片 + 有 fallback，A 有 overflow → IR 层输出 [IR_F, A, B]，OF 层输出 [OF_A, A, B]（IR_F 无 overflow 被跳过） | 单元测试 |
| AC19 | failover 循环：IR_F 失败后被 exclude，后续迭代不重复选择 IR_F（无死循环） | 单元测试 |
| AC20 | failover 循环仅做执行 + exclude，不含路由决策 | 代码审查 |

## 数据消费者检查

`capabilities` 字段的消费点：

| 消费者 | 位置 | 用途 |
|--------|------|------|
| `parseModels()` | `router/src/config/model-context.ts` | 解析 capabilities 字段 |
| `buildModelInfoList()` | `router/src/config/model-context.ts` | 返回含 capabilities 的 ModelInfo |
| `computeImageRedirectTargets()` | `router/src/proxy/routing/image-redirect.ts` | 判断模型是否支持图片 |
| Provider 管理 API（GET） | `router/src/admin/providers.ts` | 返回含 capabilities 的模型列表 |
| Provider 管理 API（PUT） | `router/src/admin/providers.ts` | 保存用户编辑的 capabilities 到 models JSON |
| Provider 管理前端 | `frontend/src/views/Providers.vue` | 展示和编辑 capabilities |

`image_fallback` 字段的消费点：

| 消费者 | 位置 | 用途 |
|--------|------|------|
| `computeImageRedirectTargets()` | `router/src/proxy/routing/image-redirect.ts` | 读取 fallback 目标 |
| 映射组 Admin API（GET） | `router/src/admin/groups.ts` | 返回 image_fallback 配置 |
| 映射组 Admin API（PUT） | `router/src/admin/groups.ts` | 保存 image_fallback 配置 |
| 映射组管理前端 | `frontend/src/views/ModelMappings.vue` | 配置 fallback |

`StageRecord` / `PipelineSnapshot` 的消费点（新增 `"image-redirect"` 变体后需确认兼容）：

| 消费者 | 位置 | 用途 |
|--------|------|------|
| 日志写入 | `router/src/proxy/log-helpers.ts` | snapshot.toJSON() 写入 request_logs |
| SSE 实时监控 | `router/src/core/monitor/request-tracker.ts` | 广播 snapshot 数据 |
| Admin API 日志查询 | `router/src/admin/logs.ts` | 返回 snapshot 字段 |
