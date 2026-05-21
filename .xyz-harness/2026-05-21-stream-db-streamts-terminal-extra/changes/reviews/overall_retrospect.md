---
phase: pr
verdict: pass
---

# 整体复盘 — stream-db-streamts-terminal-extra

覆盖全部 5 个 phase（spec → plan → dev → test → pr），综合各 phase 复盘记录和最终交付结果。

## 1. Phase Execution Review

### Summary

本次需求为"运行时诊断数据持久化 + 模型超时 UI 修复"，共涉及 8 个新增 DB 诊断列 + 1 个前端 UI 修复。全部 5 个 phase 顺利完成，最终产出 PR #161，CI 全绿（test SUCCESS, docker SKIPPED）。

| Phase | 耗时 | 关键产出 | 轮次 |
|-------|------|---------|------|
| spec | ~6 轮交互 | spec.md（8 FR + 8 AC + Data Consumer Checklist） | 2 轮审查 |
| plan | ~4 轮交互 | plan.md（5 Tasks + 2 Execution Groups）+ e2e-test-plan.md + test_cases_template.json | 2 轮审查 |
| dev | ~40 分钟 | 11 个源码文件修改 + 13 个新测试 | 2 轮 code review（3 MUST FIX → 0） |
| test | ~25 分钟 | 15 个新 vitest 测试 + 3 项前端验证 | 2 轮 test review（1 MUST FIX → 0） |
| pr | ~10 分钟 | PR #161, 20 commits, CI 全绿 | 1 轮 |

**最终指标：**
- 后端测试：1487/1487 通过（含 15 个新增诊断字段测试）
- 前端：vue-tsc + eslint 零错误
- CI：test SUCCESS, docker SKIPPED
- PR：20 commits, 已合并

### Problems Encountered（跨 Phase 汇总）

| # | 问题 | 影响的 Phase | 根因 | 严重性 |
|---|------|-------------|------|--------|
| 1 | YAML frontmatter 嵌套格式 | spec, plan, dev | subagent 审查输出将 verdict/must_fix 放在嵌套对象中，gate 脚本读不到 | 阻塞 gate（每 phase 至少浪费 1 轮） |
| 2 | spec AC 枚举不完整（AC6 缺 failover_retry） | spec → plan | 人工检查 FR→AC 映射遗漏 | plan_review 才发现 |
| 3 | plan 未覆盖 failover 双路径 | plan → dev | failover-loop.ts 的 while 循环有两条触发路径（内层 ProviderSwitchNeeded + 外层 excludeTargets），plan 只描述了内层 | MUST FIX（dev code review 发现） |
| 4 | resilience.ts else 分支未填充 headers_sent | dev | discriminated union 的所有变体未逐一检查 | MUST FIX |
| 5 | overflow_redirect 测试遗漏 | test | e2e-test-plan.md 有该场景，但 test_cases_template.json 映射时丢失 | MUST FIX |
| 6 | spec 与实现的 resilience_action 期望值不一致 | dev → test | 实现阶段变更了设计（NULL → "done"）但未同步 spec | test review 才发现 |

### What Would You Do Differently

**1. spec 阶段内建交叉对照检查**

FR 枚举值 → AC 覆盖的映射不应依赖后续 review 发现（AC6 缺 failover_retry 就是一例）。应在 spec 完成后立即运行一个轻量级检查：每个 FR 中出现的枚举值是否都有对应 AC 断言。

**2. plan 阶段对复杂控制流做路径枚举**

failover-loop.ts 的 while 循环存在双路径（内层异常 + 外层排除），plan 只分析了内层。对含 while/for 循环 + 多种退出条件的文件，plan 阶段应强制列出所有执行路径及其数据产出。

**3. dev 阶段拆分高风险 task**

Tasks 1-3 合并到单个 subagent 导致 21 分钟超时。应按风险分层：DB migration + 类型扩展（低风险，快速 subagent）vs 数据流全链路串联（高风险，独立 subagent + 更多上下文注入）。

**4. dev 阶段的 spec 变更必须标注**

resilience_action 从 NULL 改为 "done" 是合理的设计调整，但未在 dev commit 中标注"spec 需同步更新"。导致 test 阶段评审时才发现不一致，浪费了 1 轮修复。应要求 dev commit message 中包含 `spec-note:` 标签。

**5. test_cases_template 增加 AC 引用字段**

template 的 25 个 TC 中遗漏了 overflow_redirect，因为 template 与 e2e-test-plan.md 之间没有可追溯的映射关系。如果 TC ID 采用 `TS{场景组编号}-TC{序号}` 格式，并增加 `ac_ref` 字段，可以自动检测覆盖缺口。

### Key Risks（未关闭）

1. **headers_sent=1 无独立断言**：stream_error 路径已执行但未对 DB 列做显式断言，仅依赖代码审查。
2. **failover_trigger 内层路径无独立测试**：ProviderSwitchNeeded 路径的 failover_trigger 赋值无测试保护。
3. **前端 UI 无自动化验证**：AC8 的 3 项前端验证基于源码审查，无 Playwright/Cypress。
4. **client_disconnect / loop_detection abort_reason 无程序化测试**：需要真实 socket abort 模拟。

