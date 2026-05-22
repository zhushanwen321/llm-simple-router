---
review:
  type: spec_review
  round: 1
  timestamp: "2026-05-23T00:30:00"
  target: ".xyz-harness/2026-05-22-/spec.md"
  verdict: fail
  summary: "计划评审完成，第1轮，2条MUST FIX，需修改后重审"

statistics:
  total_issues: 4
  must_fix: 2
  must_fix_resolved: 0
  low: 1
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md:FR3"
    title: "api.getProviders() 失败时弹窗行为未定义"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: MUST_FIX
    location: "spec.md:FR5 / Constraints"
    title: "createRetryRule API 是否已接受 provider_id 参数未验证"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: LOW
    location: "spec.md:AC7"
    title: "AC7 依赖 PR #165 的表格显示功能，但未标注验证状态"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: INFO
    location: "spec.md:全局"
    title: "当前只有 spec.md，无 plan.md，仅评审 spec 完整性"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录
- 评审时间：2026-05-23 00:30
- 评审类型：计划评审（spec 完整性）
- 评审对象：`.xyz-harness/2026-05-22-/spec.md`

## 摘要

目标清晰，范围合理，AC 可测试。**2 条 MUST FIX** 需在进入 dev 前解决。重点缺失：provider 列表加载失败的错误处理未定义、createRetryRule API 契约未验证。

---

## 维度一：目标与范围

**目标明确度：✅ 通过**

> "AI 生成规则路径（请求详情 → 'AI 生成'按钮）缺少 provider 维度"

一句话说清楚要做什么，无歧义。

**范围合理性：✅ 通过**

4 个 FR 纵向串联了完整链路（后端 → 类型 → UI → 提交），Constraints 明确标记了不改的内容（AI prompt、手动编辑页、后端 matcher/resilience 层）。不过大不过小。

---

## 维度二：Functional Requirements 审查

### FR1（后端返回 provider_id）

| 检查项 | 状态 |
|--------|------|
| 描述是否清晰 | ✅ 明确：`rule.provider_id` 取自 `log.provider_id`（可能 null） |
| 是否可测试 | ✅ `app.inject()` 模拟 AI 生成请求，验证响应包含 `provider_id` |
| 是否说明「不改 AI prompt」 | ✅ FR1 明确写了 |

**无问题。**

### FR2（前端类型定义更新）

| 检查项 | 状态 |
|--------|------|
| 类型定义是否具体 | ✅ `AiRetryGenerateResult.rule` 增加 `provider_id?: string \| null` |
| 是否可测试 | ✅ TypeScript 编译检查 |
| 是否独立于其他 FR | ✅ 纯类型变更 |

**无问题。**

### FR3（AiRulePreviewDialog 增加 provider 下拉选择器）

| 检查项 | 状态 |
|--------|------|
| 组件位置、选项、初始值是否明确 | ✅ 位置、选项列表、"通用"默认均已说明 |
| 是否复用现有模式 | ✅ 明确引用 `RetryRules.vue` 的 Select 模式 |
| 数据加载方式 | ✅ `api.getProviders()` 在弹窗挂载时调用 |

**❌ MUST FIX #1：`api.getProviders()` 失败时的错误处理未定义**

FR3 只说了"在弹窗挂载时加载 providers 列表"，但没有定义：

1. **加载失败时弹窗是否可用？** 如果请求超时或返回 500，provider 选择器是禁用、隐藏、还是仍然显示"通用"选项？
2. **错误提示方案？** 是否在弹窗顶部 toast 提示？还是 inline 错误消息？
3. **重试机制？** 用户是否可以关闭弹窗重新打开重试？

这是一个实际的边界场景——生产环境中 API 请求可能失败，弹窗应该能优雅降级而非卡死。
**建议**：若加载失败，provider 选择器禁用或仅显示"通用"选项，并 toast 提示"加载 providers 列表失败"。

### FR4（默认值语义）

| 检查项 | 状态 |
|--------|------|
| 默认值语义是否明确 | ✅ 明确：**无论后端返回什么，默认选中"通用（所有供应商）"** |
| 与 FR1 关系是否清晰 | ✅ 后端返回作为参考，用户自主选择，设计意图一致 |

**无问题。**

### FR5（提交时传递 provider_id）

