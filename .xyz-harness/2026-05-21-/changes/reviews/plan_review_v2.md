---
review:
  type: plan_review
  round: 2
  timestamp: "2026-05-22T20:00:00"
  target: ".xyz-harness/2026-05-21-/plan.md"
  verdict: fail
  summary: "计划评审v2，v1的2条MUST FIX已修复，但MF1的修复引入新问题：transport-execute priority 300 超出 Constraint 8 定义的核心 hook 阈值（0-99），其非PipelineAbort异常会被emit()静默捕获，导致核心 hook 异常降级。需修改后重审"

statistics:
  total_issues: 8
  must_fix: 1
  must_fix_resolved: 2
  low: 4
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "plan.md:Task 5 + spec.md:FR3"
    title: "builtin:transport-execute priority 导致 pre_transport 阶段执行顺序错误"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: MUST_FIX
    location: "plan.md:BG2 Task 8 + spec.md:AC2"
    title: "failover-loop 缩减至 ≤150 行的目标不可行，实际预估 ~200-240 行"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 3
    severity: LOW
    location: "plan.md:BG1 Files (预估)"
    title: "BG1 文件数文字描述（13个）与 File Structure 表格（9个）不一致"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "plan.md:BG1 Execution Flow"
    title: "BG1 串行执行 7 个 Task 过于保守，Tasks 2/3/4/6 可并行"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: LOW
    location: "plan.md:Task 5 Depends on"
    title: "Task 5 依赖列表不完整，遗漏了对 Task 2 (route-resolve) 的依赖"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: LOW
    location: "plan.md:Task 8 设计细节"
    title: "on_error hook 在不同 catch 分支中的 ctx 字段准备不完整"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: INFO
    location: "plan.md:Constraint 8 设计细节"
    title: "Pipeline emit 异常降级的 priority < 100 判断依赖 hook 实例属性"
    status: dismissed
    raised_in_round: 1
    resolved_in_round: 2
  - id: 8
    severity: MUST_FIX
    location: "plan.md:Task 1 (emit 异常降级逻辑) + spec.md:Constraint 8 + FR3"
    title: "transport-execute priority 300 超出核心 hook 阈值(0-99)，非PipelineAbort异常会被emit()静默捕获而非传播"
    status: open
    raised_in_round: 2
    resolved_in_round: null
---

# 计划评审 v2

## 评审记录
- 评审时间：2026-05-22 20:00
- 评审类型：计划评审（第 2 轮）
- 评审对象：`.xyz-harness/2026-05-21-/plan.md`（含 spec.md、e2e-test-plan.md）

## v1 修复验证

### MF1 修复验证：transport-execute priority 50 → 300

**结论：执行顺序问题已修复，但引入新问题（Issue #8）。**

验证过程：
1. spec FR3 表格：`builtin:transport-execute` priority 已更新为 300 ✅
2. plan Task 5 设计细节：明确说明 priority 300 "确保在 format-transform(0)、api-key-decrypt(1)、provider-patches(100)、plugin-request(250) 全部完成后再执行" ✅
3. 实际执行顺序：format-transform(0) → api-key-decrypt(1) → provider-patches(100) → plugin-request(250) → **transport-execute(300)** ✅
4. 对照 failover-loop.ts 原始执行顺序（L206 格式转换 → L186 plugin adjustments → L200 provider patches → L228 API key → L241 transport），迁移后的优先级正确还原了这一顺序 ✅

**但发现新问题（Issue #8）：** transport-execute priority 提升到 300 后，超出了 Constraint 8 定义的核心 hook 阈值（priority 0-99）。plan Task 1 的 emit() 异常降级逻辑使用 `hook.priority < 100` 判断核心 hook，transport-execute 的非 PipelineAbort 异常会被 catch 并仅记录日志后继续执行，导致 ctx.transportResult 为 undefined、下游 hook 静默失败。详见 Issue #8。

### MF2 修复验证：AC2 阈值 ≤150 → ≤250

**结论：完全修复。**

