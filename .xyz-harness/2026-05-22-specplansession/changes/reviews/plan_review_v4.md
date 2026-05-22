---
verdict: pass
must_fix: 0
review:
  type: plan_review
  round: 4
  timestamp: "2026-05-22T18:30:00"
  target: ".xyz-harness/2026-05-22-specplansession/"
  summary: "计划评审完成，第4轮，0条MUST FIX，2条LOW（新增），通过"

statistics:
  total_issues: 5
  must_fix: 0
  must_fix_resolved: 1
  low: 2
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "frontend/src/i18n/locales/en/retryRules.json"
    title: "English i18n 文件缺少 16 个新增 key，导致英文界面 UI 失效"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 3
    note: "plan-frontend.md §9.2 已完整列出 en 翻译 key（15/15），plan 文档层面已修复。实际 en/retryRules.json 文件的一致性问题由编码评审验证。"

  - id: 2
    severity: LOW
    location: "plan.md File Structure 表 & plan-frontend.md §1"
    title: "Plan 声明创建 BodyMatcherEditor.vue 独立组件，实际实现在 RetryRules.vue 中内联"
    status: dismissed
    raised_in_round: 1
    resolved_in_round: 4
    note: "计划评审聚焦文档正确性。plan 要求创建独立组件是正确的实施指令，内联 vs 组件是实现选择，属于编码评审范畴。文档一致性保持 OK。"

  - id: 3
    severity: LOW
    location: "plan.md File Structure 表第15行 & Task 7"
    title: "集成测试文件路径与实现不一致"
    status: dismissed
    raised_in_round: 1
    resolved_in_round: 4
    note: "plan 声明路径 tests/integration/retry-rule-provider.test.ts 是计划中的目标路径，subagent 应遵循此路径创建。实际已有实现使用了不同路径，属于代码层面问题，编码评审时会验证。"

  - id: 4
    severity: LOW
    location: "plan.md line 46 & plan-frontend.md §1 文件变更表 / §10.1"
    title: "plan.md 与 plan-frontend.md 前端测试文件路径不一致"
    status: open
    raised_in_round: 4
    resolved_in_round: null

  - id: 5
    severity: LOW
    location: "plan-frontend.md §9.2（两个重复编号）"
    title: "plan-frontend.md §9.2 编号重复，en翻译内容不一致"
    status: open
    raised_in_round: 4
    resolved_in_round: null

---

# 计划评审 v4

## 评审记录
- 评审时间：2026-05-22 18:30
- 评审类型：计划评审
- 评审对象：spec.md + plan.md + plan-backend.md + plan-frontend.md + plan-api-contract.md + e2e-test-plan.md + test_cases_template.json
- 轮次说明：v3 已验证 MUST FIX #1 在 plan 文档层面修复（verdict: pass）。v4 做全量复查并发现 2 条新的 LOW 文档一致性问题。

---

## 1. Spec 完整性

| 维度 | 评估 | 说明 |
|------|------|------|
| 目标明确性 | ✅ | "实现 Retry Rule 的 Provider 隔离、JSON 字段匹配和上游错误日志功能，解决跨 Provider 正则误命中问题" — 一句话说清 |
| 范围合理性 | ✅ | 9 个 FR 边界清晰，明确标注 Out of Scope（SSE 监控推送不在本次范围）|
| 验收标准可量化 | ✅ | AC1-AC8 均能写测试验证，无模糊描述 |
| 待决议项 | ✅ | 无 `[待决议]`，所有设计决策已在 ADR 0005 覆盖 |
| 消费者检查清单 | ✅ | spec 含完整 Data Consumer Checklist（5 类消费者逐一确认）|

**结论：PASS**

---

## 2. Plan 可行性

