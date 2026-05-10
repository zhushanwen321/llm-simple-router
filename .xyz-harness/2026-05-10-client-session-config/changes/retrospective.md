# 复盘报告 — 客户端 Session 识别配置化 + Core 合并 + Pi 精简

**日期：** 2026-05-10
**需求：** 客户端 Session 识别配置化 + Core 包合并 + Pi 插件精简
**流程结果：** 所有阶段通过，2 次回退（计划评审 2 轮，编码评审 1 轮）

---

## 1. 回退根因分析

本需求共经历 3 轮评审，产生 7 条 MUST FIX。

### 按阶段分布

| 阶段 | 轮次 | MUST FIX | 根因分类 |
|------|------|---------|---------|
| 计划评审 | v1 | 3 | Spec 引用扫描不完整 |
| 计划评审 | v2 | 1 | v1 修复不彻底（仍遗漏 3 个文件） |
| 编码评审 | v1 | 3 | 编码遗漏（2）+ 测试缺失（1） |
| 测试评审 | v1 | 0 | — |

### 根因分类

| 根因类别 | 数量 | 典型问题 |
|---------|------|---------|
| **Spec 引用扫描不完整** | 4 | 未 grep 全量 `ctx.sessionId` 消费者、`detectClientAgentType` 调用者、core/tests 迁移 |
| **编码遗漏（spec 要求未执行）** | 2 | PipelineContext.sessionId 字段未移除、User-Agent fallback 未移除 |
| **新逻辑无测试覆盖** | 1 | detectClient body fallback 分支无测试 |

**主要模式：** 4/7 的 MUST FIX 源于 spec 编写阶段没有对代码库做全量搜索（grep），仅凭记忆列出受影响的文件和引用。这导致了「计划评审回退→修复不彻底→再次回退」的螺旋。

---

## 2. 评审有效性

| 来源 | MUST FIX 数 | 说明 |
|------|-----------|------|
| 评审 agent 发现 | 7 | 覆盖 spec 完整性、编码遗漏、测试缺失三个维度 |
| 用户发现 | 0 | 用户在确认点未提出额外问题 |

评审 agent 有效拦截了：
- **编译级错误**：sessionId 消费者遗漏会在移除字段后导致编译失败
- **资产丢失风险**：core/tests 9 文件（1523 行）未迁移将直接丢失
- **AC 违规**：User-Agent fallback 保留违反了 AC1.2 和 AC5.4
- **测试盲区**：body fallback 新逻辑无覆盖

评审 agent 遗漏：无显著遗漏。测试评审 0 MUST FIX 是可信的——测试覆盖确实完整。

**评审有效率：100%。** 唯一遗憾是计划评审第二轮的存在——第一轮修复不够彻底（仍遗漏 3 个文件），表明评审者的反馈被实现者不完全采纳。这不是评审 agent 的问题，而是执行 subagent 对修复范围理解不足。

---

## 3. 流程管理缺失分析

### 3.1 L1 gate 脚本未执行（阶段 1,3,5,7,8,9）

**现状：** `.xyz-harness/gate/` 目录不存在，无任何 `.pass` 文件。所有阶段的 L1 脚本检查均被跳过。

**根因：** 主 agent 未按照 dev-flow skill 的「通用调度模式」Step 2 执行 gate-script.sh。所有阶段直接从「派遣 subagent」跳到「下一阶段」，跳过了 L1 和 L2 门禁。

**skill 指令分析：** dev-flow skill 第二部分「通用调度模式」对 Step 2 的指令是明确的：

> Step 2: L1 脚本强制检查（仅 135789）
> 运行: gate-script.sh {NN} {project_root} [additional_args...]
> 通过 → 生成 .xyz-harness/gate/stage-{NN}.pass
> 不通过 → 直接 fail, 不进入 Step 3

指令足够明确。这是主 agent 的调度执行遗漏，非 skill 指令问题。

**预防建议：**
- dev-flow skill 可增加一句强化语：`**主 agent 必须执行 Step 2。跳过 Step 2 直接进入下一个 task 视为流程违规。**`
- CLAUDE.md Harness Agent 覆盖章节可增加规则：「主 agent 必须按 dev-flow skill 的四步调度模式执行，禁止跳过任何步骤」

### 3.2 L2 gate-checker 未派遣（所有阶段）

**现状：** 所有阶段均未派遣 harness-gate-checker subagent 进行独立验证。

**根因：** 与 L1 相同——主 agent 跳过了 Step 3。但 L2 缺失的后果比 L1 更严重：L2 gate-checker 是独立验证交付物质量的唯一机制（评审 subagent 自己不能评审自己）。

**预防建议：** 同 3.1。L2 gate-checker 的独立性使其价值高于 L1 脚本，应在 skill 中标注为「不可跳过」。

### 3.3 summary.md 未实时更新

**现状：** summary.md 的「阶段状态」表看起来是在流程接近结束时批量填写的，而非每个阶段完成后立即更新。证据：所有阶段的「状态」列一次性填写完成，异常记录也是在最后才补充。

**根因：** dev-flow skill 要求「summary.md 在每个阶段完成时立即更新，由执行 subagent 负责」。但实际执行中：
1. 主 agent 在派遣 subagent 时未将「更新 summary.md」作为任务要求明确传达
2. 执行 subagent 的 agent.md 中也未将 summary.md 更新作为必需步骤

**预防建议：**
- 修改 harness-executor agent.md，在「每次任务完成时」增加「更新 changes/summary.md 的阶段状态表」作为强制步骤
- 或在 dev-flow skill 的 subagent 配置表中将 summary.md 更新列为交付物之一

### 3.4 metrics.json 未创建

