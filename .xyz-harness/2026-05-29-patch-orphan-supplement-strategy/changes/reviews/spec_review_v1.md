---
review:
  type: spec_review
  round: 1
  timestamp: "2026-05-29T12:00:00"
  target: ".xyz-harness/2026-05-29-patch-orphan-supplement-strategy/spec.md"
  verdict: pass
  summary: "Spec 评审完成，第1轮通过，0条MUST FIX，2条LOW，1条INFO"

statistics:
  total_issues: 3
  must_fix: 0
  must_fix_resolved: 0
  low: 2
  info: 1

issues:
  - id: 1
    severity: LOW
    location: "spec.md:FR-4"
    title: "正向删除后合并连续 user 的简化逻辑未定义"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: LOW
    location: "spec.md:FR-3"
    title: "Tool Call Cache 恢复行为条件不明确"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: INFO
    location: "spec.md:AC-10"
    title: "AC-10 与 Constraint #2 内容冗余"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# Spec 评审 v1

## 评审记录
- 评审时间：2026-05-29 12:00
- 评审类型：Spec 评审（独立评审，无 plan.md 参考）
- 评审对象：`.xyz-harness/2026-05-29-patch-orphan-supplement-strategy/spec.md`

## 评审发现

### 1. spec 完整性

#### 1.1 目标明确度 ✅

**通过。** 目标清晰：将 `patchOrphanToolResultsOA` 从"删除"策略重构为"补配对"策略。Background 章节提供了充分的背景分析——包括问题根本原因（context compact 截断）、数据验证（DB 中实际 548 条请求仅 2 条异常，`upstream_error_logs` 数据），以及 Claude Code/LiteLLM 的对照调研。

#### 1.2 范围合理性 ✅

**通过。** 范围收缩在单个函数 `patchOrphanToolResultsOA` 内：
- FR-1 和 FR-2 定义反向/正向两种方向的处理策略
- FR-3 为可选增强，有明确降级路径
- FR-4 和 FR-5 明确定义移除内容
- Constraints 明确边界：Anthropic 版本不动、函数签名不变、provider 特定逻辑分离

范围不大不小，边界明确，没有"顺手重构"的溢出风险。

#### 1.3 验收标准可测试性 ✅

**通过。** 所有 10 条 AC 均为 Given/When/Then 格式，每条条件明确可量化：
- AC-1/2/3/4 有明确的输入消息链结构和期望输出结构
- AC-5 采用 JSON 序列化对比验证幂等性
- AC-6/7 覆盖特定边界值
- AC-8 指向具体测试文件
- AC-9 有具体搜索条件

每条 AC 均可直接编写单元测试验证，无模糊表述。

#### 1.4 待决议项 ✅

无 `[待决议]` 标记。FR-3 标记为"可选增强"并有降级路径，风险评估充分。

### 2. 约束完整性 ✅

**通过。** 6 条约束覆盖了关键维度：
1. ID 不变 — 复用原始 ID
2. Content 固定 — 固定字符串 `"[context truncated]"`
3. Anthropic 不动 — 明确边界
4. Provider 逻辑分离 — 阻止 scope creep
5. 函数签名不变 — 兼容现有调用方
6. FR-3 降级路径 — 实现风险可控

### 3. 功能需求覆盖

#### FR-1（反向补配对）✅
场景、行为、异常路径均定义清晰。AC-1 直接对应。

#### FR-2（正向删除）✅
场景和行为明确。与 Claude Code 策略一致。AC-2 直接对应。

#### FR-3（Tool Call Cache）🟡 见 Issue #2
行为描述偏笼统。"可以从缓存恢复"缺乏精确定义——何时恢复、恢复到哪里、缓存的作用域（单次调用 vs 跨调用）、cache 命中/未命中的行为分别是什么。但由于标记为可选增强且有明确的降级路径，风险可控。

#### FR-4（移除连锁清理逻辑）✅ — 见 Issue #1
保留/移除项明确。但"简化（正向删除后可能仍需合并）"中的合并逻辑——AC-3 虽已给出具体行为（`\n` 连接），FR-4 本身未定义简化后的合并逻辑相对于当前行为的差异。两处表述略有脱节。

