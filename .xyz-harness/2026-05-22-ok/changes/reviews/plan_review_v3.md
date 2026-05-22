---
verdict: fail
must_fix: 2
review:
  type: plan_review
  round: 3
  timestamp: "2026-05-22T16:00:00"
  target: ".xyz-harness/2026-05-22-ok/"
  summary: "计划评审完成，第3轮，2条MUST FIX（BG1b 配置缺失 transport-execute.ts + BG2 配置缺失 ADR 文件路径），需修改后重审"

statistics:
  total_issues: 8
  must_fix_resolved: 2
  low: 3
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "plan.md: BG2 (Tasks 6-9)"
    title: "ADR 更新任务遗漏——spec 要求更新 ADR-0005 和 ADR-0013，但 plan 中无对应 task"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 2
    severity: MUST_FIX
    location: "plan.md: Execution Group BG1"
    title: "BG1 文件数 22 超过指南上限 10，Task 4 单 subagent 改 15 个 hook 文件风险过高"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 3
    severity: LOW
    location: "plan.md: File Structure 表"
    title: "15 个 builtin hook 文件未显式列举，仅用 glob，影响子任务编排可预见性"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

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

  - id: 6
    severity: LOW
    location: "plan.md: Dependency Graph & Wave Schedule — 并行约束段落"
    title: "依赖关系图不精确且并行约束描述与 Task 显式依赖矛盾"
    status: open
    raised_in_round: 2
    resolved_in_round: null

  - id: 7
    severity: MUST_FIX
    location: "plan.md: BG1b Subagent 配置 → 修改/创建文件"
    title: "BG1b Subagent 配置缺失 transport-execute.ts 导致 AC-1 覆盖不全"
    status: open
    raised_in_round: 2
    resolved_in_round: null

  - id: 8
    severity: MUST_FIX
    location: "plan.md: BG2 Subagent 配置"
    title: "BG2 Subagent 配置中的 Task 17 (ADR 更新) 缺少 ADR 文件路径，subagent 上下文不足"
    status: open
    raised_in_round: 3
    resolved_in_round: null
---

# 计划评审 v3

## 评审记录
- 评审时间：2026-05-22 16:00
- 评审类型：计划评审（模式一）
- 评审对象：`.xyz-harness/2026-05-22-ok/spec.md`, `plan.md`, `e2e-test-plan.md`, `test_cases_template.json`
- 评审轮次：第 3 轮（本轮达循环上限）

---

## 第 1-2 轮问题状态总览

| # | 严重度 | 标题 | 状态 | 提出轮次 | 解决轮次 |
|---|--------|------|------|---------|---------|
| 1 | MUST FIX | ADR 更新任务遗漏 | ✅ resolved | 1 | 2 |
| 2 | MUST FIX | BG1 文件数超标 | ✅ resolved | 1 | 2 |
| 3 | LOW | hook 文件未显式列举 | ✅ resolved | 1 | 2 |
| 4 | LOW | e2e-test-plan 缺 AC 覆盖矩阵 | ❌ open | 1 | — |
| 5 | INFO | 无 Plugin API 兼容性测试 | ❌ open | 1 | — |
| 6 | LOW | 依赖图不精确 + 并行约束矛盾 | ❌ open | 2 | — |
| 7 | **MUST FIX** | **BG1b 配置缺失 transport-execute.ts** | ❌ open | 2 | — |
| 8 | **MUST FIX** | **BG2 配置缺失 ADR 文件路径** | ❌ open | 3 | — |

**第 2 轮 MUST FIX 验证结果：** 2 条均确认已修复，状态更新为 resolved。

---

## 第 3 轮独立评审

### 1. Spec 完整性（重新验证）

| 维度 | 评估 | 说明 |
|------|------|------|
| 目标明确性 | ✅ 通过 | "解决 metadata 无类型、控制流分裂、模块深度不足" 一段话概括 |
| 范围合理性 | ✅ 通过 | 4 Phase 渐进式，每个 FR 可独立 PR，边界清晰 |
| 验收标准可量化 | ✅ 通过 | 6 个 AC 共 37+ 子项，均含可验证检查点 |
| `[待决议]` 项 | ✅ 无 | — |

**结论：** Spec 无变化，结构完整，无需修改。

---

### 2. Plan 可行性（重新验证）

#### 2.1 Task 覆盖度（逐 AC 对照）

