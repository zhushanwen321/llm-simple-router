---
review:
  type: plan_review
  round: 2
  timestamp: "2026-05-22T18:00:00"
  target: ".xyz-harness/2026-05-22-specplansession/"
  verdict: fail
  summary: "第2轮评审完成，MUST FIX #1 未被修复，3 条 ISSUE 仍全部 OPEN，verdict 维持 FAIL"

statistics:
  total_issues: 3
  must_fix: 1
  must_fix_resolved: 0
  low: 2
  low_resolved: 0
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "frontend/src/i18n/locales/en/retryRules.json"
    title: "English i18n 文件缺少 16 个新增 key，导致英文界面 UI 失效"
    status: open
    raised_in_round: 1
    resolved_in_round: null
    note: "第2轮核查确认，en/retryRules.json 仍缺少全部 16 个 key"

  - id: 2
    severity: LOW
    location: "plan.md File Structure 表 & plan-frontend.md §1 组件架构"
    title: "Plan 声明创建 BodyMatcherEditor.vue 独立组件，实际实现在 RetryRules.vue 中内联"
    status: open
    raised_in_round: 1
    resolved_in_round: null
    note: "第2轮核查确认，frontend/src/components/retry-rules/ 目录下仍仅有 RecommendedRules.vue，无 BodyMatcherEditor.vue"

  - id: 3
    severity: LOW
    location: "plan.md File Structure 表第15行 & Task 7"
    title: "集成测试文件路径与实现不一致"
    status: open
    raised_in_round: 1
    resolved_in_round: null
    note: "第2轮核查确认，实际文件仍为 router/tests/integration-retry-rules.test.ts"
---

# 计划评审 v2

## 评审记录
- 评审时间：2026-05-22 18:00
- 评审类型：计划评审（第 2 轮验证）
- 评审对象：plan.md + plan-frontend.md + actual implementation 一致性
- 本轮重点：验证第 1 轮 MUST FIX #1 是否已修复

---

## 校验方法

本次 v2 评审使用以下方法验证第 1 轮发现的 3 个问题：

1. **MUST FIX #1：** 逐 key 对比 `en/retryRules.json` 和 `zh-CN/retryRules.json` 的扁平 key 集合
2. **LOW #2：** 检查 `frontend/src/components/retry-rules/` 目录下文件列表
3. **LOW #3：** 检查 `tests/integration/retry-rule-provider.test.ts` 和 `router/tests/integration-retry-rules.test.ts` 是否存在

---

## 问题状态验证

### Issue #1 (MUST FIX): English i18n 文件缺少 16 个新增 key

**状态：❌ 未修复**

第 2 轮核查使用扁平 key 对比，验证 `en/retryRules.json` 仍缺少以下 16 个 key（与第 1 轮完全一致）：

| 缺失 key | 引用位置 (RetryRules.vue) | en 当前状态 |
|----------|--------------------------|------------|
| `tableHeaders.provider` | `<TableHead>{{ t('retryRules.tableHeaders.provider') }}</TableHead>` | ❌ 缺失 |
| `provider` | `<Label>{{ t('retryRules.provider') }}</Label>` | ❌ 缺失 |
| `providerAll` | `<SelectItem>{{ t('retryRules.providerAll') }}</SelectItem>` | ❌ 缺失 |
| `providerPlaceholder` | `<SelectValue :placeholder="t('retryRules.providerPlaceholder')" />` | ❌ 缺失 |
| `globalBadge` | `<Badge>{{ t('retryRules.globalBadge') }}</Badge>` | ❌ 缺失 |
| `regexMatch` | `<TabsTrigger>{{ t('retryRules.regexMatch') }}</TabsTrigger>` | ❌ 缺失 |
| `jsonMatch` | `<TabsTrigger>{{ t('retryRules.jsonMatch') }}</TabsTrigger>` | ❌ 缺失 |
| `bodyMatchers` | 备用引用 | ❌ 缺失 |
| `fieldPath` | `<Input :placeholder="t('retryRules.fieldPath')" />` | ❌ 缺失 |
| `operator` | `<Select>{{ t('retryRules.operator') }}</Select>` | ❌ 缺失 |
| `matchValue` | `<Input :placeholder="t('retryRules.matchValue')" />` | ❌ 缺失 |
| `addCondition` | `<Button>{{ t('retryRules.addCondition') }}</Button>` | ❌ 缺失 |
| `removeCondition` | 备用 | ❌ 缺失 |
| `operatorEquals` | `<SelectItem>{{ t('retryRules.operatorEquals') }}</SelectItem>` | ❌ 缺失 |
| `operatorContains` | `<SelectItem>{{ t('retryRules.operatorContains') }}</SelectItem>` | ❌ 缺失 |
| `operatorExists` | `<SelectItem>{{ t('retryRules.operatorExists') }}</SelectItem>` | ❌ 缺失 |

