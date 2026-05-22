---
review:
  type: plan_review
  round: 1
  timestamp: "2026-05-22T12:00:00"
  target: ".xyz-harness/2026-05-22-ok/"
  verdict: fail
  summary: "计划评审完成，第1轮，2条MUST FIX（ADR 更新遗漏 + BG1 文件数超标），需修改后重审"

statistics:
  total_issues: 5
  must_fix: 2
  must_fix_resolved: 0
  low: 2
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "plan.md: BG2 (Tasks 6-9)"
    title: "ADR 更新任务遗漏——spec 要求更新 ADR-0005 和 ADR-0013，但 plan 中无对应 task"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: MUST_FIX
    location: "plan.md: Execution Group BG1"
    title: "BG1 文件数 22 超过指南上限 10，Task 4 单 subagent 改 15 个 hook 文件风险过高"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: LOW
    location: "plan.md: File Structure 表"
    title: "15 个 builtin hook 文件未显式列举，仅用 glob，影响子任务编排可预见性"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 4
    severity: LOW
    location: "e2e-test-plan.md"
    title: "e2e-test-plan 缺少显式 AC 覆盖矩阵，虽场景已涵盖但不便于门禁自动检查"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 5
    severity: INFO
    location: "test_cases_template.json"
    title: "无 Plugin API 兼容性测试用例（AC-2 item 7 仅要求文档说明，测试层面可接受）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录
- 评审时间：2026-05-22 12:00
- 评审类型：计划评审（模式一）
- 评审对象：`.xyz-harness/2026-05-22-ok/spec.md`, `plan.md`, `e2e-test-plan.md`, `test_cases_template.json`

---

## 1. Spec 完整性

**结论：通过。** Spec 结构完整，目标清晰，范围明确，验收标准可量化。

| 维度 | 评估 |
|------|------|
| 目标明确性 | ✅ 一段话概括（解决 metadata 无类型、控制流分裂、模块深度不足）|
| 范围合理 | ✅ 4 Phase 渐进式，每个 FR 可独立 PR |
| 验收标准可量化 | ✅ 所有 6 个 AC 均包含可验证子项（类型检查、grep、行数、测试通过）|
| `[待决议]` 项 | ✅ 无 |

**特殊说明：** Constraints #5 和 #7 引用 ADR 更新（ADR-0005 控制流描述、ADR-0013 兼容降级说明），这应在 plan 中有对应 task。

---

## 2. Plan 可行性

### 2.1 Task 覆盖度检查（逐 AC 对照）

| FR | AC | Plan Tasks | 覆盖状态 |
|----|----|-----------|---------|
| FR-1 (PipelineDeps) | AC-1 (6项) | T1: 接口; T2: context; T3: failover-loop; T4: 15 hooks | ✅ 完全覆盖 |
| FR-2 (控制流) | AC-2 (7项) | T6: resilience; T7: failover-loop 控制流 | ⚠️ 缺 ADR 更新 (AC-2 item 7: Plugin API 兼容说明) |
| FR-3 (TransportExecutor) | AC-3 (4项) | T8: TransportExecutor; T9: hook 简化 | ✅ 完全覆盖 |
| FR-4a (converters合并) | AC-4a (4项) | T10 | ✅ 完全覆盖 |
| FR-4b (Registry深化) | AC-4b (4项) | T11 | ✅ 完全覆盖 |
| FR-4c (BaseSSETransform) | AC-4c (6项) | T12: 基类; T13: oa2ant 迁移 | ✅ 完全覆盖 |
| FR-5 (Admin utils) | AC-5 (6项) | T14: utils; T15: 应用; T16: 删除 constants | ✅ 完全覆盖 |
| FR-6 (双注册表) | AC-6 (5项) | T5 | ✅ 完全覆盖 |

**结论：** 16 个 Task 覆盖了 6 个 AC 的主要技术实现部分，但 AC-2 的 Plugin API 兼容说明（ADR 更新）未覆盖。

### 2.2 Task 粒度

**结论：通过。** 每个 task 粒度适中，适合 subagent 独立完成。
- 每个 task 都拆分为 TDD coder → Executor → Reviewer 三阶段
- 每个 task 涉及文件数 1-5 个（除 Task 4 外）
- 前后端分离清晰（纯后端无前端）

### 2.3 依赖关系

**结论：通过。**
- BG1 → BG2：正确（FR-1 PipelineDeps 是 FR-2 控制流 + FR-3 TransportExecutor 的前置）
- BG3 独立：正确（Format 子系统相对独立）
- BG4 独立：正确（Admin 工具函数完全独立）
- Wave 编排合理：Wave 1（BG1）→ Wave 2（BG2/BG3/BG4）

### 2.4 文件完整性验证

plan.md 的 File Structure 表列出了 25 个不同的文件条目（含 15 个 hook 文件以 glob 表示），分别映射到 4 个 BG。文件归属关系清晰。

---

## 3. Spec 与 Plan 一致性

### 一致项

