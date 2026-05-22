---
review:
  type: test_review
  round: 2
  timestamp: "2026-05-22T15:00:00"
  target: "spec.md AC1-AC8 / test_cases_template.json / test_execution.json"
  verdict: fail
  summary: "测试评审完成，第2轮，2条MUST FIX，需修改后重审"

statistics:
  total_issues: 6
  must_fix: 2
  must_fix_resolved: 1
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
    location: "AC6: 前端 Provider 选择无测试覆盖"
    title: "RetryRules.vue 的 Provider 选择功能无任何前端测试"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: MUST_FIX
    location: "AC7: 前端 JSON 字段匹配编辑无测试覆盖"
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

# 测试评审 v2

## 评审记录
- 评审时间：2026-05-22 15:00
- 评审类型：测试评审
- 评审对象：test_execution.json（24 条记录，含 round 2 新增）
- 评审轮次：2

## 变更摘要（v1 → v2）

| # | 优先级 | 原问题 | v2 状态 |
|---|--------|--------|---------|
| 1 | MUST FIX | AC4: stream_error 格式化无端到端测试 | **已解决** — 新增集成测试 `'stream request with 429 upstream returns JSON error (not SSE)'`，验证 429 + Content-Type JSON + body 含 error 字段 |
| 2 | MUST FIX | AC6: 前端 Provider 选择无测试覆盖 | **未解决** — 仅增加后端 API round-trip 测试，未覆盖前端 UI 行为 |
| 3 | MUST FIX | AC7: 前端 JSON 匹配编辑无测试覆盖 | **未解决** — 仅增加后端 API round-trip 测试，未覆盖前端 UI 行为 |
| 4 | LOW | AC1: created_at DESC 排序未测试 | **已解决** — 新增排序优先级测试 `'多条 provider 绑定规则按 created_at DESC 排序优先'` |
| 5 | LOW | AC8: 向后兼容无显式测试 | **已解决** — 新增测试验证不传新字段创建规则时 provider_id/body_matchers 为 null |
| 6 | INFO | TC-3-02 依赖代码审查 | **已解决** — 新增集成测试覆盖 stream_error 路径 |

### 本轮修复总结

第 2 轮新增的测试（基于 test_execution.json 证据）：

| 测试位置 | 覆盖内容 | 关联 AC/TC |
|----------|---------|-----------|
| `integration-retry-rules.test.ts` | stream 请求 + 429 上游 → 返回 JSON 错误（非 SSE） | TC-3-02 / AC4 |
| `admin-retry-rules-provider.test.ts` | 多条 provider 绑定规则按 created_at DESC 排序优先 | AC1 |
| `admin-retry-rules-provider.test.ts` | 多条规则 mixed provider_id | AC6 (后端) |
| `admin-retry-rules-provider.test.ts` | body_matchers 多条件 round-trip | AC7 (后端) |
| `admin-retry-rules-provider.test.ts` | body_matchers=null 场景 | AC7 |
| `admin-retry-rules-provider.test.ts` | 不传新字段创建规则 → provider_id=null, body_matchers=null | AC8 |

