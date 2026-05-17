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

`ModelInfo` 同步扩展 `capabilities` 字段（`buildModelInfoList()` 返回）：

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

**已知模型能力表**：新增 `MODEL_CAPABILITIES` 常量（与 `MODEL_CONTEXT_WINDOWS` 对称），采用**白名单模式**——只列出确认支持图片的模型，不在表中的模型默认 `["text"]`。

```typescript
// router/src/config/model-context.ts
// 白名单：确认支持图片理解的模型。未列入的模型默认 ["text"]。
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
  // 阿里云 Qwen（qwq、qwen-vl 系列支持图片）
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
  { "backend_model": "glm-5.1", "provider_id": "zhipu" }
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

### 3. 图片检测实现位置

**重要**：当前 `post_route` phase 的 `proxyPipeline.emit()` 尚未被调用（`router/src/proxy/handler/create-proxy-handler.ts` 只 emit 了 `pre_route`）。overflow-redirect hook 虽然注册到 `post_route`，实际也未通过 pipeline 执行。

**实现方案**：分两步走：

**Step 1 — 新增 `post_route` emit 调用点**

在 `router/src/proxy/handler/failover-loop.ts` 中，`resolveMapping` + overflow 之后、plugin adjustments 之前（约 line 298），新增 `post_route` phase 的 emit 调用。

**前置操作**：emit 前需将局部变量赋值到 ctx（因为 failover-loop.ts 内部全程使用局部变量 `resolved`/`provider`/`currentBody`，而非 `ctx.resolved` 等）：

```typescript
// emit 前：local → ctx
ctx.resolved = resolved;
ctx.provider = provider as unknown as ProviderInfo;
ctx.body = currentBody;

// emit
await proxyPipeline.emit("post_route", ctx);

// emit 后：ctx → local（hook 可能已修改 resolved/body）
resolved = ctx.resolved!;
provider = ctx.provider as unknown as typeof provider;
currentBody = { ...currentBody, model: (ctx.body as Record<string, unknown>).model as string };
```

这使 hook 能通过 `ctx.resolved` 和 `ctx.provider` 访问当前路由结果，且 hook 的修改能正确回流到局部变量，影响后续代码路径。

```
// failover-loop.ts 内部：resolveMapping → overflow → local→ctx → emit("post_route") → ctx→local → plugin adjustments
```

> 注：当前 overflow 逻辑已在 `failover-loop.ts:275` 内联执行（不通过 pipeline）。添加 emit 后，overflow-redirect hook 的 `post_route` 注册仍有意义——将来可移除内联逻辑改为纯 hook 驱动。本次不重构 overflow，image-redirect hook 在 emit 时独立执行。

**Step 2 — 新 Hook 实现**

```
name: "builtin:image-redirect"
phase: "post_route"
priority: 120  (overflow-redirect 是 100，image 在其之后执行)
```

**检测逻辑**：

| API 格式 | 检测路径 |
|----------|----------|
| OpenAI | `messages[].content` 为数组时，检查是否存在 `type === "image_url"` 的项 |
| Anthropic | `content[].type === "image"` |
| Responses API | `input[]` 中 `type === "message"` 的项，其 `content[]` 中 `type === "input_image"` 的项；以及 `input[]` 中顶层 `type === "input_image"` 的项 |

> 注：Responses API 的图片类型是 `"input_image"`（非 OpenAI 的 `"image_url"`），见 `router/src/proxy/transform/types-responses.ts`。

检测到图片后：
1. 查询当前 resolved model 的 capabilities（从 `parseModels()` 结果中获取）
2. 如果不支持 image 且 mapping_group 配置了 `image_fallback`
3. 加载 fallback provider（`getProviderById`），检查 active 状态
4. 切换 `ctx.resolved` 和 `ctx.body.model` 到 fallback 目标
5. 记录 snapshot metadata

**不检测的场景**：
- `messages[].content` 为 string 类型（纯文本消息，OpenAI 简写格式）
- 已在映射层面指定了支持图片的模型（capabilities 含 "image"）

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
ctx.snapshot.add({
  stage: "image-redirect",
  triggered: true,
  original_model: "glm-5.1",
  redirect_to: "moonshot-v1-128k",
  redirect_provider: "kimi",
  reason: "image_detected_model_not_capable",
});
```

