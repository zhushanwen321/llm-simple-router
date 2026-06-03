---
review:
  type: spec_review
  round: 1
  timestamp: "2026-05-30T12:00:00"
  target: ".xyz-harness/2026-05-29-adaptive-concurrency-v3-fix/spec.md"
  verdict: fail
  summary: "Spec 评审完成，第1轮，2条 MUST FIX（5xx 冷却期遗漏 + AC-1 期望值错误），需修改后重审"

statistics:
  total_issues: 4
  must_fix: 2
  low: 1
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md:FR-4"
    title: "5xx/net 下降路径遗漏冷却期触发，导致纯 5xx 场景退化到 V2 下降速度"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: MUST_FIX
    location: "spec.md:AC-1"
    title: "deriveProfile(1,1) 期望值与不修改公式约束矛盾"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: LOW
    location: "spec.md:FR-3 / types.ts:AdaptiveState"
    title: "设计文档建议 cooldownUntil 重命名为 dropCooldownUntil 但 spec 未提及"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: INFO
    location: "spec.md:Constraints"
    title: "Spec 无需测试的约束条目与实际代码路径存在隐含关联"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# Spec 评审 v1

## 评审记录
- 评审时间：2026-05-30 12:00
- 评审类型：Spec 完整性评审（模式一：计划评审 — 第 1 项 spec 完整性）
- 评审对象：`.xyz-harness/2026-05-29-adaptive-concurrency-v3-fix/spec.md`
- 参考文档：`docs/design/adaptive-concurrency-v3.md`、`router/src/core/concurrency/adaptive-controller.ts`、`router/src/core/concurrency/types.ts`

## 评审维度总览

| 维度 | 结论 | 说明 |
|------|------|------|
| 目标明确性 | ✅ 通过 | 一段话说清：修复 V2 并发度降至 0/1 且永不恢复的三个根因 |
| 范围合理性 | ✅ 通过 | 2 文件 + 测试更新，边界清晰（Constraints 列出 9 条排除项） |
| 验收标准可量化 | ⚠️ 部分问题 | AC-1 期望值有误（Issue #2），其余 7 条 AC 均 Given-When-Then 可测试 |
| [待决议] 项 | ✅ 无 | 所有设计决策已明确 |
| FR 覆盖 vs 设计文档 | ⚠️ 缺漏 | 5xx 下降触发冷却期未纳入任何 FR（Issue #1） |
| Constraints 合理性 | ✅ 通过 | 不修改 deriveProfile 公式、不修改外部接口、不改 DB — 均合理 |
| 代码兼容性 | ✅ 通过 | 仅改 adaptive-controller.ts + types.ts，与 semaphore/orchestrator 无耦合 |
| 边界覆盖 | ✅ 通过 | 8 条 AC 覆盖了 max=0、死锁恢复、429 攻击、冷却期边界等关键场景 |

## 逐 FR 审查

### FR-1: max 输入防护 — ✅ 通过

- 入口点完整：`init()` + `syncProvider()` 均已覆盖
- `Math.max(config.max, 1)` 在 set entry 之前执行，防止 NaN 污染
- 保持 `PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency = 0` 不变（0 = 未配置语义）— 合理
- 已验证 `PROVIDER_CONCURRENCY_DEFAULTS` 位于 `router/src/db/providers.ts:47`，值为 `max_concurrency: 0`

### FR-2: 移除利用率门控 — ✅ 通过

- 删除清单完整：`AdaptiveState.limitReached` 字段、`SAFE_ZONE_DIVISOR` 常量、`transitionSuccess()` 中 `wasQueued` 逻辑
- 已确认当前代码中三处均存在（types.ts:limitReached、adaptive-controller.ts:SAFE_ZONE_DIVISOR、transitionSuccess 中的 safeZone 判断）
- `AdaptiveResult.wasQueued` 保留但不再使用 — 与 Constraints 一致

### FR-3: 冷却期语义翻转 — ⚠️ 部分问题

