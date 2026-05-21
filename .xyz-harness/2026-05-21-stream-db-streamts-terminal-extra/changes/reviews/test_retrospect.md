---
phase: test
verdict: pass
---

# Phase 4 (test) 复盘

## 1. Phase Execution Review

### Summary

测试阶段围绕 8 项验收标准（AC1-AC8）设计了 25 个测试用例，最终产出 15 个新 vitest 测试（diagnostic-fields.test.ts 13 个 + mapping-reason-overflow.test.ts 2 个）+ 3 项前端源码验证。全部 124 个后端测试文件（1487 个测试）通过，前端 vue-tsc 和 eslint 零错误。

测试评审经历两轮：第 1 轮发现 1 条 MUST FIX（AC6.3 overflow_redirect 未覆盖），补充 mapping-reason-overflow.test.ts 后第 2 轮通过。同时修复了 error_code 弱断言和 resilience_action spec 不一致两处 LOW 问题。

### Problems Encountered

**1. AC6.3 overflow_redirect 测试遗漏（MUST FIX）**

test_cases_template.json 的 25 个 TC 中遗漏了 overflow_redirect 场景。这不是设计遗漏——e2e-test-plan.md TS5 已明确列出该场景——而是从 test plan 到 test_cases_template 的映射环节丢失。修复方式是新增 mapping-reason-overflow.test.ts（2 条测试），验证 mapping_reason='overflow_redirect' 的 DB 写入。

**教训**：test_cases_template.json 应与 e2e-test-plan.md 的场景组建立可追溯的映射关系，而非仅靠人工对照。

**2. 部分场景无法在 vitest 中可执行验证**

TC-2-02（client_disconnect）和 TC-2-03（loop_detection）需要真实 socket abort 模拟或现有外部测试断言，vitest 组件测试环境无法覆盖。最终以代码路径审查替代。

**3. 模板-实现不匹配**

TC-4-02 模板描述"headers 发送前失败"但实际测试 TC11 覆盖的是"正常成功"。这类不一致在评审中造成困惑，需要回溯 test_execution.json 才能确认实际覆盖。

**4. spec-测试期望值不一致**

AC5.3 要求 resilience_action IS NULL，但 TC10 原先断言 "done"。第 2 轮评审前修正为 NULL。根因是实现阶段变更了设计但未同步更新 spec。

### What Would You Do Differently

1. **test_cases_template.json 生成前增加交叉检查**：用 e2e-test-plan.md 的场景编号作为 TC ID 前缀（如 TS5-TC1），确保每个场景组至少有一个 TC 覆盖，避免 overflow_redirect 式遗漏。
2. **spec 和测试同步更新机制**：实现阶段如改变字段语义（如 resilience_action 从 NULL 改为 "done"），应在 dev 阶段的 commit message 中标注"spec 需同步更新"，而非等 test 评审才发现不一致。
3. **不可执行场景提前声明**：test_cases_template.json 应增加 `executable: true/false` 字段，将 client_disconnect/loop_detection 等场景标记为不可执行，附替代验证方式，避免评审时才发现。

### Key Risks

- **headers_sent=1 无独立断言**（issue #3）：stream_error 路径已执行但未对 headers_sent DB 列做显式断言，仅依赖代码审查。如果后续 headers_sent 写入逻辑变更，可能不会触发测试失败。
- **failover_trigger 仅覆盖外层路径**（issue #5）：ProviderSwitchNeeded 内部路径无独立测试，如果该路径的 failover_trigger 赋值逻辑出错，不会被现有测试捕获。
- **前端 UI 无自动化验证**：AC8 的 3 项前端验证全部基于源码审查，无 Playwright/Cypress 环境。未来如果 v-if 条件被意外恢复，不会有测试报警。

## 2. Harness Usability Review

### Flow Friction

**测试评审两轮制的实际效果良好**。第 1 轮的 MUST FIX 发现是真实的（overflow_redirect 确实没有测试），第 2 轮验证修复后通过。两轮之间的修复工作量适中（新增 1 个测试文件 + 修改 2 个断言），没有出现"修了 A 又引入 B"的循环。

**唯一的摩擦点**：test_cases_template.json → test_execution.json 的映射。template 有 25 个 TC，但实际 vitest 测试只有 15 个。部分 TC（如 TC-6-01 direct_format）通过现有测试覆盖而非新增，部分 TC（如 TC-2-02 client_disconnect）以代码审查替代。在评审时需要来回对照三个文件（template、execution、实际测试代码）才能确认覆盖状态。

### Gate Quality

gate 检查正确识别了 MUST FIX 并阻止通过。两轮评审的问题发现率合理：第 1 轮 9 个 issue（1 MUST FIX + 6 LOW + 2 INFO），第 2 轮新增 1 个 LOW（ETIMEDOUT vs ECONNREFUSED 场景偏差），没有出现漏检或误判。

### Prompt Clarity

harness 对 test phase 的指引足够清晰。test_cases_template.json 的结构（id / type / title / description / steps）提供了良好的框架，但 `steps` 字段的粒度不统一——有些 TC 列出了具体的 vitest 断言步骤，有些只写了"代码路径确认"。建议在 template 中增加 `verification_method` 字段（enum: `vitest_assertion` / `code_review` / `existing_test`），明确每个 TC 的验证方式。

### Automation Gaps

1. **AC 覆盖矩阵生成**：当前需要人工从 test_cases_template.json 和 test_execution.json 中构建覆盖矩阵。如果 template 中增加 AC 编号字段（如 `ac_ref: "AC6.3"`），可以自动生成覆盖矩阵并标出遗漏。
2. **不可执行 TC 的检测**：如果 TC 的 evidence 中出现"代码路径确认"而非具体的断言值，说明该 TC 不是可执行测试。这个检测可以自动化。
3. **spec-测试一致性检查**：如果 spec 中 AC 的期望值（如 `IS NULL`）和测试断言值（如 `"done"`）能自动比对，可以提前发现 issue #4 类型的问题。

### Time Sinks

1. **覆盖矩阵构建**：评审中最耗时的环节是对照 spec.md 的 8 项 AC、e2e-test-plan.md 的 7 个场景组、test_cases_template.json 的 25 个 TC、test_execution.json 的 25 条执行记录，构建完整的 AC 覆盖矩阵。如果 template 中有 AC 引用字段，可以大幅缩短这个时间。
2. **模板-实现一致性验证**：TC-4-02 和 TC11 的不匹配需要回溯到测试代码才能确认，这个环节也消耗了不必要的评审时间。