| Spec 要求 | Plan 对应 | 状态 |
|-----------|----------|------|
| FR-1 PipelineDeps 结构化 | BG1 Tasks 1-4 | ✅ |
| FR-2 控制流统一（不含 ADR） | BG2 Tasks 6-7 | ✅ |
| FR-3 TransportExecutor | BG2 Tasks 8-9 | ✅ |
| FR-4a converters 合并 | BG3 Task 10 | ✅ |
| FR-4b Registry 深化 | BG3 Task 11 | ✅ |
| FR-4c BaseSSETransform | BG3 Tasks 12-13 | ✅ |
| FR-5 Admin 工具函数 | BG4 Tasks 14-16 | ✅ |
| FR-6 双注册表合并 | BG1 Task 5 | ✅ |

### 不一致项

| Spec 要求 | Plan 状态 | 问题 |
|-----------|----------|------|
| FR-2 变更清单：ADR-0005 更新 | ❌ 缺失 | 无 task 更新 ADR-0005 |
| Constraint #7：ADR-0013 说明兼容降级 | ❌ 缺失 | 无 task 更新 ADR-0013 |
| AC-2 item 7：Plugin API 兼容性说明 | ❌ 缺失 | 无 task 记录兼容性文档 |

### 额外工作

plan 中无 spec 未提及的额外工作（合理的精简），说明计划专注无冗余。

---

## 4. Execution Groups 合理性

### 4.1 分组概况

| Group | Tasks | 文件数 | Task数 | 依赖 |
|-------|-------|--------|--------|------|
| BG1 | 1-5 | 22 | 5 | 无 |
| BG2 | 6-9 | 6 | 4 | BG1 |
| BG3 | 10-13 | 7 | 4 | 无 |
| BG4 | 14-16 | 8 | 3 | 无 |

### 4.2 分组合理性

| 维度 | BG1 | BG2 | BG3 | BG4 |
|------|-----|-----|-----|-----|
| 文件数 ≤ 10 | ❌ 22 | ✅ 6 | ✅ 7 | ✅ 8 |
| Task 数 ≤ 4 | ✅ 5 (超额1但关联度高可接受) | ✅ 4 | ✅ 4 | ✅ 3 |
| 类型划分 (纯后端) | ✅ | ✅ | ✅ | ✅ |
| 功能关联度 | ✅ 高（depts + registries 紧密关联） | ✅ 高（控制流 + executor） | ✅ 高（format 子系统） | ✅ 高（admin 工具） |

### 4.3 关键问题：BG1 文件数严重超标

BG1 预估 22 个文件（2 create + 20 modify），是推荐上限 10 的 **2.2 倍**。

**风险分析：**
- Task 4（15 个 hook 文件）一次性由单个 subagent 修改 15 个文件，超出 subagent 设计建议（3-5 个文件/子任务）
- 15 个 hook 虽为同类机械替换（`metadata.get("db")` → `ctx.deps.db`），但文件多、容易遗漏
- 若 subagent 处理 15 个文件时出错，需要整组重来

**建议拆分方案：** 将 BG1 拆为两个子 Group：
- **BG1a**（7 文件）：Types + context + failover-loop + 双注册表（Tasks 1,2,3,5）— 核心架构变更
- **BG1b**（15 文件）：15 个 builtin hook metadata 迁移（Task 4）— 批量替换，可作为 BG1a 后的独立 Wave

### 4.4 Wave 编排

- Wave 1: BG1（正确，前置条件）
- Wave 2: BG2/BG3/BG4 ⇒ 并行（BG3/BG4 与 BG2 独立可并行 ✅）
- 文件冲突检查：BG2 和 BG1 共享 failover-loop.ts，依赖关系已正确标注 ✅

---

## 5. Subagent 配置充分性

