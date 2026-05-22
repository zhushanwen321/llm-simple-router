---
review:
  type: plan_review
  round: 1
  timestamp: "2026-05-22T15:30:00"
  target: ".xyz-harness/2026-05-22-specplansession/"
  verdict: fail
  summary: "计划评审完成，第1轮，1条MUST FIX，2条LOW，需修改后重审"

statistics:
  total_issues: 3
  must_fix: 1
  must_fix_resolved: 0
  low: 2
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "frontend/src/i18n/locales/en/retryRules.json"
    title: "English i18n 文件缺少 16 个新增 key，导致英文界面 UI 失效"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: LOW
    location: "plan.md: Execution Groups BG1 文件列表"
    title: "Plan 声明创建 BodyMatcherEditor.vue 为独立组件，实际实现内联在 RetryRules.vue 中"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: LOW
    location: "plan.md: File Structure 表 & Task 7"
    title: "集成测试文件路径与实现不一致"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录
- 评审时间：2026-05-22 15:30
- 评审类型：计划评审
- 评审对象：spec.md + plan.md + plan-backend.md + plan-api-contract.md + plan-frontend.md + e2e-test-plan.md + test_cases_template.json
- 对比基准：fix-usage-limit-return 分支上已合并的代码实现
- 上下文：这是恢复已有实现后的 plan，plan 需与实际实现一致

---

## 1. Spec 完整性

### 目标明确性 ✅
目标清晰："实现 Retry Rule 的 Provider 隔离、JSON 字段匹配和上游错误日志功能，解决跨 Provider 正则误命中问题。" 一句话说清楚问题域。

### 范围合理性 ✅
范围边界明确：
- FR1-FR9 完整覆盖所有需求维度（DB、Matcher、Resilience 层、前端、API）
- 明确标记 Out of Scope（SSE 监控推送不在本次范围内）
- "现有规则不受影响"明确向后兼容边界

### 验收标准可量化 ✅
AC1-AC8 全部可写测试验证，无模糊描述。每个 AC 都有具体的 "测试场景" 子段，可直接映射到 test case。

### 待决议项 ✅
无 `[待决议]` 标记。所有设计决策已有明确结论（如 provider_id = NULL 为通用标识已在 ADR 0005 中覆盖）。

### Data Consumer Checklist ✅
spec 包含完整的 Data Consumer Checklist，覆盖 5 类消费者（DB 写入、内存缓存、Admin API、前端、SSE），逐一确认覆盖状态。

**结论：Spec 完整性 PASS。**

---

## 2. Plan 可行性

### 任务拆分合理性 ✅
7 个 Task 按三级依赖链拆分（BG1→BG2→FG1），粒度适中。每个 Task 可由 subagent 独立完成：
- Task 1（DB migration + BodyMatcher 纯函数）— 独立可测
- Task 2（RetryRuleMatcher 升级 + DB layer）— 依赖 Task 1
- Task 4（Resilience/failover-loop/orchestrator）— 依赖 Task 2,3

### 依赖关系正确性 ✅
依赖图清晰：
```
BG1 (基础) ──→ BG2 (集成) ──→ FG1 (前端)
```
无循环依赖，所有被依赖 Task 排在前面。

### 工作量估算 ✅
8 个后端文件 + 2 个前端文件 + 3 个测试文件，对应 spec 的 9 个 FR，工作量合理。

### 遗漏检查 ⚠️
对照 spec 逐条覆盖：

| FR | Plan 覆盖 | 状态 |
|----|-----------|------|
| FR1: Provider 隔离 | ✅ Task 1/2 | ✅ |
| FR2: JSON 字段匹配 | ✅ Task 1/2 | ✅ |
| FR3: RetryRuleMatcher 升级 | ✅ Task 2 | ✅ |
| FR4: stream_error 响应修复 | ✅ Task 4 | ✅ |
| FR5: upstream_error_logs 表 | ✅ Task 3 | ✅ |
| FR6: 前端适配 | ✅ Task 6 | ✅ |
| FR7: DB Schema 变更 | ✅ Task 1 | ✅ |
| FR8: Admin API 适配 | ✅ Task 5 | ✅ |
| FR9: StateRegistry 刷新 | ✅ Task 5 (note: plan-backend.md §8 mentions refreshRetryRules) | ✅ |
- AC1: 绑定规则隔离 | ✅ Task 2/7 | ✅ |
- AC2: JSON 字段匹配 | ✅ Task 1/7 | ✅ |
- AC3: 429 不再误触发 | ✅ 隐含在 Task 2/4 | ✅ |
- AC4: stream_error 响应 | ✅ Task 4 | ✅ |
- AC5: upstream_error_logs | ✅ Task 3/7 | ✅ |
- AC6: 前端 Provider 选择 | ✅ Task 6 | ✅ |
- AC7: 前端 JSON 匹配编辑 | ✅ Task 6 | ✅ |
- AC8: 向后兼容 | ✅ 所有 Task 均考虑向后兼容 | ✅ |

