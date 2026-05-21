---
phase: pr
verdict: pass
---

# Phase 5 整体复盘（覆盖全部 5 个 Phase）

## 1. Phase Execution Review

### Summary

本次需求为 `request_logs` 表添加 8 个运行时诊断列 + 修复 ModelCard.vue 超时输入框 UI bug。完整经历 5 个 phase，产出 16 个 commit，修改 12 个源文件（+847/-17 行），新增 13 个集成测试。

| Phase | 交付物 | 评审轮次 | MUST FIX | 耗时估计 |
|-------|--------|---------|----------|---------|
| 1 (spec) | spec.md + infrastructure-scan.md | 2 轮 | 1（data consumer checklist 缺失） | 中 |
| 2 (plan) | plan.md + e2e-test-plan.md + test_cases_template.json | 2 轮 | 1（AC6 failover_retry 遗漏） | 中 |
| 3 (dev) | 9 files modified + 13 tests + code review | 2 轮 | 3（headers_sent / stream_error test / failover test） | 长 |
| 4 (test) | test_execution.json (26 TCs) | 2 轮 | 1（overflow_redirect 未覆盖） | 短 |
| 5 (pr) | PR #161, CI pass | 0 轮 | 0 | 短 |

### Problems Encountered

**1. Phase 3 发现了两条 failover 路径（最大发现）**

代码审查阶段发现 failover 有两条完全不同的执行路径：
- **内层（resilience）**：`decide()` 返回 `failover` → 抛 `ProviderSwitchNeeded` → catch 块记录 `failover_trigger`
- **外层（failover-loop）**：`executeWithResilience` 正常返回失败结果 → 外层循环检查 → `excludeTargets.push + continue`，**不记录 failover_trigger**

这是因为 orchestrator 的 `targets()` 回调只返回当前 target（单元素数组），resilience 层无法找到下一个 provider 来抛 `ProviderSwitchNeeded`。真正的 failover 由外层 failover-loop 处理。

修复方案：引入 `lastFailoverTrigger` 变量，在外层 failover 路径和 ProviderSwitchNeeded catch 块两条路径都设置值，下一次迭代的日志中记录。

**影响**：这个发现改变了 spec 中 failover_trigger 的语义——不仅仅是 `ProviderSwitchNeeded`，还包括 `status_500`、`throw` 等外层路径的触发原因。

**2. Phase 3 MUST FIX #1：resilience.ts else 分支漏掉 headers_sent**

`resilience.ts` 的 `executeWithResilience` 中，对 throw 类型 attempt 填充了 `error_code` 和 `headers_sent`，但 else 分支（非 throw 结果）漏掉了 `headers_sent`。当 transport 返回 `stream_error` 时，`headersSent` 信息丢失。

**3. Phase 2 plan_review 发现 spec AC6 遗漏 failover_retry**

spec 最初只列了 `direct_format` 和 `group_base_rule` 两种 mapping_reason，遗漏了 `failover_retry` 和 `overflow_redirect`。plan review 第 1 轮发现后补充。

**4. Phase 4 test_review 发现 TC-6-04 遗漏**

test_cases_template.json 从 e2e-test-plan 映射时遗漏了 overflow_redirect 场景。已有 `mapping-reason-overflow.test.ts` 测试覆盖，但 template 和 execution 中缺失。

**5. Gate 脚本 stage 5 在 worktree 环境下 `cd frontend` 失败**

gate-script.sh 的 stage 5 执行 `cd "${PROJECT_ROOT}/frontend"` 后运行 `npm run build`，但在 worktree 目录下 `set -e` 导致脚本在 cd 后的命令中因环境差异退出。实际构建通过手动验证。

### What Would You Do Differently

1. **spec 阶段应枚举所有 mapping_reason 枚举值**。遗漏 failover_retry 和 overflow_redirect 说明对现有代码的枚举值扫描不够彻底。正确做法是在 spec 阶段 `grep` 所有可能的 mappingReason 赋值点，确保 AC6 覆盖完整。

2. **Phase 3 编码前应先画 failover 数据流图**。两条 failover 路径的发现耗费了大量调试时间（TC13 先后用 console.log 调试、阅读 resilience.ts 的 decide 逻辑、追踪 targets() 回调返回值）。如果在编码前画出完整的 failover-loop → resilience → transport 数据流，就不会在设计阶段假设所有 failover 都走 ProviderSwitchNeeded。