**影响评估：**
当用户切换到英文界面时（`locale: "en"`），RetryRules 页面的以下 UI 元素全部无法正确显示：
- Provider 表格列头 → 显示 key 路径 "retryRules.tableHeaders.provider" 或空
- Provider 绑定 Select（标签 + placeholder + option）→ 空/部分失效
- "通用" Badge → 空/部分失效
- 正则/JSON Tab 切换标签 → 空/部分失效
- JSON 匹配编辑器的字段路径、操作符、匹配值 placeholder → 空/部分失效
- 添加/删除条件按钮 → 文本空/部分失效
- 操作符 Select option（等于/包含/存在）→ 空/部分失效

**原因分析：** 实现过程中添加了 zh-CN key 但没有同步更新 en 文件。`zh-CN/retryRules.json` 已完整包含所有新 key，但 `en/retryRules.json` 未收到对应补充。

**修复线索：**
```json
// 需要在 en/retryRules.json 中添加：
{
  "tableHeaders": {
    "provider": "Provider"
  },
  "provider": "Provider",
  "providerAll": "All Providers",
  "providerPlaceholder": "Select Provider",
  "globalBadge": "All",
  "regexMatch": "Regex",
  "jsonMatch": "JSON Field",
  "bodyMatchers": "JSON Field Matching",
  "fieldPath": "Field Path",
  "operator": "Operator",
  "matchValue": "Value",
  "addCondition": "Add Condition",
  "removeCondition": "Remove Condition",
  "operatorEquals": "Equals",
  "operatorContains": "Contains",
  "operatorExists": "Exists"
}
```

（翻译来源：plan-frontend.md §9.2）

---

### Issue #2 (LOW): BodyMatcherEditor.vue 组件未创建

**状态：❌ 未修复**

检查 `frontend/src/components/retry-rules/` 目录，仍仅有 `RecommendedRules.vue`，无 `BodyMatcherEditor.vue`。

JSON 字段匹配编辑器仍内联在 `RetryRules.vue` 中（约 30 行 template + script 逻辑），未提取为独立组件。

**影响：** 低。内联实现功能完整，但：
- plan.md、plan-frontend.md 中多处声明此独立组件，文档与实际不一致
- 如后续需要在 ProxyEnhancement 或其他页面复用 JSON 匹配编辑功能，需要额外的提取工作

**修复方向（二选一）：**
- 方案 A：将内联代码提取为 `frontend/src/components/retry-rules/BodyMatcherEditor.vue`，与 plan 一致
- 方案 B：更新 plan.md File Structure 表和 plan-frontend.md §1 组件架构，删除 BodyMatcherEditor.vue 声明，改为内联描述

---

### Issue #3 (LOW): 集成测试文件路径与实现不一致

**状态：❌ 未修复**

| 对比项 | Plan 声明 | 实际存在 |
|--------|----------|---------|
| 文件路径 | `tests/integration/retry-rule-provider.test.ts` | `router/tests/integration-retry-rules.test.ts` |
| 文件操作 | create | modify（已有文件追加 test case） |

**影响：** 低。集成测试已实际存在且覆盖全面（provider 隔离、upstream_error_logs、stream_error 响应）。

**修复方向：** 更新 plan.md 的 File Structure 表（第 15 行）和 Task 7 的文件路径/类型。

---

## 额外检查：Plan 与 actual 实现一致性补充

### 文件存在性快照

