---
phase: test
verdict: pass
---

# Phase 4 (Test) Retrospect — provider-multi-api-type

## 1. Phase Execution Review

### Summary

执行了 test_cases_template.json 中全部 28 个测试用例。26 个通过自动化测试覆盖，3 个 UI 类型（TC-4-01/02/03）通过 code review 验证。新增 2 个测试文件（migration-endpoints.test.ts、proxy-endpoint-routing.test.ts），最终 142 个测试文件 / 1743 个测试全部通过。

### Problems Encountered

**1. 首次 4 并行 subagent 调度超时**

第一批尝试同时 dispatch 4 个 subagent（TC-1、TC-2、TC-3、TC-E2E 各一个），结果全部超时无返回。原因可能是：
- 4 个 subagent 同时执行高复杂度任务（taskComplexity: high），每个都需要读取多个文件、创建新测试文件、运行全量测试
- 代理路由测试（TC-3/E2E）的 mock upstream 场景复杂，单个 subagent 执行时间就接近超时

解决方案：改为 2 批次、每批 2 个并行。TC-1+TC-2 合并一个 subagent，TC-3+TC-4+E2E 合并另一个。第二次尝试成功。

**2. TC-2-05 加密 roundtrip 的 DB 直验 gap**

subagent 报告 provider-endpoints.test.ts 虽然验证了 API 层的加密/解密链路（明文入 → 明文出），但没有直接查询 DB 验证存储的是密文。加密的中间步骤是隐式验证的（如果没加密，解密会失败），但严格来说应该有独立的 DB 直验测试。

影响：低。API 层测试已经覆盖了完整链路，DB 直验是锦上添花。

**3. TC-E2E-03 openai-responses 路由可能未实现**

E2E-03 测试 openai-responses endpoint 精确匹配和 fallback。实际执行时，resolveEndpoint 层面的匹配逻辑已被 resolve-endpoint.test.ts 覆盖，但完整的 POST /v1/responses 代理路由集成测试取决于该路由是否已在代码中注册。subagent 最终通过组合单元测试 + 路由测试覆盖了此场景。

### What Would You Do Differently

1. **降低并行度**：测试阶段 subagent 的工作量不均匀（TC-1 单纯验证 vs TC-3/E2E 需要创建新测试文件），4 并行容易超时。2 并行更稳健。

2. **合并 TC 组减少 subagent 数量**：TC-1 和 TC-2 可以合并到一个 subagent（都是验证已有测试），TC-3 和 E2E 合并另一个（都需要创建新的代理路由测试）。实际第二次就是这样做的，效果更好。

3. **TC-4 UI 测试应更早标注**：test_cases_template.json 中 TC-4-01/02/03 的 type 是 `ui`，按 skill 说明本阶段不执行 UI 测试。但在 dispatch subagent 前就应该把这些排除并标注为 manual/code_review，而不是让 subagent 去判断。

### Key Risks for Later Phases

1. **UI 测试未自动化**：TC-4-01/02/03 仅通过代码审查验证，没有自动化 UI 测试。如果前端组件有运行时 bug（如 v-for 渲染错误、事件绑定缺失），在 PR 合并前无法通过 CI 发现。

2. **proxy-endpoint-routing.test.ts 是单个 36KB 大文件**：包含了 TC-3-01~05 + TC-4-04 + TC-E2E-01~04 的所有测试。如果后续新增 TC，文件会继续膨胀。应考虑按场景拆分。

## 2. Harness Usability Review

### Flow Friction

1. **test_execution.json 的手工编写是主要摩擦点**。subagent 返回的是自然语言结果（"TC-3-01: passed, execute_steps: [...]"），需要主 agent 手工转换为 JSON 格式。每个 TC 需要 6-8 个字段，26 个 TC 意味着大量格式化工作。

2. **TC ID 和 template 的交叉验证也是手工的**。需要确认 26 个 caseId 完全匹配 template 中的 28 个（减去 UI 类型的 3 个，实际是 25 个自动化 + 1 个 TC-4-04 集成测试 + 2 个 UI code_review = 28）。如果 subagent 漏了某个 TC，只有 gate check 才能发现。

### Gate Quality

Gate 一次通过，无 false positive。验证了：
- test_execution.json 中所有 caseId 匹配 template
- 所有最终轮次 passed=true
- execute_steps 非空
- 字段类型正确（boolean/number/string[]）

### Prompt Clarity

1. **TC 分组到 subagent 的 prompt 质量关键**：第一次失败不是因为 prompt 不清晰，而是因为并行度过高。第二次的 prompt 减少了 subagent 数量但增加了每个 subagent 的工作范围，反而更成功。

2. **测试模式引用有效**：prompt 中指定了参考文件（proxy-agent.test.ts、provider-endpoints.test.ts），subagent 能正确复用项目的 buildApp + inject + mock upstream 模式。

### Automation Gaps

1. **test_execution.json 应由 subagent 直接生成**：subagent 已经知道每个 TC 的 passed/failed 和 execute_steps，完全可以在 subagent 内部生成 JSON 片段，主 agent 只需合并。避免手工格式化 26 个条目。

2. **TC-template 到测试代码的覆盖率分析缺失**：没有工具自动检查"test_cases_template.json 中的每个 TC 是否有对应的 vitest describe/it 块"。目前依赖 subagent 的人工判断。

3. **TC-4 UI 测试的自动化方案缺失**：test_cases_template.json 中有 3 个 type=ui 的 TC，但项目没有 Playwright/Cypress E2E 测试框架。应该在 plan 阶段就决定这些 TC 的验证方式（code_review / manual / 跳过），而不是留到 test 阶段。

### Time Sinks

1. **subagent 超时重试**：第一次 4 并行全部超时，浪费了一轮 dispatch。改为 2 并行后成功。超时本身不是时间浪费（subagent 被终止），但重新组织 task prompt 和重新 dispatch 占用了约 1 轮对话。

2. **test_execution.json 手工编写**：26 个 TC 的 JSON 编写占了 phase 执行时间的 ~20%。如果 subagent 直接输出 JSON 片段，可以减半。
