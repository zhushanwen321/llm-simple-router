# Backend Implementation Plan: Modality Redirect

## 概述

将 image-only 的 IR 层泛化为多模态重定向层（MRL）。核心改动分三类：
1. **重命名**：文件名、函数名、字段名、stage 名、reason 字符串
2. **语义扩展**：`hasImage()` → `detectModalities()` 支持 audio/video 检测
3. **新增行为**：fallback 模型 capabilities 检查（决策流程步骤 6）

## 任务依赖关系

```
T1 (pipeline-snapshot 类型)
  ↓
T2 (modality-redirect 核心文件) ← 依赖 T1 的类型定义
  ↓
T3 (failover-loop 调用方更新) ← 依赖 T2 的导出接口
  ↓
T4 (admin 校验) ← 独立，可与 T2 并行
  ↓
T5 (MODEL_CAPABILITIES 数据) ← 独立，可与任何任务并行
  ↓
T6 (测试更新) ← 依赖 T1-T5 全部完成
```

---

## T1: 更新 PipelineSnapshot StageRecord 类型

**描述**：在 `pipeline-snapshot.ts` 中将 `image-redirect` 变体替换为 `modality-redirect`，增加 `detected_modalities` 字段。

### 文件变更

| 文件 | 操作 | 详情 |
|------|------|------|
| `router/src/proxy/pipeline-snapshot.ts` | 修改 | 替换 StageRecord 的 image-redirect 变体 |

**具体改动**：

删除：
```typescript
| { stage: "image-redirect"; triggered: boolean; original_model: string; redirect_to: string; redirect_provider: string; reason: string }
```

替换为：
```typescript
| { stage: "modality-redirect"; triggered: boolean; original_model: string; redirect_to: string; redirect_provider: string; reason: string; detected_modalities?: string[] }
```

### 验收标准

- [ ] TypeScript 编译通过（`npx tsc --noEmit`）
- [ ] `stage: "image-redirect"` 在 StageRecord union 中不再存在
- [ ] `detected_modalities` 为可选字段，类型 `string[]`

### 风险点

- **低风险**：纯类型变更。但 StageRecord 被多处使用，编译会立即暴露遗漏。

---

## T2: 重命名 + 重构 modality-redirect 核心文件

**描述**：将 `image-redirect.ts` 重命名为 `modality-redirect.ts`，重写函数签名和实现。这是本次改动的核心任务。

### 文件变更

| 文件 | 操作 | 详情 |
|------|------|------|
| `router/src/proxy/routing/image-redirect.ts` | 重命名 + 重写 | → `modality-redirect.ts` |

### 函数重命名映射

| 旧名 | 新名 | 变更说明 |
|------|------|----------|
| `hasImage(body)` | `detectModalities(body)` | 返回类型 `boolean` → `Set<string>` |
| `supportsImage(capabilities)` | `supportsModality(capabilities, modality)` | 新增 `modality` 参数 |
| `computeImageRedirectTargets(...)` | `computeModalityRedirectTargets(...)` | 同签名，内部逻辑扩展 |

### detectModalities() 实现逻辑

遍历 `body.messages` 和 `body.input`，返回 `Set<string>`：

**OpenAI 格式**（messages[].content 数组）：
- `type === "image_url"` → `"image"`
- `type === "input_audio"` → `"audio"`

**Anthropic 格式**（messages[].content 数组）：
- `type === "image"` → `"image"`
- `type === "tool_result"` → 递归检查 `content[]` 中的 `type === "image"` → `"image"`

**Responses API 格式**（input[] 数组）：
- 顶层 `type === "input_image"` → `"image"`
- 顶层 `type === "input_audio"` → `"audio"`
- `message.content[]` 中 `type === "input_image"` → `"image"`

### computeModalityRedirectTargets() 决策流程

