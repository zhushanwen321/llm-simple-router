# Spec 评审 v2

## 评审记录
- 评审时间：2026-05-16 23:30
- 评审类型：Spec 独立评审（第 2 轮）
- 评审对象：`.xyz-harness/2026-05-16-modality-redirect/spec.md`
- 评审轮次：第 2 轮

## v1 问题修复验证

| # | v1 问题描述 | 修复状态 | 说明 |
|---|------------|---------|------|
| 1 | 文件路径缺少 `router/` 前缀 | 已修复 | 全文后端文件路径已加 `router/` 前缀 |
| 2 | 决策流程遗漏 reason 分支 | 已修复 | 新增完整的 reason 映射表（旧→新，10 行），所有 reason 分支已覆盖 |
| 3 | AC 缺少 fallback capabilities 匹配正向路径 | 已修复 | AC10（fallback 不支持→不 redirect）+ AC11（fallback 支持→redirect 成功）拆分明确，类型列标注"新增" |
| 4 | 无异常安全路径 AC | 已修复 | AC15 覆盖内部异常 → 返回原始 targets |
| 5 | detectModalities 边界条件 AC 缺失 | 已修复 | AC5 覆盖空 body/空 messages；AC6 覆盖混合模态 |
| 6 | StageRecord 类型缺 detected_modalities 字段 | 已修复 | 行为约束 > Always 中给出完整类型定义（含 `detected_modalities?: string[]`） |
| 7 | useProviderForm.ts 变更描述不准确 | 已修复 | 文件变更清单明确写 `toggleModelImageCapability()` → `toggleModelCapability(index, capability)` 泛化 |
| 8 | fallback-provider-unavailable vs fallback-missing-modality 未区分 | 已修复 | 决策流程步骤 5（provider 不可用）和步骤 6（capabilities 不匹配）明确分离，各有独立 reason |
| 9 | 函数签名遗漏 db 参数 | 已修复 | `computeModalityRedirectTargets` 完整签名已包含 `db: Database.Database` |
| 10 | MODEL_CAPABILITIES 扩展范围不明确 | 已修复 | 新增独立章节"MODEL_CAPABILITIES 数据扩展"，列出 8 个具体模型 + 修改前后值 + 依据，以及"不修改的模型"及原因 |

**结论：v1 的 10 条 required-fix 全部已修复。**

---

## 六要素覆盖矩阵

| 要素 | 覆盖状态 | 说明 |
|------|---------|------|
| Outcomes | ✅ | 目标章节清晰：IR 层支持 image/audio/video 三种模态检测与 fallback 路由，语义扩展+重命名 |
| Scope boundaries | ✅ | In-scope 12 项 + Out-of-scope 5 项，边界明确。out-of-scope 列出了 session 粘性、图片剥离、per-modality fallback、capabilities UI 重设计、API 格式转换 |
| Constraints | ✅ | 数据格式（capabilities 值域、multimodal_fallback 结构、无 DB migration）、向后兼容（不兼容）、行为不变量（MRL 层执行时机、异常安全、遍历所有 messages） |
| Decisions made | ✅ | D1-D6 共 6 个决策，每个有理由。D3（单一 fallback target）的理由是"85% 的多模态模型只支持 image+text" |
| Verification | ✅ | AC1-AC21 共 21 条，覆盖正向/边界/异常/回归路径，每条标注类型（重命名/新增/回归）和验证方式 |
| 已有基础设施 | ✅ | 表格列出了 10 个组件 + 位置 + 复用方式 |

---

## 自包含性检查

### 文件路径完整性

后端文件路径已统一加 `router/` 前缀（如 `router/src/proxy/routing/image-redirect.ts`）。前端文件路径以 `frontend/` 开头。测试文件路径以 `router/tests/` 开头。全部路径与代码库实际结构一致。✅

### 函数签名明确

| 函数 | spec 中签名 | 代码库实际 | 一致性 |
|------|-----------|-----------|--------|
| `detectModalities(body)` | `(body: Record<string, unknown>): Set<string>` | 当前 `hasImage(body: Record<string, unknown>): boolean`，返回类型改为 Set | ✅ 签名为新设计 |
| `computeModalityRedirectTargets` | `(db: Database.Database, targets: Target[], clientModel: string, body: Record<string, unknown>, snapshot: PipelineSnapshot): Target[]` | 当前 `computeImageRedirectTargets(db, targets, clientModel, body, snapshot): Target[]` | ✅ 参数列表一致 |
| `lookupCapabilities(modelName)` | `lookupCapabilities(modelName: string): string[]` | 代码中 `export function lookupCapabilities(modelName: string): string[]` | ✅ |
| `toggleModelCapability(index, capability)` | 新函数，泛化自 `toggleModelImageCapability(index: number)` | 当前代码 `toggleModelImageCapability(index: number)` | ✅ 为新设计 |

### 接口/类型定义位置

