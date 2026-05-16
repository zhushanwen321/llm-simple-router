# Spec: 多模态重定向（Modality Redirect）

## 目标

将现有 image-only 的 IR 层泛化为多模态重定向层，支持 image / audio / video 三种非文本输入的自动检测与 fallback 路由。

核心改动是**语义扩展 + 重命名**，不改变技术架构：
- `image-redirect` → `modality-redirect`
- `image_fallback` → `multimodal_fallback`
- `hasImage()` → `detectModalities()`
- capabilities 值从 `["text", "image"]` 扩展为 `["text", "image", "audio", "video"]`

## 范围

### In-scope

1. **后端路���层重命名**：`image-redirect.ts` → `modality-redirect.ts`，所有函数/类型/常量同步重命名
2. **模态检测扩展**：`detectModalities(body)` 在现有 image 检测基础上增加 audio / video block 识别
3. **fallback 字段重命名**：`image_fallback` → `multimodal_fallback`（DB rule JSON 字段、API、前端）
4. **pipeline snapshot stage 名**：`"image-redirect"` → `"modality-redirect"`
5. **admin 校验更新**：`groups.ts` 中 `image_fallback` 校验逻辑改为 `multimodal_fallback`
6. **MODEL_CAPABILITIES 数据扩展**：部分模型增加 `"audio"` / `"video"` 能力标记（具体列表见下方）
7. **前端类型/组件重命名**：`ImageFallback` → `MultimodalFallback`，所有引用同步更新
8. **前端 i18n 更新**：`imageFallback.*` → `multimodalFallback.*`，capabilities 加 audio/video 标签
9. **前端 Alert 提示**：ModelMappingCard 配置 multimodal fallback 时显示永久锁定行为警告
10. **前端 capabilities 切换泛化**：`toggleModelImageCapability()` → `toggleModelCapability(index, capability)` 支持任意模态切换
11. **测试重命名+更新**：所有测试文件中的引用同步更新
12. **清理旧数据**：测试数据库中的 `image_fallback` 字段清理

### Out-of-scope

- **Session 粘性/过期**：`detectModalities()` 仍遍历所有 messages，不过期、不限制窗口
- **图片剥离（image stripping）**：不修改请求 body 中的多媒体 block
- **per-modality fallback 配置**：保持单一 fallback target，不按模态拆分
- **capabilities UI 重设计**：provider 编辑页面的 capabilities 仍为 checkbox 列表，仅增加 audio/video 选项
- **API 格式转换**：不做 image_url → Anthropic image 格式的转换（已有机制不变）

## 约束

### 数据格式

- capabilities 保持 `string[]`，值域：`"text"` | `"image"` | `"audio"` | `"video"`
- `multimodal_fallback` 结��与原 `image_fallback` 完全相同：`{ provider_id: string, backend_model: string }`
- 无 DB migration：rule 是 JSON 字段，直接改 key 名

### 向后兼容

- **不兼容**：`image_fallback` 不保留，直接改为 `multimodal_fallback`（功能未上线，无生产数据迁移需求）
- 测试数据库需手动清理或重建

### 行为不变量

- MRL 层仍在 failover-loop 预计算阶段执行（while 循环外）
- 异常安全：`computeModalityRedirectTargets()` 内部 catch 返回原始 targets
- redirect 仍然是 prepend fallback target
- `detectModalities()` 遍历**所有** messages（不做窗口限制），设计决策记录在注释中

## 已做决策

| ID | 决策 | 理由 |
|----|------|------|
| D1 | capabilities 保持 `string[]` | 匹配时可按具体模态逐个匹配，扩展性好 |
| D2 | 字段名 `multimodal_fallback`，不兼容 `image_fallback` | 功能未上线，无迁移负担 |
| D3 | 单一 fallback target 覆盖所有非文本模态 | 85% 的多模态模型只支持 image+text；audio/video 模型必然也支持 image（超集关系） |
| D4 | `detectModalities()` 遍历所有 messages | compact 是天然的过期机制；图片剥离风险高，不宜在 router 层做 |
| D5 | 前端配置时显示永久锁定警告 | 用户可能不知道整个 session 会被锁在 fallback 模型上 |
| D6 | `detectModalities()` 返回 `Set<string>` | 去重，且支持集合运算判断缺失模态 |