```
1. targets 为空 → 返回 []
2. detectModalities(body) → modalities
   空 → snapshot(triggered:false, reason:"no-multimodal-detected") → 返回原 targets
3. 检查首 target capabilities（lookupCapabilities）
   首 target 包含所有 detected modalities → snapshot(triggered:false, reason:"first-target-supports-all-modalities") → 返回原 targets
4. 查找 mapping group 的 multimodal_fallback
   无 group → snapshot(triggered:false, reason:"no-mapping-group") → 返回原 targets
   rule 解析失败 → snapshot(triggered:false, reason:"rule-parse-error") → 返回原 targets
   无 multimodal_fallback → snapshot(triggered:false, reason:"no-multimodal-fallback-configured") → 返回原 targets
   配置格式错误 → snapshot(triggered:false, reason:"invalid-fallback-config") → 返回原 targets
5. fallback provider 可用性检查
   不存在或 inactive → snapshot(triggered:false, reason:"fallback-provider-unavailable") → 返回原 targets
6. [新增] 检查 fallback 模型 capabilities
   计算缺失模态: missingModalities = modalities - firstTargetCapabilities
   fallback 模型 capabilities 不包含所有 missingModalities → snapshot(triggered:false, reason:"fallback-missing-modality", detected_modalities) → 返回原 targets
7. prepend fallback target
   snapshot(triggered:true, reason:"first-target-lacks-modality", detected_modalities, redirect_to)
   返回 [fallbackTarget, ...targets]
8. catch-all → snapshot(triggered:false, reason:"internal-error") → 返回原 targets
```

### 步骤 6 的详细设计（新增行为）

这一步是新增的，当前代码只检查 fallback provider 是否 active，不检查其模型是否支持缺失模态。

```typescript
// 伪代码
const missingModalities = [...modalities].filter(
  m => !firstTargetCapabilities.includes(m)
);
const fbCapabilities = lookupCapabilities(fbBackendModel);
const fbMissing = missingModalities.filter(m => !fbCapabilities.includes(m));
if (fbMissing.length > 0) {
  // fallback 也不支持某些模态，redirect 无意义
  snapshot.add({
  stage: "modality-redirect", triggered: false,
  original_model: firstTarget.backend_model,
  redirect_to: fbBackendModel, redirect_provider: fbProviderId,
  reason: "fallback-missing-modality",
  detected_modalities: [...modalities],
  });
  return targets;
}
```

**设计理由**：当前代码假设配置了 image_fallback 的模型一定支持 image。扩展到多模态后，fallback 模型可能只支持 image 但不支持 audio。如果请求包含 audio，redirect 到一个也不支持 audio 的模型是无效的。

### supportsModality() 实现

```typescript
function supportsModality(capabilities: string[] | undefined, modality: string): boolean {
  return Array.isArray(capabilities) && capabilities.includes(modality);
}
```

改为检查单个模态，上层循环检查所有缺失模态。

### 首 target capabilities 检查逻辑变更

旧逻辑：只检查首 target 是否支持 image。
新逻辑：检查首 target 的 capabilities 是否包含 **所有** detected modalities。

```typescript
// 旧
if (entry && supportsImage(entry.capabilities)) { ... }

// 新
const firstTargetCapabilities = entry?.capabilities ?? lookupCapabilities(firstTarget.backend_model);
const allSupported = [...modalities].every(m => supportsModality(firstTargetCapabilities, m));
if (allSupported) { ... }
```

### 验收标准

- [ ] `detectModalities({})` 返回空 Set
- [ ] `detectModalities({ messages: [] })` 返回空 Set
- [ ] OpenAI `image_url` block 检测 → Set 含 `"image"`
- [ ] OpenAI `input_audio` block 检测 → Set 含 `"audio"`
- [ ] Anthropic `image` block 检测 → Set 含 `"image"`
- [ ] Anthropic `tool_result.content[].type === "image"` 检测 → Set 含 `"image"`
- [ ] Responses API `input_image` 检测 → Set 含 `"image"`
- [ ] Responses API `input_audio` 检测 → Set 含 `"audio"`
- [ ] 混合 image + audio 请求 → Set 含 `"image"` 和 `"audio"`
- [ ] 首 target 支持所有 detected modalities → 不 redirect，reason `"first-target-supports-all-modalities"`
- [ ] 首 target 不支持 image → redirect，reason `"first-target-lacks-modality"`
- [ ] multimodal_fallback 未配置 → 不 redirect，reason `"no-multimodal-fallback-configured"`
- [ ] **[新增]** fallback 模型不支持缺失模态 → 不 redirect，reason `"fallback-missing-modality"`
- [ ] **[新增]** fallback 模型支持所有缺失模态 → redirect 成功
- [ ] fallback provider inactive → 不 redirect，reason `"fallback-provider-unavailable"`
- [ ] 无 mapping group → 不 redirect，reason `"no-mapping-group"`
- [ ] rule JSON 解析失败 → 不 redirect，reason `"rule-parse-error"`
- [ ] 内部异常 → 返回原始 targets，reason `"internal-error"`
- [ ] 所有 snapshot 的 stage 名为 `"modality-redirect"`
- [ ] triggered=true 时 snapshot 包含 `detected_modalities` 字段
- [ ] `rule.image_fallback` → `rule.multimodal_fallback`