**结论：Plan 可行性 PASS（轻微遗漏见下文 LOW 项）。**

---

## 3. Spec 与 Plan 一致性

### 需求覆盖 ✅
plan.md 的 FR 引用和迁移策略与 spec 完全一致。plan-backend.md 的 9 个章节逐个对应 spec 的 FR1-FR9。

### 额外工作标记 ✅
plan 中无 spec 未提及的额外工作。所有文件变更都可回溯到 spec 中的具体需求。

### 验收标准映射 ✅
e2e-test-plan.md 的 7 个 Scenario 直接对应 AC1-AC8，test_cases_template.json 的 14 个 TC 覆盖了所有 AC。AC 覆盖矩阵：

| AC | 测试场景 | 覆盖状态 | 测试位置 |
|----|----------|---------|----------|
| AC1: Provider 隔离 | Scenario 1 / TC-2-01/02 | ✅ | unit/retry-rule-matcher.test.ts, integration-retry-rules.test.ts |
| AC2: JSON 字段匹配 | Scenario 2 / TC-1-01~06 | ✅ | unit/body-matcher.test.ts, unit/retry-rule-matcher.test.ts |
| AC3: 429 误触发修复 | Scenario 1 (隐含) | ✅ | integration-retry-rules.test.ts |
| AC4: stream_error 响应 | Scenario 3 / TC-2-02 | ✅ | integration-retry-rules.test.ts |
| AC5: upstream_error_logs | Scenario 4 / TC-2-03 | ✅ | integration-retry-rules.test.ts, unit/upstream-error-logs test |
| AC6: 前端 Provider 选择 | Scenario 5 / TC-3-01 | ✅ | frontend/__tests__/retry-rules-ac.test.ts |
| AC7: 前端 JSON 匹配编辑 | Scenario 6 / TC-3-02 | ✅ | frontend/__tests__/retry-rules-ac.test.ts |
| AC8: 向后兼容 | Scenario 7 / TC-4-01 | ⚠️ manual | 无自动化测试（手动覆盖可接受）|

**结论：Spec-Plan 一致性 PASS。**

---

## 4. Execution Groups 合理性

### 分组合理性 ✅
- BG1（DB 迁移 + Matcher + 日志层）：8 个文件，≤ 10 文件限制 ✅
- BG2（Resilience + Admin API）：6 个文件 ✅
- FG1（前端）：2 个文件 ✅

### 类型划分 ✅
- BG1/BG2 为后端，FG1 为前端，不混合 ✅

### 功能关联度 ✅
- BG1 内部 3 个 Task 紧密关联（迁移→Matcher→日志层）
- BG2 依赖 BG1 的 matcher 和日志层完成
- FG1 依赖 BG2 的 Admin API

### 依赖关系 ✅
Wave 编排正确：BG1(Wave 1) → BG2(Wave 2) → FG1(Wave 3)

### 并行约束 ✅
正确标注了 Semaphore 限制（≤3）和文件冲突规则。

**结论：Execution Groups 设计 PASS。**

---

## 5. 后端设计充分性

由于 plan 标注为 L2 复杂度，按方法论：
- 本 reviewer 评审 plan.md 总纲、前后端集成点
- 后端设计细节由独立 subagent 评审（不在本次范围内）

### 总纲完整性 ✅
- plan.md 清楚描述了四层 proxy 架构（Handler→Orchestration→Routing→Transport），RetryRuleMatcher 所在层级明确
- 关键依赖链和缓存重设计逻辑清晰

### 前后端集成点 ✅
- API 合约（plan-api-contract.md）完整定义了 4 个端点的 schema 变化
- `stateRegistry.refreshRetryRules()` 在 CRUD 后触发，前后端状态一致
- API 响应包含 `provider_id` 和 `body_matchers` 字段

