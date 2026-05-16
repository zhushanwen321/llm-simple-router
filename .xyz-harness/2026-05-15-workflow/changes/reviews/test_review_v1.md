# Test Review: Image Model Switch (分层路由)

**Review Date**: 2026-05-16
**Reviewer**: harness-reviewer-agent
**Round**: 1
**Test Files**: 6 files, 48 test cases
**Test Execution**: 48/48 PASS, 0 FAIL, 0 SKIP

---

## 1. AC Coverage Matrix

| AC# | 条件 | 测试文件 | 测试用例 | 覆盖 |
|-----|------|---------|---------|------|
| AC1 | 图片+不支持+有fallback → prepend | image-redirect.test.ts | AC1: prepends fallback target... | YES |
| AC2 | 图片+已支持 → 不扩展 | image-redirect.test.ts | AC2: returns original targets when first target already supports image | YES |
| AC3 | 图片+不支持+无fallback → 不扩展 | image-redirect.test.ts | AC3: returns original targets when no image_fallback configured | YES |
| AC4 | 无图片 → no-op | image-redirect.test.ts | AC4: returns original targets unchanged when body has no image | YES |
| AC5 | ModelEntry有capabilities → parseModels正确解析 | model-capabilities.test.ts | parseModels_capabilitiesPresent_returnsExplicitCapabilities | YES |
| AC6 | ModelEntry无capabilities → 白名单补充 | model-capabilities.test.ts | parseModels_capabilitiesAbsent_whitelistedModel_getsCapabilitiesFromLookup + parseModels_capabilitiesAbsent_unknownModel_defaultsToTextOnly | YES |
| AC7 | fallback provider非active → 不扩展 | image-redirect.test.ts | AC7: returns original targets when fallback provider is inactive | YES |
| AC8 | fallback provider不存在 → 不扩展 | image-redirect.test.ts | AC8: returns original targets when fallback provider_id does not exist | YES |
| AC9 | StageRecord记录image-redirect | image-redirect.test.ts + pipeline-snapshot.test.ts | AC9: records image-redirect StageRecord... + StageRecord accepts image-redirect variant... | YES |
| AC10 | IR/OF层异常降级 | image-redirect.test.ts + expand-overflow.test.ts | AC10: returns original targets when internal logic throws exception + exception in applyOverflowRedirect... | YES |
| AC11 | Provider前端编辑capabilities | — (手动验证) | TG5 SKIPPED | MANUAL |
| AC12 | 映射组前端配置image_fallback | — (手动验证) | TG5 SKIPPED | MANUAL |
| AC13 | OpenAI格式image_url检测 | image-redirect.test.ts | AC13: detects OpenAI image_url format... | YES |
| AC14 | Anthropic格式image检测 | image-redirect.test.ts | AC14: detects Anthropic image format... | YES |
| AC15 | OpenAI content为string不触发 | image-redirect.test.ts | AC15: does not trigger when OpenAI content is a plain string | YES |
| AC16 | Responses API格式检测 | image-redirect.test.ts | AC16a (嵌套) + AC16b (顶层) | YES |
| AC17 | validateRule验证image_fallback | admin-groups-validation.test.ts | 8个测试用例覆盖valid/invalid/inactive/missing/empty/PUT场景 | YES |
| AC18 | 分层路由IR+OF正确展开 | failover-loop-layered.test.ts | test_imageRequest_withFallbackAndOverflow_precomputesExpandedTargets + expand-overflow.test.ts | YES |
| AC19 | failover循环exclude无死循环 | failover-loop-layered.test.ts | test_irFallbackFails_excluded_noDeadloop | YES |
| AC20 | failover循环仅执行+exclude | — | 代码审查项，非测试覆盖 | N/A |

**AC覆盖率**: 18/20 (90%)。AC11/AC12 为手动验证项（前端），AC20 为代码审查项。

---

## 2. Test Quality Assessment

### Assertion Quality

