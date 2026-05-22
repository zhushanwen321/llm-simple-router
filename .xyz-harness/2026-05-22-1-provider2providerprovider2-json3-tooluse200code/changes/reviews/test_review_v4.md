---
verdict: fail
must_fix: 2

review:
  type: test_review
  round: 4
  timestamp: "2026-05-22T16:30:00"
  target: "spec.md / test_execution.json / test_results.md / ac6-frontend-verification.md"
  verdict: fail
  summary: "测试评审完成，第4轮，2条MUST FIX未解决，已达循环上限，需人工决策"

statistics:
  total_issues: 6
  must_fix: 2
  must_fix_resolved: 0
  low: 0
  info: 0

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
---

# 测试评审 v4

## 评审记录
- 评审时间：2026-05-22 16:30
- 评审类型：测试评审
- 评审对象：test_execution.json（23 条记录）、test_results.md、ac6-frontend-verification.md
- 评审轮次：4

---

## 本轮变更（v3 → v4）

**test_execution.json 内容与 v3 轮一致，无新增前端测试证据。**

key 观察：

| 观察 | 状态 |
|------|------|
| test_execution.json 新增 round 条目 | ❌ 无（与 v3 相同） |
| ac6-frontend-verification.md 存在 | ✅ 但这是**手动验证文档**，非自动化测试 |
| 前端测试文件 (`frontend/src/**/*.test.*`) | ❌ 项目无前端测试基础设施 |
| 后端测试全部通过 (126 files, 1501 tests) | ✅ |

---

## AC 覆盖矩阵

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC1 | Provider A 绑定规则优先于 Provider B | ✅ | retry-rule-matcher.test.ts: prefers provider-bound |
| AC1 | 无绑定规则时 fallback 到通用规则 | ✅ | retry-rule-matcher.test.ts: falls back to global |
| AC1 | 绑定规则不匹配时 fallback 到通用规则 | ✅ | retry-rule-matcher.test.ts: fallback scenario |
| AC1 | 多条绑定规则按 created_at DESC 排序 | ✅ | admin-retry-rules-provider.test.ts: 排序优先级测试 |
| AC2 | equals 操作符精确匹配 | ✅ | body-matcher.test.ts: equals tests |
| AC2 | contains 操作符子串匹配 | ✅ | body-matcher.test.ts: contains tests |
| AC2 | exists 操作符字段存在即匹配 | ✅ | body-matcher.test.ts: exists tests |
| AC2 | AND 逻辑（多条件同时满足） | ✅ | body-matcher.test.ts: AND logic tests |
| AC2 | 非 JSON body 返回 false → fallback 到正则 | ✅ | body-matcher.test.ts: returns false on invalid JSON |
| AC2 | 嵌套路径正确解析 | ✅ | body-matcher.test.ts: resolvePath nested/deeply nested |
| AC3 | 429 usage-limit 不再误触发其他 provider 重试 | ✅ | integration-retry-rules.test.ts: TC-3-01 |
| AC4 | stream_error 重试耗尽后客户端收到 JSON 错误 | ✅ | integration-retry-rules.test.ts: TC-3-02 (e2e) |
| AC4 | client_status_code 正确记录 | ⚠️ | 未显式查询 request_logs 确认持久化 |
| AC5 | 最终失败请求写入 upstream_error_logs | ✅ | integration-retry-rules.test.ts: TC-5-01 |
| AC5 | error_type 和 error_message 正确提取 | ✅ | extract-error-info.test.ts: 6 个子场景 |
| **AC6** | **Dialog 中可选择 provider 或 "通用"** | **❌** | **无前端测试。仅 ac6-frontend-verification.md 手动验证** |
| **AC6** | **绑定规则表格显示 provider 名称** | **❌** | **无前端测试。同上** |
| **AC6** | **通用规则表格显示 "通用" Badge** | **❌** | **无前端测试。同上** |
| **AC7** | **Tab 切换正则/JSON 匹配模式** | **❌** | **无前端测试** |
| **AC7** | **JSON 模式下可增删匹配条件行** | **❌** | **无前端测试** |
| **AC7** | **exists 操作符隐藏值输入** | **❌** | **无前端测试** |
| AC7 | 保存时正确序列化 body_matchers JSON | ✅ | admin-retry-rules-provider.test.ts (API round-trip) |
| AC8 | 现有规则行为不变（不传新字段） | ✅ | admin-retry-rules-provider.test.ts: AC8 |

> 覆盖状态定义：✅ = 有自动化测试且断言充分；⚠️ = 有测试但覆盖不完整；❌ = 无自动化测试

---

## 检查维度逐项分析

### 1. 测试覆盖度

**后端覆盖（✅ 良好）：**
- body-matcher 单元测试: 22 tests，覆盖 equals/contains/exists/AND/non-JSON/nested path
- retry-rule-matcher 单元测试: 15 tests，覆盖 provider 隔离、fallback、匹配优先级
- 集成测试: TC-3-01 (provider-bound retry)、TC-3-02 (stream error e2e)、TC-5-01 (error logs)
- Admin API 测试: 11 tests，覆盖 CRUD + body_matchers + provider_id + backward compat
- extract-error-info: 6 tests，覆盖 type/code/fallback/edge cases

