---
phase: pr
verdict: pass
---

# Overall Retrospect — retry-rule-upgrade

## 整体 Phase 执行质量

### 做得好的

1. **从问题到交付的完整链路**：从 Kimi 429 usage-limit 误触发开始，经过根因分析 → 5-section 设计确认 → Wave 编排实施 → AC 全覆盖测试 → CI 通过 PR，跨越 5 个 Phase，全部交付物完整。每个 Phase 的 gate 最终均通过。

2. **subagent-driven-development 高效落地**（Phase 3 确认）：3 个 Wave（BG1 → {BG2, BG3} → FG1），BG2/BG3 并行执行节省约 40-50% 时间。Subagent task prompt 质量直接影响产出准确性——BG1 因 prompt 包含完整 SQL 和接口定义一次性正确实现。

3. **测试驱动设计贯穿始终**：17 个 test case 精确映射 8 个 AC，body-matcher 22 + retry-rule-matcher 15 = 37 个单元测试预先规划。最终覆盖 1503 后端测试 + 5 前端组件测试。

4. **基础设施问题推动改进**：Phase 1 的 subagent 加载失败、Phase 4 的 subagent 扩展文件被置空，持续暴露扩展代码缺陷。最终在 Phase 4 末尾推动用户修复，使 gate review 恢复正常。

5. **增量演进避免了大规模重构**（Phase 1 明确选择 Method 1）：ALTER TABLE ADD COLUMN、NULL 默认值确保向后兼容；现有规则无需迁移脚本；前端在现有 Dialog 上加控件而非全新页面。

### 各 Phase 跨引用问题

| 问题 | 首次提及 | 最终解决 | 复盘回溯 |
|------|---------|---------|---------|
| subagent 扩展异常 | Phase 1 (Spec) 复盘 | Phase 4 Round 7 用户修复 | 横跨全部 5 个 Phase |
| 前端测试基础设施缺失 | Phase 1 spec 含 FR6 但推迟实现 | Phase 4 Round 6 新安装 vitest+jsdom | Phase 3 Dev 未预见，到 Test 才暴露 |
| evidence 不更新导致 review 不通过 | — | Phase 4 Round 7 (证据引用修复后通过) | Phase 4 复盘记录为教训 |
| gate 脚本路径问题 | Phase 1 复盘 | 未修复（workaround: 用全局路径） | 已知但未处理的技术债务 |
| 迁移计数硬编码脆弱性 | Phase 3 复盘 | 未修复（workaround: 每次新增 migration 手动更新） | 低风险，留待后续 |

### 可改进的

1. **Subagent 扩展稳定性是瓶颈**（Phase 1 → Phase 4 持续暴露）：
   - Phase 1: spec review subagent `CollectSubagentParams is not defined` → 手动执行
   - Phase 4: subagent 扩展文件被置空 → 7 轮 review loop → 用户修复后通过
   - 同一个底层问题在不同 Phase 以不同形式暴露，浪费了大量来回轮次。

2. **前端测试基础设施应前置**（Phase 1 spec 即有 FR6）：
   - Phase 3 Dev 实现后端 + 前端 UI，但未搭建前端测试框架
   - Phase 4 Test 才紧急安装 vitest、@vue/test-utils、jsdom
   - 建议：项目 CLAUDE.md 中记录前端测试框架为项目基础设施，新 Phase 1 就应确认已配置。

3. **Evidence 驱动机制的理解成本高**：
   - Phase 4 review 反复拒绝 AC6/AC7，即使前端测试文件已提交
   - 根因：review subagent 只读 evidence 文件，不扫描源码
   - 经验：新增测试后必须立即更新 test_execution.json + test_results.md

4. **Docker CI 问题在 Phase 5 才暴露**：
   - 前端测试文件在 vue-tsc 构建中被检查，而 Docker 环境无 vitest 依赖
   - commit `809b84a` 修复：在 tsconfig.app.json 中 exclude 测试文件
   - 本地开发因 node_modules 有 vitest 未发现此问题

## Harness 整体体验

### 流程质量评估

| 维度 | 评分 | 跨 Phase 证据 |
|------|------|--------------|
| 阶段划分明确性 | ⭐⭐⭐⭐⭐ | 5 个 Phase 边界清晰（Spec → Plan → Dev → Test → PR），每个 Phase 有独立交付物和 gate，从未混淆 |
| 模板覆盖度 | ⭐⭐⭐⭐ | spec 的 9 步 checklist、plan 的 4 要素 task 表、test 的 case ID 映射均实用。缺"Out of Scope"小节（Phase 1 复盘指出） |
| 测试指导性 | ⭐⭐⭐⭐⭐ | AC 覆盖矩阵 → test_cases_template → test_execution 映射链路完整。Gate cross-ref 自动验证 template-execution 一致性 |
| 门禁严格度 | ⭐⭐⭐⭐ | Gate 脚本（格式验证）+ review subagent（覆盖率评估）双保险。Subagent 扩展故障时 review 无法正确感知新的测试文件 |
| 复盘价值 | ⭐⭐⭐⭐ | 每个 Phase 强制复盘迫使回顾问题和提炼教训。问题跨 Phase 串联后可以识别出系统性问题（如 subagent 稳定性） |

### 各 Phase 可改进建议的跨 Phase 落实情况

| 建议来源 | 建议内容 | 落实状态 |
|---------|---------|---------|
| Phase 1 复盘 | spec 加 Out of Scope 小节 | ❌ 未落实（模板未改） |
| Phase 1 复盘 | gate 脚本支持 PATH/npm bin 查找 | ❌ 未落实 |
| Phase 2 复盘 | BG2 拆分建议（BG2a+BG2b） | ⚠️ 未触发（subagent 执行成功，未遇瓶颈） |
| Phase 3 复盘 | 迁移计数用动态断言替代硬编码 | ❌ 未落实（低风险，留待后续） |
| Phase 4 复盘 | 前端测试框架应前置 | ❌ 规范层面未记录，但后续项目可参考 |

### Phase 耗时分布

| Phase | 主要耗时活动 | 复盘关键发现 |
|-------|-------------|-------------|
| 1 Spec | ~12 turns — 根因分析 + 5 section 设计讨论 | subagent 故障浪费 2 turns |
| 2 Plan | 4 turns — Task 拆解 + Wave 编排 + 17 test cases | 最顺利的 Phase |
| 3 Dev | 9 turns — 3 subagent dispatches | BG2/BG3 并行效率高 |
| 4 Test | 15+ turns — 7 轮 review loop | 6 轮卡在扩展故障 |
| 5 PR | 8 turns — Push + CI + Docker 修复 | Docker 的 vitest 问题额外一轮 |

### 关键指标

| 指标 | 值 |
|------|-----|
| 总变更文件 | ~31 源文件 + 8 review/plan 文档 + 6 测试文件 |
| 迁移 | 1 (migration #049: ALTER TABLE retry_rules) |
| ADR | 1 (ADR 0005: retry-rule-body-matchers) |
| 最终测试 | 127 files, 1503 tests 后端 + 5 tests 前端 |
| CI 状态 | test: SUCCESS, docker: SUCCESS |
| PR | [#165](https://github.com/zhushanwen321/llm-simple-router/pull/165) |
| Review MUST_FIX (最终) | 0 |
| 总轮次 | ~48 turns |