验证过程：
1. spec AC2 已更新为 `failover-loop.ts 行数 ≤ 250 行，import 数 ≤ 25` ✅
2. 250 行阈值覆盖了 v1 评估的 ~200-240 行预估范围 ✅
3. import 阈值从 20 放宽到 25，与实际情况匹配 ✅
4. plan 中仍以 ≤150 行作为内部目标（Architecture 行、Task 8 描述），这比 spec 更严格，不冲突 ✅

**注意：** plan Self-Review 表仍写 "AC2 failover-loop ≤150行"，与 spec AC2 的 ≤250 不一致。这是文档问题（Issue #3 扩展），不影响功能正确性。

## 1. spec 完整性（独立复查）

**结论：完整，无新增问题。**

与 v1 一致，无变化。

## 2. plan 可行性

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | ~~MUST FIX~~ | plan.md:Task 5 + spec.md:FR3 | ~~builtin:transport-execute priority 50 导致执行顺序错误~~ | **v2 已修复：** priority 改为 300，执行顺序正确 |
| 2 | ~~MUST FIX~~ | plan.md:BG2 Task 8 + spec.md:AC2 | ~~failover-loop ≤150 行目标不可行~~ | **v2 已修复：** AC2 阈值放宽至 ≤250 行 |
| 8 | **MUST FIX** | plan.md:Task 1 + spec.md:Constraint 8 + FR3 | **transport-execute priority 300 超出核心 hook 阈值，异常会被错误降级。** 具体分析如下。 | 见下方详细修复方向 |
| 3 | LOW | plan.md:BG1 Files (预估) | BG1 文件数文字（13个）与表格（9个）不一致（v1 遗留） | 修正描述或调整表格 |
| 4 | LOW | plan.md:BG1 Execution Flow | BG1 串行执行 7 个 Task 过于保守（v1 遗留） | 改为 3-4 波执行 |
| 5 | LOW | plan.md:Task 5 Depends on | Task 5 依赖列表遗漏 Task 2（v1 遗留） | 更新为 "Depends on: 2, 3, 4" |
| 6 | LOW | plan.md:Task 8 设计细节 | on_error 在不同 catch 分支的 ctx 字段准备不完整（v1 遗留） | 明确 rejectAndReply vs on_error 的分工 |

### Issue #8 详细分析

**问题：** transport-execute 是系统骨架 hook（调用 orchestrator.handle()，写入 ctx.transportResult/resilienceResult/clientRequest/upstreamRequest），但其 priority 300 超出了 Constraint 8 定义的核心 hook 范围（priority 0-99）。

**影响链路：**

```
transport-execute 因编程错误（如 ctx.resolved 为 null → TypeError）崩溃
  → emit() catch 块：不是 PipelineAbort，priority 300 >= 100 → 不 throw
  → emit() 记录错误日志后正常返回
  → ctx.transportResult 为 undefined
  → 后续 emit("post_response") 的 hook 读取 ctx.transportResult → 二次崩溃
  → 二次崩溃被 failover-loop 的 catch(unknown) 捕获 → 返回 502
  → 客户端收到 502 但错误信息是二次崩溃的 TypeError，而非原始 transport 错误
```

**实际后果：**
- 请求不会挂起（最终返回 502）✓
- 错误信息会误导排查方向（TypeError "Cannot read property of undefined" 而非原始错误）✗
- 日志出现两条错误（emit 降级日志 + 二次崩溃日志），增加排查复杂度 ✗
- 违反 Constraint 8 的设计意图（"核心 hook 的异常直接传播，降级无意义"）✗

**根因：** v1 的 MF1 修复将 transport-execute priority 从 50 提升到 300（解决执行顺序问题），但未同步调整 emit() 的核心 hook 判断逻辑。这产生了语义冲突：
- 功能角色：transport-execute 是系统骨架，异常应直接传播
- Priority 值：300 属于 Constraint 8 定义的"非核心"区间（≥100）

**修复方向（三选一，推荐方案 A）：**

**方案 A（最小改动）：** 在 emit() 中增加核心 hook 标记机制，不依赖 priority 阈值判断：

```typescript
// PipelineHook 接口新增可选字段
interface PipelineHook {
  // ... 现有字段
  core?: boolean;  // 标记核心 hook，异常直接传播
}

// emit() 修改
if (hook.priority < 100 || hook.core === true) throw e;
```