- transitionSuccess 移除冷却期检查：✅ 当前代码第 133 行 `if (Date.now() < s.cooldownUntil) return` 需删除
- transitionFailure 冷却期前置：✅ 描述清晰，位置精确（statusCode 过滤之后、failure 计数之前）
- 冷却期拦截不清零 consecutiveSuccesses：✅ 明确了当前代码的 `s.consecutiveSuccesses = 0` 在拦截后不应执行
- **但**：冷却期只有 429 路径设置（FR-4 只改 429），5xx/net 下降不设冷却期 → Issue #1

### FR-4: 429 固定步进下降 — ⚠️ 问题（见 Issue #1）

- 429 路径改为固定 -1：✅ 正确
- 删除 `keepRatio` 和 `KEEP_RATIO_MIN`：✅ 已确认两者存在于当前代码
- **问题**："5xx/net 路径保持不变"遗漏了设计文档要求的 5xx 下降也触发冷却期

### FR-5: 满额时保留部分成功计数 — ✅ 通过

- 逻辑清晰：`limit < max` 清零，`limit == max` 保留一半
- 防止满额稳态下计数器反复从 0 累积，导致响应延迟
- `Math.floor(s.consecutiveSuccesses / 2)` — 整数安全

### FR-6: deriveProfile 简化 — ✅ 通过

- 删除 `keepRatio` 计算（FR-4 已移除该字段）
- 保留 `climbThreshold`、`dropThreshold`、`cooldownMs` — 与设计文档一致
- Constraints 明确不修改公式本身 — 合理

## 逐 AC 审查

### AC-1: max=0 不再导致 NaN — ⚠️ 期望值错误（Issue #2）

| 检查项 | 状态 | 说明 |
|--------|------|------|
| max 被钳制为 1 | ✅ | FR-1 实现了入口防护 |
| currentLimit 初始化为 1 | ✅ | `config.max` 被 Math.max(,1) 后传入 init |
| deriveProfile(1,1) 返回有效数值 | ✅ | 不会产生 NaN（分母 max=1 非零） |
| climbThreshold=2, dropThreshold=1 | ❌ | **实际值为 climbThreshold=4, dropThreshold=3** |

已通过 Node.js 执行 deriveProfile(1,1) 公式验证：

```
level = min(1, 1/1) = 1
capacity = min(1, log2(1)/7) = 0
climbThreshold = max(2, round(2 + 0*2 + 1*2)) = max(2, 4) = 4  ← 非 2
dropThreshold  = max(1, round(5 - 0*2 - 1*2)) = max(1, 3) = 3  ← 非 1
cooldownMs     = round(10000 + 1*10000) = 20000                    ← 正确
```

AC-1 的核心目标（验证无 NaN）是正确的，但具体期望值需修正为 climbThreshold=4, dropThreshold=3, cooldownMs=20000。

### AC-2: 高水位无条件爬升 — ✅ 通过

- 已验证 deriveProfile(8, 10).climbThreshold = 5，5 次成功触发爬升，合理
- "无 wasQueued 信号" 条件验证了 FR-2 移除门控后的行为

### AC-3: 冷却期保护下降不保护上升 — ✅ 通过

- 429 触发冷却 → 冷却期内 429 被拦截 ✅
- 冷却期内成功正常累积并爬升 ✅
- 时间线（T+5s 爬升、T+10s 拦截）与 deriveProfile(9,10).cooldownMs=19000 兼容

### AC-4: 429 固定 -1 下降 — ✅ 通过

- 数学验证：对所有整数 limit，`floor(limit * (1-1/limit))` = `limit - 1`，数值结果相同
- Spec 正确注明了"整数 limit 下数值相同，但语义更清晰无浮点风险"

### AC-5: 满额时保留半数计数器 — ✅ 通过

- `floor(5/2) = 2` → 后续仅需 3 次成功（而非 5 次）— 数学正确

### AC-6: 连续 429 攻击下降速度 — ✅ 通过

- 第一个 429 降 1 格 + 设置 20s 冷却期 → 后续 9 个 429 全被拦截
- V2 对比：9 次乘法衰减 vs V3 仅 1 次下降 — 效果差异明确

### AC-7: 从 limit=1 完全恢复 — ✅ 通过

- 已逐级验证 climbThreshold：1→2(3次), 2→3(3次), 3→4(4次), 4→5(4次), 5→6(4次), 6→7(4次), 7→8(4次), 8→9(5次), 9→10(5次) = 共 36 次
- 与 AC-7 声明的"36 次连续成功"完全一致

