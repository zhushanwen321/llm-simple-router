---
phase: test
verdict: pass
---

# Test Phase Retrospect

## 1. Phase Execution Review

### Summary

Test 阶段为 Pipeline 全量接管需求新增 6 个测试文件、16 个测试用例（38 个子测试），覆盖 AC1-AC8 中 5 项完全覆盖、3 项部分覆盖。全量回归测试 1534/1534 通过（131 个文件），tsc 零错误，eslint 零警告。测试评审 1 轮通过，0 条 MUST FIX，3 条 LOW + 1 条 INFO 保持 open。测试质量整体良好——断言充分、mock 边界合理、数据构造真实。

### Problems Encountered

**1. AC3/AC5/AC6 三项部分覆盖，评审标 LOW/INFO 未阻塞。**

- **AC3（已有 hook 激活）**：overflow-redirect 和 provider-patches 两个已有 hook 在请求处理中的实际执行未做显式验证。端到端集成测试（TC-8-02）隐式证明了 pipeline 流程成功执行，但无法确认这两个 hook 的具体行为正确。
- **AC5（10 种场景等价性）**：仅 failover 场景（1/10）有显式端到端验证，其余 9 种依赖现有 1534 测试隐式覆盖。spec 原文要求"响应与迁移前完全一致"，但测试只证明了"现有测试通过"和"failover 场景正确"。
- **AC6（日志/指标字段完整性）**：request_logs 仅验证 provider_id、status_code、pipeline_snapshot 三个字段，mapping_reason、transport_kind 和 request_metrics 的 token/TTFT/TPS 未覆盖。

这三个问题的共同根因是**测试范围边界不够明确**。spec 的 AC 描述有"功能等价"和"字段一致性"的要求，但测试阶段没有为这些 AC 拆分出足够细粒度的验证点。评审正确识别了覆盖缺口，但全部标 LOW/INFO 而非 MUST FIX——这个判定是否合理取决于对"功能等价"的严格程度解读。

**2. 测试文件与 plan 规划有偏差。**

plan 规划了 `pipeline-hooks.test.ts` 和 `pipeline-emit.test.ts` 两个文件，实际产出 6 个文件（route-resolve、format-transform、api-key-decrypt、post-response-hooks、pipeline-emit-integration、failover-integration）。偏差方向是好的——按 hook 拆分比按功能大类拆分更利于维护和定位。但 plan 中规划的"hook 级别单元测试"和"emit 序列集成测试"两个层次确实都在实际产出中体现了（单元级: route-resolve/format-transform/api-key-decrypt; 集成级: pipeline-emit-integration/failover-integration）。

### What Would You Do Differently

1. **AC5 的 10 种场景应该在 test_cases_template 中就拆出独立 TC。** 当前 test_cases_template 只规划了 TC-8-02/03 覆盖 failover，其余场景未列 TC。如果 template 阶段就把 10 种场景的 TC 规划出来（哪怕标注"依赖现有测试"），测试评审时 AC5 的覆盖判断会更明确。
2. **AC6 应该拆成字段级别的 checklist。** request_logs 有 ~15 个字段、request_metrics 有 ~8 个字段。在 test_cases_template 中列出"哪些字段有断言、哪些依赖现有测试"比在评审时才发现缺失更高效。

### Key Risks

1. **AC3 的 overflow-redirect 和 provider-patches 执行未验证。** 如果这两个 hook 在 pipeline 迁移后行为变化（如 context 字段名变更导致 hook 读写不一致），现有测试无法捕获。虽然概率低（它们是 pre-existing hook，代码未修改），但属于盲区。
2. **AC5 的 9 种场景无新增显式测试。** 后续如果 pipeline 行为变更导致某种场景回归，需要逐场景补充端到端测试，调试成本较高。
3. **failover-loop.ts 中 inline 日志/指标补偿代码未在测试中验证其必要性。** dev_retrospect 记录了 requestLoggingHook 是 no-op（字段命名不匹配），但 test 阶段未发现这个问题——测试只验证了"日志被写入"，没有验证"日志是通过 hook 写入还是通过 inline 代码写入"。

---

## 2. Harness Usability Review

### Flow Friction

Test 阶段流程顺畅，评审 1 轮通过（对比：spec 3 轮、plan 5 轮、dev 4 轮）。主要原因是 dev 阶段的编码评审已经验证了代码质量，test 阶段的测试代码本身相对简单（hook 单元测试 + 集成测试），bug 密度低。没有出现"测试评审发现 MUST FIX → 回到 dev 修复 → 重新测试"的回环。

### Gate Quality

测试评审准确识别了 3 个 LOW 和 1 个 INFO 问题，并且对每个问题的严重程度给出了合理的校准论证（为什么不标 MUST FIX）。AC 覆盖矩阵的构建方式（8 项 AC 逐项标注覆盖状态）清晰且可追溯。评审报告的结构（覆盖度 → 质量 → 可维护性 → 数据构造 → 问题清单）比 dev 阶段的评审报告更系统化。

### Prompt Clarity

test_cases_template.json 为测试执行提供了充分的指导：每个 TC 有明确的 caseId、输入条件、预期输出。实际执行时 TC 与测试文件的映射关系清晰（TC-2-01/02 → route-resolve.test.ts, TC-3-01 → format-transform.test.ts 等）。没有出现"不知道该测什么"的情况。

一个可改进点：TC-8-01（AC2 行数检查）本质上是一个静态检查而非功能测试，被放在 test_execution.json 中作为 TC 有点突兀。这类 lint/style 检查更适合放在 gate-script 中自动化。

### Automation Gaps

1. **TC-8-01（行数/import 检查）应自动化。** 当前通过 `wc -l` + `grep` 手动检查 failover-loop.ts 的行数和 import 数。这类静态检查完全可以通过 gate-script 自动化，避免人工遗忘。
2. **全量测试通过（TC-8-04）的收集可以自动化。** 当前需要手动运行 `npm test` + `tsc --noEmit` + `eslint` 并记录结果到 test_results.md。这些命令可以集成到 gate-script 中，自动生成 test_results.md。

### Time Sinks

无明显时间消耗点。test 阶段的效率受益于 dev 阶段的充分准备（hook 已实现、mock 模式已建立）和 test_cases_template 的清晰规划。16 个 TC 的执行在合理时间内完成，评审仅 1 轮通过。