| Plan 声明的文件 | 实际存在 | 状态 |
|-----------------|---------|------|
| `router/src/db/migrations/049_*.sql` | ✅ | 一致 |
| `router/src/proxy/orchestration/body-matcher.ts` | ✅ | 一致 |
| `router/src/db/upstream-error-logs.ts` | ✅ | 一致 |
| `router/src/proxy/orchestration/retry-rules.ts` | ✅ | 已修改 |
| `router/src/db/retry-rules.ts` | ✅ | 已修改 |
| `router/src/proxy/orchestration/resilience.ts` | ✅ | 已修改 |
| `router/src/proxy/handler/failover-loop.ts` | ✅ | 已修改 |
| `router/src/proxy/orchestration/orchestrator.ts` | ✅ | 已修改 |
| `router/src/admin/retry-rules.ts` | ✅ | 已修改 |
| `router/src/proxy/patch/retry-rule-matcher.ts` | ✅ | 已修改 |
| `frontend/src/views/RetryRules.vue` | ✅ | 已修改 |
| `frontend/src/components/retry-rules/BodyMatcherEditor.vue` | ❌ | 内联实现 |
| `frontend/src/i18n/locales/zh-CN/retryRules.json` | ✅ | 已更新 |
| `frontend/src/i18n/locales/en/retryRules.json` | ❌ 缺16 key | 未更新 |
| `tests/unit/body-matcher.test.ts` | ✅ | 一致 |
| `tests/unit/retry-rule-matcher.test.ts` | ✅ | 一致 |
| `router/tests/integration-retry-rules.test.ts` | ✅ | 实际文件（路径不同）|
| `frontend/src/__tests__/RetryRules.test.ts` | ✅ | 实际存在（路径有差异）|

### 功能实现快照

| 功能点 | Plan 描述 | Implementation | 状态 |
|--------|----------|---------------|------|
| DB migration 049 | provider_id + body_matchers 列 + upstream_error_logs 表 | ✅ 完全一致 | ✅ |
| BodyMatcher.matchBodyMatchers() | AND 逻辑，3 种操作符 | ✅ 完全一致 | ✅ |
| RetryRuleMatcher 二级缓存 | providerId:statusCode + __global__:statusCode | ✅ 完全一致 | ✅ |
| Resilience 传参 providerId | 通过 config.providerId 传递 | ✅ 已实现 | ✅ |
| upstream_error_logs 写入 | failover-loop 中 `!succeeded` 时写入 | ✅ 已实现 | ✅ |
| stream_error 格式化响应 | adapter.formatError() + reply.send() | ✅ 已实现 | ✅ |
| Admin API CRUD | provider_id/body_matchers 字段 | ✅ 已实现 | ✅ |
| 前端 Provider 列 | Badge + provider 名称 | ✅ 已实现 | ✅ |
| 前端 Provider 绑定 Select | "通用" + 各 provider | ✅ 已实现 | ✅ |
| 前端 JSON 匹配编辑 | Tab 切换 + 行编辑 + exists 隐藏 value | ✅ 已实现（内联） | ✅ |
| 前端 i18n zh-CN | 完整新 key | ✅ 已添加 | ✅ |
| 前端 i18n en | 完整新 key | ❌ 缺失 16 key | ❌ |
| 集成测试 | provider 隔离 + stream_error + upstream_error_logs | ✅ 已实现 | ✅ |

---

## 结论

**Verdict: FAIL**

### 未解决 ISSUE 汇总

| ID | Severity | Title | 第1轮状态 | 第2轮状态 | 备注 |
|----|----------|-------|----------|----------|------|
| #1 | MUST_FIX | English i18n 文件缺少 16 个新增 key | open | **open** | **未被修复** |
| #2 | LOW | BodyMatcherEditor.vue 组件未创建 | open | **open** | 未被修复 |
| #3 | LOW | 集成测试文件路径不一致 | open | **open** | 未被修复 |

### 要求

**MUST FIX #1 必须修复后重新提交第 3 轮评审。** 修复方法：

在 `frontend/src/i18n/locales/en/retryRules.json` 中添加以下 key（翻译参考 plan-frontend.md §9.2）：

| Key | English Translation |
|-----|-------------------|
| `tableHeaders.provider` | `"Provider"` |
| `provider` | `"Provider"` |
| `providerAll` | `"All Providers"` |
| `providerPlaceholder` | `"Select Provider"` |
| `globalBadge` | `"All"` |
| `regexMatch` | `"Regex"` |
| `jsonMatch` | `"JSON Field"` |
| `bodyMatchers` | `"JSON Field Matching"` |
| `fieldPath` | `"Field Path"` |
| `operator` | `"Operator"` |
| `matchValue` | `"Value"` |
| `addCondition` | `"Add Condition"` |
| `removeCondition` | `"Remove Condition"` |
| `operatorEquals` | `"Equals"` |
| `operatorContains` | `"Contains"` |
| `operatorExists` | `"Exists"` |

### LOW 项（建议但不阻塞）

- **Issue #2 / #3**：建议更新 plan.md / plan-frontend.md 文档以匹配实际实现，或在后续 PR 中解决