3. **test_cases_template.json 应包含 AC 引用字段**。当前只有 id/title/steps，缺少与 spec AC 的映射关系，导致评审时需要人工交叉对照。增加 `ac_ref: "AC6.3"` 字段可以自动化覆盖矩阵生成。

### Key Risks

- **外层 failover 路径的 failover_trigger 是新增逻辑**（`lastFailoverTrigger` 变量），如果后续有人在 failover-loop 中添加新的 `excludeTargets.push` 路径但忘记更新 `lastFailoverTrigger`，会导致 trigger 值缺失。建议在代码中添加注释说明。
- **前端 UI 修复无自动化测试**。ModelCard.vue 的 `v-if` 删除是纯手动验证，无 Playwright/Cypress 覆盖。
- **8 个新列全部 nullable**，数据消费者（Admin API、前端 Monitor 页面）需要处理 NULL 值。当前未修改前端读取逻辑，仅后端写入。

## 2. Harness Usability Review

### Flow Friction

**复盘触发机制是最大的流程缺陷。**

gate PASS 后的指令是 `"IMPORTANT: Call coding-workflow-phase-start() now to proceed. Do not do any other work first."` 这条指令与复盘的"gate 通过后执行"直接矛盾。实际执行中，gate PASS → phase-start → 新 phase 指令注入 → 复盘被完全跳过。

Phase 4 test retrospective 和 Phase 5 overall retrospective 都因为这个机制被遗漏，直到用户手动检查才发现。

**建议**：gate PASS 结果消息中应包含"执行当前 phase 复盘"的显式指令，或者 phase-start 逻辑中应检查上一 phase 的复盘文件是否存在。

**评审两轮制的价值**。每个 phase 的评审都发现了真实问题（spec: 1 MUST FIX, plan: 1 MUST FIX, code: 3 MUST FIX, test: 1 MUST FIX），总计 6 条 MUST FIX 在合并前被捕获。两轮制避免了"修了 A 又引入 B"的循环。

### Gate Quality

gate 脚本在 stage 1-4 工作正常，正确识别了各阶段的交付物。stage 5 在 worktree 环境下因 `cd frontend` 问题失败，但实际构建通过。gate 脚本对 worktree 目录结构的适配需要改进。

### Prompt Clarity

各 phase 的 skill 指引总体清晰，但有两处歧义：

1. **Phase 3 "wire diagnostic fields" 的粒度**：plan 中 Task 3 "数据流串联"修改了 7 个文件，对单个 subagent 来说偏重。建议 plan 阶段对这类串联任务进一步拆分（如按写入点分组）。
2. **Phase 4 test_execution.json 的 evidence 字段**：部分 TC 的 evidence 是"代码路径确认"，部分是具体的断言值。template 中缺少 `verification_method` 字段来区分这两类。

### Automation Gaps

1. **复盘触发**：gate PASS 后应自动触发复盘 subagent，而非依赖 phase-start 间隙中的人工记忆。
2. **AC 覆盖矩阵**：spec AC → test_cases_template → test_execution 的映射应可自动生成，当前需人工构建。
3. **spec-测试一致性检查**：spec 中 AC 的期望值（如 `IS NULL`）与测试断言值（如 `"done"`）的自动比对。
4. **gate 脚本的 worktree 适配**：stage 5 的 `cd frontend && npm run build` 在 worktree 中失败，需要更健壮的目录探测。

### Time Sinks

1. **Phase 3 failover 路径调试**（最大时间黑洞）：TC13 从预期 30 分钟变成了接近 2 小时的调试。根因是对 failover 双路径的不了解。如果编码前有数据流图，可以节省 70% 的时间。
2. **评审-修复-再评审循环**：Phase 3 经历了 2 轮 code review（3 MUST FIX），Phase 4 经历了 2 轮 test review（1 MUST FIX）。每个 MUST FIX 的修复-验证-提交-推送-再评审周期约 10-15 分钟。总计约 1 小时花在评审循环上。
3. **test_cases_template ↔ test_execution 映射**：评审中反复对照三个文件确认覆盖关系，约 30 分钟。
