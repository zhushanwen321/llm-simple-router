# 图片检测自动切换多模态模型

## 目标

请求含图片但当前映射模型不支持图片理解时，自动切换到支持多模态的 fallback 模型，避免上游返回错误。

## 背景

客户端（ChatGPT-Next-Web、LobeChat 等）在对话中混合文本和图片。路由器按映射规则将请求转发到上游模型，但纯文本模型（如 glm-5.1、deepseek-v4-flash）收到图片会报错。当前没有任何图片检测或模型能力判断机制。

## 方案

### 1. 模型能力标记

**数据模型**：`ModelEntry` 扩展 `capabilities` 字段。

```typescript
// model-context.ts
export interface ModelEntry {
  name: string
  context_window?: number
  patches?: string[]
  stream_timeout_ms?: number
  capabilities?: string[]  // 新增：["text", "image"]
}
```

默认值 `["text"]`（纯文本）。支持图片的模型标记为 `["text", "image"]`。

**已知模型能力表**：新增 `MODEL_CAPABILITIES` 常量（与 `MODEL_CONTEXT_WINDOWS` 对称），维护已知模型的能力信息。不在表中的模型默认为纯文本。

```typescript
export const MODEL_CAPABILITIES: Record<string, string[]> = {
  "glm-5.1": ["text"],
  "glm-4.5-air": ["text", "image"],
  "kimi-k2.6": ["text", "image"],
  "moonshot-v1-128k": ["text", "image"],
  // ... 完整列表见 spec 数据消费者检查
}
```

**数据迁移**：启动时 `parseModels()` 解析现有 provider 的 models JSON。如果 ModelEntry 没有 `capabilities` 字段，从 `MODEL_CAPABILITIES` 查表填充；查不到则默认 `["text"]`。不修改 DB 中的原始 JSON——能力信息在运行时补充。

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

**前端**：映射组编辑表单中新增「图片 Fallback」区域，选择 provider + model。

### 3. 图片检测 Hook

**Pipeline Hook**：`post_route` 阶段，优先级在 overflow-redirect 之后。

```
name: "builtin:image-redirect"
phase: "post_route"
priority: 120  (overflow-redirect 是 100)
```

**检测逻辑**：

| API 格式 | 检测路径 |
|----------|----------|
| OpenAI | `messages[].content` 为数组时，检查是否存在 `type === "image_url"` 的项 |
| Anthropic | `content[].type === "image"` |
| Responses API | `input[]` 中 `type === "message"` 的项，其 `content[]` 中 `type === "image_url"` 的项 |

检测到图片后：
1. 查询当前 resolved model 的 capabilities（从 `parseModels()` 结果中获取）
2. 如果不支持 image 且 mapping_group 配置了 `image_fallback`
3. 切换 `ctx.resolved` 和 `ctx.body.model` 到 fallback 目标
4. 记录 snapshot metadata

**不检测的场景**：
- `messages[].content` 为 string 类型（纯文本消息，OpenAI 简写格式）
- 已在映射层面指定了支持图片的模型

### 4. 日志记录

切换事件记录到 `ctx.snapshot`：

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

- `ModelEntry.capabilities` 字段扩展 + `parseModels()` 适配
- `MODEL_CAPABILITIES` 已知模型能力表（覆盖 `recommended-providers.json` 中的所有模型）
- `mapping_groups.rule` 增加 `image_fallback` 配置
- `post_route` Pipeline Hook：图片检测 + 自动切换
- Provider 管理前端：模型能力编辑
- 映射组管理前端：image_fallback 配置 UI
- 单元测试：图片检测逻辑、能力判断、fallback 切换

### Out-of-scope

- 音频/视频检测（后续扩展点，capabilities 字段设计预留但本次不实现 audio/video 检测）
- Session 粘性（切换后不保持，下次无图片请求回到原模型）
- 自动从上游 `/v1/models` 端点获取能力信息
- Responses API 原生 `image` input 类型（暂只处理转换后的 OpenAI/Anthropic 格式）
- 独立的模型能力管理页面

## 约束