| FR | AC | Plan Tasks | 覆盖状态 |
|----|-----|-----------|---------|
| FR-1 | AC-1 (6 子项) | T1 (接口) + T2 (context) + T3 (failover-loop) + T4 (15 hooks) | ⚠️ 见 Issue 7 |
| FR-2 | AC-2 (7 子项) | T6 (resilience action) + T7 (failover-loop) + T17 (ADR) | ⚠️ 见 Issue 8 |
| FR-3 | AC-3 (4 子项) | T8 (TransportExecutor) + T9 (hook 简化) | ✅ |
| FR-4a | AC-4a (4 子项) | T10 | ✅ |
| FR-4b | AC-4b (4 子项) | T11 | ✅ |
| FR-4c | AC-4c (6 子项) | T12 + T13 | ✅ |
| FR-5 | AC-5 (6 子项) | T14 + T15 + T16 | ✅ |
| FR-6 | AC-6 (5 子项) | T5 | ✅ |

**结论：** 整体 task 覆盖度高，但 AC-1 和 AC-2 存在子项覆盖风险（见 MUST FIX 分析）。

#### 2.2 依赖关系（重点检查）

**已知问题：** 依赖关系图和并行约束描述仍然不精确（Issue 6，未修复）。

```
BG1a (core arch) ──→ BG1b (15 hooks)
       │
       ├──→ BG2 (control flow+executor+ADR)
```

此图将 BG2 表示为只依赖 BG1a。但实际情况：

| 依赖边 | 来源 | 说明 |
|--------|------|------|
| BG2 Task 7 → BG1a (Task 3) | ✅ plan.md 显式声明 | failover-loop 控制流 → failover-loop metadata 迁移 |
| BG2 Task 8 → BG1b (Task 4) | ✅ plan.md 显式声明 | TransportExecutor 提取 → 15 hook 迁移（含 transport-execute） |
| BG2 Task 9 → BG1b (Task 8 → Task 4) | ✅ 传递依赖 | 委托简化 → TransportExecutor → 15 hook 迁移 |

**并行约束段落** 中写 "BG1b 与 BG2 无依赖关系"，这与 Task 8 声明 `depends on: 4 (BG1b)` 直接矛盾。Wave 执行顺序（Wave 1→2→3）保证了正确时序，但错误描述可能误导 future reader 或自动化调度。

**影响：** LOW。Wave 调度确保执行正确，但不精确的依赖图增加维护成本。

---

### 3. Spec-Plan 一致性

| Spec 要求 | Plan 对应 | 状态 |
|-----------|----------|------|
| FR-1 PipelineDeps 结构化 | BG1a + BG1b | ✅ |
| FR-2 控制流统一 | BG2 (T6 + T7 + T17) | ✅ |
| FR-3 TransportExecutor | BG2 (T8 + T9) | ✅ |
| FR-4a/b/c Format 子系统 | BG3 (T10 + T11 + T12 + T13) | ✅ |
| FR-5 Admin 工具函数 | BG4 (T14 + T15 + T16) | ✅ |
| FR-6 双注册表合并 | BG1a (T5) | ✅ |
| ADR-0005 更新 | BG2 (T17) | ⚠️ 配置缺失（Issue 8） |
| ADR-0013 兼容降级说明 | BG2 (T17) | ⚠️ 配置缺失（Issue 8） |

**结论：** Spec-Plan 映射正确，无遗漏。但 ADR 更新的 subagent 执行配置需要补全。

---

### 4. Execution Groups 合理性（重新验证）

#### 4.1 分组概况

| Group | Tasks | 文件数 | Wave | 依赖 |
|-------|-------|--------|------|------|
| BG1a | 1, 2, 3, 5 | 7 | Wave 1 | 无 |
| BG1b | 4 | 14~15 | Wave 2 | BG1a |
| BG2 | 6, 7, 8, 9, 17 | 6 | Wave 3 | BG1a + BG1b |
| BG3 | 10, 11, 12, 13 | 7 | Wave 3 | 无 |
| BG4 | 14, 15, 16 | 8 | Wave 3 | 无 |

#### 4.2 分组合理性检查

| 维度 | BG1a | BG1b | BG2 | BG3 | BG4 |
|------|------|------|-----|-----|-----|
| 文件数 ≤ 10 | ✅ 7 | ⚠️ 14~15 | ✅ 6 | ✅ 7 | ✅ 8 |
| Task 数 | ✅ 4 | ✅ 1 | ⚠️ 5 | ✅ 4 | ✅ 3 |
| 纯后端 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 功能关联度 | ✅ 高 | ✅ 高 | ✅ 高 | ✅ 高 | ✅ 高 |

BG1b 14~15 个文件仍略超上限，但第 2 轮已判定可接受（同类机械替换，taskComplexity low）。

