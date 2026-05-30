---
review:
  type: plan_review
  round: 1
  timestamp: "2026-05-30T10:30:00"
  target: ".xyz-harness/2026-05-29-adaptive-concurrency-v3-fix/plan.md"
  verdict: pass
  summary: "计划评审完成，第1轮通过，0条MUST FIX，2条LOW建议"
must_fix: 0

statistics:
  total_issues: 3
  must_fix: 0
  must_fix_resolved: 0
  low: 2
  info: 1

issues:
  - id: 1
    severity: LOW
    location: "plan.md:Task 2「删除的旧测试」"
    title: "AC3 utilization gating 旧测试块应精确列出用例名称"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: LOW
    location: "plan.md:Task 3「删除的旧测试」"
    title: "AC5 semaphore error keepRatio 断言对应的具体测试用例需确认"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: INFO
    location: "plan.md:Task 5"
    title: "Task 5 的 E2E 场景 E18（5xx→success 交替）与 deriveProfile 参数耦合，建议补充 climbThreshold/dropThreshold 推导说明"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录
- 评审时间：2026-05-30 10:30
- 评审类型：计划评审
- 评审对象：`.xyz-harness/2026-05-29-adaptive-concurrency-v3-fix/plan.md`
- 对照文件：spec.md、e2e-test-plan.md、use-cases.md、non-functional-design.md、现有源码、现有测试

---

## 1. spec 完整性

| 维度 | 评估 | 说明 |
|------|------|------|
| 目标明确 | ✅ | 一段话可说清：修复自适应并发控制器三个架构缺陷（NaN 冻结、冷却期倒置、利用率死锁） |
| 范围合理 | ✅ | 仅 2 个源文件 + 1 个测试文件，纯算法层，不涉及 DB/API/前端 |
| AC 可量化 | ✅ | 8 条 AC 全部可写测试验证，给出具体数值（如 deriveProfile(1,1) → climbThreshold=4） |
| 待决议项 | ✅ | 无 `[待决议]` 标记 |
| 约束合理 | ✅ | 明确列出不修改的文件和不变更的接口 |

**结论：spec 完整性通过。**

---

## 2. plan 可行性

### 2.1 任务拆分合理性

5 个 Task 的拆分粒度合理：

| Task | 内容 | 粒度评估 |
|------|------|---------|
| Task 1 | 入口防护 + 类型清理 | ✅ 基础设施变更，先行。约 7 处代码修改 |
| Task 2 | 冷却期翻转 + 移除利用率门控 | ✅ 核心语义变更，依赖 Task 1 的类型清理 |
| Task 3 | 429 固定 -1 + 5xx 冷却期 + 冷却期拦截 | ✅ 失败路径变更，依赖 Task 2 的成功路径重构 |
| Task 4 | 满额时保留半数成功计数 | ✅ 小而独立的优化，依赖 Task 3 完成 transitionFailure |
| Task 5 | 集成验证 | ✅ 纯测试 Task，验证整体行为 |

每个 Task 粒度适中，一个 subagent 可独立完成。

### 2.2 依赖关系正确性

```
Task 1 ──→ Task 2 ──→ Task 3 ──→ Task 4 ──→ Task 5
```

- Task 1 先行：删除 `limitReached`、`keepRatio` 等字段是后续 Task 的前提（否则编译不过）✅
- Task 2 依赖 Task 1：`transitionSuccess()` 中引用了 `SAFE_ZONE_DIVISOR`、`limitReached` 等字段，Task 1 已清理 ✅
- Task 3 依赖 Task 2：`transitionFailure()` 中 `consecutiveSuccesses = 0` 的行为与 `transitionSuccess()` 中的冷却期逻辑协同变更 ✅
- Task 4 依赖 Task 3：修改 `transitionSuccess()` 中的爬升分支，需 Task 3 完成冷却期拦截逻辑后才安全 ✅
- Task 5 依赖 Task 4：纯测试，验证所有 Task 的集成效果 ✅

**依赖关系正确，串行执行合理。**

### 2.3 工作量估算

- 源码修改约 30 行（spec 估算）——对照现有代码（约 200 行 controller），删除 ~20 行 + 修改 ~10 行，现实 ✅
- 测试更新量较大（现有测试约 370 行，需大量重写），plan 中已标注删除的旧测试用例 ✅

### 2.4 遗漏的 Task 检查

逐条对照 spec FR：

| FR | 覆盖 Task | 说明 |
|----|----------|------|
| FR-1 max 输入防护 | Task 1 | ✅ |
| FR-2 移除利用率门控 | Task 2 | ✅ |
| FR-3 冷却期语义翻转 | Task 2 + Task 3 | ✅ |
| FR-4 429 固定步进下降 + 5xx 冷却期 | Task 3 | ✅ |
| FR-5 满额时保留部分成功计数 | Task 4 | ✅ |
| FR-6 deriveProfile 简化 | Task 1 | ✅ |

**无遗漏 Task。**

---

## 3. spec 与 plan 一致性

### 3.1 AC 覆盖矩阵

