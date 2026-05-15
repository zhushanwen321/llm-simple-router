# TDD Red Report

## 测试文件总览

| 文件 | Task | 用例数 | 结果 | 失败原因 |
|------|------|--------|------|----------|
| `router/tests/model-capabilities.test.ts` | T1 | 8 | 7 FAIL + 1 PASS | `capabilities` 字段未定义，`MODEL_CAPABILITIES` 常量不存在 |
| `router/tests/image-redirect.test.ts` | T2 | 15 | 15 FAIL | 模块 `image-redirect.js` 不存在 |
| `router/tests/failover-loop-layered.test.ts` | T3 | 5 | 5 FAIL | IR 层未实现，fallback provider 从未被调用 |
| `router/tests/expand-overflow.test.ts` | T4 | 4 | 4 FAIL | `expandOverflowTargets` 函数不存在 |
| `router/tests/pipeline-snapshot.test.ts` | T5 | 3 | 3 TYPE ERROR | `"image-redirect"` 不在 `StageRecord` union type |
| `router/tests/admin-groups-validation.test.ts` | T6 | 8 | 6 FAIL + 2 PASS | `validateRule()` 不验证 `image_fallback` 字段 |

**总计：43 测试用例，41 FAIL + 2 PASS（未实现功能不符合预期，已实现功能符合预期）**

## 按 AC 覆盖

| AC | Task | 测试状态 | 预期通过条件 |
|----|------|----------|-------------|
| AC1 | T2 | FAIL | `computeImageRedirectTargets()` 实现后 prepend fallback |
| AC2 | T2 | FAIL | 支持图片时返回原列表 |
| AC3 | T2 | FAIL | 无 fallback 时返回原列表 |
| AC4 | T2 | FAIL | 无图片时返回原列表 |
| AC5 | T1 | FAIL | `parseModels()` 解析 `capabilities` 字段 |
| AC6 | T1 | FAIL | `MODEL_CAPABILITIES` 查表补充 |
| AC7 | T2 | FAIL | fallback inactive 时不扩展 |
| AC8 | T2 | FAIL | fallback 不存在时不扩展 |
| AC9 | T2/T5 | FAIL | StageRecord 记录 image-redirect |
| AC10 | T2 | FAIL | IR 层异常降级 |
| AC13-AC16 | T2 | FAIL | 3 种 API 格式图片检测 |
| AC17 | T6 | FAIL | `validateRule` 校验 `image_fallback` |
| AC18 | T3 | FAIL | IR+OF 分层扩展 target 列表 |
| AC19 | T3 | FAIL | IR_F 失败后 exclude 不重复 |
| AC20 | T3 | 代码审查 | while 循环不含路由决策 |

## 结论

全部失败测试均因功能未实现而失败。TDD RED 阶段验证通过，可进入 Stage 11 编码实现（GREEN 阶段）。
