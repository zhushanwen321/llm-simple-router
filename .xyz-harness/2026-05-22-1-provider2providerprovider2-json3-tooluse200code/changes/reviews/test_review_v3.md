---
review:
  type: test_review
  round: 3
  timestamp: "2026-05-22T16:00:00"
  target: "spec.md AC1-AC8 / test_execution.json / test_results.md"
  verdict: fail
  summary: "测试评审完成，第3轮，2条MUST FIX未解决，已达循环上限，需人工决策"

verdict: fail
must_fix: 2

statistics:
  total_issues: 6
  must_fix: 2
  must_fix_resolved: 0
  low: 0
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "AC4: stream_error 格式化响应无集成测试覆盖"
    title: "stream_error 重试耗尽后格式化 JSON 响应路径无端到端自动测试"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: MUST_FIX
    location: "AC6: RetryRules.vue 前端 UI（Provider 选择）"
    title: "RetryRules.vue 的 Provider 选择功能无任何前端测试"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: MUST_FIX
    location: "AC7: RetryRules.vue 前端 UI（JSON 字段匹配编辑）"
    title: "RetryRules.vue 的 JSON 字段匹配编辑功能无任何前端测试"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "AC1: created_at DESC 排序未测试"
    title: "多条绑定规则按 created_at DESC 排序的优先级未验证"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 5
    severity: LOW
    location: "AC8: 向后兼容无显式测试"
    title: "无显式测试验证不传新字段创建规则的行为"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 6
    severity: INFO
    location: "test_execution.json: TC-3-02"
    title: "TC-3-02 的通过证据依赖代码审查而非自动化测试"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
---

# 测试评审 v3

## 评审记录
- 评审时间：2026-05-22 16:00
- 评审类型：测试评审
- 评审对象：test_execution.json（23 条记录）、test_results.md
- 评审轮次：3

---

## 本轮变更（v2 → v3）

**无新测试证据提交。**

test_execution.json 中无 round 3 条目。test_results.md 内容与 v2 轮状态一致，AC6/AC7 仍标注为仅 API 数据层覆盖。

| # | 优先级 | 问题 | v2 状态 | v3 状态 |
|---|--------|------|---------|---------|
| 1 | MUST FIX | AC4 stream_error 端到端测试 | ✅ resolved | ✅ resolved |
| 2 | MUST FIX | AC6 前端 Provider 选择 | ❌ open | ❌ **open（未修复）** |
| 3 | MUST FIX | AC7 前端 JSON 匹配编辑 | ❌ open | ❌ **open（未修复）** |
| 4 | LOW | AC1 created_at DESC 排序 | ✅ resolved | ✅ resolved |
| 5 | LOW | AC8 向后兼容 | ✅ resolved | ✅ resolved |
| 6 | INFO | TC-3-02 依赖代码审查 | ✅ resolved | ✅ resolved |

---

## AC 覆盖矩阵

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC1 | Provider A 绑定规则优先于 Provider B | ✅ | retry-rule-matcher.test.ts: "prefers provider-bound over global" |
| AC1 | 无绑定规则时 fallback 到通用规则 | ✅ | retry-rule-matcher.test.ts: "falls back to global when no provider-specific rule matches" |
| AC1 | 绑定规则不匹配时 fallback 到通用规则 | ✅ | retry-rule-matcher.test.ts: fallback scenario |
| AC1 | 多条绑定规则按 created_at DESC 排序 | ✅ | admin-retry-rules-provider.test.ts: 排序优先级测试（v2 新增） |
| AC2 | equals 操作符精确匹配 | ✅ | body-matcher.test.ts: equals tests |
| AC2 | contains 操作符子串匹配 | ✅ | body-matcher.test.ts: contains tests |
| AC2 | exists 操作符字段存在即匹配 | ✅ | body-matcher.test.ts: exists tests |
| AC2 | AND 逻辑（多条件同时满足） | ✅ | body-matcher.test.ts: AND logic tests |
| AC2 | 非 JSON body 返回 false → fallback 到正则 | ✅ | body-matcher.test.ts: "returns false on invalid JSON" |
| AC2 | 嵌套路径正确解析 | ✅ | body-matcher.test.ts: resolvePath nested/deeply nested |
| AC3 | 429 usage-limit 不再误触发其他 provider 重试 | ✅ | integration-retry-rules.test.ts: TC-3-01 |
| AC4 | stream_error 重试耗尽后客户端收到 JSON 错误 | ✅ | integration-retry-rules.test.ts: "stream request with 429 upstream returns JSON error"（v2 新增） |
| AC4 | client_status_code 正确记录 | ⚠️ | 验证了响应 statusCode=429，但未显式查询 request_logs 确认 client_status_code 持久化 |
| AC5 | 最终失败请求写入 upstream_error_logs | ✅ | integration-retry-rules.test.ts: TC-5-01 |
| AC5 | error_type 和 error_message 正确提取 | ✅ | extract-error-info.test.ts: TC-6-01（6 个子场景） |
| **AC6** | **Dialog 中可选择 provider 或 "通用"** | **❌** | **无前端组件测试** |
| **AC6** | **绑定规则表格显示 provider 名称** | **❌** | **无前端组件测试** |
| **AC6** | **通用规则表格显示 "通用" Badge** | **❌** | **无前端组件测试** |
| **AC7** | **Tab 切换正则/JSON 匹配模式** | **❌** | **无前端组件测试** |
| **AC7** | **JSON 模式下可增删匹配条件行** | **❌** | **无前端组件测试** |
| **AC7** | **exists 操作符隐藏值输入** | **❌** | **无前端组件测试** |
| AC7 | 保存时正确序列化 body_matchers JSON | ✅ | admin-retry-rules-provider.test.ts: body_matchers round-trip（仅 API 序列化） |
| AC8 | 现有规则行为不变（不传新字段） | ✅ | admin-retry-rules-provider.test.ts: AC8（v2 新增） |

