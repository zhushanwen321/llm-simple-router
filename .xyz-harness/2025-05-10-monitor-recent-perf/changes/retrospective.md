# 自动复盘 — 监控 recent 接口性能优化

**日期**: 2026-05-10
**需求**: `/admin/api/monitor/recent` 接口返回数据过大(>10MB)，将大字段分离实现摘要+详情按需加载
**最终状态**: 通过（阶段⑩用户确认）

---

## 一、全流程阶段追溯

| 阶段 | 状态 | 回退 | 关键事件 |
|------|------|------|---------|
| ① 需求分析 | 通过 | 无 | spec + plan 质量 high |
| ② 计划评审 | 通过(v1) | 无 | 0 MUST FIX，3 LOW，2 INFO |
| ③ 编码实现 | 通过 | 1次 | rebase origin/main 后测试文件 import 路径失效 |
| ④ 编码评审 | 通过(v1) | 无 | 2 LOW，用户要求修复后通过 |
| ⑤ 测试编写 | 通过 | 无 | 单元测试(404行) + 集成测试(101行) |
| ⑥ 测试评审 | 通过(v1) | 无 | 0 MUST FIX，3 LOW |
| ⑦⑧ 推送+CI | 通过 | 1次 | gate-script.sh eval backtick 解析 bug |
| ⑨ 部署验证 | 跳过 | — | 本地项目，无部署 |
| ⑩ 用户确认 | 通过 | 无 | 用户 review spec/plan/实现一致性后通过 |

---

## 二、回退事件分析

### 回退 1: rebase 后 import 路径失效（阶段③）

**现象**: 编码完成后 rebase origin/main，测试文件路径从 `core/tests/` 变为 `router/tests/core/`（main 分支合并了 core 到 router），import 路径需要修复。

**commit**: `458a668 fix: update import paths after core merge into router`

**根因分类**: 环境问题 — 并行分支改变了目录结构

**根因分析**:
- 功能分支基于旧目录结构（`core/tests/`）编写代码
- rebase 时 main 分支已合并了 core→router 重构
- git 能自动合并文件内容，但无法自动修复 TypeScript import 路径
- 这是 worktree 模型下并行开发的固有问题，非代码逻辑错误

**教训**: rebase 后应先 `npx tsc --noEmit` 检查编译，再进入评审流程。可以在 dev-flow 的 rebase 步骤后增加自动 tsc 检查。

**CLAUDE.md 建议**: 无需新增规则。此类问题应通过 rebase 后的编译检查流程捕获。

### 回退 2: gate-script.sh eval backtick 解析 bug（阶段⑦⑧）

**现象**: gate-script.sh 的编译检查步骤报失败，但实际编译是通过的。原因是脚本中 `eval` 对 backtick 的解析有 bug。

**根因分类**: 环境问题 — harness 工具链 bug

**根因分析**:
- L1 gate 脚本使用 `eval` 执行动态构建的命令
- backtick（反引号）在 eval 上下文中被 shell 解释为命令替换
- 导致实际执行的命令与预期不符
- 与本次需求代码无关，是 harness 基础设施的问题

**教训**: gate-script.sh 应避免 `eval` + 动态命令拼接，改用数组参数传递。这是一个 harness 工具链的 bug，需独立修复。

### 回退 3: 编码评审 LOW 问题用户要求修复（阶段④）

**现象**: 编码评审给出"通过"结论（0 MUST FIX，2 LOW），但用户要求修复 LOW-1（sendInitialSnapshot 未 strip upstreamRequest）和 LOW-2（容量淘汰 O(n)）后才算通过。

**commit**: `f460e25 fix: strip upstreamRequest in sendInitialSnapshot + O(1) eviction in completedDetails`

**根因分类**: 评审标准偏松 — LOW-1 实际应为 MUST FIX

**根因分析**:
- 评审员将 `sendInitialSnapshot` 未 strip `upstreamRequest` 标为 LOW，理由是"预存行为"+"仅影响少量 pending 请求"
- 但从用户视角看，pending 请求在初始快照中泄露 `upstreamRequest`（可达 200KB）是同一类性能问题
- 评审员过度使用了"预存行为"的豁免理由——如果本次需求就是消除大字段传输，那么所有遗漏的大字段传输路径都应被视为未完全实现 spec
- LOW-2（O(n) 淘汰）用户也要求修复，这是合理的品味要求，保持 LOW 分级是正确的

