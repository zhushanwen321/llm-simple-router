---
verdict: fail
must_fix: 2

review:
  type: test_review
  round: 6
  timestamp: "2026-05-22T17:10:00"
  target: "spec.md / test_execution.json / test_results.md"
  verdict: fail
  summary: "测试评审完成，第6轮，2条MUST FIX未解决，远超循环上限，需人工决策"

statistics:
  total_issues: 8
  must_fix: 2
  must_fix_resolved: 0
  low: 2
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "AC4: stream_error end-to-end test"
    title: "stream_error 重试耗尽后格式化 JSON 响应路径无端到端自动测试"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: MUST_FIX
    location: "AC6: RetryRules.vue Provider 选择 UI"
    title: "RetryRules.vue 的 Provider 选择功能无任何前端组件测试或 E2E 测试"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: MUST_FIX
    location: "AC7: RetryRules.vue JSON 字段匹配编辑 UI"
    title: "RetryRules.vue 的 JSON 字段匹配编辑功能无任何前端组件测试或 E2E 测试"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "AC1: created_at DESC 排序"
    title: "多条绑定规则按 created_at DESC 排序的优先级未显式验证"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 5
    severity: LOW
    location: "AC8: 向后兼容"
    title: "无显式测试验证不传新字段创建规则的行为"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 6
    severity: INFO
    location: "test_execution.json: TC-3-02 round 1"
    title: "TC-3-02 round 1 的通过证据依赖代码审查而非自动化测试"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 7
    severity: INFO
    location: "changes/evidence/frontend-component-verify.mjs"
    title: "新增静态代码分析脚本 frontend-component-verify.mjs，但非运行时组件测试"
    status: open
    raised_in_round: 5
    resolved_in_round: null
  - id: 8
    severity: LOW
    location: "changes/evidence/test_results.md AC6/AC7 声明"
    title: "test_results.md 声称 AC6/AC7 覆盖率 ✅，但仅基于 API 数据层测试，未覆盖 UI 交互行为"
    status: open
    raised_in_round: 5
    resolved_in_round: null
---

# 测试评审 v6

## 评审记录
- 评审时间：2026-05-22 17:10
- 评审类型：测试评审
- 评审对象：spec.md、test_execution.json、test_results.md、router/tests/frontend-types.test.ts
- 评审轮次：6

---

## 本轮变更（v5 → v6）

| 项目 | v5 状态 | v6 状态 | 变更 |
|------|---------|---------|------|
| test_execution.json | 22 条记录 | 18 条记录 | test_execution.json 已清理，去除了重复/非正式条目 |
| test_results.md | 存在 | 存在 | 无变化 |
| **router/tests/frontend-types.test.ts** | **不存在** | **存在** | **新增后端类型验证测试（2 tests）** |
| frontend-component-verify.mjs | 存在 | 存在 | 无变化 |
| 前端测试文件 (`frontend/src/**/*.test.*`) | 不存在 | 不存在 | 无变化 |
| 后端测试全部通过 | ✅ (126 files, 1501 tests) | ✅ (最新 commit 测试通过) | 无变化 |

### 关键变更

**新增 `router/tests/frontend-types.test.ts`：**
- 2 个测试用例，在 vitest 环境中运行
- 测试 1 (AC6)：验证 `provider_id` 字段可以正确判断"绑定"vs"通用"规则
- 测试 2 (AC7)：验证 `body_matchers` JSON 的解析和序列化往返
- **优势：** 轻量、执行快（1ms）、验证了前端将处理的数据形状
- **局限：** 仍然是后端 Node.js 环境测试，不涉及 Vue 组件渲染、DOM 交互、事件处理
- 未在 `test_execution.json` 中记录执行结果

**`test_execution.json` 清理：**
- 从 22 条记录减少到 18 条记录
- 去除了一些重复/非正式条目（如 AC7 去重条目）
- 未新增任何前端运行时测试记录

---