这些风险的共同特征是"测试环境无法模拟的边界条件"。短期内可接受（代码审查覆盖），长期应在 E2E 测试框架中补充。

---

## 2. Harness Usability Review

### Flow Friction

**最严重的摩擦点：YAML frontmatter 格式问题贯穿全流程。**

每个 phase 的 review subagent 都将 `verdict`/`must_fix` 放在嵌套对象中，gate 脚本无法解析。主 agent 每次都需要手动修复 frontmatter，累计浪费约 4-5 轮交互。这是系统性问题，不是偶发错误。

**Phase 间交接不流畅：**
- Phase 2 gate 通过后 retrospect 被跳过，直接跳到了 Phase 5 的任务注入。phase transition 的自动化流程有 bug。
- Phase 3 → Phase 4 的 transition 正常。

**Subagent 调度效率：**
- 后端 subagent 21 分钟 vs 前端 subagent 2 分钟，差异源于 task 粒度不均和 skill 加载开销。
- Background 模式的 `collect_subagent` 轮询消耗了主 agent 大量等待时间。

### Gate Quality

| Phase | Gate 结果 | 问题 |
|-------|----------|------|
| spec | PASS（2 次尝试） | 第 1 次 gate 脚本路径错，第 2 次 frontmatter 格式错 |
| plan | PASS（1 次） | gate 脚本未检查文件内容，仅验证存在性 |
| dev | PASS（1 次） | Stage 3 gate 正常 |
| test | PASS（2 次审查） | 正确阻止了 MUST FIX |
| pr | PASS | CI 全绿 |

**Gate 检查深度不一致**：spec gate 检查了 verdict/must_fix 字段值，plan gate 只检查文件存在。所有 phase 应统一使用相同深度的 gate 检查。

**Code review subagent 的价值已验证**：dev phase 的 3 条 MUST FIX 和 test phase 的 1 条 MUST FIX 都是真实的实现遗漏，不是误报。独立审查 subagent 的 ROI 明确。

### Prompt Clarity

**有效的设计：**
- spec 阶段的 six-element check + AMBIGUITY 标记提供了结构化框架
- L1/L2 复杂度判定表帮助快速选择 Execution Group
- "禁码铁律"在复杂路径下被严格执行

**需要改进的设计：**
- Execution Group 模板中的 subagent 配置（Agent/Model/注入上下文）不够明确，主 agent 需要额外查找 CLAUDE.md 中的模型选择规则
- test_cases_template.json 的 `steps` 字段粒度不统一，有些列出了具体断言，有些只写"代码路径确认"
- subagent task prompt 中对 YAML frontmatter 格式的要求不够强，导致系统性偏差

### Automation Gaps

| Gap | 影响 | 修复方案 | 优先级 |
|-----|------|---------|--------|
| YAML frontmatter 嵌套检测 | 每 phase 浪费 1 轮 | gate 脚本增加 frontmatter 扁平化检查 + 自动修复 | P0 |
| FR→AC 枚举覆盖自动检查 | AC 遗漏到 plan_review 才发现 | spec 完成后自动提取 FR 枚举值和 AC 断言做 diff | P1 |
| TC→AC 覆盖矩阵自动生成 | test review 手动构建矩阵耗时 | template 增加 ac_ref 字段，自动生成覆盖矩阵 | P1 |
| gate 检查深度统一 | plan gate 只检查文件存在 | 所有 phase gate 统一检查 frontmatter + verdict + must_fix | P1 |
| subagent 耗时预估 | 无法判断 collect_subagent 时机 | dispatch 时记录 task 估算耗时，超时告警 | P2 |
| spec-测试一致性自动检查 | resilience_action 期望值不一致到 test review 才发现 | 解析 spec AC 的期望值和测试断言值做自动比对 | P2 |

### Time Sinks

| 环节 | Phase | 耗时估计 | 可缩减比例 |
|------|-------|---------|-----------|
| 后端 subagent 执行 | dev | 21 分钟 | 40%（拆分 task + 减少 skill 注入） |
| frontmatter 手动修复 | 全流程 | 累计 15 分钟 | 90%（自动化） |
| AC 覆盖矩阵构建 | test | 10 分钟 | 80%（ac_ref 自动化） |
| 数据流路径追踪 | plan | 8 分钟 | 50%（code-review-graph MCP） |
| collect_subagent 轮询 | dev | 持续 | —（background 模式固有限制） |

### 整体评价

harness 流程在本次需求中发挥了预期作用：独立审查 subagent 捕获了 4 条 MUST FIX（3 条代码 + 1 条测试覆盖），gate 机制阻止了未完成的 phase 推进。最核心的质量保障来自两个环节：**spec 的 Data Consumer Checklist**（强制列出 4 类消费者，防止遗漏）和 **dev code review**（发现 failover 双路径遗漏和 discriminated union 变体遗漏）。

最大的流程浪费是 YAML frontmatter 嵌套问题，5 个 phase 中至少 3 个受影响。如果只能改一个地方，就改 gate 脚本增加 frontmatter 自动修复。