### AC-8: 冷却期内失败不重置成功计数 — ✅ 通过

- 前提假设冷却期已激活（由之前的 429 设置）
- 验证了 FR-3 的核心语义：冷却期拦截 → 无任何状态变更

### AC 覆盖矩阵

| 设计文档场景 | 对应 AC | 覆盖状态 |
|-------------|---------|---------|
| S1 正常启动 | AC-5 | ✅ |
| S2 偶发 429 | AC-3, AC-4 | ✅ |
| S5 连续 429 攻击 | AC-6 | ✅ |
| S7 持续 5xx | AC-8（间接） | ⚠️ 未测试 5xx 主动触发冷却期 |
| S8 5xx 后恢复 | — | ❌ 无专属 AC |
| S15/S21 从 1 恢复 | AC-7 | ✅ |
| S16 冷却期边界 | AC-3 | ✅ |
| E15 冷却期内大量成功 | AC-3 | ✅ |
| max=0 防护 | AC-1 | ✅（需修正期望值） |

**S8（5xx 后恢复）缺少直接覆盖**：设计文档 S8 验证"2 次 5xx → 下降 → 冷却期保护 → 恢复"的完整链路。当前 AC 仅通过 AC-8 间接覆盖了"冷却期内 5xx 被拦截"，未测试 5xx 主动触发下降+冷却期。此缺口与 Issue #1 关联——如果 5xx 下降不设冷却期，则 S8 的"冷却期保护后续 5xx"行为无法复现。

## Constraints 审查

| 约束 | 合理性 | 说明 |
|------|--------|------|
| 仅修改 adaptive-controller.ts + types.ts | ✅ | 改动集中，影响范围可控 |
| 不修改 semaphore/orchestrator/scope | ✅ | 自适应控制器通过 ISemaphoreControl 接口解耦 |
| 不修改 DB schema/migration | ✅ | 无新增字段，仅修改内存状态 |
| 不修改 admin API/前端 | ✅ | 行为变更对上层透明 |
| 不修改 deriveProfile 公式 | ✅ | 公式本身正确，问题在入口和门控 |
| 保持 AdaptiveResult 不变 | ✅ | wasQueued 保留兼容，不破坏调用方 |
| 保持默认值 max=0 不变 | ✅ | 0=未配置语义在 admin API 层有意义 |
| 保持日志格式不变 | ✅ | 现有日志字段不涉及 safeZone/limitReached |
| 保持 syncToSemaphore 双重防护 | ✅ | Math.max(currentLimit, ADAPTIVE_MIN) 保留 |

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | spec.md:FR-4 | **5xx/net 下降路径遗漏冷却期触发**。FR-4 说"5xx/net 路径保持不变"，但设计文档算法明确要求 5xx/net 下降后"进入冷却期"。当前代码 5xx 下降不设 `cooldownUntil`。若保持不变，纯 5xx 场景下降速度为每 `dropThreshold` 次连续失败降 1 格（无冷却期保护），max=10 时约 20s 从 10→1，退化到 V2 水平，违背设计目标（~200s）。设计文档场景 S7/S8 均依赖此行为：`t=2s: 2 次 5xx → limit 10→9, 冷却期 20s; t=3-22s: 冷却期内所有 5xx 被拦截`。 | FR-4 应将"5xx/net 路径保持不变"改为明确描述：5xx/net 路径在达到 dropThreshold 下降时，也需设置 `s.cooldownUntil = Date.now() + profile.cooldownMs`。同步新增 AC 验证：Given max=10, currentLimit=10, When 连续 dropThreshold(2) 次 5xx, Then currentLimit=9 且 cooldownUntil 被设置。 |
| 2 | MUST FIX | spec.md:AC-1 | **deriveProfile(1,1) 期望值与公式矛盾**。AC-1 声称 deriveProfile(1,1) 返回 climbThreshold=2, dropThreshold=1。但 Constraints 明确"不修改 deriveProfile 公式"，而公式对 max=1 计算得：climbThreshold=max(2, round(2+0+2))=**4**, dropThreshold=max(1, round(5-0-2))=**3**。已通过 Node.js 执行验证。如果按 AC-1 写测试 `expect(climbThreshold).toBe(2)` 会失败。 | 修正 AC-1 期望值为 `climbThreshold=4, dropThreshold=3, cooldownMs=20000`。AC-1 的核心目标（验证无 NaN、currentLimit=1）不变，只修正具体数值。 |
| 3 | LOW | spec.md:FR-3 / types.ts | 设计文档数据变更章节建议将 `AdaptiveState.cooldownUntil` 重命名为 `dropCooldownUntil`，语义更精确（是"下降冷却"而非通用冷却）。Spec 全文使用 `cooldownUntil`（当前名称），未提及重命名。不影响行为正确性，但会导致实现与设计文档不一致。 | 在 FR-3 中补充说明字段重命名，或在实现注释中标注。此为可选建议，不阻塞。 |
| 4 | INFO | spec.md:Constraints | "不修改 deriveProfile 的公式"这一约束是合理的，但与 AC-1 的错误期望值存在隐含冲突（Issue #2 的根因）。建议在 Constraints 中增加注释：deriveProfile 的输入范围变化（max 从 0 变为 ≥1）会导致输出值变化，AC 应基于公式实际输出验证。 | 纯观察，无需操作。Issue #2 修复后此点自然解决。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

