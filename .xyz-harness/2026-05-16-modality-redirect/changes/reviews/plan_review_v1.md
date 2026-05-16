# 实现方案评审 v1

## 评审记录
- 评审时间：2026-05-16
- 评审类型：实现方案评审（plan.md + plan-backend.md + plan-frontend.md）
- 评审对象：plan.md（总览）、plan-backend.md（后端详细）、plan-frontend.md（前端详细）
- 评审轮次：第 1 轮

---

## Summary

方案整体质量较高。三个文档（plan.md / plan-backend.md / plan-frontend.md）分工清晰，AC 覆盖矩阵完整映射了 spec 的 21 条验收标准，任务依赖关系正确，文件变更清单与 spec 一致。后端 plan 的 T2 核心任务分析透彻，步骤 6（fallback capabilities 检查）的新增行为伪代码清晰。

发现 3 条 MUST FIX 和 4 条 SUGGESTION。

---

## Completeness Check

### spec 覆盖矩阵

| spec 需求项 | plan 覆盖章节 | 覆盖状态 |
|-------------|-------------|---------|
| 后端路由层重命名 (image-redirect → modality-redirect) | plan.md T2, plan-backend.md T2 | ✅ 完整 |
| 模态检测扩展 (detectModalities) | plan-backend.md T2 | ✅ 完整 |
| fallback 字段重命名 (image_fallback → multimodal_fallback) | plan.md T2/T4, plan-frontend.md F1/F2/F3 | ✅ 完整 |
| pipeline snapshot stage 名更新 | plan.md T1, plan-backend.md T1 | ✅ 完整 |
| admin 校验更新 | plan.md T4, plan-backend.md T4 | ✅ 完整 |
| MODEL_CAPABILITIES 数据扩展 | plan.md T5, plan-backend.md T5 | ✅ 完整 |
| 前端类型/组件重命名 | plan-frontend.md F1 | ✅ 完整 |
| 前端 i18n 更新 | plan-frontend.md F6 | ✅ 完整 |
| 前端 Alert 提示 | plan-frontend.md F2 | ✅ 完整 |
| 前端 capabilities 切换泛化 | plan-frontend.md F4/F5 | ✅ 完整 |
| 测试重命名+更新 | plan.md T6, plan-backend.md T6 | ✅ 完整 |
| 清理旧数据 | plan.md T7, plan-backend.md T7 | ✅ 完整 |
| detectModalities 检测规则 (OpenAI/Anthropic/Responses API) | plan-backend.md T2 | ✅ 完整 |
| computeModalityRedirectTargets 决策流程 (10 个 reason) | plan-backend.md T2 | ⚠️ 部分（见 Issue #1） |
| 前端 Alert 提示内容 | plan-frontend.md F2 | ✅ 完整 |
| AC 覆盖 (AC1-AC21) | plan.md AC 覆盖矩阵 | ⚠️ 部分（见 Issue #2） |

### Reason 映射覆盖（10 个 reason）

| # | 新 reason | plan 覆盖 | 状态 |
|---|-----------|----------|------|
| 1 | `no-multimodal-detected` | plan-backend.md T2 步骤 2 | ✅ |
| 2 | `first-target-supports-all-modalities` | plan-backend.md T2 步骤 3 | ✅ |
| 3 | `no-mapping-group` | plan-backend.md T2 步骤 4 | ✅ |
| 4 | `rule-parse-error` | plan-backend.md T2 步骤 4 | ✅ |
| 5 | `no-multimodal-fallback-configured` | plan-backend.md T2 步骤 4 | ✅ |
| 6 | `invalid-fallback-config` | plan-backend.md T2 步骤 4 | ✅ |
| 7 | `fallback-provider-unavailable` | plan-backend.md T2 步骤 5 | ✅ |
| 8 | `fallback-missing-modality` | plan-backend.md T2 步骤 6 | ✅ |
| 9 | `first-target-lacks-modality` | plan-backend.md T2 步骤 7 | ✅ |
| 10 | `internal-error` | plan-backend.md T2 步骤 8 | ✅ |

### 文件变更覆盖

所有 spec 文件变更清单中的文件均在 plan 中有对应任务。经验证，所有文件路径均存在于当前代码库中。

---

## Issues

### MUST FIX

#### #1 — Responses API `message.content[]` 中缺少 `input_audio` 检测规则