**前端覆盖（❌ 未满足 spec）：**
AC6 的三个 UI 行为（Dialog Provider Select、表格 Provider 列、通用 Badge）和 AC7 的三个 UI 行为（Tab 切换、条件行增删、exists 隐藏值输入）均 **无自动化测试覆盖**。仅存在：
- 后端 API round-trip 测试（仅验证数据序列化，不验证 UI 交互）
- `ac6-frontend-verification.md` — 手动验证文档，不是可重复的自动化测试

### 2. 测试质量

后端测试质量良好：
- 断言具体（验证具体返回值，非仅"不抛异常"）
- body-matcher 包含边界情况（非 JSON body、无效路径）
- extract-error-info 覆盖 type/code/无 error 字段/无效 JSON/非字符串类型
- 集成测试验证具体的 HTTP statusCode 和 JSON body 结构

### 3. 测试可维护性

- 测试结构清晰（Arrange-Act-Assert 模式）
- 测试之间独立（各自创建/清理测试数据）
- 辅助函数（`createMockBackend()`、`buildTestApp()` 等）合理抽取

### 4. 数据构造合理性

- 测试数据贴近真实场景（429/500 状态码、JSON body 结构）
- Mock 后端使用 `http.createServer()` 模拟真实上游，不 mock 被测对象本身
- magic number 有说明（如 `max_retries=0` 表示禁止重试）

---

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 2 | MUST FIX | AC6: RetryRules.vue 前端 UI | **RetryRules.vue 的 Provider 选择功能仍无前端自动化测试。** 自 round 1 起连续 4 轮未解决。后端 API round-trip 测试仅验证了数据序列化，3 个 spec 要求的前端行为（Dialog Provider Select、表格 Provider 列、通用 Badge）均无自动化验证。`ac6-frontend-verification.md` 是手动验证文档，不可作为可重复的 CI 测试。 | 方案 A：添加 vue-test-utils 组件测试覆盖 Dialog Provider Select、表格 Provider 列渲染、Badge 显示。方案 B：添加 Playwright E2E 测试覆盖完整交互流程。方案 C：降级 AC6 为仅后端验证（需改 spec）。 |
| 3 | MUST FIX | AC7: RetryRules.vue JSON 字段匹配编辑 UI | **RetryRules.vue 的 JSON 字段匹配编辑功能仍无前端自动化测试。** 自 round 1 起连续 4 轮未解决。后端 API round-trip 测试仅覆盖了 body_matchers 的序列化/反序列化，3 个 spec 要求的前端行为（Tab 切换、条件行增删、exists 隐藏值输入）均无自动化验证。 | 方案 A：添加 vue-test-utils 组件测试覆盖 Tab 切换、条件行增删、exists 隐藏值输入、保存后序列化。方案 B：添加 Playwright E2E 测试。方案 C：降级 AC7 为仅后端验证（需改 spec）。 |

---

## 已达循环上限

根据评审方法论，测试评审的循环上限为 **≤ 2 轮**。当前为第 4 轮，远超上限。

两条 MUST FIX 问题（AC6 前端测试、AC7 前端测试）从第 1 轮（v1）提出至今，跨越 4 轮评审均未解决。根本原因是**项目无前端测试基础设施**（`frontend/src/` 下无任何 `.test.ts` 文件），而 spec 的 AC6/AC7 要求的是前端 UI 行为。

### 人工决策建议

| 方案 | 操作 | 对 verdict 影响 |
|------|------|----------------|
| **A. 补充前端自动化测试** | 安装 vue-test-utils + vitest，编写 RetryRules.vue 组件测试 | 解决 MUST FIX → verdict pass |
| **B. 添加 Playwright E2E** | 安装 Playwright，覆盖 AC6/AC7 交互流程 | 解决 MUST FIX → verdict pass |
| **C. 手动验证 + 文档化 SOP** | 保留手动验证脚本，在 test_results.md 中声明手动验证结论 | **不解决** MUST FIX，需修改 spec 降级 AC |
| **D. 修改 spec，降级 AC6/AC7 为后端验证** | 更新 spec.md 将 AC6/AC7 从 UI 行为降级为 API 数据层验证 | 消除 MUST FIX 基础 → verdict pass |

**推荐：** 如果项目当前阶段不准备引入前端测试框架，方案 D（修改 spec）是最务实的路径。如果 spec 不可修改，则必须执行方案 A 或 B。

---

## 结论

**已达循环上限，需人工决策**

2 条 MUST FIX 问题在 4 轮评审后仍未解决：
- AC6: RetryRules.vue Provider 选择 UI 无自动化测试
- AC7: RetryRules.vue JSON 字段匹配编辑 UI 无自动化测试

后端测试覆盖完善（AC1-AC5, AC8 全部通过，126 个测试文件 1501 个测试全部通过）。2 条 MUST FIX 均为前端 UI 测试缺口，根因是项目无前端测试基础设施。

---

## Summary

测试评审完成，第4轮，2条MUST FIX，已达循环上限，需人工决策。
