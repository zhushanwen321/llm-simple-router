---
plan: .xyz-harness/2026-05-16-modality-redirect/plan.md
review_round: 2
verdict: pass
must_fix_count: 0
date: 2026-05-16
---

# 实现方案评审 v2

## 评审记录
- 评审时间：2026-05-16
- 评审类型：实现方案评审（plan.md + plan-backend.md + plan-frontend.md）
- 评审对象：plan.md（总览）、plan-backend.md（后端详细）、plan-frontend.md（前端详细）
- 评审轮次：第 2 轮（v1 有 3 条 required-fix，已修复）

---

## v1 required-fix 修复验证

### Fix #1 — Responses API `message.content[]` 中 `input_audio` 检测规则

**v1 问题**：plan-backend.md T2 的 Responses API 检测规则只列了 `message.content[]` 中的 `input_image`，没有说明为什么 `input_audio` 不在 `message.content[]` 中检测。

**修复状态**：**已修复**。plan.md T2 新增了显式说明：

> `input_audio` 只出现在 Responses API 的顶层 `input[]` 中，不会出现在 `message.content[]` 中（API 规范决定：audio 是 realtime 概念，不在 message 对话结构中）。因此 `detectModalities()` 只在顶层检测 `input_audio`，`message.content[]` 只检测 `input_image`。

说明清晰，技术理由充分。与 spec 的检测规则一致。

### Fix #2 — SA3 前端任务过重

**v1 问题**：SA3 包含 F1-F6 全部 6 个前端任务，13 个文件，约 3159 行，超出 subagent 约束（5 文件/3000 行）。

**修复状态**：**已修复**。plan.md 实现顺序已拆分：
- SA3a: F6 + F1 + F3（前端基础重命名，约 4 文件）
- SA3b: F4 + F5 + F2（前端功能扩展，约 5 文件）

两个 subagent 的文件数和行数均在约束范围内。

### Fix #3 — SA1/SA2 并行执行与测试依赖冲突

**v1 问题**：plan.md 实现顺序中 SA1（T1+T2+T3）和 SA2（含测试）的并行关系不清晰，可能导致测试文件引用不存在的导出。

**修复状态**：**已修复**。plan.md 实现顺序已明确：
- SA1 内部标注为 **串行** T1→T2→T3
- SA2 改为 T4+T5（仅文本替换），**不含测试**，标注"不做编译验证"
- T6（全量测试）移到阶段 3，标注"SA1+SA3b 完成后执行"

依赖关系正确，无冲突。

---

## spec 覆盖矩阵

| spec 需求项 | plan 覆盖章节 | 覆盖状态 |
|-------------|-------------|---------|
| 后端路由层重命名 (image-redirect → modality-redirect) | T2 | ✅ 完整 |
| 模态检测扩展 (detectModalities) | T2 + Fix#1 说明 | ✅ 完整 |
| fallback 字段重命名 (image_fallback → multimodal_fallback) | T2/T4, F1/F2/F3 | ✅ 完整 |
| pipeline snapshot stage 名更新 | T1, T6-4 | ✅ 完整 |
| admin 校验更新 | T4 | ✅ 完整 |
| MODEL_CAPABILITIES 数据扩展（8 个模型） | T5 | ✅ 完整 |
| 前端类型/组件重命名 | F1 | ✅ 完整 |
| 前端 i18n 更新 | F6 | ✅ 完整 |
| 前端 Alert 提示 | F2 | ✅ 完整 |
| 前端 capabilities 切换泛化 | F4/F5 | ✅ 完整 |
| 测试重命名+更新 | T6 | ✅ 完整 |
| 清理旧数据 | T7 grep 验证 | ✅ 完整 |
| detectModalities 检测规则（3 种 API 格式） | T2 + Fix#1 | ✅ 完整 |
| computeModalityRedirectTargets 决策流程（10 个 reason） | T2 | ✅ 完整 |
| 前端 Alert 提示内容（会话锁定/原因/恢复/成本） | F2 | ✅ 完整 |
| AC1-AC21 全覆盖 | AC 覆盖矩阵 | ✅ 完整 |

### Reason 映射覆盖（10 个 reason）

| reason | plan 覆盖 | 状态 |
|--------|----------|------|
| `no-multimodal-detected` | T2 步骤 2 | ✅ |
| `first-target-supports-all-modalities` | T2 步骤 3 | ✅ |
| `no-mapping-group` | T2 步骤 4 | ✅ |
| `rule-parse-error` | T2 步骤 4 | ✅ |
| `no-multimodal-fallback-configured` | T2 步骤 4 | ✅ |
| `invalid-fallback-config` | T2 步骤 4 | ✅ |
| `fallback-provider-unavailable` | T2 步骤 5 | ✅ |
| `fallback-missing-modality` | T2 步骤 6（新增） | ✅ |
| `first-target-lacks-modality` | T2 步骤 7 | ✅ |
| `internal-error` | T2 步骤 8 | ✅ |

---

## 新发现的问题

### LOW