`request_logs` 的 `client_request` 字段中会包含切换前后的信息（已有机制）。

## 范围

### In-scope

- `ModelEntry.capabilities` + `ModelInfo.capabilities` 字段扩展 + `parseModels()` / `buildModelInfoList()` 适配
- `MODEL_CAPABILITIES` 已知模型能力白名单
- `mapping_groups.rule` 增加 `image_fallback` 配置 + `validateRule()` 扩展
- `post_route` emit 调用点新增（`failover-loop.ts`）
- `post_route` Pipeline Hook：图片检测 + 自动切换
- `StageRecord` union type 扩展
- Provider 管理前端：模型能力编辑
- 映射组管理前端：image_fallback 配置 UI
- 单元测试：图片检测逻辑、能力判断、fallback 切换

### Out-of-scope

- 音频/视频检测（capabilities 字段设计预留但本次不实现 audio/video 检测 Hook）
- Session 粘性（切换后不保持，下次无图片请求回到原模型）
- 自动从上游 `/v1/models` 端点获取能力信息
- 独立的模型能力管理页面

## 约束

- **性能**：图片检测必须在 O(n) 内完成（n = messages 数量），不允许正则全文扫描
- **兼容性**：`capabilities` 字段可选，缺失时默认 `["text"]`，不影响现有 provider 数据
- **幂等性**：Hook 多次执行结果一致；已切换到支持图片的模型时不重复切换
- **无阻塞**：Hook 失败时降级为不切换，请求照常转发（防御性设计）

## 已做决策

| # | 决策 | 理由 | 可推翻？ |
|---|------|------|---------|
| D1 | 方案 A：显式 fallback 配置 | 用户完全可控，语义清晰 | 否（用户已确认） |
| D2 | capabilities 运行时补充，不修改 DB 原始 JSON | 避免迁移脚本，零停机部署 | 是（如后续需要持久化可改为 migration） |
| D3 | 已知模型能力表作为常量维护（白名单） | 与 `MODEL_CONTEXT_WINDOWS` 模式一致；未列入的默认 text | 是（可改为 DB 配置或 API 获取） |
| D4 | `post_route` 阶段执行，需新增 emit 调用点 | 需要在映射解析后（有 resolved target）且在 transport 前；现有 `post_route` 未被 emit 是架构缺陷，应修复 | 否（pipeline 架构的正确用法） |
| D5 | 不做 session 粘性 | 简化实现，用户下次无图请求自动回到原模型 | 是（如有反馈可加） |

## 行为约束

| 级别 | 约束 |
|------|------|
| Always | 图片检测只检查消息结构，不下载/解析图片内容本身 |
| Always | `image_fallback` 未配置时，检测到图片也不切换（no-op） |
| Always | fallback provider 必须是 active 状态，否则不切换 |
| Always | fallback provider_id 必须在 DB 中存在，否则不切换 |
| Always | Hook 异常不传播到调用链，降级为 no-op |
| Never | 不修改请求体中的图片数据（URL/base64 原样转发） |
| Never | 不在 DB 中持久化运行时补充的 capabilities |

## 已有基础设施

| 组件 | 位置 | 复用方式 |
|------|------|----------|
| Pipeline Hook 框架 | `router/src/proxy/pipeline/types.ts` | 新 Hook 实现 `PipelineHook` 接口 |
| Hook 注册 | `router/src/proxy/pipeline/register-hooks.ts` | 新 Hook 加入 `ALL_HOOKS` 数组 |
| overflow-redirect Hook | `router/src/proxy/hooks/builtin/overflow-redirect.ts` | 参考模式：post_route 阶段修改 `ctx.resolved` |
| emit 调用点 | `router/src/proxy/handler/failover-loop.ts` | 新增 `post_route` emit（在 resolveMapping + overflow 之后） |
| `parseModels()` | `router/src/config/model-context.ts` | 扩展解析 `capabilities` 字段 |
| `MODEL_CONTEXT_WINDOWS` | `router/src/config/model-context.ts` | 同文件新增 `MODEL_CAPABILITIES` |
| `StageRecord` union | `router/src/proxy/pipeline-snapshot.ts` | 新增 `"image-redirect"` 变体 |
| 映射组 rule 验证 | `router/src/admin/groups.ts` | `validateRule()` 扩展验证 `image_fallback` |
| Provider 管理 UI | `frontend/src/views/Providers.vue` | 扩展模型列表编辑 |
| 映射组管理 UI | `frontend/src/views/ModelMappings.vue` | 扩展 fallback 配置 |