**现状：** `.xyz-harness/2026-05-10-client-session-config/metrics.json` 不存在。

**根因：** dev-flow skill 要求阶段 11 主 agent 将运行指标写入 metrics.json，但本次阶段 11 的执行是通过复盘 subagent 而非主 agent 直接调度（实际上本次复盘是由独立的 reviewer agent 执行的，并非 dev-flow 主 agent 调度的阶段 11）。主 agent 未执行 metrics 收集步骤。

**预防建议：** 在阶段 11 的调度指令中增加「Step 2: 主 agent 收集运行指标写入 metrics.json」，与复盘 subagent 的报告生成分开。

### 3.5 evidence 文件状态更正

summary.md 的「异常记录」声称 evidence 文件缺失，但实际检查发现：
- `verification_output.md` — **存在**（1030 字节，记录了 build/test/lint 全部通过）
- `ci_result.md` — **存在**（记录了本地替代验证）
- `deploy_result.md` — **存在**（记录了本地 npm run dev 确认）

这三份文件是在阶段 8/9 执行时被正确产出的。**summary.md 的此项记录有误。**

---

## 4. CLAUDE.md 改进建议

### 4.1 新增规则：Spec 编写前强制全量 grep

**问题：** 计划评审 4 条 MUST FIX 均源于 spec 编写者未对代码库做全量搜索，仅凭记忆列出受影响文件。

**建议新增规则（放在 CLAUDE.md 的 Harness Agent 覆盖章节）：**

```markdown
### Spec/Plan 编写时的引用完整性检查

在 spec 和 plan 中列出「受影响文件」或「引用计数」时，必须通过 `grep`/`rg` 对代码库做全量搜索验证，
禁止仅凭记忆或经验估算。

- 计划评审阶段如发现引用遗漏（实际引用 > spec 声明的引用），记为 MUST FIX
- 搜索范围必须覆盖：源码目录、测试目录、配置文件、CI/CD 配置
```

### 4.2 新增规则：Pipeline 门禁强制执行

**问题：** 主 agent 跳过了所有 L1/L2 门禁检查。

**建议新增规则：**

```markdown
### Dev-flow 门禁强制规则

当主 agent 按 dev-flow 流程调度时，每个阶段的 L1 gate-script.sh 和 L2 gate-checker
是强制步骤，禁止跳过。跳过门禁的流程视为未完成。

- 阶段完成后必须有对应的 `.xyz-harness/gate/stage-NN.pass` 文件
- pass 文件只能由 gate-script.sh 生成，禁止人工创建
- 无 pass 文件的阶段不得进入下一阶段
```

### 4.3 新增规则：字段/函数移除后的残留检查

**问题：** 编码评审 MF-1（sessionId 字段未移除）和 MF-2（User-Agent fallback 未移除）表明，实现者在执行「移除某物」的 task 时，没有做最终的残留检查。

**建议新增规则：**

```markdown
### 字段/函数移除的验证要求

当 task 要求移除某个字段、函数、或逻辑分支时，实现完成后必须：
1. `grep -rn "<被移除的标识符>" src/ tests/` 确认无残留引用
2. 如果 grep 有结果，逐一确认是合法保留还是遗漏
3. 编译通过（tsc --noEmit）确保类型层面的引用已清理

代码评审阶段如发现残留引用，记为 MUST FIX。
```

---

## 5. 代码质量改进建议

基于评审过程中发现的代码问题模式：

### 5.1 新代码分支必须测试

编码评审 MF-3（body fallback 无测试）表明，实现者在添加新逻辑分支时未同步添加测试。此次是 `detectClient()` 中新增了 body 参数 fallback 逻辑，但没有任何测试覆盖非 string body 值、body undefined、header 优先于 body 等场景。

**建议：** 在 CLAUDE.md 的编码规范中增加：「任何新增的 if/else 分支、try/catch 分支、switch case 都必须有对应的测试用例。编码评审阶段缺少对应测试记为 MUST FIX。」

### 5.2 清理旧功能要彻底

`context.ts` 中 `sessionId` 的硬编码逻辑（`x-claude-code-session-id` header 读取）没有被清理，`types.ts` 中 `PipelineContext.sessionId` 字段也没有被移除。尽管所有消费方已改为从 metadata 读取，这些残留代码是死代码，且与可配置化设计矛盾。

**建议：** 当 task 要求「移除旧功能」时，实现者的检查清单应包括：字段定义、初始化逻辑、所有引用、测试中的 mock 数据。

### 5.3 Spec 估算数据应与实际代码对齐

spec 中「19 处 ctx.sessionId」实际仅 8 处（其余是参数传递、接口定义等非直接引用），「38 处 import」实际 40 处。虽然偏差未导致功能问题，但数字不准会让实现者误判工作量。

---

## 总结

| 指标 | 数值 |
|------|------|
| 总 MUST FIX | 7 |
| 评审轮次 | 计划 2 轮，编码 1 轮，测试 1 轮 |
| 回退次数 | 2（计划评审不通过 → 修改 spec/plan） |
| 评审有效率 | 100%（agent 发现 7，用户发现 0） |
| L1 gate 执行率 | 0%（所有阶段均跳过） |
| L2 gate-checker 执行率 | 0%（所有阶段均跳过） |
| summary.md 实时更新 | 否（批量更新） |
| metrics.json | 未生成 |
| evidence 文件 | 齐全（3/3，summary.md 记录有误） |

**核心发现：** 技术层面（spec 合规、代码质量、测试覆盖）评审 agent 表现良好，7 条 MUST FIX 全部在评审阶段拦截。流程管理层面问题严重——L1/L2 门禁被全面跳过，暴露了主 agent 对 dev-flow skill 调度模式的执行偏差。