| 维度 | 评价 | 说明 |
|------|------|------|
| 断言精确度 | 良好 | AC1-AC4 检查 result 数组长度和具体元素值，而非仅检查"无异常" |
| 行为验证 | 良好 | AC9 验证 snapshot.toJSON() 中 JSON 包含正确的 stage 字段值 |
| 端到端验证 | 良好 | failover-loop-layered.test.ts 验证 DB request_logs 中的 pipeline_snapshot 字段和实际 HTTP 调用计数 |
| 边界覆盖 | 充分 | 空 targets、空 body、capabilities 缺失等边界均有覆盖 |

### Test Isolation

| 文件 | 隔离方式 | 状态 |
|------|---------|------|
| model-capabilities.test.ts | 每测试 clearModelsCache()，纯函数无 DB | GOOD |
| image-redirect.test.ts | beforeEach initDatabase(":memory:") | GOOD |
| expand-overflow.test.ts | beforeEach initDatabase(":memory:") | GOOD |
| admin-groups-validation.test.ts | beforeEach buildApp + initDatabase(":memory:") + afterEach close | GOOD |
| pipeline-snapshot.test.ts | 纯内存对象，无外部依赖 | GOOD |
| failover-loop-layered.test.ts | beforeEach initDatabase(":memory:") + afterEach close + servers cleanup | GOOD |

所有测试使用独立的内存数据库实例，无共享状态风险。

---

## 3. E2E Test Results

| 测试组 | 总数 | PASS | SKIP | FAIL |
|--------|------|------|------|------|
| TG1: Capabilities基础设施 | 3 | 3 | 0 | 0 |
| TG2: 配置写入 | 4 | 4 | 0 | 0 |
| TG3: 端到端分层路由 | 6 | 6 | 0 | 0 |
| TG4: 边界&异常 | 6 | 6 | 0 | 0 |
| TG5: 前端浏览器测试 | 3 | 0 | 3 | 0 |
| **合计** | **22** | **19** | **3** | **0** |

TG5 SKIP 原因：Chrome 未以 `--remote-debugging-port=9222` 模式启动，CDP 不可用。AC11/AC12 为手动验证项，E2E 计划中已标注"手动验证"。

前端编译验证已通过：vue-tsc 0 errors、eslint 0 warnings、vite build 成功。

---

## 4. Issues

### blocking

无。

### low

| # | 文件 | 位置 | 描述 | 优先级 |
|---|------|------|------|--------|
| L1 | failover-loop-layered.test.ts | describe名称 | 测试套件名称仍含 "TDD - expecting FAIL" 和 "TDD RED 阶段"，但测试已全部通过。应更新描述反映当前状态。 | LOW |
| L2 | image-redirect.test.ts | 文件头注释 | 文件头注释写着"T2: computeImageRedirectTargets() TDD 测试"和"所有测试必须 FAIL — 函数和文件均不存在"，但函数已存在且测试通过。注释已过时。 | LOW |
| L3 | expand-overflow.test.ts | 文件头注释 | 同样标注"Function does not exist yet — all tests must FAIL"，但函数已存在。 | LOW |
| L4 | failover-loop-layered.test.ts | 文件头注释 | 注释标注"这些测试必须 FAIL，因为当前实现尚未重构"，但实现已完成。 | LOW |

### info

| # | 描述 |
|---|------|
| I1 | admin-groups-validation.test.ts 的测试覆盖超出 spec 要求的 AC17，额外测试了 missing backend_model、missing provider_id、empty object、PUT update 等场景。这是正向的超额覆盖，不构成问题。 |
| I2 | failover-loop-layered.test.ts 包含一个非 spec AC 的测试："Pre-computed IR stage always recorded in snapshot"（failover group 无 image_fallback 时 IR stage 仍记录 triggered:false）。这是合理的行为验证。 |

---

## 5. Conclusion

**PASS** — 0 个 blocking 问题。

- AC 覆盖率 90%（18/20），剩余 2 个为手动验证和代码审查项，不在测试覆盖范围内
- 48 个测试全部通过，0 FAIL
- 断言精确，验证了具体行为而非仅"无异常"
- 测试隔离良好，每个测试使用独立内存数据库
- 唯一的低优先级问题是测试文件中残留的 TDD RED 阶段注释，不影响测试正确性