## 行为约束

### Always

- 重定向前必须检查 fallback 模型是否支持请求中的**具体模态**（不是只检查"是否多模态"）
- pipeline snapshot 必须记录 `"modality-redirect"` stage，完整类型定义：

```typescript
// pipeline-snapshot.ts StageRecord 新变体（替换原 image-redirect）
| { stage: "modality-redirect"; triggered: boolean; original_model: string; redirect_to: string; redirect_provider: string; reason: string; detected_modalities?: string[] }
```

- `detected_modalities` 字段：当 `triggered=true` 时必填，值为检测到的非文本模态列表（如 `["image"]`、`["image", "audio"]`）；`triggered=false` 时可选
- admin 校验 `multimodal_fallback` 时必须验证 provider 存在、active、model 在 models 列表中
- 前端配置 multimodal fallback 时必须显示永久锁定行为警告

### Never

- 不修改请求 body（不做图片/音频/视频剥离）
- 不引入 session 粘性配置（如 TTL、窗口大小等参数）
- 不在 `detectModalities()` 中限制扫描窗口（不查"最近 N 条"）

## 已有基础设施

| 组件 | 位置 | 复用方式 |
|------|------|----------|
| IR 层框架 | `router/src/proxy/routing/image-redirect.ts` | 重命名+扩展 |
| pipeline snapshot | `router/src/proxy/pipeline-snapshot.ts` | stage 名更新 + 类型扩展 |
| capabilities 查询 | `router/src/config/model-context.ts` `lookupCapabilities(modelName: string): string[]` | 数据扩展 |
| admin 校验 | `router/src/admin/groups.ts` `validateRule()` | 字段名更新 |
| 前端 fallback 配置 | `frontend/src/components/mappings/ModelMappingCard.vue` + `CascadingModelSelect` | 重命名+加 Alert |
| 前端 capabilities 切换 | `frontend/src/composables/useProviderForm.ts` `toggleModelImageCapability()` | 泛化为 `toggleModelCapability()` |
| 前端 capabilities UI | `frontend/src/components/providers/ModelCapabilitiesEditor.vue` + `ModelCard.vue` | 增加 audio/video checkbox |
| i18n | `frontend/src/i18n/locales/*/mappings.json` | key 重命名+新增 |
| 测试框架 | `router/tests/image-redirect.test.ts` 等 | 重命名+更新断言 |

## detectModalities() 检测规则

函数签名：
```typescript
export function detectModalities(body: Record<string, unknown>): Set<string>
```

### OpenAI 格式（api_type = openai）

```
messages[].content:
  type="image_url"  → "image"
  type="input_audio" → "audio"
  // video 目前无标准 OpenAI block type，暂不检测
```

### Anthropic 格式（api_type = anthropic）

```
messages[].content:
  type="image"       → "image"
  type="tool_result" → 检查 content[].type:
  "image"          → "image"
  // Anthropic 无标准 audio/video content block，不检测 audio/video
```

### Responses API 格式（api_type = openai-responses）

```
input[]:
  type="input_image"  → "image"
  type="input_audio"  → "audio"
  message.content[]:
  type="input_image"  → "image"
```

### 边界条件

- `body` 无 `messages` 字段或 `messages` 为空数组 → 返回空集合
- `body` 无 `input` 字段 → 跳过 Responses API 检测
- 同一请求包含 image + audio → 返回包含两种模态的集合
- Anthropic 格式不检测 audio/video（API 无标准 content block type）

## computeModalityRedirectTargets() 决策流程

