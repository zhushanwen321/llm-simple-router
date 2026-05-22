---
phase: dev
verdict: pass
---

# Phase 3 Retrospect — Pipeline + Extension 架构深化 (Dev)

## Phase 执行质量

### 总结

本次 Dev Phase 完成了 Pipeline Hook 架构的核心结构性修复：

- **FR-1 (PipelineDeps 结构化)**：PipelineContext 新增 `deps: PipelineDeps` 字段 + 14 个迭代级具名字段（excludeTargets、mappingReason、isFailoverIteration、iterationStartTime、lastFailoverTrigger）。failover-loop 的 20+ 个 `metadata.set()` 迁移为 `ctx.deps` 一次性赋值。
- **FR-2 (控制流统一)**：resilience.ts 的 `case "failover"` 从 `throw ProviderSwitchNeeded` 改为返回 `{ action: "failover" }` 结果对象。failover-loop.ts 删除 ProviderSwitchNeeded catch 分支，控制流统一为 action 返回值驱动。
- **FR-6 (双注册表合并)**：hook-registry.ts 删除，Admin API 改为查询 proxyPipeline。register-hooks.ts 中每个 hook 只注册一次。
- **FR-4b (FormatRegistry 深化)**：新增 `transformRequestBody`/`transformResponseBody`/`transformErrorBody` 三个高阶方法。
- **部分 FR-4a**：2/6 个 converter 文件已合并，但无 `register-converters.ts`。

**产出：** 49 files, +475/-477 lines clean diff。130 test files / 1529 tests 全部通过。TypeScript 编译 0 错误。

### 与 Plan 的偏差

Plan 定义 4 个独立 Phase，本次 Dev Phase 以一个 PR混合了 Phase 1~4 的部分工作：

| Plan Phase | 描述 | 实现状态 |
|-----------|------|---------|
| Phase 1 (FR-1 + FR-6) | PipelineDeps + 双注册表合并 | ✅ 完整实现 |
| Phase 2 (FR-2 + FR-3) | 控制流统一 + TransportExecutor | ✅ FR-2 完整实现；❌ FR-3 TransportExecutor 未实现 |
| Phase 3 (FR-4a/b/c) | Format 子系统清理 | ✅ FR-4b 完整；⚠️ FR-4a 部分（2/6 文件合并）；❌ FR-4c 未实现 |
| Phase 4 (FR-5) | Admin 工具函数 | ❌ 4 个工具函数 (partialBody/extractDefinedFields/notFound/conflict) 未实现 |

这是有意为之的渐进式单 PR 策略，但 spec/plan 中未明确说明范围缩小，导致代码评审中产生混淆（INFO #12）。

### 编码评审流

| 轮次 |  verdict | MUST FIX | 说明 |
|------|---------|----------|------|
| v1 | fail | 2 | resilience.ts 仍 throw ProviderSwitchNeeded + failover-loop.ts 仍 catch |
| v2 | pass | 0 | 2 条 MUST FIX 已修复，控制流统一完成 |
| v3 (验证) | pass | 0 | 回归验证，无新问题 |

**评审效果：** 评审有效拦截了控制流分裂的遗留问题。v1 的 2 条 MUST FIX 直击架构核心——spec AC-2 要求消除异常驱动的 failover 路径，而实现确实保留了 throw/catch 路径。修复后控制流从双路径（异常 + 返回值）统一为单路径。

### 质量评估

**做得好的：**
1. **MUST FIX 修复彻底** — 第 2 轮修复后 `grep "throw.*ProviderSwitchNeeded"` 和 `grep "instanceof ProviderSwitchNeeded"` 均返回空，控制流完整性验证通过。
2. **测试通过率** — 130 个测试文件全部通过，覆盖了存量功能无回归。
3. **架构核心变更正确** — PipelineDeps 结构化是其他 FR 的前置条件，控制流统一是最具架构价值的变化。
4. **代码变更精炼** — 49 文件净增 475 行净删 477 行，基本零增长重构。