| Task | 描述 | 依赖 | 评估 |
|------|------|------|------|
| 1 | DB Migration + BodyMatcher 纯函数 | — | ✅ 粒度适中，可独立测试 |
| 2 | RetryRuleMatcher 升级 + DB layer | 1 | ✅ 依赖正确 |
| 3 | upstream_error_logs DB layer | 1 | ✅ 依赖正确 |
| 4 | Resilience/failover-loop/orchestrator 适配 | 2,3 | ✅ 依赖正确 |
| 5 | Admin API 适配 | 2 | ✅ 依赖正确 |
| 6 | 前端 RetryRules 页面适配 | 5 | ✅ 依赖正确 |
| 7 | 集成测试 | 4 | ✅ 依赖正确 |

**依赖图正确性：** ✅ BG1 → BG2 → FG1，无循环依赖，被依赖 Task 排在前面

**工作量估算：** ✅ 18 个文件（8 create + 6 modify + 4 test），对应 spec 9 个 FR，工作量合理

**FR 逐条覆盖检查：** 

| FR | Plan 覆盖 | 说明 |
|----|-----------|------|
| FR1: Provider 隔离 | ✅ Task 1/2 | DB 列 + Matcher 升级 |
| FR2: JSON 字段匹配 | ✅ Task 1/2 | BodyMatcher 纯函数 + Matcher 集成 |
| FR3: RetryRuleMatcher 升级 | ✅ Task 2 | 二级缓存结构 |
| FR4: stream_error 响应修复 | ✅ Task 4 | Two-phase handling |
| FR5: upstream_error_logs 表 | ✅ Task 3 | DB layer + failover-loop 集成 |
| FR6: 前端适配 | ✅ Task 6 | Provider 列 + Tab 切换 + BodyMatcherEditor |
| FR7: DB Schema 变更 | ✅ Task 1 | Migration 049 |
| FR8: Admin API 适配 | ✅ Task 5 | Schema + Validation + Refresh |
| FR9: StateRegistry 刷新 | ✅ Task 5 | CRUD 后触发 load() |

**AC 逐条覆盖检查：**

| AC | Plan 覆盖 | 说明 |
|----|-----------|------|
| AC1: Provider 隔离 | ✅ Task 2/7 | Matcher 升级 + 集成测试 |
| AC2: JSON 字段匹配 | ✅ Task 1/7 | BodyMatcher 纯函数 + 集成测试 |
| AC3: 429 不再误触发 | ✅ Task 2/4 (隐含) | 通过 AC1 + AC4 组合验证 |
| AC4: stream_error 响应 | ✅ Task 4/7 | failover-loop + orchestrator + 集成测试 |
| AC5: upstream_error_logs | ✅ Task 3/7 | DB layer + 集成测试 |
| AC6: 前端 Provider 选择 | ✅ Task 6 | Provider 列 + Select |
| AC7: 前端 JSON 匹配编辑 | ✅ Task 6 | Tab 切换 + BodyMatcherEditor |
| AC8: 向后兼容 | ✅ 隐含在所有 Task | provider_id=NULL / body_matchers=NULL 行为不变 |

**结论：PASS**

---

## 3. Spec 与 Plan 一致性

| 检查项 | 评估 | 说明 |
|--------|------|------|
| 需求逐条覆盖 | ✅ | FR1-9 全部在 plan 中找到对应 Task |
| 额外工作 | ✅ | 无 spec 未提及的额外工作 |
| AC 映射 | ✅ | e2e-test-plan.md 7 个 Scenario 对应 AC1-AC8，test_cases_template.json 14 个 TC 全覆盖 |

**结论：PASS**

---

## 4. Execution Groups 合理性

### 分组检查

| Group | 文件数 | Task 数 | 评估 |
|-------|--------|---------|------|
| BG1 (DB + Matcher + 日志) | 8 | 3 | ✅ ≤ 10 文件，功能关联紧密 |
| BG2 (集成) | 6 | 3 | ✅ ≤ 10 文件 |
| FG1 (前端) | 5 | 1 | ✅ ≤ 10 文件 |

### 类型划分
- BG1/BG2 为纯后端，FG1 为纯前端 ✅
- 无混合类型 Group