- **性能**：图片检测必须在 O(n) 内完成（n = messages 数量），不允许正则全文扫描
- **兼容性**：`capabilities` 字段可选，缺失时默认 `["text"]`，不影响现有 provider 数据
- **幂等性**：Hook 多次执行结果一致；已切换到支持图片的模型时不重复切换
- **无阻塞**：Hook 失败时降级为不切换，请求照常转发（防御性设计）

## 已做决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 方案 A：显式 fallback 配置 | 用户完全可控，语义清晰 |
| D2 | capabilities 运行时补充，不修改 DB 原始 JSON | 避免迁移脚本，零停机部署 |
| D3 | 已知模型能力表作为常量维护 | 与 `MODEL_CONTEXT_WINDOWS` 模式一致 |
| D4 | `post_route` 阶段执行 | 需要在映射解析后（有 resolved target）且在 transport 前 |
| D5 | 不做 session 粘性 | 简化实现，用户下次无图请求自动回到原模型 |

## 行为约束

| 级别 | 约束 |
|------|------|
| Always | 图片检测只检查消息结构，不下载/解析图片内容本身 |
| Always | `image_fallback` 未配置时，检测到图片也不切换（no-op） |
| Always | fallback provider 必须是 active 状态，否则不切换 |
| Always | Hook 异常不传播到调用链，降级为 no-op |
| Never | 不修改请求体中的图片数据（URL/base64 原样转发） |
| Never | 不在 DB 中持久化运行时补充的 capabilities |

## 已有基础设施

| 组件 | 位置 | 复用方式 |
|------|------|----------|
| Pipeline Hook 框架 | `src/proxy/pipeline/types.ts` | 新 Hook 实现 `PipelineHook` 接口 |
| Hook 注册 | `src/proxy/pipeline/register-hooks.ts` | 新 Hook 加入 `ALL_HOOKS` 数组 |
| overflow-redirect Hook | `src/proxy/hooks/builtin/overflow-redirect.ts` | 参考模式：post_route 阶段修改 `ctx.resolved` |
| `parseModels()` | `src/config/model-context.ts` | 扩展解析 `capabilities` 字段 |
| `MODEL_CONTEXT_WINDOWS` | `src/config/model-context.ts` | 同文件新增 `MODEL_CAPABILITIES` |
| 映射组 rule 类型 | `mapping_groups.rule` JSON | 新增 `image_fallback` 字段 |
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
| AC8 | 切换事件记录到 `ctx.snapshot`（含 original_model、redirect_to、reason） | 单元测试 |
| AC9 | Hook 异常不传播，降级为 no-op | 单元测试 |
| AC10 | Provider 管理前端可编辑模型 capabilities | 手动验证 |
| AC11 | 映射组管理前端可配置 image_fallback | 手动验证 |
| AC12 | OpenAI 格式（content 数组中 type=image_url）正确检测 | 单元测试 |
| AC13 | Anthropic 格式（content 中 type=image）正确检测 | 单元测试 |
| AC14 | OpenAI content 为 string 时不触发检测 | 单元测试 |

## 数据消费者检查

`capabilities` 字段的消费点：

| 消费者 | 位置 | 用途 |
|--------|------|------|
| `parseModels()` | `src/config/model-context.ts` | 解析 capabilities 字段 |
| `buildModelInfoList()` | `src/config/model-context.ts` | 返回含 capabilities 的 ModelInfo |
| image-redirect Hook | `src/proxy/hooks/builtin/image-redirect.ts` | 判断模型是否支持图片 |
| Provider 管理 API | `src/admin/providers.ts` | 返回含 capabilities 的模型列表 |
| Provider 管理前端 | `frontend/src/views/Providers.vue` | 展示和编辑 capabilities |

`image_fallback` 字段的消费点：

| 消费者 | 位置 | 用途 |
|--------|------|------|
| image-redirect Hook | `src/proxy/hooks/builtin/image-redirect.ts` | 读取 fallback 目标 |
| 映射组 Admin API | `src/admin/groups.ts` | 返回/保存 image_fallback |
| 映射组管理前端 | `frontend/src/views/ModelMappings.vue` | 配置 fallback |