**可改进的：**
1. **预留 LOW 问题 6 条** — 防御性 metadata.get() 回退、ProviderSwitchNeeded 未标记 @deprecated、未实现的 FR-3/4a/4c/5 等。虽然不阻塞，但降低了代码清晰度。
2. **未提前声明 scope 缩减** — 计划做 4 个 Phase，实际只完整完成 1.5 个 Phase，其余缩减。应在 spec 或 plan 中明确声明本轮范围，减少评审混淆。
3. **TransportExecutor 未提取** — FR-3 是 Phase 2 的核心降低 pipeline 复杂度的举措，transport-execute hook 180+ 行内联逻辑保留，未完成深模块提取。
4. **6 个 hook 保留 metadata.get() 回退** — 虽然 `ctx.deps?.xxx` 优先，回退路径 + `as` 断言让编译器的类型安全保障打了折扣。

### 关键风险

1. **metadata.get() 回退膨胀** — 6 个 hook 保留的 `as` 断言回退可能在新 hook 中被复制作"安全模式"，导致 PipelineDeps 结构化效果被稀释。
2. **transport-execute hook 复杂** — 180+ 行内联逻辑的复杂 hook 仍是架构中最难理解和维护的模块。
3. **剩余 LOW 可能变成惯性** — 6 条未解决的 LOW 问题如果没有计划在下轮迭代处理，可能会无限期拖延。

## Harness 体验

### 流程顺畅度

**好的方面：**
- 编码评审流程结构清晰 — issues tracker 格式（id/severity/location/status/round）使 12 个问题的追踪状态一目了然
- code_review_v1/v2/v3 的文件命名和 frontmatter 格式一致，方便自动化处理
- MUST FIX 从发现到修复的闭环明确（open → resolved_in_round）

**摩擦点：**
1. **3 轮评审耗时** — 从 v1(fail) 到 v2(pass) 到 v3(验证)，评审消耗了较多轮次。虽然 MUST FIX 在第 2 轮就全部修复，但第 3 轮的回归验证增加了时间成本。
2. **测试计数波动** — v2 时 1544 passed (1 failed，included)，v3 时 1529 passed (全部通过)，差异来自 pre-existing failure 的包含/排除方式，造成容易误解的计数变化。
3. **scope 偏差无正式记录** — INFO #12 提到实现范围与 plan 不匹配，但没有在 plan 或 spec 中有正式的缩小范围声明，导致评审者需要揣测是否笔误。

### Gate 质量

Gate 在 Dev Phase 的核心作用是检查代码评审通过 + 测试通过。当前流程依赖 code_review 的 `verdict: pass` + `must_fix: 0` 来判断是否通过，机制有效。

### 时间消耗

| 阶段 | 时间占比 | 说明 |
|------|---------|------|
| 实现 | ~60% | PipelineDeps + 控制流 + 双注册表 + FormatRegistry 深化 |
| 第 1 轮修复 | ~15% | 修复 2 条 MUST FIX |
| 第 2+3 轮评审 | ~15% | 验证 + 回归确认 |
| 测试验证 | ~10% | 全量测试 + tsc 检查 |

总体合理。MUST FIX 修复效率高（v1→v2 一轮完成），但多一轮验证增加了成本。

### 工具体验

- **review 文件格式**：code_review 文件的 issue tracking 格式（表格 + 状态机）简洁有效，适合自动化解析。
- **test_results.md**：内容完整（测试结果 + tsc 结果 + 变更统计），但未说明测试环境信息（Node 版本、OS 等）。

### 建议

1. **scope 声明强制化**：如果 dev phase 的 scope 与 plan 不一致（缩小或扩大），应在开始实现前在 plan.md 中加注 `Actual Scope` 节。
2. **测试计数标准化**：测试结果文件应明确区分 baseline 测试数 vs 新增测试数，减少跨轮次的计数混淆。
3. **LOW 问题设置截止期**：对于评审中发现的非阻塞 LOW 问题，应在 plan 或 spec 中指定预计清理的 iteration，防止无限期堆积。
4. **TransportExecutor 优先**：作为最重要的剩余架构工作，建议在下一开发周期第一优先级完成。