## AC 覆盖矩阵

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC1 | Provider A 绑定规则优先于 Provider B | ✅ | retry-rule-matcher.test.ts: prefers provider-bound |
| AC1 | 无绑定规则时 fallback 到通用规则 | ✅ | retry-rule-matcher.test.ts: falls back to global |
| AC1 | 绑定规则不匹配时 fallback 到通用规则 | ✅ | retry-rule-matcher.test.ts: fallback scenario |
| AC1 | 多条绑定规则按 created_at DESC 排序 | ✅ | admin-retry-rules-provider.test.ts |
| AC2 | equals 操作符精确匹配 | ✅ | body-matcher.test.ts |
| AC2 | contains 操作符子串匹配 | ✅ | body-matcher.test.ts |
| AC2 | exists 操作符字段存在即匹配 | ✅ | body-matcher.test.ts |
| AC2 | AND 逻辑（多条件同时满足） | ✅ | body-matcher.test.ts |
| AC2 | 非 JSON body 返回 false → fallback 到正则 | ✅ | body-matcher.test.ts |
| AC2 | 嵌套路径正确解析 | ✅ | body-matcher.test.ts |
| AC3 | 429 usage-limit 不再误触发其他 provider 重试 | ✅ | integration-retry-rules.test.ts: TC-3-01 |
| AC4 | stream_error 重试耗尽后客户端收到 JSON 错误 | ✅ | integration-retry-rules.test.ts: TC-3-02 (e2e) |
| AC4 | client_status_code 正确记录到 request_logs | ⚠️ | 未显式查询 request_logs 确认持久化 |
| AC5 | 最终失败请求写入 upstream_error_logs | ✅ | integration-retry-rules.test.ts: TC-5-01 |
| AC5 | error_type 和 error_message 正确提取 | ✅ | extract-error-info.test.ts: 6 个子场景 |
| AC5 | retry_count 记录正确 | ⚠️ | TC-5-01 查询了 provider_id/status_code/error_type/error_message，未显式验证 retry_count |
| AC5 | 日志可按 provider_id/status_code/created_at 查询 | ⚠️ | 索引有效性未验证 |
| **AC6** | **Dialog 中可选择 provider 或 "通用"** | **❌** | 无运行时前端测试 |
| **AC6** | **绑定规则表格显示 provider 名称** | **❌** | 无运行时前端测试 |
| **AC6** | **通用规则表格显示 "通用" Badge** | **❌** | 无运行时前端测试 |
| **AC6** | **新增：数据形状验证（provider_id null/non-null）** | **⚠️** | frontend-types.test.ts（类型验证，非 UI 测试） |
| **AC7** | **Tab 切换正则/JSON 匹配模式** | **❌** | 无运行时前端测试 |
| **AC7** | **JSON 模式下可增删匹配条件行** | **❌** | 无运行时前端测试 |
| **AC7** | **exists 操作符隐藏值输入** | **❌** | 无运行时前端测试 |
| AC7 | 保存时正确序列化 body_matchers JSON | ✅ | frontend-types.test.ts + admin-retry-rules-provider.test.ts |
| AC8 | 现有规则行为不变（不传新字段） | ✅ | admin-retry-rules-provider.test.ts |

---

## 检查维度逐项分析

### 1. 测试覆盖度

**后端覆盖（✅ 覆盖良好）：**
- body-matcher 单元测试: 22 tests，覆盖所有操作符和边界
- retry-rule-matcher 单元测试: 15 tests，覆盖 provider 隔离、fallback、body_matchers 优先级
- 集成测试: TC-3-01 (provider 绑定) + TC-3-02 (stream error e2e) + TC-5-01 (error logs)
- Admin API 测试: 6+ tests，覆盖 CRUD + 新字段 + 向后兼容
- extract-error-info: 6 tests，覆盖各种 error 提取场景
- **新增: frontend-types.test.ts: 2 tests，验证数据形状**

**前端覆盖（❌ 仍无运行时测试）：**
- `frontend-component-verify.mjs`（静态代码分析）：14 项检查全部通过，验证 RetryRules.vue 包含预期的代码模式
- `frontend-types.test.ts`（新增后端类型验证）：2 项检查通过，验证 provider_id/body_matchers 数据形状
- **仍然没有 vue-test-utils 组件测试、Playwright E2E 测试或其他前端运行时测试**
- 无法验证 Select 组件渲染、Tab 切换交互、条件行增删、exists 隐藏值等运行时行为

### 2. 测试质量

所有后端测试质量保持良好，断言具体、覆盖边界、独立可重复。

`frontend-types.test.ts` 作为类型验证测试：
- 断言合理（验证 null vs string 区分、JSON 往返一致、operator 类型判断）
- 但不能替代 UI 测试——"测试业务逻辑/数据形状"不等于"测试用户交互"
- 适合作为补充验证层，但不能作为 AC6/AC7 的主要覆盖手段

### 3. 测试可维护性

