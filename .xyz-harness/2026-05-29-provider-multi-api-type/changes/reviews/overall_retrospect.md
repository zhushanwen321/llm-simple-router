---
phase: pr
verdict: pass
---

# Phase 5 (Overall) Retrospect — provider-multi-api-type

## 1. Phase Execution Review

### Summary

完整执行了 5 个 phase 的 xyz-harness 工作流，实现 Provider 多 API 类型支持功能。

| Phase | 关键产出 | 轮次 | 状态 |
|-------|---------|------|------|
| Spec | spec.md (7 FR/13 AC) + ADR 0006 + UI Demo | 2 轮 review | ✅ |
| Plan | plan.md + 3 子文档 + interface_chain.json + test_cases_template.json | 5 轮 review | ✅ |
| Dev | BG1-BG3 后端 + FG1 前端 + 5 步专项审查 | 3 轮 taste + 2 轮 robustness | ✅ |
| Test | 28 TC 执行（25 automated + 3 code_review）+ 2 新测试文件 | 1 轮 gate | ✅ |
| PR | PR #177 创建 + CI 通过 | 1 轮 gate | ✅ |

**规模**: 47+ 文件变更，后端 types/DB/proxy/admin + 前端 components/composables/views，142 测试文件/1743 测试。

### Phase 5 (PR) 本身

PR 创建和 CI 验证顺利。`gh pr create` 一次成功，CI 在 2m18s 内通过（build + tsc + test）。无 lint 错误、无 type 错误、无测试失败。这是 5 个 phase 中最顺利的一个。

### Problems Encountered (跨 Phase 全局)

**1. 跨文档一致性是最大摩擦源**

Spec → Plan → Dev 的信息传递依赖文档。resolveEndpoint 的行为（空数组 throw vs fallback）、parseEndpoints 的位置、迁移文件拆分方式——每个决策在 4-5 个文档中出现，修改一处容易遗漏其他。

Plan 阶段 5 轮 review 中 4 轮是跨文档同步问题。Dev 阶段的 BG1/BG2 边界入侵（BG2 修改了 BG1 漏掉的 createProvider 签名）也是文档精度不足的后果。

**2. Review → 修复 → 再 Review 循环的成本高**

Dev 阶段 Taste Review 经历 3 轮（v1→v2→v3），Test 阶段 subagent 超时重试 1 次。根因都类似：首轮产出质量不足，后续迭代中修复引入新问题（M4: 修复 M2 时添加 eslint-disable）。

**3. subagent 并行度需要根据任务量动态调整**

Test 阶段首次 4 并行全部超时，改为 2 并行后成功。Dev 阶段 3 Wave 调度（1+2+1）则没有超时问题。说明并行度不能一刀切——需要按 subagent 的预估工作量决定。

### What Would You Do Differently (全局)

1. **Spec 阶段用枚举矩阵写 AC**：3 种 api_type × N 种行为 = 矩阵。这次 AC 是线性列举，遗漏了 openai-responses 枚举值的正向流程，review 第 1 轮才补上。

2. **Plan 阶段先定行为表再写子文档**：resolveEndpoint 的 9 种输入场景应该在 plan.md 总纲中一次性定义，子文档从行为表派生。避免 5 轮跨文档对齐。

3. **Dev 阶段编码前执行类型查重**：`grep -r "type ApiType" router/src/` 3 秒就能发现重复定义，但被跳过了。CLAUDE.md 的"写之前先读"是直接适用的。

4. **Test 阶段让 subagent 直接输出 JSON**：subagent 已经知道 passed/failed 和 execute_steps，不需要主 agent 手工格式化 26 个条目。

5. **修复 MUST FIX 时显式禁止 eslint-disable**：在修复 subagent 的 task prompt 中加入约束，避免修复引入同类违规。

### Key Learnings

1. **5 步专项审查（BLR/Standards/Taste/Robustness/Integration）比单步 review 有效**：不同维度从不同角度发现同一问题（legacy 路径空 key 在 BLR 和 Robustness 中都被发现），交叉验证增加了发现率。全部 5 个 MUST FIX 都是真实问题，无 false positive。

2. **interface_chain.json 的接口契约传递有效**：resolveEndpoint 的 9 种行为场景完整注入到每个编码 subagent 的 task prompt 中，实现与 spec 完全对齐。