**教训**: 
1. 当需求的核心目标就是"消除 X"时，评审员不应以"预存行为"为由将遗漏的 X 降级为 LOW
2. 评审结论"通过"与用户实际要求修复之间存在 gap——dev-flow 应允许用户在评审通过后仍提出修复要求（当前流程已支持）

---

## 三、评审 Agent 有效性评估

### 评审发现的问题 vs 用户发现的问题

| 问题 | 发现者 | 评级 | 评估 |
|------|--------|------|------|
| completedDetails 容量约束缺失 | 计划评审(LOW-1) | LOW | 有效拦截，实现中已采纳 |
| `get()` 行为变更未记录 | 计划评审(LOW-2) | LOW | 有效提示，避免遗漏 |
| killRequest() 描述可能误导 | 计划评审(LOW-3) | LOW | 有效拦截 |
| sendInitialSnapshot 未 strip upstreamRequest | 编码评审(LOW-1) | LOW→应为MUST FIX | 发现了问题但分级偏低 |
| 容量淘汰 O(n) | 编码评审(LOW-2) | LOW | 发现了问题，用户选择修复 |
| cleanup TTL 测试验证内部状态 | 测试评审(LOW-1) | LOW | 有效改进建议 |
| 淘汰测试 if 条件断言 | 测试评审(LOW-2) | LOW | 有效发现逻辑缺陷 |
| delete 绕过正常路径 | 测试评审(LOW-3) | LOW | 有效改进建议 |

**用户额外发现的问题**: 无。用户在阶段⑩确认了 spec/plan/实现的一致性后通过。

**结论**: 评审 agent 有效拦截了所有实质性问题。唯一的问题是 LOW-1（sendInitialSnapshot）的分级偏低。

### 评审漏检分析

本次无评审漏检。三阶段评审（计划→编码→测试）覆盖完整，6 个 AC 全部验证。

---

## 四、AI 错误分析

### 错误 1: sendInitialSnapshot 的 strip 遗漏在实现阶段

**性质**: 实现遗漏

**分析**: spec 第 4 节"broadcast 补漏"只提到了 `broadcast()` 的 `request_start`/`request_complete` 事件，未显式提及 `sendInitialSnapshot()`。实现者按 spec 字面实现，导致遗漏。

**责任归属**: 
- spec 负部分责任——未列出 `sendInitialSnapshot` 这条独立的 SSE 路径
- 实现者负部分责任——spec 的"影响范围"节只列了 `broadcast()` 的变更，但 `sendInitialSnapshot` 也是一个会传输完整 ActiveRequest 的路径，应主动识别

**改进建议**: spec 的数据流分析应列出所有传输 ActiveRequest 的代码路径（不仅限于 broadcast），可以用 `grep -n 'clientRequest\|upstreamRequest\|ActiveRequest'` 快速扫描。

### 错误 2: 容量淘汰使用 O(n) 遍历

**性质**: 过度简化

**分析**: 实现者选择了遍历 Map 找最旧 key 的简单方案，200 条场景下性能可忽略。但 JavaScript Map 本身按插入顺序维护，直接 `keys().next().value` 即可获取最旧 key（这正是修复后采用的方案）。初次实现选择了不必要的遍历方案。

**改进建议**: 开发者应熟悉 ES6 Map 的插入顺序保证特性。这不是流程问题，是知识盲点。

---

## 五、CLAUDE.md 规则评估

### 现有规则覆盖情况

| 规则 | 本次是否触发 | 评估 |
|------|------------|------|
| 数据消费者完整性检查 | 是 | plan 评审 LOW-2 发现 `get()` 消费者未记录 |
| AC 覆盖矩阵 | 是 | 测试评审严格按 AC 矩阵检查 |
| structuredClone vs JSON roundtrip | 未触发 | 使用 spread operator，合规 |
| 兜底响应 | 未触发 | 不涉及 switch/catch |
| 新字段数据消费者检查 | 是 | spec 明确列出了 detailsMap 的所有消费者 |

