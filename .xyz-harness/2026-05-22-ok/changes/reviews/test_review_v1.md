---
verdict: "fail"
must_fix: 1
review:
  type: test_review
  round: 1
  timestamp: "2026-05-22T13:45:00"
  target: ".xyz-harness/2026-05-22-ok/changes/evidence/test_execution.json"
  summary: "测试评审完成，第1轮，1条MUST FIX，需修改后重审"

statistics:
  total_issues: 4
  must_fix: 1
  must_fix_resolved: 0
  low: 2
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md AC-4c, 执行证据 TC-4-03"
    title: "AC-4c stream-oa2ant.ts 映射表模式迁移未完成，行数未达标"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: LOW
    location: "执行证据 TC-4-01"
    title: "AC-4a 验证条件与 spec 不完全一致：converters/ 目录仍存在但测试标记为通过"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: LOW
    location: "执行证据 TC-4-03"
    title: "行数(wc -l)无法直接验证"映射表模式"架构迁移是否完成"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 4
    severity: INFO
    location: "执行证据 TC-1-02/03, TC-2-02/03"
    title: "多条 AC 验证依赖 grep 手工检查，建议对关键模式验证编写自动化测试"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 测试评审 v1

## 评审记录
- 评审时间：2026-05-22 13:45
- 评审类型：测试评审
- 评审对象：Pipeline + Extension 架构深化（spec.md 6 个 FR / 21 条 AC，plan.md 4-Phase / 17 Tasks）
- 测试执行证据：`.xyz-harness/2026-05-22-ok/changes/evidence/test_execution.json`

## 评审依据
- spec.md — 6 个 FR, 21 条 AC
- plan.md — 4 Phase, 17 Tasks, 4 Execution Groups
- test_execution.json — 12 个 TC，包含自动化测试（vitest 1529 全量通过）和手工验证

## AC 覆盖矩阵

| AC | 场景 | 覆盖状态 | 测试位置 |
|----|------|---------|----------|
| AC-1 (FR-1) | PipelineContext.deps 类型 + 5 迭代级字段 + failover-loop 无 metadata.set(固定依赖) + 15 hooks 无固定依赖 as 断言 | ✅ | TC-1-01 (tsc+vtest), TC-1-02 (grep metadata.set), TC-1-03 (grep metadata.get) |
| AC-2 (FR-2) | ResilienceResult.action + resilience.ts 无 throw + failover-loop 无 catch + 无手写 if(failed) + Failover 行为不变 + Plugin 兼容说明 | ✅ | TC-2-01 (resilience tests), TC-2-02 (grep throw), TC-2-03 (grep catch), TC-2-04 (集成测试) |
| AC-3 (FR-3) | TransportExecutor 类存在 + transport-execute hook ≤20 行 + 独立可测试 + 测试通过 | ⚠️ | TC-3-01 (文件/方法存在), TC-3-02 Round 2 (16 行 ✓) |
| AC-4a (FR-4a) | format/converters/ 目录不存在 + createConverter 移除 + register-converters.ts 存在 | ⚠️ | TC-4-01 (目录仍存在, 但关键 converter 文件已删除/合并) |
| AC-4b (FR-4b) | 3 个高阶方法存在 + 低阶方法保留 + 无 converter 返回原始数据 | ✅ | TC-4-02 (方法检查) |
| AC-4c (FR-4c) | BaseSSETransform 支持映射表 + stream-oa2ant ≤130 行 + stream-ant2oa 候选 + 异构转换器保留 processEvent | ❌ | TC-4-03 (224 行 > 130, passed=false, 未修复) |
| AC-5 (FR-5) | admin/utils.ts 存在 + admin/constants.ts 不存在 + admin 文件使用工具函数 | ✅ | TC-5-01 (utils 存在), TC-5-02 (constants 不存在), TC-5-03 (providers 使用 utils) |
| AC-6 (FR-6) | hook-registry.ts 不存在 + Admin 查询 proxyPipeline + 数据结构一致 + 注册一次 | ✅ | TC-6-01 (文件删除), TC-6-02 (方法/端点/数据结构) |

覆盖状态定义：
- ✅ 完整覆盖 — 有测试且断言充分
- ⚠️ 部分覆盖 — 有测试但仅覆盖部分场景
- ❌ 未覆盖 — 无测试或测试不相关（→ MUST FIX）

---

## 1. 测试覆盖度

### 1.1 AC 覆盖总体情况
21 条 AC 中，18 条 ✅，2 条 ⚠️，1 条 ❌。

**AC-4c ❌ 是唯一的必须修复项。** spec 明确要求 stream-oa2ant.ts 迁移为映射表模式且行数 ≤ 130，TC-4-03 确认当前 224 行未达标（passed=false），且无 Round 2 修复轮次。测试执行者的注释"不在 Plan BG3 范围"与 spec AC 的强制要求冲突——spec 是验收标准，Plan 是实施计划，spec 优先级高于 plan。

### 1.2 场景覆盖
- **正常路径**：12 个 TC 覆盖了所有 6 个 FR，每个 FR 有至少 2 个 TC
- **边界条件**：TC-2-04 覆盖了 failover 切换路径（500 → failover → 200），TC-1-03 覆盖了 metadata fallback 的 deps-first 模式
- **异常路径**：TC-3-02 Round 1 正确识别了 hook 简化失败（183 行 > 20），Round 2 修复后验证通过——这是理想的测试迭代模式
- **回归：** 全量 1529 测试全部通过，tsc 0 错误