---

### 5. Subagent 配置充分性（重点检查）

#### 5.1 BG1b Subagent 配置

| 配置项 | 值 | 充分性 |
|--------|-----|--------|
| Agent | general-purpose | ✅ |
| Model | auto (low) | ✅ |
| 注入上下文 | spec FR-1 + metadata 依赖清单 + PipelineDeps | ✅ |
| 读取文件 | proxy/pipeline/types.ts | ✅ |
| **修改/创建文件** | **14 个 hook 文件（缺 transport-execute.ts）** | **❌ MUST FIX** |

**问题：**
- File Structure 表第 27 行声明 `transport-execute.ts` 属于 **BG1b + BG2**
- AC-1 要求**所有 15 个 hook** 完成 metadata 迁移
- 但 BG1b 的 modify 文件列表仅列出 14 个文件，**缺少** `transport-execute.ts`
- 后果：BG1b 完成后 transport-execute.ts 中的 metadata.get() 调用未被迁移，BG2 Task 8 提取 TransportExecutor 时需同时处理未迁移的旧代码，违背分组解耦设计

**此问题在第 2 轮以 LOW 标记，第 3 轮重评估后升级为 MUST FIX。** 原因：不修复则 AC-1（"15 个 builtin hook 中无 metadata.get('db') as T 等固定依赖的 as 断言"）无法被 BG1b 满足；transport-execute.ts 的迁移被部署到 BG2 的 Task 8，造成隐含的跨组依赖。

**修复方向：** 在 BG1b subagent 配置的修改/创建文件列表中增加 `proxy/hooks/builtin/transport-execute.ts`。

---

#### 5.2 BG2 Subagent 配置 — ADR 文件路径缺失（新增 MUST FIX）

| 配置项 | 值 | 充分性 |
|--------|-----|--------|
| Inject context | spec FR-2 + FR-3 | ✅ |
| 读取文件 | proxy/orchestration/resilience.ts, proxy/handler/failover-loop.ts, proxy/hooks/builtin/transport-execute.ts, core/errors.ts | ❌ |
| 修改/创建文件 | 同上 + transport-executor.ts | ❌ |

**问题：** BG2 的 Task 17 负责 "ADR-0005 + ADR-0013 更新"，但：
1. **读取文件** 未列出任何 ADR 文档（docs/adr/ADR-0005.md, docs/adr/ADR-0013.md）
2. **修改/创建文件** 未列出任何 ADR 文档
3. 注入上下文（spec FR-2 + FR-3）虽提及 ADR 更新要求，但 subagent 无从知晓 ADR 文件的实际路径和格式

**影响：** Subagent 上下文不足，可能无法发现需要修改的 ADR 文件，导致 AC-2 item 7（Plugin API 兼容性文档说明）无法满足。

**修复方向：** 在 BG2 的读取文件列表增加 `docs/adr/ADR-0005.md` 和 `docs/adr/ADR-0013.md`，修改/创建文件列表增加这两个 ADR 文档。

---

### 6. 并行约束与依赖关系矛盾（Issue 6 — 未修复）

**位置：** plan.md → Dependency Graph & Wave Schedule → 并行约束段落

**原文：**
```
Wave 3: BG2 必须等 BG1a 完成（BG1b 与 BG2 无依赖关系但建议串行避免文件冲突）
```

**问题：** 声明 "BG1b 与 BG2 无依赖关系" 与 plan.md Task Table 矛盾：
- Task 8 (TransportExecutor 类提取) 显式声明 `depends on: 4`
- Task 4 属于 BG1b（15 个 hook 迁移）

**影响：** LOW。Wave 调度（Wave 1→2→3）实际保证了正确执行时序。但错误描述可能误导 future reader 理解架构依赖关系。

**修复方向：** 将并行约束修改为 "BG2 同时依赖 BG1a 和 BG1b（Task 8 需要 Task 4 的 hook 迁移结果）"，依赖图也应调整为 BG1a → BG1b → BG2。

---

### 7. 未关闭的第 1-2 轮 LOW/INFO 问题

#### LOW #4: e2e-test-plan 缺 AC 覆盖矩阵

**状态：** 未修复

项目 CLAUDE.md 要求 "测试评审环节强制检查 AC 覆盖矩阵"。当前 e2e-test-plan 虽在测试描述中标注了覆盖的 AC 编号（如 "覆盖 AC-1"），但缺少规范化的 AC↔TS 映射矩阵表。

**建议修复方向：** 在 e2e-test-plan 末尾或各 TS 前增加：