| 类型 | spec 描述 | 代码库实际位置 | 一致性 |
|------|----------|--------------|--------|
| `StageRecord` "modality-redirect" 变体 | spec 行为约束中给出完整类型定义 | 当前在 `router/src/proxy/pipeline-snapshot.ts` | ✅ spec 给出了完整新类型 |
| `ImageFallback` → `MultimodalFallback` | `{ provider_id: string, backend_model: string }` | 当前 `frontend/src/types/mapping.ts` 中 `ImageFallback` 接口字段一致 | ✅ |
| `Rule.image_fallback` → `Rule.multimodal_fallback` | `frontend/src/types/mapping.ts` | 当前 `Rule` 接口含 `image_fallback?: ImageFallback` | ✅ |

### 无隐含知识

- `lookupCapabilities` 的优先级链（显式配置 > model-directory > 硬编码 > `["text"]`）在 spec 已有基础设施表中引用了 CLAUDE.md 中的描述，Phase 2 agent 可从 CLAUDE.md 获取完整上下文。✅
- `parseModels()` 的 capabilities 合并逻辑：spec 提到"通过 `lookupCapabilities` 查询"，未展开 `parseModels` 的内部合并。这不会阻塞 Phase 2 agent，因为 lookupCapabilities 是公开 API。✅

### 无模糊引用

spec 中引用的文件路径、函数名、字段名均具体明确。✅

---

## 必填章节覆盖

| 章节 | 存在 | 内容充分 |
|------|------|---------|
| 目标 | ✅ | 一段话说清楚：泛化 IR 层支持 image/audio/video |
| 已做决策 | ✅ | D1-D6 表格，每项有理由 |
| 行为约束 | ✅ | Always（5 条）+ Never（3 条），含 StageRecord 完整类型定义 |
| 已有基础设施 | ✅ | 10 个组件表格，位置 + 复用方式 |
| 验收标准 | ✅ | AC1-AC21，21 条标准，每条有类型和验证方式 |
| 数据流（条件性） | N/A | 无新数据存储，仅 JSON 字段重命名 |

---

## 歧义标记检查

- 无未解决的 `[AMBIGUOUS]` 标记。✅
- 隐含歧义扫描：未发现需要用户确认但未标记的歧义项。✅

---

## 类型签名正确性抽查

| 抽查项 | spec 中描述 | 代码库实际 | 一致性 |
|--------|-----------|-----------|--------|
| `StageRecord` image-redirect 变体现有字段 | spec reason 映射表列出 `no-image-detected` 等 10 个 reason | 代码中有 `no-image-detected`, `first-target-already-supports-image`, `no-mapping-group`, `rule-parse-error`, `no-image-fallback-configured`, `invalid-fallback-config`, `fallback-provider-unavailable`, `first-target-lacks-image-capability`, `internal-error` 共 9 个 | ✅ 映射表覆盖了代码中全部 9 个旧 reason + 1 个新增 reason |
| `groups.ts` validateRule 中 image_fallback 校验 | spec 文件变更清单说 L86-107 `image_fallback` → `multimodal_fallback` 校验 | 代码中 validateRule 确实在 ~L107 开始校验 `image_fallback`，包括 provider 存在/active/model 存在 | ✅ |
| `failover-loop.ts` L23 import + L233 调用 | spec 文件变更清单写 L23 import 路径 + 函数名；L233 调用名 | 代码中 L23 是 `import { computeImageRedirectTargets } from "../routing/image-redirect.js"`，L233 是调用 | ✅ |
| `useProviderForm.ts` `toggleModelImageCapability(index)` | spec 写泛化为 `toggleModelCapability(index, capability)` | 代码中函数签名 `toggleModelImageCapability(index: number)`，内部硬编码 `"image"` capability 切换 | ✅ spec 准确描述了需要泛化 |

---

## 验收标准质量检查

### 可量化性

AC1-AC15 为单元测试/集成测试/API 测试，均可写自动化测试验证。AC18-AC19 标注为"手动验证"（前端 UI 行为），在当前项目测试框架下是合理的。AC20（全量 CI 通过）、AC21（grep 验证）均可量化。✅

### 完整性

| 路径类型 | 覆盖的 AC | 缺口 |
|---------|----------|------|
| detectModalities 正向（OpenAI image） | AC1 | — |
| detectModalities 正向（Anthropic image + tool_result） | AC2 | — |
| detectModalities 正向（Responses API image） | AC3 | — |
| detectModalities 正向（OpenAI audio） | AC4 | — |
| detectModalities 边界（空 body/空 messages） | AC5 | — |
| detectModalities 边界（混合模态） | AC6 | — |
| redirect 不触发（首 target 支持所有模态） | AC7 | — |
| redirect 触发（首 target 不支持） | AC8 | — |
| redirect 不触发（无 fallback 配置） | AC9 | — |
| redirect 不触发（fallback 不支持缺失模态） | AC10 | — |
| redirect 触发（fallback 支持所有缺失模态） | AC11 | — |
| redirect 不触发（fallback provider inactive） | AC12 | — |
| redirect 不触发（无 mapping group） | AC13 | — |
| redirect 不触发（rule 解析失败） | AC14 | — |
| redirect 不触发（内部异常） | AC15 | — |
| pipeline snapshot 格式 | AC16 | — |
| admin 校验 | AC17 | — |
| 前端 Alert | AC18 | — |
| 前端 capabilities 切换 | AC19 | — |
| 全量 CI | AC20 | — |
| 旧引用清理 | AC21 | — |