### 风险点

- **中风险**：`detectModalities()` 返回 `Set<string>` 是 breaking change，所有调用方（目前只有 `computeModalityRedirectTargets`）需要适配。但因为 `hasImage()` 只在内部使用，影响范围可控。
- **低风险**：步骤 6 是新增的纯检查逻辑，不影响已有路径（image-only 场景下 fallback 模型一定支持 image，新检查会通过）。
- **需注意**：`detected_modalities` 字段在 snapshot 中是可选的（`triggered=false` 时可能没有），但 spec 要求 `triggered=true` 时必填。实现时在 triggered=true 路径确保赋值。

---

## T3: 更新 failover-loop.ts 调用方

**描述**：更新 failover-loop 中对 IR 层的 import 和调用。

### 文件变更

| 文件 | 操作 | 详情 |
|------|------|------|
| `router/src/proxy/handler/failover-loop.ts` | 修改 | import 路径 + 函数名替换 |

**具体改动**：

L23 import：
```typescript
// 旧
import { computeImageRedirectTargets } from "../routing/image-redirect.js";
// 新
import { computeModalityRedirectTargets } from "../routing/modality-redirect.js";
```

L233 调用：
```typescript
// 旧
allTargets = computeImageRedirectTargets(db, allTargets, clientModel, ctx.body, precomputeSnapshot);
// 新
allTargets = computeModalityRedirectTargets(db, allTargets, clientModel, ctx.body, precomputeSnapshot);
```

注释更新（L10 附近）：
```
// - image-redirect stage → modality-redirect stage
```

### 验收标准

- [ ] TypeScript 编译通过
- [ ] 无残留的 `image-redirect` 引用（`grep -rn "image-redirect" router/src/` 应无结果，排除 node_modules）

### 风险点

- **极低风险**：纯机械替换，函数签名完全相同。

---

## T4: 更新 admin groups.ts 校验

**描述**：将 `validateRule()` 中的 `image_fallback` 校验字段改为 `multimodal_fallback`，错误消息同步更新。

### 文件变更

| 文件 | 操作 | 详情 |
|------|------|------|
| `router/src/admin/groups.ts` | 修改 | 字段名 + 错误消息 |

**具体改动**：

L86-107 区域：
```typescript
// 旧
const fallback = (r as Record<string, unknown>).image_fallback;
// 新
const fallback = (r as Record<string, unknown>).multimodal_fallback;

// 错误消息
// 旧: "image_fallback: provider_id is required"
// 新: "multimodal_fallback: provider_id is required"
// 旧: "image_fallback: backend_model is required"
// 新: "multimodal_fallback: backend_model is required"
// 旧: `image_fallback: provider_id '...' not found`
// 新: `multimodal_fallback: provider_id '...' not found`
// 旧: `image_fallback: provider '...' is not active`
// 新: `multimodal_fallback: provider '...' is not active`
// 旧: `image_fallback: backend_model '...' not found in provider '...' models list`
// 新: `multimodal_fallback: backend_model '...' not found in provider '...' models list`
```

注释更新：
```typescript
// 旧: // Validate image_fallback if present
// 新: // Validate multimodal_fallback if present
```

### 验收标准

- [ ] `multimodal_fallback` 校验：provider_id 必填、provider 存在且 active、backend_model 在 models 列表中
- [ ] 错误消息包含 `multimodal_fallback`（不包含 `image_fallback`）
- [ ] 无 `multimodal_fallback` 字段时校验通过（向后兼容）

### 风险点

- **低风险**：校验逻辑不变，只是字段名和消息文本替换。但需注意测试数据中的 `image_fallback` 也要改为 `multimodal_fallback`。

---

## T5: 扩展 MODEL_CAPABILITIES 数据

**描述**：在 `model-context.ts` 的 `MODEL_CAPABILITIES` 中为指定模型增加 `"audio"` / `"video"` 能力标记。

### 文件变更

| 文件 | 操作 | 详情 |
|------|------|------|
| `router/src/config/model-context.ts` | 修改 | MODEL_CAPABILITIES 值更新 |

**具体改动**：