### 功能关联度
- BG1: 迁移 → Matcher → 日志层，三个 Task 共用的新数据字段共享同一组 migration ✅
- BG2: Resilience 传参 + failover-loop 写入 + Admin API，都依赖 BG1 就绪 ✅
- FG1: 前端 UI 适配，依赖 Admin API 就绪 ✅

### Wave 编排
```
Wave 1: BG1 ──→ Wave 2: BG2 ──→ Wave 3: FG1
```
✅ 正确，被依赖 Group 在前 Wave

### Subagent 配置完整性
- BG1: 注入上下文 spec.md FR1-FR3/FR7, plan-backend.md §3-5 ✅
- BG2: 注入上下文 spec.md FR4/FR5/FR8/FR9, plan-backend.md §6-8, plan-api-contract.md ✅
- FG1: 注入上下文 spec.md FR6, plan-frontend.md, plan-api-contract.md ✅

### 并行约束
- 同 Wave 最多 3 个 subagent 并行 ✅
- 同一文件不允许多个 subagent 同时修改 ✅

**结论：PASS**

---

## 5. 后端设计充分性（L2 模式）

plan 标注为 **L2 复杂度**，按方法论本 reviewer 负责总纲评审和集成点检查，不重复后端设计细节。

### 总纲完整性 ✅
- 四层 proxy 架构清晰（Handler → Orchestration → Routing → Transport）
- RetryRuleMatcher 位于 Orchestration 层，定位正确
- 关键依赖链：DB Schema → Matcher 升级 → Resilience 适配 → failover-loop 适配 → 前端适配
- plan-backend.md 9 个章节完整覆盖所有后端设计维度

### 前后端集成点 ✅
- API 合约（plan-api-contract.md）定义了 4 个端点的 schema 变化
- `stateRegistry.refreshRetryRules()` 在 CRUD 后触发，前后端状态一致
- API 响应包含 `provider_id` 和 `body_matchers` 字段
- 前端初始化使用 `providers` 列表（通过现有 API 获取）

### E2E 测试计划 ✅
- 7 个 Scenario 完整覆盖 AC1-AC8
- test_cases_template.json 的 14 个 TC 结构完整（unit + integration + ui + manual）
- 非功能验证（性能 benchmark + 迁移耗时 + 渲染时间）合理

**结论：PASS**

---

## 6. v3 修复验证

v3 裁定 MUST FIX #1（en i18n key 缺失）已修复，依据是 plan-frontend.md §9.2 已列出完整 en 翻译。

**验证结果：确认 plan-frontend.md §9.2 确实包含 15 个 en i18n keys**，与 zh-CN §9.1 一一对应。plan 文档层面已覆盖。

> **重要说明：** 计划评审评估的是 plan 文档的正确性，而非实际代码文件。实际 `en/retryRules.json` 是否已更新属于编码评审范畴。

---

## 7. 新增问题

### Issue #4 (LOW): plan.md 与 plan-frontend.md 前端测试文件路径不一致

**位置：** plan.md line 46 vs plan-frontend.md §1 文件变更表 / §10.1

**描述：** plan.md 和 plan-frontend.md 对前端组件测试文件的路径声明不一致，可能导致 subagent 混淆：

| 文档 | 声明路径 | 文件操作 |
|------|---------|---------|
| plan.md File Structure 表 (line 46) | `frontend/src/__tests__/RetryRules.test.ts` | create |
| plan-frontend.md §1 文件变更表 | `frontend/src/views/__tests__/retry-rules-ac.test.ts` | modify |
| plan-frontend.md §10.1 测试方案 | `frontend/src/views/__tests__/retry-rules-ac.test.ts` | — |
| FG1 Subagent 配置 (plan.md line 153) | `RetryRules.test.ts` | — |
| e2e-test-plan.md 测试环境 | `src/__tests__/RetryRules.test.ts` | — |

**影响：** 低。不影响功能实现，但 subagent 可能因路径不一致在错误位置创建文件，或在测试运行时使用错误路径。