### Issue #1 详细分析：5xx 冷却期遗漏的影响

**当前代码路径**（adaptive-controller.ts `transitionFailure`）：

```
5xx/net 分支:
  s.consecutiveFailures++
  s.consecutiveSuccesses = 0
  if (s.consecutiveFailures >= profile.dropThreshold) {
    s.currentLimit -= 1               // ← 下降
    s.consecutiveFailures = 0
    this.syncToSemaphore(providerId)
    // ← 注意：没有 s.cooldownUntil = ... ←
  }
```

**设计文档期望的 V3 路径**：

```
5xx/net 分支:
  if 冷却期内: return                 // ← FR-3 新增的冷却期检查
  s.consecutiveFailures++
  if (s.consecutiveFailures >= dropThreshold) {
    limit -= 1
    s.consecutiveFailures = 0
    进入冷却期(cooldownUntil = now + cooldownMs)  // ← 关键遗漏
  }
```

**影响量化**（max=10, 纯 5xx 场景）：

| 方案 | 下降速度 | 10→1 耗时 |
|------|---------|----------|
| V3 + 5xx 冷却期 | 每 10-20s 降 1 格 | ~100-200s |
| V3 + 无 5xx 冷却期 | 每 dropThreshold 次失败降 1 格 | ~20s |
| V2 | 无冷却期保护 | ~10s |

无 5xx 冷却期时，V3 对纯 5xx 的防护效果接近 V2，远未达到设计文档宣称的"100 倍减速"。

### Issue #2 验证证据

Node.js 执行结果（使用当前代码中 deriveProfile 的精确公式）：

```javascript
deriveProfile(1, 1) = {
  climbThreshold: 4,   // max(2, round(2 + 0*2 + 1*2)) = max(2, 4) = 4
  dropThreshold: 3,    // max(1, round(5 - 0*2 - 1*2)) = max(1, 3) = 3
  cooldownMs: 20000    // round(10000 + 1*10000) = 20000
}
```

AC-1 声明的 `climbThreshold=2, dropThreshold=1` 不符合公式输出。

## 结论

**需修改后重审**。

两条 MUST FIX 均为 spec 内容层面的遗漏/错误，不影响整体架构方向：
1. Issue #1（5xx 冷却期）是 FR 与设计文档的覆盖缺口——补充后即可闭合
2. Issue #2（AC-1 期望值）是数值计算错误——修正即可

Spec 的整体质量良好：6 条 FR 精准覆盖了 V2 的三个根因 + 三个改进项，8 条 AC 大部分 Given-When-Then 格式规范且可测试，Constraints 列出了 9 条排除项。修复上述两个问题后，spec 可进入 Plan 阶段。

### Summary

Spec 评审完成，第1轮，2条 MUST FIX（5xx 冷却期遗漏 + AC-1 期望值错误），需修改后重审。