| 模型 | 当前值 | 新值 |
|------|--------|------|
| `kimi-k2.6` | `["text", "image"]` | `["text", "image", "video"]` |
| `kimi-k2.5` | `["text", "image"]` | `["text", "image", "video"]` |
| `qwen3.5-plus` | `["text", "image"]` | `["text", "image", "video"]` |
| `qwen3.6-plus` | `["text", "image"]` | `["text", "image", "video"]` |
| `doubao-seed-2-0-pro-260215` | `["text", "image"]` | `["text", "image", "video"]` |
| `mimo-v2-omni` | `["text", "image"]` | `["text", "image", "audio", "video"]` |
| `mimo-v2.5` | `["text", "image"]` | `["text", "image", "audio", "video"]` |
| `glm-5v-turbo` | `["text", "image"]` | `["text", "image", "audio", "video"]` |

### 验收标准

- [ ] 8 个模型的 capabilities 按上表更新
- [ ] 其他模型的 capabilities 不变
- [ ] `lookupCapabilities("mimo-v2-omni")` 返回 `["text", "image", "audio", "video"]`
- [ ] `lookupCapabilities("gpt-4o")` 仍返回 `["text", "image"]`（不变）

### 风险点

- **极低风险**：纯数据变更，只影响查询结果。这些模型如果被用于 multimodal_fallback，新增的 capabilities 会使得步骤 6 的检查更宽松（支持更多模态），但这正是期望行为。

---

## T6: 更新所有测试文件

**描述**：将 4 个测试文件中的 `image-redirect` / `image_fallback` 引用全部更新为 `modality-redirect` / `multimodal_fallback`，并新增 `detectModalities()` 和 fallback capabilities 检查的测试。

### 文件变更

| 文件 | 操作 | 详情 |
|------|------|------|
| `router/tests/image-redirect.test.ts` | 重命名 → `modality-redirect.test.ts` + 大量更新 |
| `router/tests/failover-loop-layered.test.ts` | 修改 | 字符串替换 |
| `router/tests/admin-groups-validation.test.ts` | 修改 | 字段名 + 错误消息 |
| `router/tests/pipeline-snapshot.test.ts` | 修改 | stage 名 + 类型 |

### 6-1: modality-redirect.test.ts

**重命名 + 全面更新**：

1. import 路径：`image-redirect.js` → `modality-redirect.js`
2. import 函数名：`computeImageRedirectTargets` → `computeModalityRedirectTargets`，新增 `detectModalities`
3. 所有 `image_fallback` → `multimodal_fallback`（在 mapping group rule 中）
4. 所有 snapshot 断言中 `stage: "image-redirect"` → `stage: "modality-redirect"`
5. 所有 reason 字符串按映射表替换

**新增测试用例**：

| 测试名 | 对应 AC | 说明 |
|--------|---------|------|
| `detectModalities returns empty set for empty body` | AC5 | `detectModalities({})` → 空 Set |
| `detectModalities returns empty set for empty messages` | AC5 | `detectModalities({ messages: [] })` → 空 Set |
| `detectModalities detects OpenAI input_audio` | AC4 | 返回含 `"audio"` 的 Set |
| `detectModalities detects Responses API input_audio` | AC4 | 返回含 `"audio"` 的 Set |
| `detectModalities returns both image and audio for mixed request` | AC6 | 混合请求 → Set 含两种模态 |
| `fallback model lacks audio capability → no redirect` | AC10 | reason: `"fallback-missing-modality"` |
| `fallback model supports all missing modalities → redirect` | AC11 | 成功 redirect |

**修改现有测试用例**：

| 原测试 | 修改点 |
|--------|--------|
| AC1 (prepend fallback) | `image_fallback` → `multimodal_fallback`，reason → `"first-target-lacks-modality"` |
| AC2 (first supports image) | reason → `"first-target-supports-all-modalities"` |
| AC3 (no fallback) | reason → `"no-multimodal-fallback-configured"` |
| AC4 (no image) | reason → `"no-multimodal-detected"` |
| AC7 (inactive provider) | `image_fallback` → `multimodal_fallback` |
| AC8 (non-existent provider) | `image_fallback` → `multimodal_fallback` |
| AC9 (StageRecord) | stage → `"modality-redirect"` |
| AC10 (exception safety) | 不变（异常路径） |
| AC13-AC16 (format detection) | `image_fallback` → `multimodal_fallback` |

### 6-2: failover-loop-layered.test.ts

机械替换，无需新增测试：

| 旧值 | 新值 | 出现次数 |
|------|------|----------|
| `"image-redirect"` | `"modality-redirect"` | ~10 处 |
| `image_fallback` | `multimodal_fallback` | ~5 处 |
| 注释中 `image-redirect` | `modality-redirect` | ~10 处 |

### 6-3: admin-groups-validation.test.ts