完整签名：
```typescript
export function computeModalityRedirectTargets(
  db: Database.Database,
  targets: Target[],
  clientModel: string,
  body: Record<string, unknown>,
  snapshot: PipelineSnapshot,
): Target[]
```

```
输入: db, targets, clientModel, body, snapshot

1. targets 为空 → 返回空列表
2. detectModalities(body) → modalities
   modalities 为空 → 记录 snapshot(triggered:false, reason:"no-multimodal-detected") → 返回原 targets
3. 检查首 target 的 capabilities（通过 lookupCapabilities）
   首 target 的 capabilities 包含所有 detected modalities → 记录 snapshot(triggered:false, reason:"first-target-supports-all-modalities") → 返回原 targets
4. 查找 mapping group 的 multimodal_fallback 配置
   无 group → 记录 snapshot(triggered:false, reason:"no-mapping-group") → 返回原 targets
   rule JSON 解析失败 → 记录 snapshot(triggered:false, reason:"rule-parse-error") → 返回原 targets
   无 multimodal_fallback 字段 → 记录 snapshot(triggered:false, reason:"no-multimodal-fallback-configured") → 返回原 targets
   multimodal_fallback 字段类型错误 → 记录 snapshot(triggered:false, reason:"invalid-fallback-config") → 返回原 targets
5. 检查 fallback provider 可用性
   provider 不存在或 inactive → 记录 snapshot(triggered:false, reason:"fallback-provider-unavailable") → 返回原 targets
6. 检查 fallback 模型 capabilities（新增行为）
   fallback 模型的 capabilities 不包含所有缺失的模态 → 记录 snapshot(triggered:false, reason:"fallback-missing-modality") → 返回原 targets
7. prepend fallback target
   记录 snapshot(triggered:true, reason:"first-target-lacks-modality", detected_modalities, redirect_to)
   返回 [fallbackTarget, ...targets]
8. catch-all: 内部异常 → 记录 snapshot(triggered:false, reason:"internal-error") → 返回原 targets
```

### reason 映射表（旧 → 新）

| 旧 reason（image-redirect） | 新 reason（modality-redirect） | 说明 |
|-----|-----|------|
| `no-image-detected` | `no-multimodal-detected` | 检测函数返回空集合 |
| `first-target-already-supports-image` | `first-target-supports-all-modalities` | 首 target 覆盖所有模态 |
| `no-mapping-group` | `no-mapping-group` | 不变 |
| `rule-parse-error` | `rule-parse-error` | 不变 |
| `no-image-fallback-configured` | `no-multimodal-fallback-configured` | 字段名变更 |
| `invalid-fallback-config` | `invalid-fallback-config` | 不变 |
| `fallback-provider-unavailable` | `fallback-provider-unavailable` | 不变，provider 不存在或 inactive |
| *(新增)* | `fallback-missing-modality` | **新行为**：fallback 模型不支持缺失模态 |
| `first-target-lacks-image-capability` | `first-target-lacks-modality` | 成功 redirect |
| `internal-error` | `internal-error` | 不变 |

**注意**：步骤 6（`fallback-missing-modality`）是**新增行为**。当前代码只检查 fallback provider 是否 active，不检查其 capabilities。新增此检查后，如果 fallback 模型也不支持请求中的模态，不会 redirect（避免无效的 fallback）。

## 前端 Alert 提示内容

配置 multimodal fallback 后显示的警告（zh-CN）：

```
⚠ 注意：一旦请求中包含图片、音频或视频，整个会话将持续路由到 fallback 模型。

原因：客户端每轮发送完整对话历史，历史中的多媒体内容会持续触发重定向，即使后续消息为纯文本。

恢复方式：客户端执行 compact（压缩历史）或开启新会话后，将自动回到原始模型。

建议：选择与原始模型价位相近的 fallback 模型，避免成本差异过大。
```

## MODEL_CAPABILITIES 数据扩展

以下模型需要在 `router/src/config/model-context.ts` 的 `MODEL_CAPABILITIES` 中增加模态标记：