## AC 覆盖矩阵

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC1 | Provider A 的绑定规则不匹配 Provider B 的 429 | ✅ | retry-rule-matcher.test.ts: "prefers provider-bound over global" |
| AC1 | 无绑定规则时 fallback 到通用规则 | ✅ | retry-rule-matcher.test.ts: "falls back to global when no provider-specific rule matches" |
| AC1 | 绑定规则不匹配时 fallback 到通用规则 | ✅ | retry-rule-matcher.test.ts: fallback scenario |
| AC1 | 多条绑定规则按 created_at DESC 排序 | ✅ | admin-retry-rules-provider.test.ts: 排序优先级测试（**本轮新增**） |
| AC2 | equals 操作符精确匹配 | ✅ | body-matcher.test.ts: equals tests |
| AC2 | contains 操作符子串匹配 | ✅ | body-matcher.test.ts: contains tests |
| AC2 | exists 操作符字段存在即匹配 | ✅ | body-matcher.test.ts: exists tests |
| AC2 | AND 逻辑（多条件同时满足） | ✅ | body-matcher.test.ts: AND logic tests |
| AC2 | 非 JSON body 返回 false → fallback 到正则 | ✅ | body-matcher.test.ts: "returns false on invalid JSON" |
| AC2 | 嵌套路径正确解析 | ✅ | body-matcher.test.ts: resolvePath nested/deeply nested |
| AC3 | 429 usage-limit 不再误触发其他 provider 重试 | ✅ | integration-retry-rules.test.ts: TC-3-01 |
| AC4 | stream_error 重试耗尽后客户端收到 JSON 错误 | ✅ | integration-retry-rules.test.ts: "stream request with 429 upstream returns JSON error"（**本轮新增**） |
| AC4 | client_status_code 正确记录 | ⚠️ | 已确认 TC-3-02 验证 statusCode=429，但未显式验证 request_logs 中的 client_status_code 字段 |
| AC5 | 最终失败请求写入 upstream_error_logs | ✅ | integration-retry-rules.test.ts: TC-5-01 |
| AC5 | error_type 和 error_message 正确提取 | ✅ | extract-error-info.test.ts: TC-6-01（6 个子场景） |
| AC6 | Dialog 中可选择 provider 或 "通用" | ❌ | **无前端组件测试** |
| AC6 | 绑定规则表格显示 provider 名称 | ❌ | **无前端组件测试** |
| AC6 | 通用规则表格显示 "通用" Badge | ❌ | **无前端组件测试** |
| AC7 | Tab 切换正则/JSON 匹配模式 | ❌ | **无前端组件测试** |
| AC7 | JSON 模式下可增删匹配条件行 | ❌ | **无前端组件测试** |
| AC7 | exists 操作符隐藏值输入 | ❌ | **无前端组件测试** |
| AC7 | 保存时正确序列化 body_matchers JSON | ✅ | admin-retry-rules-provider.test.ts: body_matchers round-trip（**本轮新增**，仅验证 API 序列化） |
| AC8 | 现有规则行为不变 | ✅ | admin-retry-rules-provider.test.ts: AC8（**本轮新增**） |

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 2 | MUST FIX | AC6: RetryRules.vue 前端 UI | **RetryRules.vue 的 Provider 选择功能仍无前端测试覆盖。** 后端 API round-trip 测试（admin-retry-rules-provider.test.ts）仅验证了数据能正确序列化/反序列化，未验证：Dialog 中 Provider Select 组件可选择 provider/通用、表格列显示 provider 名称、通用规则显示 Badge。这些是 spec AC6 明确要求的 UI 行为。 | 为 RetryRules.vue 添加组件测试：(a) Dialog 打开后 Provider Select 默认值为"通用"，(b) 选择 provider 后表格行显示对应名称，(c) 选择"通用"后显示 "通用" Badge。 |
| 3 | MUST FIX | AC7: RetryRules.vue 前端 UI | **RetryRules.vue 的 JSON 字段匹配编辑功能仍无前端测试覆盖。** 后端 API round-trip 测试只验证了保存/读取数据，未验证：Tab 切换正则/JSON 模式、增删匹配条件行、exists 操作符隐藏值输入等 UI 行为。这些是 spec AC7 明确要求的 UI 交互。 | 添加组件测试覆盖：(a) 切换到 JSON 匹配 Tab 后显示匹配条件列表，(b) 添加新条件行，(c) exists 操作符选择后值输入框隐藏，(d) 删除条件行，(e) 保存后序列化为正确的 body_matchers JSON。 |

### 已解决的问题（v2 轮）

| # | 优先级 | 原问题 | 解决方式 |
|---|--------|--------|---------|
| 1 | MUST FIX | AC4 stream_error 格式化无端到端测试 | integration-retry-rules.test.ts 新增 `'stream request with 429 upstream returns JSON error'`，验证 statusCode=429、Content-Type=application/json、body 含 error 字段 |
| 4 | LOW | AC1 created_at DESC 排序未测试 | admin-retry-rules-provider.test.ts 新增排序优先级测试 |
| 5 | LOW | AC8 向后兼容无显式测试 | admin-retry-rules-provider.test.ts 新增不传新字段创建规则的测试 |
| 6 | INFO | TC-3-02 依赖代码审查 | 已替换为集成测试 |

### AC4 ⚠️ 观察

AC4 的 `client_status_code` 记录验证为部分覆盖：新集成测试验证了客户端收到 statusCode=429，但未显式查询 `request_logs` 表中的 `client_status_code` 字段确认该值被正确持久化。建议 TC-3-02 验证断言中增加 `request_logs` 查询确认环节。

### 测试质量评估

**本轮改进亮点：**

1. **AC4 关键路径验证完善**：新增的 stream_error 集成测试覆盖了完整的 HTTP 响应路径（statusCode + Content-Type + body 格式），从"代码审查确认"升级为"自动化测试确认"，显著降低回归风险。

2. **AC1 排序优先级验证**：多条绑定规则 created_at DESC 排序的集成测试覆盖了一个重要的优先级逻辑，此前仅依赖单元测试的顺序无关假设。

3. **AC8 向后兼容显式化**：新增的旧字段创建规则测试明确验证了向后兼容性，降低迁移风险。

**仍存在的问题：**

1. **AC6/AC7 前端覆盖缺失**（见 MUST FIX）：2 个 AC 的前端 UI 行为完全无组件测试覆盖。后端 API 测试仅验证数据层，无法验证 UI 交互相应。如果项目当前无前端测试基础设施，建议至少添加 E2E 测试或手动验证 SOP 来弥补。

2. **AC4 日志验证缺口**：client_status_code 的 DB 持久化未显式验证（当前仅验证响应头），建议补充。

## 结论

**需修改后重审**

2 条 MUST FIX 问题仍未解决，均为 AC6/AC7 的前端 UI 测试覆盖缺口：
- AC6: RetryRules.vue Provider 选择 UI 无组件测试
- AC7: RetryRules.vue JSON 字段匹配编辑 UI 无组件测试

已解决的重要问题：AC4 stream_error 端到端测试（MUST FIX → resolved）、AC1 created_at DESC 排序测试（LOW → resolved）、AC8 向后兼容测试（LOW → resolved）。

## Summary

测试评审完成，第2轮，2条MUST FIX，需修改后重审。