**结论：后端设计充分性 PASS（L2 流程正确）。**

---

## 6. Plan 与实际实现一致性检查

因任务说明此 plan 为"恢复已有实现后"的文档，需验证 plan 与实际代码一致。

### 6.1 文件存在性检查

| Plan 声明的文件 | 实际存在 | 注意事项 |
|-----------------|---------|----------|
| `router/src/db/migrations/049_*.sql` | ✅ | 内容与 plan-backend.md §1 一致 |
| `router/src/proxy/orchestration/body-matcher.ts` | ✅ | 已实现 |
| `router/src/db/upstream-error-logs.ts` | ✅ | 已实现 |
| `frontend/src/components/retry-rules/BodyMatcherEditor.vue` | ❌ **不存在** | 见 Issue #2 |
| `frontend/src/views/RetryRules.vue` | ✅ | 已修改，包含 provider 列和 JSON 匹配编辑器（内联实现）|
| `frontend/src/views/__tests__/retry-rules-ac.test.ts` | ✅ | 已实现 |
| `frontend/src/i18n/locales/en/retryRules.json` | ✅ **但缺少新 key** | 见 Issue #1 |
| `frontend/src/i18n/locales/zh-CN/retryRules.json` | ✅ | 所有新 key 已添加 |
| `tests/unit/body-matcher.test.ts` | ✅ | 全面 |
| `tests/unit/retry-rule-matcher.test.ts` | ✅ | 全面 |
| `router/tests/integration-retry-rules.test.ts` | ✅ | 见 Issue #3：文件路径与 plan 声明的 `tests/integration/retry-rule-provider.test.ts` 不同 |

### 6.2 功能实现检查

| 功能点 | Plan 描述 | 实现状态 |
|--------|----------|---------|
| DB migration 049 | provider_id + body_matchers 列 + upstream_error_logs 表 | ✅ 完全一致 |
| BodyMatcher.matchBodyMatchers() | AND 逻辑，3 种操作符 | ✅ 完全一致 |
| RetryRuleMatcher 二级缓存 | providerId:statusCode + __global__:statusCode | ✅ 完全一致 |
| Resilience 传参 providerId | 通过 config.providerId 传递 | ✅ 已实现 |
| upstream_error_logs 写入 | failover-loop 中 `!succeeded` 时写入 | ✅ 已实现 |
| stream_error 格式化响应 | adapter.formatError() + reply.send() | ✅ 已实现 |
| Admin API CRUD | provider_id/body_matchers 字段 | ✅ 已实现 |
| 前端 Provider 列 | Badge + provider 名称 | ✅ 已实现 |
| 前端 Provider 绑定 Select | "通用" + 各 provider | ✅ 已实现 |
| 前端 JSON 匹配编辑 | Tab 切换 + 行编辑 + exists 隐藏 value | ✅ 已实现（内联）|
| 前端 i18n zh-CN | 完整新 key | ✅ 已添加 |
| 前端 i18n en | 完整新 key | ❌ **缺失 16 个 key** |
| 集成测试 | provider 隔离 + stream_error + upstream_error_logs | ✅ 已实现（路径不同）|

---

## 发现的问题

### Issue #1 (MUST FIX): English i18n 文件缺少 16 个新增 key

**位置：** `frontend/src/i18n/locales/en/retryRules.json`

**描述：** plan-frontend.md §9.2 明确列出了英文 i18n 翻译 key，但实际 en 文件中未添加以下 16 个 key：

| 缺失的 key | 在 RetryRules.vue 中的使用 |
|-----------|--------------------------|
| `tableHeaders.provider` | `<TableHead>` 表格列标题 |
| `provider` | Dialog 字段标签 |
| `providerAll` | Select option "通用（所有供应商）" |
| `providerPlaceholder` | Select placeholder（`t('retryRules.providerPlaceholder')`） |
| `globalBadge` | 通用规则 Badge 文字 |
| `regexMatch` | Tab 切换标签 |
| `jsonMatch` | Tab 切换标签 |
| `bodyMatchers` | 备用引用 |
| `fieldPath` | JSON 匹配器 Input placeholder（`t('retryRules.fieldPath')`） |
| `matchValue` | JSON 匹配器 Input placeholder（`t('retryRules.matchValue')`） |
| `operator` | Select 标签 |
| `operatorEquals` | Select option |
| `operatorContains` | Select option |
| `operatorExists` | Select option |
| `addCondition` | 添加条件按钮 |
| `removeCondition` | 删除条件按钮 |