| 模型 | 当前 | 新值 | 依据 |
|------|------|------|------|
| `kimi-k2.6` | `["text", "image"]` | `["text", "image", "video"]` | model-directory.json 确认 |
| `kimi-k2.5` | `["text", "image"]` | `["text", "image", "video"]` | model-directory.json 确认 |
| `qwen3.5-plus` | `["text", "image"]` | `["text", "image", "video"]` | model-directory.json 确认 |
| `qwen3.6-plus` | `["text", "image"]` | `["text", "image", "video"]` | model-directory.json 确认 |
| `doubao-seed-2-0-pro-260215` | `["text", "image"]` | `["text", "image", "video"]` | model-directory.json 确认 |
| `mimo-v2-omni` | `["text", "image"]` | `["text", "image", "audio", "video"]` | model-directory.json 确认（全模态） |
| `mimo-v2.5` | `["text", "image"]` | `["text", "image", "audio", "video"]` | model-directory.json 确认（全模态） |
| `glm-5v-turbo` | `["text", "image"]` | `["text", "image", "audio", "video"]` | model-directory.json 确认（zhipu provider） |

**不修改的模型**（provider-dependent，不在白名单中标记）：
- `gemini-2.5-pro` / `gemini-2.5-flash`：标准 API 支持 audio/video，但通过不同 provider 的 OpenAI 兼容端点行为不一致。用户可在 provider 配置中手动添加。
- `gpt-4o`：audio 通过 `input_audio` content type 支持，但标准 `image_url` 场景不需要。用户可手动添加。
- `claude-*`：仅支持 image，不支持 audio/video。

## 验收标准

| AC | 描述 | 类型 | 验证方式 |
|----|------|------|----------|
| AC1 | `detectModalities()` 正确检测 OpenAI `image_url` block → 返回包含 `"image"` 的 Set | 重命名 | 单元测试 |
| AC2 | `detectModalities()` 正确检测 Anthropic `image` block（含 `tool_result.content[]` 内嵌） → 返回包含 `"image"` 的 Set | 重命名 | 单元测试 |
| AC3 | `detectModalities()` 正确检测 Responses API `input_image` → 返回包含 `"image"` 的 Set | 重命名 | 单元测试 |
| AC4 | `detectModalities()` 正确检测 OpenAI `input_audio` block → 返回包含 `"audio"` 的 Set | 新增 | 单元测试 |
| AC5 | `detectModalities({})` 返回空 Set；`detectModalities({ messages: [] })` 返回空 Set | 重命名 | 单元测试 |
| AC6 | `detectModalities()` 对混合 image + audio 请求返回包含 `"image"` 和 `"audio"` 的 Set | 新增 | 单元测试 |
| AC7 | 首 target 支持所有 detected modalities → 不 redirect，reason `"first-target-supports-all-modalities"` | 重命名 | 单元测试 |
| AC8 | 首 target 不支持 image → redirect 到 multimodal_fallback，reason `"first-target-lacks-modality"` | 重命名 | 单元测试 |
| AC9 | multimodal_fallback 未配置 → 不 redirect，reason `"no-multimodal-fallback-configured"` | 重命名 | 单元测试 |
| AC10 | fallback 模型不支持缺失模态 → 不 redirect，reason `"fallback-missing-modality"` | **新增** | 单元测试 |
| AC11 | fallback 模型支持所有缺失模态 → redirect 成功 | **新增** | 单元测试 |
| AC12 | fallback provider inactive → 不 redirect，reason `"fallback-provider-unavailable"` | 回归 | 单元测试 |
| AC13 | 无 mapping group → 不 redirect，reason `"no-mapping-group"` | 回归 | 单元测试 |
| AC14 | rule JSON 解析失败 → 不 redirect，reason `"rule-parse-error"` | 回归 | 单元测试 |
| AC15 | 内部异常 → 返回原始 targets 不崩溃，reason `"internal-error"` | 回归 | 单元测试 |
| AC16 | pipeline snapshot stage 名为 `"modality-redirect"`，triggered 时包含 `detected_modalities` 字段 | 重命名 | 集成测试 |
| AC17 | admin `multimodal_fallback` 校验：provider_id 必填、provider 存在且 active、backend_model 在 models 列表中 | 重命名 | API 测试 |
| AC18 | 前端 ModelMappingCard 配置 multimodal fallback 时显示 Alert 警告 | 新增 | 手动验证 |
| AC19 | 前端 capabilities 切换泛化为 `toggleModelCapability()`，支持 image/audio/video | 新增 | 手动验证 |
| AC20 | 全部测试通过（tsc + vitest + eslint） | — | CI |
| AC21 | 旧 `image_fallback` / `image-redirect` / `ImageFallback` 引用全部清理 | — | grep 验证 |