**位置**：plan-backend.md T2 detectModalities() 实现逻辑 / plan-frontend.md 未涉及

**描述**：spec 的 Responses API 检测规则为：
```
input[]:
  type="input_image"  → "image"
  type="input_audio"  → "audio"
message.content[]:
  type="input_image"  → "image"
```

但 plan-backend.md 的 detectModalities 实现逻辑只列出：
```
- 顶层 type="input_image" → "image"
- 顶层 type="input_audio" → "audio"
- message.content[] 中 type="input_image" → "image"
```

**缺少**：`message.content[]` 中 `type="input_audio"` → `"audio"` 的检测。

这有两种可能：
1. spec 有意只检测 message.content[] 中的 image 而不检测 audio（Anthropic 的 Responses API 格式规范中 message.content 可能不含 input_audio）
2. spec 是有意省略的（与 Anthropic 格式相同，audio 无标准 content block type）

如果 spec 有意省略，plan-backend.md 需要添加注释说明为什么 message.content[] 不检测 audio；如果 spec 是遗漏，plan 需要补充此检测。

**修改建议**：在 plan-backend.md T2 的 detectModalities() Responses API 部分显式说明：`message.content[]` 只检测 `input_image`（与 OpenAI Responses API 规范一致，audio 只出现在顶层 input[]），或将 spec 的 Responses API 检测规则补齐 `message.content[]` 中 `input_audio` 的检测。

#### #2 — SA3（前端全部任务）负载过重，超出 subagent 约束

**位置**：plan.md 实现顺序，阶段 1

**描述**：SA3 被分配了 F1-F6 全部 6 个前端任务，涉及 **13 个文件**、约 **3159 行**。根据 CLAUDE.md 的 subagent 约束：

> 每个 subagent 修改的文件不建议超过 5 个，修改行数不建议超过 3000 行。

SA3 同时违反了文件数量（13 >> 5）和行数（3159 > 3000）约束。虽然大部分改动是机械替换，但 ModelMappingCard.vue（351 行，含新增 Alert 区域）和 useProviderForm.ts（逻辑泛化）需要仔细审查，将所有前端任务放在一个 subagent 中容易导致质量下降。

**修改建议**：拆分 SA3 为两个 subagent：
- SA3a: F6 (i18n) + F1 (类型重命名) + F3 (ModelMappings.vue) — 基础重命名，~4 文件，~400 行
- SA3b: F2 (ModelMappingCard) + F4 (toggleCapability) + F5 (ModelCard+Editor+Providers.vue) — 功能扩展，~5 文件，~1500 行

或者按 plan-frontend.md 建议的执行顺序分批：先 SA3a (F6→F1→F3)，再 SA3b (F4→F5→F2)。

#### #3 — plan.md 与 plan-backend.md 的实现顺序矛盾

**位置**：plan.md 实现顺序 vs plan-backend.md 实现顺序建议

**描述**：plan.md 将 T1+T2+T3 合并到 SA1（后端核心链路），但 plan-backend.md 明确标注 T2 依赖 T1，T3 依赖 T2。如果 SA1 是单个 subagent 串行执行 T1→T2→T3，这没有问题；但如果理解为并行，则违反依赖关系。

此外，plan.md 的 SA2 包含 T6-2~4（部分测试更新），但测试文件引用 T2 的导出（`computeModalityRedirectTargets`、`detectModalities`），在 SA1 的 T2 未完成前，SA2 的测试文件修改无法通过编译验证。

**修改建议**：在 plan.md 实现顺序中明确标注：
- SA1 内部是 T1→T2→T3 **串行**执行（非并行）
- SA2 的测试更新（T6-2~4）必须在 SA1 完成后执行，或标注为"仅做文本替换，不做编译验证"

### SUGGESTION

#### #4 — plan-backend.md T2 缺少 `firstTargetCapabilities` 的获取逻辑细节

**位置**：plan-backend.md T2 步骤 3

**描述**：当前代码的 capabilities 获取逻辑是：先从 provider 的 `parseModels()` 结果中查找 model entry，取 entry.capabilities；如果找不到 entry，则 fallback 到 `lookupCapabilities()`。plan-backend.md 的伪代码只展示了 `entry?.capabilities ?? lookupCapabilities(...)`，但没有说明这个 fallback 逻辑需要保持。