| 检查项 | 状态 |
|--------|------|
| 传递逻辑是否明确 | ✅ `api.createRetryRule()` 传入 `provider_id`，"通用"传 `null` |
| 是否可测试 | ✅ 通过 API mock 验证请求体 |

**❌ MUST FIX #2：未确认 `createRetryRule` API 是否已接受 `provider_id` 参数**

Constraints 中说手动编辑页面的 provider 选择器已在 PR #165 实现，**但这个断言未经验证**：

1. `api.createRetryRule()` 的请求体 schema 是否真的包含了 `provider_id` 字段？
2. 如果 `provider_id` 未在 `createRetryRule` 的校验白名单或 schema 中，传递后会被静默忽略或拒绝，导致 AC5/AC6 失败
3. 这是一个**跨 PR 的集成依赖**，应在 spec 阶段验证或加一条 AC：「验证 `createRetryRule` API 的请求体 schema 已包含 `provider_id`」

**建议**：在 Constraints 中增加一条「已验证 `POST /admin/api/retry-rules` 的 schema 已包含 `provider_id`」，或加一条 AC 覆盖。

---

## 维度三：Acceptance Criteria 审查

| AC | 场景 | 可测试 | 评估 |
|----|------|--------|------|
| AC1 | 后端接口返回 `provider_id` | ✅ app.inject() 模拟请求 | 充分 |
| AC2 | 前端类型包含 `provider_id` | ✅ tsc 编译检查 | 充分 |
| AC3 | 弹窗显示 provider 下拉选择器 | ✅ 组件渲染测试 | 需补充：加载失败场景 |
| AC4 | 默认选中"通用" | ✅ 组件挂载后验证选中值 | 充分 |
| AC5 | 选择 provider 后保存 | ✅ mock API 验证请求体 | 需补充（见 MUST FIX #2） |
| AC6 | 保持通用后保存 | ✅ mock API 验证请求体 | 需补充（见 MUST FIX #2） |
| AC7 | 表格 Provider 列正确显示 | ⚠️ 依赖 PR #165 | 见 LOW #3 |

**LOW #3：AC7 依赖 PR #165 的表格显示功能**

AC7 说"保存后 RetryRules 页面表格 Provider 列正确显示"通用"徽章或 provider 名称"，这个功能是 PR #165 实现的。如果 PR #165 已完成且已验证，则 AC7 是一个集成验证检查点，没有问题。

但 spec 没有标注：
- PR #165 是否已合并到当前分支（`fix-retry-provider`）？
- 当前分支是否包含表格显示"通用"徽章的逻辑？

建议在 AC7 前加一句说明：「前提：当前分支已包含 PR #165 的表格 Provider 列显示功能」。

**未覆盖的边界场景（信息记录级）：**

| 场景 | 覆盖状态 | 说明 |
|------|---------|------|
| 日志的 `provider_id` 为 null | ✅ AC1 覆盖 | 后端返回 null |
| providers 列表为空 | ✅ 语义正确 | 下拉框只显示"通用" |
| AI 生成后 provider 被删除 | ✅ 不阻塞 | 默认通用，不影响 |
| `api.getProviders()` 失败 | ❌ MUST FIX #1 | 未定义弹窗行为 |
| 用户修改 AI prompt 后返回弹窗 | ⚠️ 未定义 | provider 选择状态是否保持 |

---

## 维度四：Complexity Assessment

**评估：合理 ✅**。

Spec 标 Low，4 个文件改动。确认后实际为：
1. `src/admin/retry-rules.ts` — 1 行加字段（~5 行）
2. `frontend/src/api/client.ts` — 1 行类型（~3 行）
3. `frontend/src/components/retry-rules/AiRulePreviewDialog.vue` — provider 选择器 + 加载逻辑（~30 行）
4. 调用 `api.createRetryRule()` 的传参处（~2 行）

Low 复杂度评估合理。

---

## 结论

**需修改后重审。**

| 类别 | 数量 | 说明 |
|------|------|------|
| MUST FIX | 2 | `api.getProviders()` 错误处理、`createRetryRule` 契约验证 |
| LOW | 1 | AC7 前置条件标注 |
| INFO | 1 | 暂无 plan.md |

### Summary

计划评审完成，第1轮，2条 MUST FIX，需修改后重审。