## 文件变更清单

### 后端（router/src/）

| 文件 | 操作 |
|------|------|
| `src/proxy/routing/image-redirect.ts` | **重命名** → `modality-redirect.ts`；`hasImage()` → `detectModalities()` 返回 `Set<string>`；`supportsImage()` → `supportsModality()`；`computeImageRedirectTargets` → `computeModalityRedirectTargets`；`rule.image_fallback` → `rule.multimodal_fallback`；新增步骤 6（fallback capabilities 检查） |
| `src/proxy/handler/failover-loop.ts` | L23 import 路径 + 函数名；L233 调用名 |
| `src/proxy/pipeline-snapshot.ts` | L7 stage 名 `"image-redirect"` → `"modality-redirect"`；类型增加 `detected_modalities?: string[]` |
| `src/admin/groups.ts` | L86-107 `image_fallback` → `multimodal_fallback` 校验字段名 + 错误消息 |
| `src/config/model-context.ts` | 部分模型加 `"audio"` / `"video"`（见上方数据扩展表） |

### 前端（frontend/src/）

| 文件 | 操作 |
|------|------|
| `types/mapping.ts` | `ImageFallback` → `MultimodalFallback`；`image_fallback` → `multimodal_fallback` |
| `components/mappings/ModelMappingCard.vue` | 重命名引用 + 加 Alert 警告组件 |
| `components/quick-setup/types.ts` | 类型重命名 |
| `views/ModelMappings.vue` | L136-158 字段名 `image_fallback` → `multimodal_fallback` |
| `views/Providers.vue` | `@toggle-model-image-capability` → `@toggle-model-capability` |
| `views/QuickSetup.vue` | `toggleModelImageCapability` → `toggleModelCapability` |
| `composables/useProviderForm.ts` | `toggleModelImageCapability()` → `toggleModelCapability(index, capability)` 泛化为支持任意模态 |
| `components/providers/ModelCapabilitiesEditor.vue` | 事件名 + 传递 `capability` 参数 |
| `components/quick-setup/ModelCard.vue` | 事件名 + 传递 `capability` 参数；增加 audio/video checkbox |
| `i18n/locales/zh-CN/mappings.json` | `imageFallback.*` → `multimodalFallback.*` |
| `i18n/locales/en/mappings.json` | 同上 |
| `i18n/locales/zh-CN/providers.json` | capabilities 加 `"audio": "音频"` 和 `"video": "视频"` |
| `i18n/locales/en/providers.json` | capabilities 加 `"audio": "Audio"` 和 `"video": "Video"` |

### 测试（router/tests/）

| 文件 | 操作 |
|------|------|
| `tests/image-redirect.test.ts` | **重命名** → `modality-redirect.test.ts`；所有函数名/字段名/stage 名替换 |
| `tests/failover-loop-layered.test.ts` | `image-redirect` → `modality-redirect`；`image_fallback` → `multimodal_fallback` |
| `tests/admin-groups-validation.test.ts` | `image_fallback` → `multimodal_fallback` |
| `tests/pipeline-snapshot.test.ts` | `image-redirect` → `modality-redirect` |