- 后端测试结构清晰，Arrange-Act-Assert 模式
- `frontend-types.test.ts` 结构简洁，2 个独立测试用例

### 4. 数据构造合理性

- 测试数据贴近真实场景
- Mock 后端不 mock 被测对象

---

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 2 | MUST FIX | AC6: RetryRules.vue 前端 UI | **RetryRules.vue 的 Provider 选择功能仍无前端运行时自动化测试。** 自 round 1 起连续 6 轮未解决。新增 `frontend-types.test.ts`（后端类型验证）验证了 provider_id 数据形状，但无法替代 Vue 组件渲染/交互验证。 | 方案 A：添加 vue-test-utils 组件测试。方案 B：添加 Playwright E2E 测试。方案 C：修改 spec 降级 AC6/AC7 为仅数据层验证。 |
| 3 | MUST FIX | AC7: RetryRules.vue JSON 字段匹配编辑 UI | **RetryRules.vue 的 JSON 字段匹配编辑功能仍无前端运行时自动化测试。** 新增 `frontend-types.test.ts` 验证了 body_matchers JSON 往返，但无法验证 Tab 切换、条件行增删、exists 隐藏值等交互行为。 | 同上。 |
| 7 | INFO | evidence/frontend-component-verify.mjs | 静态代码分析脚本，14 项检查全部通过。可验证 RetryRules.vue 中 AC6/AC7 相关代码模式的存在性。未集成 CI，未在 test_execution.json 中记录。 | 可选集成到 CI 或记录到 test_execution.json。 |
| 8 | LOW | evidence/test_results.md | test_results.md 中 AC6 和 AC7 覆盖状态标记为 ✅。新增的 `frontend-types.test.ts` 提供了数据层验证，但 AC6/AC7 的 UI 交互行为仍未覆盖。 | 修正 test_results.md，将 AC6/AC7 覆盖状态改为 ⚠️ 或 ✅（仅数据层），并注明覆盖范围。 |

---

## 已达循环上限

根据测试评审方法论，循环上限为 **≤ 2 轮**。当前为第 6 轮，远超上限。

两条 MUST FIX 问题（AC6/AC7 前端测试）从第 1 轮提出至今，跨越 6 轮评审均未完全解决。根本原因是**项目无前端测试基础设施**（`frontend/src/` 下无任何 `.test.ts` 文件），而 spec 的 AC6/AC7 要求的是前端 UI 行为验证。

### 本轮进展记录

v5 → v6 期间新增：
1. **`router/tests/frontend-types.test.ts`**（2 tests）：后端类型验证测试，验证 provider_id 和 body_matchers 的数据形状正确性
2. **test_execution.json 已清理**：去除了重复/非正式条目

### 问题未解决原因

`frontend-types.test.ts` 验证的是"RetryRule 对象的字段是否存在、JSON 能否正确 parse/serialize"——这是 **确认数据格式正确**，而非 **测试 UI 行为**。spec 的 AC6 要求的是：
- "Dialog 中可选择 provider 或 '通用'" → UI 交互
- "绑定规则在表格中显示 provider 名称" → DOM 渲染
- "通用规则显示 Badge" → 条件渲染

这些都无法通过纯后端类型测试覆盖。

### 人工决策建议（同 v5）

| 方案 | 操作 | 对 verdict 影响 |
|------|------|----------------|
| **A. 补充前端自动化测试** | 安装 vue-test-utils + vitest 或 Playwright | 解决 MUST FIX → verdict pass |
| **B. 修改 spec 降级 AC6/AC7** | 将 AC6/AC7 从 UI 行为降级为 API 数据层验证 | 消除 MUST FIX → verdict pass |
| **C. 维持现状+人工审查** | 每次前端变更后人工验证 + 静态分析 | MUST FIX 状态不变 → verdict fail |

---

## 结论

**已达循环上限，需人工决策**

2 条 MUST FIX 问题在 6 轮评审后仍未解决：
- AC6: RetryRules.vue Provider 选择 UI 无运行时自动化测试
- AC7: RetryRules.vue JSON 字段匹配编辑 UI 无运行时自动化测试

后端测试覆盖完善（AC1-AC5, AC8 全部通过），新增的 `frontend-types.test.ts` 提供了数据形状验证。但项目缺乏前端测试基础设施，spec 对 AC6/AC7 的 UI 行为要求无法通过后端测试满足。

---

## Summary

测试评审完成，第6轮，2条MUST FIX，远超循环上限，需人工决策。