| 旧值 | 新值 | 说明 |
|------|------|------|
| `image_fallback` | `multimodal_fallback` | 所有 rule JSON 和断言 |
| 错误消息含 `"image_fallback"` | 错误消息含 `"multimodal_fallback"` | `toContain("multimodal_fallback")` |

测试函数名和描述字符串也需同步更新（如 `"test_validateRule_image_fallback_..."` → `"test_validateRule_multimodal_fallback_..."`）。

### 6-4: pipeline-snapshot.test.ts

| 旧值 | 新值 | 说明 |
|------|------|------|
| `"image-redirect"` | `"modality-redirect"` | 所有 stage 断言 |
| describe 名 `"StageRecord image-redirect variant"` | `"StageRecord modality-redirect variant"` | |

新增断言：验证 `detected_modalities` 字段在 StageRecord 中可赋值。

### 验收标准

- [ ] `router/tests/image-redirect.test.ts` 不再存在
- [ ] `router/tests/modality-redirect.test.ts` 存在且所有测试通过
- [ ] failover-loop-layered.test.ts 全部通过
- [ ] admin-groups-validation.test.ts 全部通过（含 `multimodal_fallback` 字段名）
- [ ] pipeline-snapshot.test.ts 全部通过
- [ ] `grep -rn "image-redirect\|image_fallback" router/tests/` 返回空结果
- [ ] AC1-AC16 所有验收标准有对应测试用例覆盖
- [ ] 新增测试覆盖 AC10（fallback-missing-modality）和 AC11（fallback 支持所有模态）

### 风险点

- **中风险**：测试文件变动最多（~150 行变更），容易遗漏替换。建议先做全局替换，再手动新增测试。
- **需注意**：`admin-groups-validation.test.ts` 中的 `VALID_RULE_WITH_FALLBACK` helper 函数的 `image_fallback` key 也需改为 `multimodal_fallback`。

---

## 全局验证（T7）

所有任务完成后执行：

```bash
# 1. 编译检查
cd router && npx tsc --noEmit

# 2. 全量测试
cd router && npm test

# 3. Lint
cd router && npm run lint

# 4. 旧引用检查
grep -rn "image-redirect\|image_fallback\|hasImage\|supportsImage\|computeImageRedirect" router/src/ router/tests/ --include="*.ts"
```

### 验收标准

- [ ] `tsc --noEmit` 零错误
- [ ] `npm test` 全部通过
- [ ] `npm run lint` 零警告零错误
- [ ] grep 无残留旧引用

---

## AC 覆盖矩阵

| AC | 测试文件 | 测试用例 |
|----|----------|----------|
| AC1 | modality-redirect.test.ts | OpenAI image_url 检测 + redirect |
| AC2 | modality-redirect.test.ts | Anthropic image block 检测 + redirect |
| AC3 | modality-redirect.test.ts | Responses API input_image 检测 + redirect |
| AC4 | modality-redirect.test.ts | `detectModalities()` OpenAI input_audio |
| AC5 | modality-redirect.test.ts | 空body/空messages 返回空Set |
| AC6 | modality-redirect.test.ts | 混合 image+audio 返回双元素Set |
| AC7 | modality-redirect.test.ts | 首target支持所有模态 → 不redirect |
| AC8 | modality-redirect.test.ts | 首target不支持 → redirect |
| AC9 | modality-redirect.test.ts | 无fallback配置 → 不redirect |
| AC10 | modality-redirect.test.ts | **新增**: fallback缺模态 → 不redirect |
| AC11 | modality-redirect.test.ts | **新增**: fallback支持所有模态 → redirect |
| AC12 | modality-redirect.test.ts | fallback provider inactive |
| AC13 | modality-redirect.test.ts | 无mapping group |
| AC14 | modality-redirect.test.ts | rule JSON解析失败 |
| AC15 | modality-redirect.test.ts | 内部异常降级 |
| AC16 | failover-loop-layered.test.ts | 集成测试验证stage名+字段 |
| AC17 | admin-groups-validation.test.ts | API级校验测试 |
| AC20 | CI | tsc + vitest + eslint |
| AC21 | grep验证 | 无残留旧引用 |

## 实现顺序建议

```
阶段 1（并行）: T1, T4, T5 — 类型定义、admin校验、数据扩展互不依赖
阶段 2（串行）: T2 — 核心文件重写，依赖 T1 类型
阶段 3（串行）: T3 — 调用方更新，依赖 T2 导出
阶段 4（串行）: T6 — 测试更新，依赖 T1-T5 全部完成
阶段 5: T7 — 全局验证
```
