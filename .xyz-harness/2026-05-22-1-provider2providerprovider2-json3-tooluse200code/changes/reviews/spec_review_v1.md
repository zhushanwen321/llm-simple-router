---
verdict: pass
must_fix: 0
---

# Spec Review — retry-rule-upgrade

## Summary

Spec 结构完整，9 个 FR 覆盖从 DB schema 到前端的完整链路，8 个 AC 均可测试。Background 的问题起源和根因分析清晰，与代码交叉引用一致。无 MUST FIX 问题。

## Issues Found

### SHOULD FIX (2)

1. **FR4 stream_error 修复缺少 `stream_error + statusCode >= failoverThreshold` 的分支覆盖**
   - 当前 FR4 描述了 stream_error 重试耗尽的场景，但 resilience.ts 的 decide() 中 stream_error + statusCode >= 400 走的是通用 `statusCode >= failoverThreshold` 分支（而非 stream_error 专用分支）。sendResponse 修改需同时覆盖这两个路径。
   - 风险低：实现时自然会覆盖，但 spec 可更精确。

2. **FR5 error_type 提取逻辑未定义**
   - 写入 upstream_error_logs 时 "从 responseBody 中提取 error_type"，但未定义提取规则（优先 `error.type`？还是 `error.code`？回退逻辑？）。不同 provider 的错误格式差异大。
   - 建议明确提取优先级：`error.type` > `error.code` > `null`。

### NICE TO HAVE (1)

3. **FR6 前端缺少 body_matchers 为空 + body_pattern 也为空时的交互**
   - 新建规则时，用户未填写任何匹配条件（两个 Tab 都为空），保存行为未定义。应要求至少填写一种匹配条件（与现有 body_pattern required 校验一致）。

## Verification

### 六要素检查

| 要素 | 状态 | 说明 |
|------|------|------|
| **Outcomes** | PASS | 明确：provider 隔离 + JSON 匹配 + stream_error 修复 + 错误日志，可验证的终态 |
| **Scope boundaries** | PASS | In-scope 清晰（FR1-FR9），Constraints 列出技术约束 |
| **Constraints** | PASS | 7 条约束涵盖 DB 兼容性、API 兼容性、UI 框架、测试、性能 |
| **Decisions made** | PASS | body_matchers JSON 格式、provider_id Nullable、正则 fallback、AI 不自动绑定 provider |
| **Task breakdown** | N/A | Plan 阶段处理 |
| **Verification** | PASS | 8 个 AC 可测试，含具体测试场景 |

### AC 可测试性检查

| AC | 可测试 | 说明 |
|----|--------|------|
| AC1 | 是 | 纯函数 + 集成测试，3 个测试场景 |
| AC2 | 是 | 纯函数 matchBodyMatchers()，6 个场景覆盖 3 个操作符 + fallback |
| AC3 | 是 | 端到端：绑定规则不重试 usage-limit |
| AC4 | 是 | 集成测试：stream_error 路径验证响应格式 |
| AC5 | 是 | DB 查询验证写入正确性 |
| AC6 | 是 | 前端组件测试 |
| AC7 | 是 | 前端组件测试 |
| AC8 | 是 | 回归测试：现有规则行为不变 |

### 与 CLAUDE.md 一致性

- parseModels() 规范：FR7 迁移不改 providers.models，无需适配
- ESLint taste 规则：Constraints 明确禁止 eslint-disable
- 前端 shadcn-vue：FR6 明确使用 Select/Input/Badge 组件
- tool-error-logger 参考：FR5 模式一致

### 模糊性检查

无 `[AMBIGUOUS]` 标记。唯一模糊点是 error_type 提取逻辑（SHOULD FIX #2）。

## Conclusion

Spec 质量合格，无 MUST FIX。2 个 SHOULD FIX 可在实现阶段处理，不影响 plan 编写。
