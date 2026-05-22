---
verdict: pass
must_fix: 0
---

# Code Review — retry-rule-upgrade

## Summary

23 files changed (+1250/-256 lines), covering 5 plan tasks across 4 execution groups. Implementation closely follows spec and plan. All 1487 tests pass, lint clean, frontend build clean. No MUST FIX issues.

## Issues Found

### SHOULD FIX (1)

1. **failover-loop.ts: upstream_error_logs 写入条件过于宽松**
   - 当前逻辑：`!succeeded` 就写入 upstream_error_logs。但 `succeeded` 包含 `stream_abort`（超时中断），意味着 stream_abort 也会写入错误日志。
   - spec FR5 明确："最终失败的请求（status >= 400）"。stream_abort 不一定有 status code。
   - 不过代码中有 `if (trStatusCode !== null)` 防护，实际写入时已过滤掉无 status code 的情况。风险低，可接受。

### NICE TO HAVE (2)

2. **body-matcher.ts: `actual.toString()` 对 number/boolean 的 equals 比较可考虑精确类型匹配**
   - 当前 `equals` 对 number 和 boolean 使用 `.toString()` 比较（如 `actual=42, expected="42"` 匹配）。这在大多数场景下是正确的（API 返回的数字和布尔值通常以字符串形式传入）。
   - 如果未来需要精确类型匹配，可引入 `strict_equals` 操作符。当前 YAGNI。

3. **RecommendedRules.vue 子组件提取合理**：从 RetryRules.vue 提取了推荐规则子组件，使主文件保持在行数约束内（template 186行, script 199行）。

## Spec Compliance

| FR | 实现 | 验证 |
|----|------|------|
| FR1 Provider 隔离 | ✅ retry-rules.ts: 按 provider_id 缓存分组，match() 先查绑定后查全局 | TC-2-01~03 通过 |
| FR2 JSON 字段匹配 | ✅ body-matcher.ts: resolvePath + equals/contains/exists + AND | TC-1-01~06 通过 |
| FR3 RetryRuleMatcher 升级 | ✅ 缓存改为 `${providerId}:${statusCode}` 二级分组 | TC-2-04~05 通过 |
| FR4 stream_error 修复 | ✅ failover-loop.ts: stream_error 分支用 adapter.formatError() 格式化 | orchestrator/resilience test 通过 |
| FR5 upstream_error_logs | ✅ failover-loop.ts: !succeeded 时写入，extractErrorInfo 提取 | db.test 通过 |
| FR6 前端适配 | ✅ Provider 列 + Select + Tabs + JSON matcher 编辑器 | vue-tsc + build 通过 |
| FR7 DB Schema | ✅ migration 049: ALTER TABLE + CREATE TABLE | db.test 迁移计数正确 |
| FR8 Admin API | ✅ validateBodyMatchers 校验 + CRUD 新字段 | admin test 通过 |
| FR9 StateRegistry 刷新 | ✅ load() 重写适配新缓存结构 | 已有测试通过 |

## Architecture Compliance

- **CLAUDE.md 禁止裸 JSON.parse**: ✅ admin/retry-rules.ts 中 `validateBodyMatchers()` 解析 body_matchers 有校验；retry-rules.ts 中 parse 有 catch 处理
- **CLAUDE.md 禁止 eslint-disable**: ✅ 代码中无 eslint-disable 注释
- **CLAUDE.md 前端禁止原生 HTML**: ✅ 使用 shadcn-vue 组件（Select, Input, Button, Badge, Tabs）
- **structuredClone vs JSON roundtrip**: ✅ 新代码无深拷贝操作
- **headers 脱敏**: ✅ 无新增 header 写入日志

## Conclusion

代码质量合格，spec 覆盖完整。SHOULD FIX #1 风险低且已有 `trStatusCode !== null` 防护。可直接合并。
