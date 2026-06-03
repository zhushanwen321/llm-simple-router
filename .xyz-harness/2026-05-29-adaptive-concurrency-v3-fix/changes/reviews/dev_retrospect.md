---
phase: dev
verdict: pass
---

# Dev Phase Retrospect — adaptive-concurrency-v3-fix

## 1. Phase Execution Review

### Summary

Phase 3 一次性完成了 V3 算法的全部实现：修改 2 个源文件 + 1 个测试文件，产出 62 个测试用例（原 42 个，新增 20 个），全部通过。五步专项审查中 4 个首轮通过，robustness review 发现 2 个 MUST FIX（NaN 输入、日志误导），修复后二轮通过。

关键变更：
- `types.ts`：删除 `AdaptiveState.limitReached` 和 `AdaptiveProfile.keepRatio`
- `adaptive-controller.ts`：6 项 FR 全部实现 + `clampMax()` NaN 防护 + 满额日志降级
- `adaptive-controller.test.ts`：从 V2 测试全面重写为 V3 行为

### Problems Encountered

1. **Robustness MF-1（NaN 输入）**：`Math.max(NaN, 1)` 返回 `NaN` 而非 `1`，这是 JavaScript 的已知行为但容易被忽视。spec 只要求了 `max=0` 防护，审查发现 `max=NaN/undefined` 同样会冻结控制器。修复方式：新增 `clampMax()` 方法使用 `Number.isFinite()` 做完整防护。

2. **Robustness MF-2（满额日志误导）**：V2 遗留问题——满额时仍然输出 `info` 级别的 "limit increased" 日志但 `prevLimit === newLimit`。流量高峰时每 2-3 次请求触发一次，造成大量噪音。修复方式：满额分支降级为 `debug` + `action: "at_max_counter_cycle"`。

3. **npm install 缺失**：worktree 模式下 `router/` 目录没有 `node_modules`，首次运行 `npx vitest` 失败。需要手动 `npm install`。

### What Would You Do Differently

1. **应先安装依赖再开始编码**：worktree 模式下新分支的依赖安装应在防护预检步骤中自动完成，而不是等到运行测试时才发现。

2. **NaN 防护应在 spec/plan 阶段就考虑**：spec 的 AC-1 只覆盖了 `max=0`，没有覆盖 `NaN`/`undefined`/负数。如果 plan 阶段的健壮性分析更深入，可以避免 dev 阶段的 review 循环。

### Key Risks

- 无剩余风险。所有 MUST FIX 已修复并通过二轮审查。
- 3 个 SHOULD FIX 未处理（syncToSemaphore try-catch、init 日志、deriveProfile 防御性检查），风险低，可在后续 PR 中处理。

## 2. Harness Usability Review

### Flow Friction

- **五步专项审查的并行调度效果很好**：4 个审查同时 dispatch，约 30 秒内全部返回。integration review 依赖 BLR 产出，串行执行也不慢。总审查时间比传统单步 code review 快得多。
- **审查循环成本低**：robustness review 的 2 个 MUST FIX 修复后，只重新 dispatch 了 robustness 一个审查（v2），不需要重跑其他 4 个已通过的审查。

### Gate Quality

- Gate 准确识别了两个真实问题：
  - MF-1 是静默破坏性 bug（NaN 冻结控制器），极难在生产中排查
  - MF-2 是运维噪音问题，在满额运行时严重影响日志可读性
- 两个 MUST FIX 的修复工作量都很小（各约 10 行），审查-修复-验证循环效率高。

### Prompt Clarity

- 五步审查各自的 task prompt 需要手动编写审查重点。对于这种小变更（3 文件，156 行 diff），每个审查的 task prompt 耗时和审查本身相当。考虑对 L1 小变更简化审查流程（如合并 taste + standards）。

### Automation Gaps

- **Worktree 依赖安装未自动化**：`npm install` 应在 coding-workflow 初始化 worktree 时自动执行，或至少在 Phase 3 防护预检中检测并提示。

### Time Sinks

- 无明显时间消耗。编码约 5 分钟，审查+修复约 3 分钟，测试约 1 分钟。整体 Phase 3 效率高。