## 验收标准

| AC# | 条件 | 验证方式 |
|-----|------|----------|
| AC1 | 请求含图片 + 当前模型不支持 + 配置了 fallback → 自动切换到 fallback 模型 | 单元测试 |
| AC2 | 请求含图片 + 当前模型已支持 → 不切换 | 单元测试 |
| AC3 | 请求含图片 + 当前模型不支持 + 未配置 fallback → 不切换，请求照常转发 | 单元测试 |
| AC4 | 请求不含图片 → 不触发检测逻辑（no-op） | 单元测试 |
| AC5 | `ModelEntry` 含 `capabilities` 字段时，`parseModels()` 正确解析 | 单元测试 |
| AC6 | `ModelEntry` 无 `capabilities` 字段时，`parseModels()` 从 `MODEL_CAPABILITIES` 补充 | 单元测试 |
| AC7 | fallback provider 非 active → 不切换 | 单元测试 |
| AC8 | fallback provider_id 在 DB 中不存在 → 不切换 | 单元测试 |
| AC9 | 切换事件记录到 `ctx.snapshot`（含 original_model、redirect_to、reason） | 单元测试 |
| AC10 | Hook 异常不传播，降级为 no-op | 单元测试 |
| AC11 | Provider 管理前端可编辑模型 capabilities | 手动验证 |
| AC12 | 映射组管理前端可配置 image_fallback | 手动验证 |
| AC13 | OpenAI 格式（content 数组中 type=image_url）正确检测 | 单元测试 |
| AC14 | Anthropic 格式（content 中 type=image）正确检测 | 单元测试 |
| AC15 | OpenAI content 为 string 时不触发检测 | 单元测试 |
| AC16 | Responses API 格式（input 中 type=input_image）正确检测 | 单元测试 |
| AC17 | `validateRule()` 验证 image_fallback 的 provider_id 存在且 active | 单元测试 |

## 数据消费者检查

`capabilities` 字段的消费点：

| 消费者 | 位置 | 用途 |
|--------|------|------|
| `parseModels()` | `router/src/config/model-context.ts` | 解析 capabilities 字段 |
| `buildModelInfoList()` | `router/src/config/model-context.ts` | 返回含 capabilities 的 ModelInfo |
| image-redirect Hook | `router/src/proxy/hooks/builtin/image-redirect.ts` | 判断模型是否支持图片 |
| Provider 管理 API（GET） | `router/src/admin/providers.ts` | 返回含 capabilities 的模型列表 |
| Provider 管理 API（PUT） | `router/src/admin/providers.ts` | 保存用户编辑的 capabilities 到 models JSON |
| Provider 管理前端 | `frontend/src/views/Providers.vue` | 展示和编辑 capabilities |

`image_fallback` 字段的消费点：

| 消费者 | 位置 | 用途 |
|--------|------|------|
| image-redirect Hook | `router/src/proxy/hooks/builtin/image-redirect.ts` | 读取 fallback 目标 |
| 映射组 Admin API（GET） | `router/src/admin/groups.ts` | 返回 image_fallback 配置 |
| 映射组 Admin API（PUT） | `router/src/admin/groups.ts` | 保存 image_fallback 配置 |
| 映射组管理前端 | `frontend/src/views/ModelMappings.vue` | 配置 fallback |

`StageRecord` / `PipelineSnapshot` 的消费点（新增 `"image-redirect"` 变体后需确认兼容）：

| 消费者 | 位置 | 用途 |
|--------|------|------|
| 日志写入 | `router/src/proxy/log-helpers.ts` | snapshot.toJSON() 写入 request_logs |
| SSE 实时监控 | `router/src/core/monitor/request-tracker.ts` | 广播 snapshot 数据 |
| Admin API 日志查询 | `router/src/admin/logs.ts` | 返回 snapshot 字段 |