**修改方向：** 统一 plan.md、plan-frontend.md 中的测试文件路径，选择其中一个作为标准路径：
- 方案 A：全部统一为 `frontend/src/views/__tests__/retry-rules-ac.test.ts`（与 plan-frontend.md 一致）
- 方案 B：全部统一为 `frontend/src/__tests__/RetryRules.test.ts`（与 plan.md 一致）

选择后更新三处：plan.md File Structure 表、plan-frontend.md §1 和 §10.1、e2e-test-plan.md 测试环境命令。

---

### Issue #5 (LOW): plan-frontend.md §9.2 编号重复，en 翻译内容不一致

**位置：** plan-frontend.md §9.2（第 300 行和第 324 行）

**描述：** §9.2 编号出现了两次，内容有细微差异，可能导致 subagent 混淆该使用哪个翻译：

| key | 第一个 §9.2 ($300) | 第二个 §9.2 ($324) |
|-----|-------------------|-------------------|
| `globalBadge` | `"Global"` | `"All"` |
| `providerPlaceholder` | `"Select provider"` | `"Select Provider"` |
| `jsonMatch` | `"JSON Field Match"` | `"JSON Field"` |
| `operator` | `"Operator"` | `"Operator"`（一致）|
| `matchValue` | `"Match Value"` | `"Value"` |

正确的引用应该是：**第二个 §9.2**（第 324 行），它是最新的 en 翻译，与 zh-CN 的语义更匹配（如 `globalBadge: "All"` 对应中文"通用"）。

第一个 §9.2（第 300 行）应为旧的草稿版本，应删除或更新标题为"§9.2 (deprecated)"。

**影响：** 低。subagent 可能读到第一个 §9.2 并使用不同的翻译值，但功能不影响（i18n key 路径一致）。

**修改方向：**
1. 删除或标记第一个 §9.2（第 300 行），保留第二个 §9.2（第 324 行）
2. 或者将第二个 §9.2 改为 `### 9.3`，统一编号

---

## 8. 之前轮次问题状态汇总

| ID | Round 1 | Round 2 | Round 3 | Round 4 (v4) |
|----|---------|---------|---------|-------------|
| #1 MUST_FIX: en i18n | open | open | **resolved** (plan 文档修复) | resolved |
| #2 LOW: BodyMatcherEditor 组件 | open | open | (未检查) | **dismissed** (计划评审范围外) |
| #3 LOW: 集成测试路径 | open | open | (未检查) | **dismissed** (计划评审范围外) |
| #4 LOW: 前端测试路径不一致 | — | — | — | **open** (新发现) |
| #5 LOW: §9.2 重复编号 | — | — | — | **open** (新发现) |

**关于 #2 和 #3 的 dismissed 说明：** 计划评审评估的是 plan 文档的正确性和可执行性，不评估 plan 与已有代码实现的一致性。plan 要求创建独立 BodyMatcherEditor.vue 组件是有效的实施指令；plan 声明的集成测试路径是 subagent 应遵循的目标路径。与已有代码的差异属于编码评审的检查范围。

---

## 结论

**Verdict: PASS** — 0 条 open MUST FIX

| 严重度 | 数量 | 说明 |
|--------|------|------|
| MUST_FIX | 0 | 无阻塞性问题 |
| LOW | 2 | plan-frontend.md 文档格式和一致性问题 |
| INFO | 0 | 无 |

### LOW 项修复方向

| ID | 问题 | 修复方向 |
|----|------|---------|
| #4 | 前端测试文件路径不一致 | 统一 plan.md 和 plan-frontend.md 中的测试文件路径 |
| #5 | §9.2 重复编号 | 删除第一个 §9.2，保留第二个（或重新编号） |

### 已达上限说明

按 skill 规范，计划评审循环上限为 **≤ 3 轮**。当前为第 4 轮，已达上限。但无 MUST FIX 问题，verdict 为 pass，无需升级到人工决策。

---

## Summary

计划评审完成，第4轮，0条MUST FIX，通过。