```
## AC 覆盖矩阵

| AC | 覆盖场景 | 测试用例 | 覆盖状态 |
|----|---------|---------|----------|
| AC-1 | TS-1 PipelineDeps 结构化验证 | TC-1-01~03 | ✅ |
| AC-2 | TS-2 Failover 控制流统一 | TC-2-01~04 | ✅ |
... | ...
```

#### INFO #5: Plugin API 兼容性测试

**状态：** 维持 open（可接受）

ADR 更新后不需额外测试用例，文档说明即可。不阻塞。

---

### 8. 发现的问题汇总

| # | 严重度 | 位置 | 描述 | 修改方向 |
|---|--------|------|------|---------|
| 7 | **MUST FIX** | plan.md: BG1b Subagent 配置 → 修改/创建文件 | BG1b 的 subagent 配置列出 14 个 hook 文件，缺少 transport-execute.ts。Spec FR-1 要求所有 15 个 hook 完成 metadata 迁移，BG1b 覆盖不全将导致 AC-1 无法完全满足。 | 在 BG1b 的修改/创建文件列表中追加 `proxy/hooks/builtin/transport-execute.ts` |
| 8 | **MUST FIX** | plan.md: BG2 Subagent 配置 | Task 17 (ADR-0005 + ADR-0013 更新) 的 subagent 配置缺少 ADR 文档路径。读取文件和修改/创建文件均未包含 ADR 文档，subagent 无法自动发现需要修改的目标文件。 | 在 BG2 读取文件列表增加 `docs/adr/ADR-0005.md` 和 `docs/adr/ADR-0013.md`；在修改/创建文件列表增加这两个 ADR 文件 |
| 6 | LOW | plan.md: 依赖关系图 + 并行约束段落 | 依赖关系图显示 BG2 仅从 BG1a 分支，但 BG2 Task 8 显式依赖 BG1b Task 4。并行约束称 "BG1b 与 BG2 无依赖关系" 与 Task Table 矛盾。 | 修改依赖图：BG1a→BG1b→BG2；将并行约束改为 "BG2 依赖 BG1a + BG1b" |
| 4 | LOW | e2e-test-plan.md | 缺少 AC 覆盖矩阵表，项目 CLAUDE.md 要求测试评审时强制检查 | 补充 AC↔TS 映射矩阵 |
| 5 | INFO | test_cases_template.json | 无 Plugin API 兼容性测试用例（通过 ADR 文档说明解决即可） | 无需操作 |

---

### 等级判定理由

**Issue 7 — MUST FIX 判定依据：**
- Spec FR-1 明确要求 "15 个 builtin hook: metadata.get('xxx') as T → ctx.deps.xxx"
- File Structure 将 transport-execute.ts 列入 BG1b 职责范围（metadata.get → ctx.deps/ctx.field）
- BG1b subagent 配置遗漏此文件，导致 AC-1（第 4 子项 "15 个 builtin hook 中无固定依赖的 as 断言"）无法被 BG1b 满足
- 本条判定为 MUST FIX 因为该问题会导致代码质量门禁（15 个 hook 的 metadata 迁移）未执行完毕即进入下个阶段，属于 "功能失效"（某段代码的预期变更未被执行）

**Issue 8 — MUST FIX 判定依据：**
- Spec Constraint #7 和 AC-2 item 7 明确要求 ADR-0005 和 ADR-0013 更新
- Plan 虽已增加 Task 17，但 subagent 配置不包含 ADR 文件路径，导致 context 不足
- 若不修复，subagent 可能因找不到目标文件而跳过 ADR 更新
- 本条为 MUST FIX 因为 ADR 文档更新有明确的产品需求（Constraint #7），且 AC-2 item 7 要求 Plugin API 兼容性说明写入 ADR-0013

---

## 结论

**需修改后重审。已达循环上限（3 轮），升级到人工决策。**

本轮的 **2 条 MUST FIX** 均只需修复 plan.md 中的 subagent 配置文件清单，无需调整 spec、task 结构或分组编排：

1. **MUST FIX** — BG1b subagent 配置文件列表补上 transport-execute.ts
2. **MUST FIX** — BG2 subagent 配置的读取文件和修改/创建文件列表补上 docs/adr/ADR-0005.md 和 docs/adr/ADR-0013.md

这两条修复均为低风险机械变更，预计 5 分钟内完成。

## Summary

计划评审完成，第3轮，2条MUST FIX（BG1b 配置缺失 transport-execute.ts + BG2 配置缺失 ADR 文件路径），需修改后重审。已达循环上限。