**影响：** 当用户切换到英文界面时，RetryRules 页面的 Provider 列、Provider 绑定 Select、响应体匹配 Tab 切换、JSON 匹配编辑器等所有新 UI 均无法正确显示。这些 key 缺失会导致 Vue i18n 在开发模式下显示警告、生产模式下可能显示 key 路径或空值。

**验证：** 
```bash
# 对比 zh-CN 和 en 的扁平 key 集合，en 缺少 16 个 key
python3 -c "
import json
for lang in ['zh-CN', 'en']:
    with open(f'frontend/src/i18n/locales/{lang}/retryRules.json') as f:
        d = json.load(f)
    def flat(o, p=''):
        for k,v in o.items():
            fk = f'{p}.{k}' if p else k
            if isinstance(v, dict): yield from flat(v, fk)
            else: yield fk
    print(f'{lang}: {len(list(flat(d)))} keys')
"
```

**建议修复：** 在 `frontend/src/i18n/locales/en/retryRules.json` 中添加所有缺失 key，翻译参考 plan-frontend.md §9.2 并查阅 zh-CN 对应的语义。

---

### Issue #2 (LOW): Plan 声明创建 BodyMatcherEditor.vue 独立组件，实际实现在 RetryRules.vue 中内联

**位置：** `plan.md` File Structure 表 + `plan.md` Execution Groups BG1 文件列表 + `plan-frontend.md` §1 组件架构 + `plan-frontend.md` §5 BodyMatcherEditor.vue 组件设计

**描述：** plan 多处声明创建一个独立的 `frontend/src/components/retry-rules/BodyMatcherEditor.vue` 组件。实际实现将 JSON 字段匹配编辑器直接内联在 `RetryRules.vue` 中（约 100 行 template 代码）。

当前 `frontend/src/components/retry-rules/` 目录下仅有 `RecommendedRules.vue`，无 `BodyMatcherEditor.vue`。

**影响：** 低。内联实现功能完整，但计划文档与实现不一致。如后续需要复用 BodyMatcherEditor（如在 ProxyEnhancement 页面中使用），内联实现需要提取。

**建议修复：** 更新 plan.md、plan-frontend.md 中的组件设计和文件列表，反映实际实现方式（内联在 RetryRules.vue 中），或如计划复用，将现有内联代码提取为独立组件。

---

### Issue #3 (LOW): 集成测试文件路径与实现不一致

**位置：** `plan.md` File Structure 表（第 15 行） + `plan.md` Task 7 描述

**描述：** plan 声明集成测试文件路径为 `tests/integration/retry-rule-provider.test.ts`（create），实际文件为 `router/tests/integration-retry-rules.test.ts`。

文件结构表的路径也需对应更新：`router/tests/integration-retry-rules.test.ts`（modify）而非 `tests/integration/retry-rule-provider.test.ts`（create）。

**影响：** 低。集成测试已存在且覆盖全面（TC-3-01 provider 隔离、TC-5-01 upstream_error_logs、TC-3-02 stream_error 响应），只是路径与 plan 声明不一致。

**建议修复：** 更新 plan.md 的 File Structure 表和 Task 7，将路径修正为 `router/tests/integration-retry-rules.test.ts`，文件类型为 `modify`（已有文件新增测试用例）。BG2 的 Execution Flow 中 Task 7 的 subagent 配置应引用正确的文件路径。

---

## 结论

**Verdict: FAIL**

1 条 MUST FIX（英文 i18n 缺少关键 key）、2 条 LOW（文档与实现路径/组件结构不一致）。

### 修复优先级

| 优先级 | Issue | 修复方向 |
|--------|-------|---------|
| P0 | #1 英文 i18n 缺失 | 添加 16 个缺失 key 到 en/retryRules.json |
| P1 | #2 BodyMatcherEditor 组件 | 更新 plan 文件或提取为独立组件 |
| P1 | #3 测试文件路径 | 更新 plan.md 文件结构表 |

修复后进入第 2 轮评审。

---

## Summary

计划评审完成，第1轮，1条MUST FIX，2条LOW，需修改后重审。