这不是 bug，但作为"为什么"文档，建议显式说明 capabilities 查找的优先级链：provider 配置 > MODEL_CAPABILITIES 白名单 > 默认值。当前代码已经正确实现了这个链路，只需保持。

**修改建议**：在 plan-backend.md T2 步骤 3 添加一句注释，说明 capabilities 查找复用现有 `parseModels()` + `lookupCapabilities()` 的两级 fallback 机制。

#### #5 — plan-frontend.md F2 Alert 组件未使用 shadcn-vue Alert 组件

**位置**：plan-frontend.md F2, 设计决策 FD1

**描述**：FD1 决定使用 Card + 自定义样式代替安装 shadcn Alert 组件，理由是"项目无 Alert 组件，安装引入额外依赖"。但实际 plan 中的实现代码使用的是原生 `<div>` 加手写 class：

```vue
<div v-if="localMultimodalFallback" class="mt-2 p-2 rounded-md border border-amber-500/30 bg-amber-500/5">
```

这违反了 CLAUDE.md 中"禁止使用原生 HTML 表单/交互元素"的精神（虽然 `<div>` 不是交互元素）。更准确的担忧是：使用手写 `border-amber-500/30` 和 `bg-amber-500/5` 可能违反 `taste/no-hardcoded-colors` ESLint 规则（使用 Tailwind 原始色名而非语义 token）。

**修改建议**：确认 `taste/no-hardcoded-colors` 规则是否对这些 class 报警。如果报警，需要使用 CSS 变量或语义类名（如 `border-warning bg-warning/5`）。如果不报警（/前端文件可能被排除在该规则之外），则当前方案可行。设计决策本身（不安装 shadcn Alert）是合理的。

#### #6 — plan.md AC 覆盖矩阵中 AC18/AC19 标注为"手动验证"但无自动化验证建议

**位置**：plan.md AC 覆盖矩阵

**描述**：AC18（Alert 显示）和 AC19（capabilities 切换泛化）仅标注为"手动验证"。虽然没有自动化测试不是 MUST FIX（前端 UI 变更），但 plan 完全没有提供验证步骤（如页面操作路径、预期视觉表现），subagent 执行时无法验证这两个 AC。

**修改建议**：为 AC18/AC19 添加简要的验证步骤：
- AC18：打开 ModelMappings 页面 → 编辑一个映射组 → 添加 multimodal fallback → 确认 fallback 配置区域下方出现琥珀色警告框
- AC19：打开 Providers 页面 → 编辑模型 capabilities → 确认 image/audio/video 三个 checkbox 均可点击切换

或标注"AC18/AC19 在 T7 全局验证阶段通过人工页面检查完成"。

#### #7 — T6 测试任务拆分不清晰

**位置**：plan.md 实现顺序

**描述**：plan.md 将 T6 拆分为 T6-1（核心测试更新）和 T6-2~4（其他测试更新），但 plan-backend.md 中 T6 的详细描述是 6-1 到 6-4 四个子任务。plan.md 阶段 1 将 T6-2~4 分配给 SA2，阶段 2 单独执行 T6-1，但 SA2 执行 T6-2~4 时 T2（被测代码）可能还未完成（如果 SA1 和 SA2 并行），测试文件修改后无法运行验证。

**修改建议**：统一编号体系。建议 plan.md 的实现顺序与 plan-backend.md 的 T6 子任务编号保持一致，并明确标注 SA2 的 T6-2~4 仅做文本替换（不需要运行测试），T6-1 在 SA1 完成后执行并运行全量测试。

### LOW

#### #8 — plan-frontend.md F4 Providers.vue 分配不明确

**位置**：plan.md F4 任务描述 vs plan-frontend.md F4/F5 任务描述

**描述**：plan.md 将 `Providers.vue` 放在 F5 任务中（与 ModelCard + Editor 一起），但 plan-frontend.md F4 也列出了 `Providers.vue` 的改动（emit 名更新）。两个文档对 Providers.vue 的归属不一致。实际改动很简单（一行 emit 名替换），无论归属哪个任务都可以，但应统一。

---

## Verdict

**需修改后重审** — 3 条 MUST FIX。

核心问题是：
1. Responses API `message.content[]` 中 audio 检测规则的歧义需澄清
2. SA3 前端任务过重需拆分
3. 实现顺序中 SA1/SA2 的串行/并行语义和测试依赖需明确

修复这 3 点后方案可进入执行阶段。