3. **Wave 调度模式适合有依赖关系的多 Group 任务**：BG1→BG2+BG3→FG1 的 3 Wave 执行清晰可靠。BG2 和 BG3 并行节省了时间。

4. **UI Demo 在 plan 阶段有价值但不应阻塞 plan review**：3 轮 UI 迭代占了 plan 阶段 ~25% 时间，但 UI 细节（行高、label 位置）在实现阶段才需要精确处理。

## 2. Harness Usability Review

### Flow Friction

1. **5 phase 串行门控是最大的结构性摩擦**：每个 phase 必须 gate pass 才能进入下一个，且 gate 需要特定的证据文件格式（YAML frontmatter + 布尔值类型严格检查）。这在保证质量的同时增加了文档维护成本。

2. **test_execution.json 手工编写是 test 阶段最大摩擦**：26 个 TC × 6 个字段 = 156 个字段值需要手工从自然语言结果转换为 JSON。

3. **跨文档一致性维护贯穿 spec→plan→dev 三个阶段**：同一个函数签名在 4-5 个文档中出现，修改是级联的。

### Gate Quality

1. **Gate 检查零 false positive**：5 个 phase 的 gate 检查全部准确，没有"文档格式正确但被拒"或"文档有问题但通过了"的情况。

2. **YAML 布尔值类型检查严格**：`pr_created: "true"`（字符串）会被拒，必须是 `pr_created: true`（布尔值）。这种严格性在 test_execution.json 的 `passed` 字段上同样有效——避免了 1/"true"/"yes" 等歧义。

3. **Gate 脚本的 cross-reference 检查有效**：test_execution.json 中的 caseId 与 test_cases_template.json 交叉验证，确保没有遗漏 TC。

### Prompt Clarity

1. **每个 phase 的 skill 指令足够清晰**：step-by-step 指导 + YAML schema 示例 + 常见错误表格，AI 能准确执行。

2. **interface_chain.json 的 L2 接口契约定义有价值**：methods 数组（params/returns/edge_cases）被注入到编码 subagent 的 task prompt 中，确保实现与 spec 对齐。

3. **5 维度审查的分工定义清晰**：BLR（业务逻辑正确性）、Standards（命名/格式/类型）、Taste（代码品味/anti-pattern）、Robustness（异常/边界/安全）、Integration（跨层数据链路）——每个维度有明确的检查范围和严重度分级。

### Automation Gaps

1. **跨文档一致性检查应自动化**：grep 关键函数签名 + diff 返回值/边界条件，不需要 5 轮人工 review 对齐。

2. **MUST FIX 修复后应自动触发 re-review**：当前需要手动 dispatch v2/v3 审查 subagent。自动触发可以减少 2-3 轮手动调度。

3. **test_execution.json 应由 subagent 直接生成**：避免主 agent 手工格式化 26+ 条目。

4. **UI 测试的验证方式应在 plan 阶段决定**：3 个 type=ui 的 TC 留到 test 阶段才标注为 code_review，plan 阶段就该明确。

5. **subagent 超时后应有自动降级重试**：4 并行超时 → 自动降为 2 并行重试，不需要主 agent 手动调整。

### Time Sinks

| Phase | 时间黑洞 | 占比 |
|-------|---------|------|
| Spec | 方案迭代（3 次方向调整）| ~30% |
| Plan | 5 轮 review（4 轮是跨文档同步）| ~60% |
| Dev | Taste Review 3 轮 + failover-loop 拆分 | ~50% |
| Test | subagent 超时重试 + JSON 手工编写 | ~30% |
| PR | 无 | 0% |

**全局最大时间黑洞**：Plan 阶段的跨文档一致性对齐（5 轮 review × 跨 4-5 个文档）。如果有一致性检查脚本，理论上 2 轮就能通过。

### 对 Harness 工作流的整体评价

xyz-harness 的 5 phase 门控流程在质量保障上效果显著：
- **所有代码变更经过 spec→plan→code review→test→CI 五道门**，无跳过
- **5 步专项审查发现 5 个 MUST FIX**，全部是真实问题
- **Gate 检查零 false positive**，格式要求严格但合理

主要改进方向是**减少文档维护成本**（跨文档一致性自动化、test_execution.json 自动生成）和**优化 subagent 调度**（超时降级、re-review 自动触发）。