| Group | Agent | Model | 注入上下文 | 读取文件 | 修改/创建文件 |
|-------|-------|-------|-----------|---------|-------------|
| BG1 | general-purpose | auto | spec FR-1+FR-6 + metadata 依赖清单 | 7 个显式路径 | 8 个显式路径 + glob (15 hooks) |
| BG2 | general-purpose | auto | spec FR-2+FR-3 | 4 个显式路径 | 5 个显式路径 |
| BG3 | general-purpose | auto | spec FR-4 | 5 路径 (含 converters/*) | 6 显式 + 1 目录删除 |
| BG4 | general-purpose | auto | spec FR-5 | 6 个显式路径 | 7 显式 + 1 删除 |

**问题：** BG1 的 15 个 hook 文件以 glob 表示而非显式列举，需确认 subagent 能正确通过 glob 发现全部文件。此问题虽不影响功能但降低可预见性。

---

## 6. 测试覆盖

### 6.1 E2E 测试场景覆盖

| E2E 场景 | 覆盖 AC | 覆盖状态 |
|----------|---------|---------|
| TS-1: PipelineDeps | AC-1 | ✅ |
| TS-2: Failover 控制流 | AC-2 | ✅ |
| TS-3: TransportExecutor | AC-3 | ✅ |
| TS-4: Format 子系统 | AC-4a/b/c | ✅ |
| TS-5: Admin 工具 | AC-5 | ✅ |
| TS-6: 双注册表 | AC-6 | ✅ |

**问题：** e2e-test-plan 没有显式的 AC 覆盖矩阵表（在测试评审时门禁强制检查），虽场景已覆盖但不便于自动化检查。

### 6.2 test_cases_template.json 完整性

**结论：基本完整。** 17 个测试用例，覆盖所有 6 个 AC 的主验证路径。测试设计合理（集成测试 + API 测试 + grep 验证），测试步骤可执行。

| 覆盖领域 | 用例数 | 说明 |
|---------|--------|------|
| AC-1 PipelineDeps | TC-1-01~03 (3) | 类型 + failover-loop + hooks |
| AC-2 控制流 | TC-2-01~04 (4) | action + throw + catch + behavior |
| AC-3 TransportExecutor | TC-3-01~02 (2) | class + line count |
| AC-4a/b/c Format | TC-4-01~03 (3) | dir + methods + lines |
| AC-5 Admin | TC-5-01~03 (3) | utils + constants + usage |
| AC-6 注册表 | TC-6-01~02 (2) | delete + monitor |

**共 17 个充分测试用例**，覆盖正常路径和验证路径。行数验证（TC-3-02、TC-4-03）有明确的检查标准。

---

## 发现的问题

| # | 优先级 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|---------|
| 1 | MUST FIX | plan.md: BG2 (Tasks 6-9) | **ADR 更新任务遗漏。** spec 的 FR-2 变更清单要求更新 ADR-0005（控制流描述改为 "FailoverLoop 检查 resilienceResult.action"），Constraints #7 要求在 ADR-0013 中说明 ProviderSwitchNeeded 兼容降级策略。plan 的 16 个 task 均未涉及 ADR 更新。此遗漏导致 AC-2 item 7（Plugin API 兼容性说明）无法被满足。 | 在 BG2 或独立新增一个 task 更新两个 ADR 文档：1) 将 ADR-0005 中 "FailoverLoop catches ProviderSwitchNeeded" 改为 "FailoverLoop 检查 resilienceResult.action"；2) 在 ADR-0013 中记录 ProviderSwitchNeeded 兼容降级说明。 |
| 2 | MUST FIX | plan.md: BG1 (Tasks 1-4) | **BG1 文件数严重超标。** BG1 预估 22 个文件（含 15 个 hook 文件），是执行组指南上限（10）的 2.2 倍。Task 4（15 个 hook 文件）单个 subagent 处理 15 个文件，超出子任务建议规模（3-5 文件）。风险：修改遗漏、不一致或出错时整组重来。 | 将 BG1 拆分为两个子 Group：**BG1a**（7 文件，Tasks 1,2,3,5）为核心架构变更；**BG1b**（15 文件，Task 4）为批量 hook 迁移。BG1a 完成后启动 BG1b。两个 Group 放在同一 Wave 内串行。 |
| 3 | LOW | plan.md: File Structure | **15 个 hook 文件未显式列举。** File Structure 表使用 "15 × proxy/hooks/builtin/*.ts" glob 而非显式文件列表。虽然 glob 对 subagent 可行（可 ls 发现），但不便于事前评估变更范围和冲突风险。 | 列出 15 个 hook 文件的实际路径（或附录按功能分组），或在 plan.md 中增加备注说明使用 glob 的原因及 subagent 发现方式。 |
| 4 | LOW | e2e-test-plan.md | **缺少显式 AC 覆盖矩阵。** 项目 CLAUDE.md 规范要求 "测试评审环节强制检查 AC 覆盖矩阵"。e2e-test-plan 的场景已覆盖全部 AC 但未以表格形式呈现 AC↔TS 映射。| 在 e2e-test-plan 末尾增加 AC 覆盖矩阵表（格式：AC | 覆盖场景 | 测试用例 | 覆盖状态），便于测试评审时自动验证。 |
| 5 | INFO | test_cases_template.json | **无 Plugin API 兼容性测试。** AC-2 item 7 要求 "external plugin 使用 ProviderSwitchNeeded 时行为说明"，但 test_cases_template.json 无对应测试用例。考虑到该 AC 主要通过 ADR 文档说明实现（非运行时可验证），当前可接受。 | ADR 更新后不需额外测试用例。如 expect plugin 的行为变化可被测试，可考虑加一个集成测试验证 throw ProviderSwitchNeeded 的 plugin 在 failover-loop 中的行为。 |

---

## 结论

**需修改后重审。** 存在 2 条 MUST FIX 问题：

1. **ADR 更新遗漏** — ADR-0005 和 ADR-0013 的更新是 spec 明确要求的，缺失会导致 AC-2 item 7 无法满足
2. **BG1 文件数超标** — 22 个文件超出执行组指南上限，Task 4 的单 subagent 负载过高

## Summary

计划评审完成，第1轮，2条MUST FIX（ADR 更新遗漏 + BG1 文件数超标），需修改后重审。