---

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 2 | MUST FIX | AC6: RetryRules.vue 前端 UI | **RetryRules.vue 的 Provider 选择功能仍无前端测试覆盖。** 后端 API round-trip 测试仅验证了数据能正确序列化/反序列化，未验证 Dialog 中 Provider Select 组件可交互选择 provider/通用、表格列显示 provider 名称、通用规则显示 Badge。这些是 spec AC6 明确要求的 UI 行为。超过 2 轮仍未修复。 | 添加组件测试覆盖：(a) Dialog 打开后 Provider Select 默认值为"通用"，(b) 选择 provider 后表格行显示对应名称，(c) 选择"通用"后显示 Badge。 |
| 3 | MUST FIX | AC7: RetryRules.vue 前端 UI | **RetryRules.vue 的 JSON 字段匹配编辑功能仍无前端测试覆盖。** 后端 API round-trip 测试仅验证保存/读取数据，未验证 Tab 切换正则/JSON 模式、增删匹配条件行、exists 操作符隐藏值输入等 UI 交互。这些是 spec AC7 明确要求的 UI 行为。超过 2 轮仍未修复。 | 添加组件测试覆盖：(a) 切换到 JSON 匹配 Tab 后显示匹配条件列表，(b) 添加新条件行，(c) exists 操作符选择后值输入框隐藏，(d) 删除条件行，(e) 保存后序列化为正确的 body_matchers JSON。 |

---

## 已达循环上限

根据评审方法论，测试评审的循环上限为 **≤ 2 轮**。当前为第 3 轮，已达上限。

涉及的两条 MUST FIX（AC6 前端测试、AC7 前端测试）从第 1 轮提出至今均未解决。未解决的可能原因包括：
- 项目架构中可能缺乏前端组件测试基础设施（vitest + vue-test-utils 等）
- 或者测试执行未覆盖到 UI 层验证

**建议处理方式（升级到人工决策）：**

| 方案 | 适用场景 |
|------|---------|
| **A. 添加前端组件测试** | 项目已有 @vue/test-utils 等设施，仅需补写测试 |
| **B. 添加 Playwright/Cypress E2E 测试** | 项目倾向端到端覆盖而非组件测试 |
| **C. 记录为已知风险，文档化手动验证流程** | 如果项目决定暂时不添加前端测试基础设施 |
| **D. 降级 AC6/AC7 为仅后端验证** | 如果 spec 可以调整（需要修改 spec.md） |

**建议：** 如果项目当前无前端测试基础设施，推荐方案 C（记录风险 + 手动验证 SOP），同时在后续迭代中逐步搭建前端测试框架。

---

## 结论

**已达循环上限，升级到人工决策**

2 条 MUST FIX 问题在 3 轮评审后仍未解决：
- AC6: RetryRules.vue Provider 选择 UI 无组件测试
- AC7: RetryRules.vue JSON 字段匹配编辑 UI 无组件测试

后端测试覆盖完善（AC1-AC5, AC8 全部通过），2 条 MUST FIX 均为前端 UI 测试缺口。

---

## Summary

测试评审完成，第3轮，2条MUST FIX，已达循环上限，需人工决策。