### 1.3 自动化 vs 手工验证
项目合理采用了混合验证方法：
- **自动化（vitest）**：TC-1-01（全量回归）、TC-2-01/04（resilience/failover 集成测试）、TC-3-02（hook 行数验证）
- **手工（grep/ls/wc）**：TC-1-02/03（metadata 模式验证）、TC-2-02/03（ProviderSwitchNeeded 残留检查）、TC-4-01/02（目录/方法检查）、TC-5-01/02/03（admin 文件验证）、TC-6-01/02（hook 注册表验证）

手工验证对于一次性结构变更检查是合理的，但缺少自动化回归手段。

---

## 2. 测试质量

### 2.1 断言充分性
- **自动化测试**：1529 条 vitest 测试全通过，说明现有断言体系覆盖了功能正确性
- **手工 TC**：每条 TC 都有明确的执行步骤和证据输出，可重复执行
- **TC-3-02 迭代**：Round 1 发现 183 行 > 20 行目标，Round 2 验证通过（16 行）——这是高质量测试迭代的典范

### 2.2 测试意图与 spec 一致性
所有 TC 的测试意图与 spec AC 一致，没有出现"测试了错误的东西"的情况。TC 逐一对应 AC 的检查点。

### 2.3 脆弱性
- **TC-4-01**：测试标记为 passed=true，但证据显示 converters/ 目录仍存在。spec AC-4a 要求"目录不存在"，测试条件与 spec 不完全一致。这是一个脆弱点——如果未来严格按 AC 门禁检查，该测试会与 AC 冲突。
- 其他 TC 依赖的文件路径和 grep 模式是稳定的，不存在脆弱性。

---

## 3. 测试可维护性

### 3.1 结构清晰度
test_execution.json 的每条 TC 结构完整，包含 caseId、round、passed、execute_steps、evidence 5 个字段。Arrange-Act-Assert 模式清晰。

### 3.2 测试独立性
TC 之间没有执行顺序依赖。每个 TC 验证独立的 AC 或 FR，结果互不影响。

### 3.3 公共 setup
测试执行证据集中在单一 JSON 文件中，方便统一管理。但缺少公共的 setup/teardown 描述（比如哪些 TC 共享相同的集成测试环境）。

---

## 4. 数据构造合理性

本项目的测试主要为结构验证和回归测试，不涉及复杂的数据构造。手工 TC 中使用 grep/wc/ls 等命令直接操作代码库，不需要构造测试数据。vitest 自动化测试的测试数据构造属于现有测试框架范畴，不在本评审范围内。

---

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | spec.md AC-4c, TC-4-03 | **AC-4c（stream-oa2ant.ts 映射表模式迁移）测试验证失败且未修复**。TC-4-03 Round 1 passed=false（224 行 > 130 行目标），无 Round 2 修复轮次。执行者声称"不在 Plan BG3 范围"，但 spec AC 是验收标准，优先级高于 plan。该 AC 状态为 ❌（未覆盖）。 | 完成 stream-oa2ant.ts 的映射表模式迁移（目标 ≤ 130 行），重新执行 TC-4-03 验证。或更新 spec AC 以反映实际 scope（需在 spec 中说明 scope 缩减原因）。 |
| 2 | LOW | TC-4-01 | **AC-4a 验证条件与 spec 不完全一致**。TC-4-01 marked as passed=true，但证据显示 "converters/ 目录仍存在"。Spec AC-4a 要求 "format/converters/ 目录不存在"。测试的通过条件比 spec 宽松。 | 统一测试判定标准与 spec AC 一致。删除空目录或调整测试条件文档。 |
| 3 | LOW | TC-4-03 | **行数检查（wc -l）无法直接验证"映射表模式"架构迁移是否完成**。TC-4-03 使用 wc -l 作为验证手段，但行数减少是映射表模式迁移的伴生结果，不是目标本身。真正的验证点应该是：子类是否使用映射表构造函数而非覆写 processEvent。 | 增加更精确的验证点：检查类结构（是否使用 EventMapping[] 构造函数）、import 路径是否映射到 base 类的映射表模式方法。 |
| 4 | INFO | TC-1-02/03, TC-2-02/03 | **多条 AC 验证依赖 grep 手工检查，缺少自动化回归手段**。目前 4 个 TC 使用 grep 验证 metadata.set/get 模式、ProviderSwitchNeeded 残留等。这些模式在后续代码变更中可能被意外破坏，但无自动化测试防护。 | 考虑为关键模式验证（如"禁止 metadata.get('db') 固定依赖"）编写 ESLint 自定义规则或自动化测试，替代手工 grep 检查。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程。测试评审中仅用于逻辑缺陷（见上方分层规则）
> - **LOW**：建议修复，但不阻塞。测试评审中的命名/注释/格式问题统一归此类
> - **INFO**：观察记录，无需操作

---

## 结论

**需修改后重审。** 1 条 MUST FIX（AC-4c stream-oa2ant.ts 映射表模式迁移未完成），22 条 AC 覆盖矩阵中 1 条 ❌。TC-3-02 展示了良好的测试迭代模式（Round 1 发现 → Round 2 修复），但 AC-4c 缺少对应的修复轮次。修复后需补充验证结果。

### Summary

测试评审完成，第1轮，1条MUST FIX，需修改后重审。