transport-execute 注册时设置 `core: true`。其他非核心 hook（priority ≥ 100）不受影响。需要同步更新 spec Constraint 8 的文字描述。

**方案 B（内部防御）：** transport-execute 内部 try-catch 所有错误，转换为 PipelineAbort：

```typescript
// transport-execute hook 内部
async execute(ctx: PipelineContext): Promise<void> {
  try {
    // ... 原有逻辑
  } catch (e: unknown) {
    if (e instanceof PipelineAbort) throw e;
    throw new PipelineAbort(502, { error: "transport execution failed", cause: e });
  }
}
```

优点：不需要修改 emit() 逻辑。缺点：丢失原始错误类型信息，所有 transport 错误都变成 502 PipelineAbort。

**方案 C（调整优先级分段）：** 修改 Constraint 4 和 Constraint 8，扩展核心 hook 的 priority 范围到 0-399（新增 300-399 "核心后执行" 段）。但这会改变 spec 中的两个 Constraint，影响面较大。

## 3. spec 与 plan 一致性

**逐条覆盖检查（与 v1 一致，无变化）：**

| Spec Section | 对应 Task | 覆盖状态 | 备注 |
|-------------|----------|---------|------|
| FR1 三层架构 | Task 8 | ✅ | |
| FR2 Pipeline 驱动 L2 | Task 8 | ✅ | |
| FR3 核心步骤 hook | Task 2-6 | ✅ | transport-execute priority 300 执行顺序正确 |
| FR4 消除内联重复 | Task 8 | ✅ | |
| FR5 PipelineContext 字段 | Task 2-6 + Task 8 | ✅ | |
| FR6 on_error 接入 | Task 8 | ✅ | |
| FR7 on_stream_event 就绪 | 无 task | ✅ | |
| AC1 pipeline 全量接管 | Task 8 | ✅ | |
| AC2 failover-loop ≤250行 | Task 8 | ✅ | v2 已修正阈值 |
| AC3 已有 hook 激活 | Task 8 | ✅ | |
| AC4 核心 hook 可执行 | Task 2-5 | ✅ | |
| AC5 功能等价 10 场景 | Task 9 | ✅ | |
| AC6 日志指标等价 | Task 9 | ✅ | |
| AC7 现有测试通过 | Task 9 | ✅ | |
| AC8 pipeline 扩展 | Task 8 | ✅ | |
| Constraint 8 异常降级 | Task 1 | ⚠️ | 实现逻辑与 transport-execute core 身份冲突（Issue #8） |

**plan 中无 spec 未提及的额外工作。**

## 4. Execution Groups 合理性

与 v1 一致。BG1→BG2→BG3 串行依赖正确，Wave 编排合理。

## 5. E2E Test Plan 交叉验证

| AC | E2E 场景 | 覆盖状态 |
|----|---------|---------|
| AC1 | E2E-01/02/03 | ✅ |
| AC2 | 静态检查（非 E2E） | ✅ |
| AC3 | E2E-17/18/19 | ✅ |
| AC4 | E2E-08（隐式覆盖跨格式转换） | ⚠️ 建议补充 transport-execute 直接验证 |
| AC5 | E2E-04~E2E-13 | ✅ |
| AC6 | E2E-14/15/16 | ✅ |
| AC7 | 全部通过 | ✅ |
| AC8 | E2E-20 | ✅ |

**注意：** Issue #8 的修复后，E2E 测试应补充一个场景：模拟 transport-execute 内部抛出非 PipelineAbort 异常，验证错误是否正确传播而非被静默降级。

## 结论

**需修改后重审。** v1 的两条 MUST FIX 已修复（执行顺序正确、AC2 阈值合理），但 MF1 的修复引入了一个新问题：transport-execute 的 priority 300 导致其在 emit() 异常降级逻辑中被当作非核心 hook，其非 PipelineAbort 异常会被静默捕获而非传播，违反 Constraint 8 的设计意图。

### Summary

计划评审v2，v1的2条MUST FIX已修复，但MF1修复引入1条新MUST FIX（transport-execute core hook 异常降级冲突），需修改后重审。
