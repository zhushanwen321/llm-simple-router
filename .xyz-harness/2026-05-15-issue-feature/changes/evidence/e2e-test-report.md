# E2E Test Report: 映射原因追踪

**日期**: 2026-05-15
**测试基础设施**: buildApp + app.inject 集成测试（无 Playwright/Cypress）

## 测试结果总览

```
Test Files  5 passed (5)
   Tests  32 passed (32)
```

---

## TG1: resolveMapping 映射原因正确性

| TC | 测试 | 结果 |
|----|------|------|
| TC1.1 | direct_format — provider/model 直接格式 | ✅ PASS |
| TC1.2 | group_base_rule — 无 schedule 映射组 | ✅ PASS |
| TC1.2b | group_base_rule — schedule 未命中 | ✅ PASS |
| TC1.3 | group_schedule — 全天窗口 schedule 命中 | ✅ PASS |
| TC1.4 | fallback_provider — 无映射组回退匹配 | ✅ PASS |
| TC1.5 | overflow_redirect — context 超限触发 | ✅ PASS |
| TC1.5b | 无 overflow 时不设置 overflow_redirect | ✅ PASS |
| TC1.6 | failover_retry — 第 2+ 次迭代 | ✅ PASS |
| TC1.6b | 首次迭代不设 failover_retry | ✅ PASS |

## TG2: pipeline_snapshot 完整性

| TC | 测试 | 结果 |
|----|------|------|
| TC2.1 | routing stage 包含 mapping_reason | ✅ 随 TC1 验证 |
| TC2.2 | overflow 双记录（routing + overflow stage） | ✅ 随 TC1.5 验证 |
| TC2.3 | 历史数据兼容（无 mapping_reason） | ✅ parseMappingReason 测试覆盖 |

## TG3: ActiveRequest mappingReason 验证

| TC | 测试 | 结果 |
|----|------|------|
| TC3.1 | completed 请求返回 mappingReason 字段 | ✅ PASS |
| TC3.2 | 无 mappingReason 时字段为 undefined | ✅ PASS |

## parseMappingReason 边界测试

| # | 输入 | 期望 | 结果 |
|---|------|------|------|
| 1 | null | undefined | ✅ PASS |
| 2 | undefined | undefined | ✅ PASS |
| 3 | "invalid json" | undefined | ✅ PASS |
| 4 | routing+mapping_reason | "group_schedule" | ✅ PASS |
| 5 | routing+overflow(triggered=true) | "overflow_redirect" | ✅ PASS |
| 6 | routing 无 mapping_reason | undefined | ✅ PASS |
| 7 | {} 非数组 | undefined | ✅ PASS |
| 8 | [] 空数组 | undefined | ✅ PASS |
| 9 | routing+overflow(triggered=false) | "direct_format" | ✅ PASS |

## TG4: 前端展示（手动验证）

**状态**: 待用户手动验证

| TC | 验证项 | 状态 |
|----|--------|------|
| TC4.1 | Logs 页面 Badge 展示 | ⏳ 待验证 |
| TC4.2 | Monitor 页面一致性 | ⏳ 待验证 |
| TC4.3 | 历史数据无 Badge | ⏳ 待验证 |

## 结论

TG1-TG3 全部通过（32/32）。TG4 为前端手动验证，需部署后确认。