#### FR-5（移除 opencode.ai hack）✅
明确列出两项清理目标，AC-9 直接对应。

### 4. AC ⇔ FR 覆盖映射

| AC | 对应 FR | 说明 |
|----|---------|------|
| AC-1 | FR-1 | 反向补配对 |
| AC-2 | FR-2 | 正向删除 |
| AC-3 | FR-4 | 正向删除后合并连续 user |
| AC-4 | FR-4 | Step 4 重排保留 |
| AC-5 | FR-1, FR-2 | 正常链的幂等性 |
| AC-6 | FR-1, FR-2 | 空 ID 处理 |
| AC-7 | FR-1 | 末尾 assistant 跳过 |
| AC-8 | — | 测试回归（全量 AC 覆盖） |
| AC-9 | FR-5 | 移除 reasoning_content 和 opencode.ai |
| AC-10 | FR-1, Constraint #2 | KV cache 友好 |

**覆盖度：** 每项 FR 至少有 1 条 AC 覆盖。FR-3（可选）无 AC 是合理的。AC-8 和 AC-10 为跨 FR 的质量保障项。

### 5. 模糊或遗漏

#### AC 覆盖盲区
- **混合场景**：反向孤儿（需补）+ 正向穿插（需重排）在同一消息链中同时发生的场景缺少独立 AC。当前由 AC-1 和 AC-4 分开覆盖，但两者交互后的结果未验证。
- **空/异常 `tool_calls` 结构**：`tool_calls: null`（非空数组）、`tool_calls: []`、`tool_call_id` 为非字符串类型等边界缺少 AC。这些是实际可能出现的 API 返回差异。
- **未找到任何 orphan 时的行为**：AC-5 覆盖了"正常配对链"的幂等性，但隐式也覆盖了"没有任何 orphan"的场景。

以上盲区均为**可接受的范围**——当前 AC 覆盖了核心功能路径和关键边界，剩余的边缘场景可在 plan/test 阶段补充。

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | LOW | spec.md:FR-4 | FR-4 表格中"简化（正向删除后可能仍需合并）"未定义简化后的合并逻辑与当前行为的差异。AC-3 虽已给出行为，FR-4 自身描述不够完整。 | 在 FR-4 中增补半行描述简化后的合并策略（如"合并规则不变，仅移除不再需要的空壳清理前置条件"），或在 FR-4 中引用 AC-3 的精确描述。 |
| 2 | LOW | spec.md:FR-3 | "可以从缓存恢复"条件不精确：缓存的作用域（单次调用内/跨调用）、恢复目标（修改哪条消息）、命中/未命中分别做什么，均未定义。 | 鉴于 FR-3 为可选增强且 Constraint #6 提供了降级路径，当前模糊度可接受。建议在 plan 阶段明确是否选做，选做时补充具体行为表。 |
| 3 | INFO | spec.md:AC-10 | AC-10（KV cache 友好）的保证已被 Constraint #2（Content 固定为 `"[context truncated]"`）隐式满足。AC-10 本身在单次单元测试范围内无法验证跨请求的 cache 行为。 | 可考虑将 AC-10 降级为"合成内容与 Constraint #2 一致"的确定性检查，或在备注中说明跨请求一致性由 Constraint #2 保障。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

## 结论

**通过。**

该 spec 质量高——目标清晰、范围得当、AC 全部可测试、约束完整。Background 章节有真实数据支撑，调研对照充分。FR-4 合并逻辑描述可以更精确（Issue #1），FR-3 可选增强项行为条件偏模糊但风险可控（Issue #2），AC-10 与约束存在冗余但无害（Issue #3）。

零条 MUST FIX。建议在 plan 阶段注意混合场景（complement + reorder 同时发生）的测试覆盖。

## Summary

Spec 评审完成，第1轮通过，0条MUST FIX，2条LOW，1条INFO。