#### #4 — F2 Alert 使用 `amber-*` 硬编码颜色，违反项目语义 token 约定

**位置**：plan-frontend.md F2, Alert UI 结构

**描述**：Alert 组件使用 `border-amber-500/30`、`bg-amber-500/5`、`text-amber-500`、`text-amber-600/80`、`text-amber-600/60` 等 Tailwind 原始色名。项目的 `taste/no-hardcoded-colors` ESLint 规则要求使用语义 token（如 `border-warning`、`bg-warning`、`text-warning`）。

经验证，`taste/no-hardcoded-colors` 规则当前在 eslint 10 + vue-eslint-parser 环境下存在兼容性问题，VAttribute visitor 不会触发，因此 **不会导致 CI 失败**。但使用语义 token 仍符合项目编码规范和 `design-tokens.ts` 中定义的 warning 色体系（`STATUS_COLORS.warning`）。

项目现有 `ModelMappingCard.vue` 第 230 行的 `border-orange-400/30 text-orange-400/60` 也存在同样问题，可作为一并修复的参考。

**修改建议**：将 `amber-*` 颜色替换为语义 token：
- `border-amber-500/30` → `border-warning/30`
- `bg-amber-500/5` → `bg-warning/5`
- `text-amber-500` → `text-warning`
- `text-amber-600/80` → `text-warning/80`
- `text-amber-600/60` → `text-warning/60`

或在 CSS 变量中定义 amber 变体（如 `--color-amber-*`），通过 `@apply` 引用。由于 `ALLOWED_PREFIXES` 包含 `warning`，使用 `border-warning`/`bg-warning`/`text-warning` 是最简洁的方案。

#### #5 — v1 #5 建议（firstTargetCapabilities 获取逻辑）已部分处理

**位置**：plan.md T2

**描述**：v1 #4 建议在 T2 中显式说明 capabilities 查找的优先级链。plan.md T2 新增了：

> 保持现有两级 fallback 机制（先从 provider 的 `parseModels()` 结果中查找 model entry 的 capabilities，找不到则 fallback 到 `lookupCapabilities()`）

这覆盖了建议的核心内容。plan-backend.md T2 的伪代码 `entry?.capabilities ?? lookupCapabilities(...)` 也表达了同样的逻辑。

#### #6 — v1 #8（Providers.vue 归属不一致）未修复

**位置**：plan.md F4 vs F5 任务分配

**描述**：plan-frontend.md 中 `Providers.vue` 的改动（emit 名替换）在 F4 和 F5 都有描述。plan.md 将 `Providers.vue` 列在 F5 下。两个文档的归属仍然不一致。

实际影响很小（改动只有一行 emit 名替换），且 `Providers.vue` 在 plan.md 中明确列在 F5 下，subagent 执行时不会遗漏。仅标记为 LOW。

---

## v1 SUGGESTION 验证

| v1 # | 描述 | v2 状态 |
|------|------|---------|
| #4 | T2 缺 firstTargetCapabilities 获取细节 | 已在 plan.md T2 中添加说明 |
| #5 | F2 Alert 未用 shadcn-vue Alert，amber 硬编码色 | FD1 决策不变（不安装 shadcn Alert），amber 色问题见本文 #4 |
| #6 | AC18/AC19 手动验证无操作步骤 | plan.md AC 覆盖矩阵已添加验证步骤描述 |
| #7 | T6 测试任务拆分编号不统一 | 已修复：SA2 不再包含测试，T6 整体在阶段 3 执行 |
| #8 | Providers.vue 归属不一致 | 未修复，但影响微小（见本文 #6） |

---

## 可行性评估

### 技术可行性：高

- 所有源文件已验证存在且路径正确
- 函数签名变更向后兼容（`computeImageRedirectTargets` → `computeModalityRedirectTargets` 签名不变）
- `detectModalities()` 返回 `Set<string>` 是 breaking change，但调用方仅 `computeModalityRedirectTargets` 内部，影响可控
- 步骤 6（fallback capabilities 检查）是纯新增逻辑，不影响已有 image-only 场景（fallback 模型一定支持 image，新检查会通过）

### 执行可行性：高

- subagent 拆分合理，每个 subagent 文件数 ≤ 5，行数在约束内
- 依赖关系正确：SA1 串行 → T6 在 SA1 完成后 → T7 全局验证
- AC18/AC19 有明确的手动验证步骤

### 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 机械替换遗漏（旧引用残留） | 低 | T7 有 grep 验证步骤 |
| 前后端部署不同步（字段名不匹配） | 低 | 功能未上线，无生产数据，同时部署即可 |
| amber 颜色违反项目规范（但不影响 CI） | 低 | 建议用语义 token，不阻塞 |

---

## 结论

**通过** — v1 的 3 条 required-fix 已全部修复。v2 发现 2 条 LOW（amber 硬编码色、Providers.vue 归属不一致），均不阻塞执行。

### Summary

实现方案评审 v2 完成，3 条 required-fix 已修复，0 条新增 required-fix，2 条 LOW，**通过**。