| AC | plan Task | 覆盖 |
|----|----------|------|
| AC-1 max=0 → clamp to 1 | Task 1（init + syncProvider 入口防护 + deriveProfile 测试） | ✅ |
| AC-2 高水位无条件爬升 | Task 2（删除 safeZone/limitReached 门控） | ✅ |
| AC-3 冷却期翻转（保护下降不保护上升） | Task 2（删除 success 冷却期检查） + Task 3（failure 冷却期前置拦截） | ✅ |
| AC-4 429 固定 -1 | Task 3（替换 keepRatio 为固定 -1） | ✅ |
| AC-5 满额保留半数计数 | Task 4（爬升分支条件重置） | ✅ |
| AC-6 密集 429 只降 1 格 | Task 3（冷却期拦截后续 429） | ✅ |
| AC-7 limit=1 完全恢复 | Task 5（36 次成功集成测试） | ✅ |
| AC-8 冷却期不重置成功计数 | Task 3（冷却期 return 在 consecutiveSuccesses=0 之前） | ✅ |

**所有 AC 在 plan 中有对应实现步骤。✅**

### 3.2 plan 无 spec 未提及的额外工作

所有 Task 均可追溯到 spec FR 或 AC，无镀金内容。✅

---

## 4. Execution Groups 合理性

### 4.1 分组

仅 BG1 一组，包含 5 个 Task。文件数 3 个（≤ 10 ✅），Task 数 5 个（功能关联紧密，全部串行，无法拆分到多组 ✅）。

### 4.2 类型划分

全部为后端 Task（纯 TypeScript 算法层），无前端混合 ✅

### 4.3 功能关联度

5 个 Task 都是同一个 `AdaptiveController` 类的状态机修改，功能强关联，合组合理 ✅

### 4.4 Subagent 配置

| 配置项 | 评估 |
|--------|------|
| Agent | general-purpose ✅ |
| Model | taskComplexity 自动选择 ✅ |
| 注入上下文 | spec.md 全文 + plan.md Task 描述 + deriveProfile 公式 + CLAUDE.md 编码规范 ✅ 足够独立执行 |
| 读取文件 | 列出 3 个文件 ✅ |
| 修改/创建文件 | 明确 ✅ |
| Execution Flow | 每个 Task 3 步（写测试→写实现→spec 合规检查），流程清晰 ✅ |

### 4.5 Wave 编排

5 个 Wave 串行（Task 1→5），无并行，无数据竞争 ✅

---

## 5. 接口契约审查

### 5.1 plan.md Interface Contracts 一致性

对照现有源码验证：

| 接口声明 | 源码验证 |
|----------|---------|
| `init(providerId, config, semParams)` | ✅ 签名匹配 |
| `syncProvider(providerId, p)` | ✅ 签名匹配 |
| `onRequestComplete(providerId, result)` | ✅ 签名匹配 |
| `deriveProfile(currentLimit, max)` → 无 keepRatio | ✅ plan 正确标注删除 |
| `AdaptiveState` 删除 `limitReached` | ✅ plan 正确标注 |
| `AdaptiveProfile` 删除 `keepRatio` | ✅ plan 正确标注 |

### 5.2 AC 覆盖矩阵完整性

plan.md 的 Spec Coverage Matrix 包含全部 8 条 AC，每条有 Interface Method、Data Flow、Task 对应 ✅

---

## 6. 后端设计充分性（L1）

### 6.1 实现说明质量

每个 Task 的"实现要点"给出了具体的代码变更位置（行号范围）和变更内容（删除什么、插入什么、替换什么），subagent 可独立执行 ✅

### 6.2 边界条件覆盖

- `max=0` → clamp to 1 ✅
- `currentLimit=1` → 429 后保底在 ADAPTIVE_MIN ✅
- `currentLimit=max` → 满额保留半数计数 ✅
- 冷却期内 5xx 不重置成功计数 ✅
- 5xx 新增冷却期（V2 中无冷却期） ✅

### 6.3 非功能性要求

non-functional-design.md 覆盖了稳定性、数据一致性、性能、安全性。plan.md 的约束中体现了这些要求（不修改 DB schema、不修改外部接口等） ✅

---

## 7. 与现有代码和测试的兼容性

### 7.1 现有测试中需删除的用例

对照现有测试文件 `adaptive-controller.test.ts`（约 370 行）：

**Task 1 需处理的旧测试：**
- `AC1: deriveProfile` 中的 `keepRatio` 相关断言（2 个用例：`keepRatio = 1 - 1/currentLimit when limit > 1` 和 `keepRatio = 0.5 when limit = 1`）→ plan 标注了需删除 ✅
- `init` 用例中 `limitReached: false` 断言 → plan Task 1 测试要点已提及 ✅
- `deriveProfile` helper 函数中 `keepRatio` 计算 → plan 标注需删除 ✅