**覆盖完整。** 正向路径、边界条件、异常路径、回归路径全部覆盖。

### 可追溯性

每个 AC 可追溯到 spec 中的具体需求描述（决策流程步骤或检测规则表）。AC 类型标注（重命名/新增/回归）帮助区分行为变更级别。✅

---

## 行为正确性审查

### detectModalities() 检测规则

对照代码中 `hasImage()` 的实际检测逻辑：

| 格式 | spec 检测规则 | 代码 hasImage() 实际检测 | 一致性 |
|------|-------------|------------------------|--------|
| OpenAI `image_url` | `"image"` | `t === "image_url"` → true | ✅ |
| OpenAI `input_audio` | `"audio"` | 当前代码不检测 | ✅ 新增 |
| Anthropic `image` | `"image"` | `t === "image"` → true | ✅ |
| Anthropic `tool_result` 内嵌 `image` | `"image"` | `t === "tool_result"` → 检查 inner content | ✅ |
| Responses API `input_image` | `"image"` | `rec.type === "input_image"` → true | ✅ |
| Responses API message.content `input_image` | `"image"` | `content` 数组中检查 `input_image` | ✅ |

spec 的检测规则表与代码逻辑一致，新增 `input_audio` → `"audio"` 是合理的扩展。

### computeModalityRedirectTargets() 决策流程

对照代码中 `computeImageRedirectTargets()` 的实际逻辑：

| 步骤 | spec 描述 | 代码实际行为 | 一致性 |
|------|----------|------------|--------|
| 1 | targets 为空 → 返回空 | `if (targets.length === 0) return targets` | ✅ |
| 2 | detectModalities 为空 → 不 redirect | `if (!hasImage(body))` → no-image-detected | ✅ |
| 3 | 首 target capabilities 包含所有模态 → 不 redirect | `supportsImage(entry.capabilities)` → first-target-already-supports-image | ✅（泛化为检查所有模态） |
| 4 | 查 mapping group | `getMappingGroup(db, clientModel)` | ✅ |
| 5 | fallback provider 不存在/inactive | `getProviderById(db, fbProviderId)` + `is_active !== 1` | ✅ |
| 6 | fallback 模型 capabilities 检查 | **新增**，代码中不存在 | ✅ 明确标注为新增行为 |
| 7 | prepend fallback | 构造 fbTarget 并 prepend | ✅ |
| 8 | catch-all | try-catch 返回 targets | ✅ |

### 关键行为变更

spec 明确标注了步骤 6（`fallback-missing-modality`）为**新增行为**，当前代码只检查 provider 是否 active，不检查 capabilities。这个新行为的理由在 reason 映射表下方有说明："避免无效的 fallback"。行为合理。

---

## 发现的问题

无 required-fix 问题。

| # | 优先级 | 维度 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|------|---------|
| 1 | LOW | 自包含性 | §文件变更清单 > 前端 | `ModelCapabilitiesEditor.vue` 变更描述仅写"事件名 + 传递 `capability` 参数"，但实际还需要增加 audio/video 的 Checkbox UI。文件变更清单中对 `ModelCard.vue` 有较详细描述（"增加 audio/video checkbox"），但 `ModelCapabilitiesEditor.vue` 的描述偏简略 | 建议：ModelCapabilitiesEditor.vue 的操作列补充"传递 capability 参数（从硬编码 image 改为参数化）" |
| 2 | LOW | 自包含性 | §前端 Alert 提示内容 | Alert 内容使用了 Unicode 符号 "⚠" 而非 lucide-vue-next 图标，但 CLAUDE.md 全局规范和项目规则都要求"禁止使用 Emoji，使用 lucide-vue-next 图标"。不过 ⚠ 是 Unicode 符号不是 Emoji，具体是否违规取决于 vue_rules_checker.py 的检查逻辑 | 建议：Phase 2 实现时用 `<AlertTriangle>` 图标替代 Unicode 符号，或在 spec 中明确使用 lucide AlertTriangle |
| 3 | LOW | 验收标准 | AC18, AC19 | AC18（前端 Alert）和 AC19（前端 capabilities 切换）标注为"手动验证"。当前项目前端无 E2E 测试框架，手动验证是合理的降级方案 | 无需修改，仅记录 |

> 优先级定义：
> - **required-fix**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

---

## 结论

**通过**

## Summary

Spec 评审完成，第 2 轮，0 条 required-fix，3 条 LOW，通过。v1 的 10 条 required-fix 全部已修复。spec 文档结构完整，六要素覆盖充分，决策流程与代码库实际行为一致，AC 覆盖正向/边界/异常/回归全路径。