### 需要新增/修改的规则

#### 建议 1: 大字段传输路径完整性扫描

**规则内容**: 当 spec 的核心目标是"消除/减少字段 X 的传输"时，spec 必须列出代码中所有传输包含 X 的数据结构的路径（包括但不限于 broadcast、snapshot、日志写入、API 响应等），并逐一标注处理方式。

**理由**: 本次 `sendInitialSnapshot()` 的遗漏就是因为 spec 只关注了 `broadcast()` 路径。一个系统性的路径扫描规则可以从源头避免此类遗漏。

**建议写入位置**: CLAUDE.md "新字段数据消费者检查" 小节，作为补充。

#### 建议 2: rebase 后自动编译检查

**规则内容**: rebase/merge 后必须执行 `npx tsc --noEmit` 确认编译通过，再继续后续流程。

**理由**: 依赖其他分支的目录结构变更不会在 rebase 时自动修复 import 路径。虽然这是偶发问题，但修复成本极低（一条命令），防御价值高。

**建议写入位置**: dev-flow 阶段③的前置步骤，或 create-worktree skill 的 post-rebase hook。

#### 建议 3: 评审分级校准 — "预存行为"豁免边界

**规则内容**: 当本次需求的核心目标就是解决某类问题时，不能以"预存行为"为由将该问题的遗留实例降级为 LOW。只有与本次需求目标无关的预存问题才能标为 LOW。

**理由**: 本次评审将 sendInitialSnapshot 的 upstreamRequest 泄露标为 LOW，理由是"预存行为"。但本次需求的核心目标就是减少大字段传输，遗漏一条传输路径应视为 spec 实现不完整。

**建议写入位置**: 评审 agent 的评审规则（xyz-harness-expert-reviewer skill）。

---

## 六、流程效率分析

### 时间分布

| 阶段 | 评审轮次 | 备注 |
|------|---------|------|
| 计划评审 | 1轮 | 高质量 spec+plan，一次通过 |
| 编码评审 | 1轮 + 用户修复 | 评审通过但用户要求修复 LOW |
| 测试评审 | 1轮 | 高质量测试，一次通过 |

### 质量指标

| 指标 | 数值 | 评估 |
|------|------|------|
| 总评审轮次 | 3轮（各1轮） | 优秀 |
| MUST FIX | 0 | 无阻断性问题 |
| 代码变更量 | ~60行生产代码 + ~500行测试 | 合理，测试:生产 ≈ 8:1 |
| 回退次数 | 3次（2环境+1评审偏松） | 可接受 |
| AC 覆盖率 | 5/6 自动化 + 1/6 手动 | 充分 |

### 效率亮点

1. **spec+plan 质量高**: 计划评审 0 MUST FIX，任务拆分清晰，为后续阶段奠定基础
2. **TDD 执行到位**: 先写失败测试再实现，红-绿周期完整
3. **双层测试覆盖**: 单元测试验证内部逻辑，集成测试验证 API 端点行为
4. **评审一次通过率**: 三个评审阶段均 1 轮通过

### 效率瓶颈

1. **rebase 路径修复**: 可通过自动 tsc 检查消除
2. **gate-script.sh bug**: harness 工具链问题，需独立修复
3. **评审分级偏松导致额外修复**: 可通过分级校准规则消除

---

## 七、总结

本次需求开发流程整体顺畅，spec/plan 质量为后续阶段的高效执行奠定了基础。三个评审阶段均一次通过，AC 覆盖完整。主要改进点：

1. **spec 路径完整性**: 消除类需求应扫描所有传输路径，不仅仅是显式提到的
2. **评审分级校准**: "预存行为"不应成为核心目标遗漏的挡箭牌
3. **rebase 后自动检查**: 一条 tsc 命令可以避免人工排查 import 路径问题

整体评价: **良好**。流程设计有效，评审 agent 有价值，主要问题集中在工具链和边界校准，非流程本身缺陷。