**Task 2 需处理的旧测试：**
- `AC3: utilization gating` 整个 describe 块（5 个用例：`safe zone`, `outside safe zone + limitReached=false`, `outside safe zone + limitReached=true`, `wasQueued=true sets limitReached`, `limitReached resets after each climb cycle`）→ plan 标注需删除 ✅
- `cooldown behavior` 中的 `successes during cooldown do not trigger climb` 用例 → plan 标注需删除（行为已变，冷却期内成功应该能累积和爬升）✅

**Task 3 需处理的旧测试：**
- `AC4: 5xx failures` 中的 `does NOT enter cooldown on 5xx` → plan 标注需删除（5xx 现在也进入冷却期）✅
- `AC5: semaphore timeout/queue full → 429` 中的 `keepRatio` 断言（`keepRatio for 8 = 1 - 1/8 = 0.875, floor(8*0.875) = 7`）→ plan 标注需删除 ✅

### 7.2 现有测试中需保留/修改的用例

- `AC1: deriveProfile` 中 climbThreshold/dropThreshold/cooldownMs 断言 → 保留 ✅
- `AC2: 429 handling` 中大多数用例 → 保留，修改断言值（从 keepRatio 计算改为固定 -1）✅
- `AC4: 5xx failures` 中大多数用例 → 保留 ✅
- `AC6: no probe` → 保留，但需删除 `limitReached` 断言 ✅
- `remove / re-init / syncProvider` → 保留，删除 `limitReached` 断言 ✅
- `non-concurrency error filtering` → 保留 ✅
- `max ceiling` → 保留，修改 `limitReached` 相关逻辑 ✅
- `cooldown behavior` 中的 `after cooldown, climbs normally` → 保留但修改（冷却期不再阻止爬升，语义已变）✅

### 7.3 兼容性风险

- `AdaptiveState` 不做序列化（纯内存），删除字段无兼容性问题 ✅
- `AdaptiveResult.wasQueued` 保留但不使用（spec 明确要求）✅
- `syncToSemaphore` 中的 `Math.max(currentLimit, ADAPTIVE_MIN)` 双重防护保留 ✅

---

## 8. 测试策略评估

### 8.1 E2E Test Plan AC 覆盖

| E2E 场景 | 覆盖 AC | plan Task |
|----------|---------|-----------|
| TS-1: max=0 入口防护 | AC-1 | Task 1 |
| TS-2: 高水位无条件爬升 | AC-2 | Task 2 |
| TS-3: 冷却期双向行为 | AC-3 | Task 2 + Task 3 |
| TS-4: 固定步进下降 | AC-4, AC-6 | Task 3 |
| TS-5: 满额半数保留 | AC-5 | Task 4 |
| TS-6: limit=1 完全恢复 | AC-7 | Task 5 |
| TS-7: 冷却期不重置成功计数 | AC-8 | Task 3 |
| TS-8: 5xx 冷却期 | FR-4 补充 | Task 3 |

E2E Test Plan 的 8 个场景完整覆盖了 spec 的全部 8 条 AC ✅

### 8.2 测试环境说明

E2E Test Plan 明确了框架（Vitest）、运行命令、Mock 模式（`createMockSemaphore()`）、Timer 策略（`vi.useFakeTimers()`），与现有测试基础设施一致 ✅

---

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | LOW | plan.md:Task 2「删除的旧测试」 | "AC3 utilization gating 整个 describe 块"是正确的，但 plan 中没有提到同一 describe 块下的 `wasQueued=true sets limitReached` 和 `limitReached resets after each climb cycle` 两个用例也需删除（它们依赖 `limitReached` 字段，而 Task 1 已删除该字段）。不过 Task 1 已删除字段，这两个用例会在 Task 1 阶段因编译错误被处理，所以不会遗漏。 | 建议在 Task 1 中补充说明：`limitReached` 字段删除后，所有引用该字段的旧测试（AC3 块、init、re-init 等）需一并清理，而不是等到 Task 2 |
| 2 | LOW | plan.md:Task 3「删除的旧测试」 | "AC5 semaphore error 中的 keepRatio 断言"指的是 `AC5` 的第二个用例 `semaphore error behaves identically to upstream 429`（断言 `floor(8*0.875) = 7`），plan 未精确标注用例名 | 建议列出具体用例名：`AC5: semaphore error behaves identically to upstream 429` |
| 3 | INFO | plan.md:Task 5 | E2E 场景 E18 描述了 `5xx → success → 5xx → success → 5xx → 5xx` 交替模式，但验证"只有最后 2 次连续 5xx 算数"需要知道具体的 `dropThreshold` 值。由于 deriveProfile 是动态计算的，测试中需要先计算参数再验证，建议 Task 5 的实现要点中提醒 subagent 使用 helper 函数推导参数 | subagent 执行时参考 `deriveProfile` helper 即可，不需要 plan 层面修改 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

---

## 结论

通过

### Summary

计划评审完成，第1轮通过，0条MUST FIX，plan 质量 high——任务拆分合理，依赖关系正确，AC 全覆盖，实现要点足够具体，旧测试删除识别准确。2 条 LOW 建议可由执行 subagent 在实施时自行处理，不阻塞流程。
