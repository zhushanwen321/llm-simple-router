---
verdict: pass
must_fix: 0
review_metrics:
  files_reviewed: 2
  lines_added: 67
  lines_removed: 74
  principles_checked: 7
  issues_found: 0
  suggestions: 2
  review_time_minutes: 15
---

# TypeScript 品味审查报告

**变更范围**: `router/src/core/concurrency/adaptive-controller.ts` + `types.ts`
**审查日期**: 2026-05-30
**审查基线**: CLAUDE.md 代码品味原则 + 一般品味标准

## 变更摘要

V3 自适应并发控制器的语义简化：
1. **移除 `limitReached` 门控** — 爬升不再依赖利用率信号（wasQueued），纯粹基于连续成功计数
2. **移除 `keepRatio` 按比例下降** — 429/5xx 退避统一为固定 -1
3. **冷却期语义翻转** — 冷却期阻止下降但不再阻止成功累积
4. **满额计数器减半** — `currentLimit === max` 时保留半数计数器，避免反复从 0 爬升
5. **5xx 退避也加冷却期** — 原来只有 429 有冷却期

## CLAUDE.md 品味原则逐项审查

### ✅ 兜底响应

| 位置 | 判定 |
|------|------|
| `onRequestComplete` — entry 不存在时 `return` | ✅ 静默返回合理（provider 未启用 adaptive） |
| `transitionSuccess` — 成功但未达阈值 | ✅ 无操作（隐式 else），正确 |
| `transitionFailure` — 非并发错误分支 | ✅ debug 日志 + return |
| `transitionFailure` — 冷却期分支 | ✅ debug 日志 + return |
| `transitionFailure` — 429 分支 vs 5xx 分支 | ✅ 两个分支都有状态更新 + syncToSemaphore |
| `transitionFailure` — 5xx 未达 dropThreshold | ✅ 隐式 else：累计 consecutiveFailures 等下次触发，合理 |
| `syncToSemaphore` — entry 不存在 | ✅ return |

**结论**: 所有分支都有明确出路，无悬挂路径。

### ✅ 完整错误提取

`transitionFailure` 的日志结构体包含 `statusCode`、`retryRuleMatched`、`requestId`、`prevLimit`、`newLimit`、`action`、`cooldownMs`。错误信息没有遗漏关键字段。

### ✅ 幂等注册

`init()` 使用 `this.entries.set()` 直接覆盖，`entries.set()` 是幂等的。`remove()` / `removeAll()` 也是幂等操作。`syncProvider()` 在 existing 存在时更新，不存在时调用 init，逻辑自洽。

### ✅ structuredClone 使用

变更中无深拷贝操作。状态对象通过引用直接修改（`entry.state`），这是合理的——entry 是 Map 中的值对象，不需要深拷贝。

### ✅ Headers 安全

本变更不涉及 HTTP headers 处理。不适用。

### ✅ Hook 降级

AdaptiveController 不是 Hook/Pipeline 组件，其方法由 orchestrator 直接调用。降级逻辑通过 `onRequestComplete` 入口的 `if (!entry) return` 实现——provider 未启用 adaptive 时静默跳过，符合降级原则。

### ✅ 数据消费者完整性

**`AdaptiveState` 消费者清单**：

| 消费者 | 字段使用 | V3 兼容 |
|--------|---------|---------|
| `AdaptiveController` 内部 | currentLimit, consecutiveSuccesses, consecutiveFailures, cooldownUntil | ✅ |
| `RequestTracker.getConcurrencySnapshot()` | `adaptiveState?.currentLimit` | ✅ |
| `RequestTracker` SSE 推送 → `ProviderConcurrencySnapshot.adaptiveLimit` | currentLimit 映射 | ✅ |
| `Admin routes (providers.ts)` | `getStatus()` 返回整个 AdaptiveState | ✅ |
| `Monitor SSE types` | `adaptiveEnabled`, `adaptiveLimit` | ✅ |
| 前端 Monitor 页面 | `adaptiveEnabled`, `adaptiveLimit` | ✅ |

**移除字段影响**：
- `limitReached`: 已确认从 `AdaptiveState` 接口、`AdaptiveProfile`、所有消费者中完全移除。无残留引用。
- `keepRatio`: 仅在 `AdaptiveProfile` 内部使用，随 `deriveProfile` 一起移除。无外部消费者。

**新增字段无遗漏**: `AT_MAX_COUNTER_HALVE_DIVISOR` 是内部常量，不涉及数据消费者。

## 一般品味审查

### ✅ 函数长度

| 函数 | 行数 | 判定 |
|------|------|------|
| `transitionSuccess` | ~25 行 | ✅ |
| `transitionFailure` | ~35 行 | ✅ |
| `deriveProfile` | ~10 行 | ✅ |
| `syncProvider` | ~15 行 | ✅ |
| `init` | ~15 行 | ✅ |

所有函数在 50 行以内，职责单一。文件总行数 208，远低于 1000 行上限。

### ✅ 魔法数字

所有数值常量提取为顶层命名常量：
- `RATE_LIMIT_STATUS`, `HTTP_SERVER_ERROR_MIN`, `ADAPTIVE_MIN`
- `CAPACITY_LOG_BASE`, `CLIMB_BASE`, `CLIMB_CAPACITY_WEIGHT` 等
- `AT_MAX_COUNTER_HALVE_DIVISOR` — 新增常量有 JSDoc 注释

唯一内联数值：`1`（爬升/下降步长），这是算法语义明确的固定步长，无需提取。

### ✅ 命名清晰度

| 名称 | 评价 |
|------|------|
| `AT_MAX_COUNTER_HALVE_DIVISOR` | 偏长但意图精确：满额时将计数器减半的除数 |
| `transitionSuccess` / `transitionFailure` | 清晰的状态机命名 |
| `deriveProfile` | 准确表达"根据水位推导行为参数" |
| `syncToSemaphore` | 明确表达副作用 |

### ✅ 代码结构

**状态机模式清晰**：
- `onRequestComplete` 是入口路由（success/failure 分发）
- `transitionSuccess` — 累计成功 → 检查阈值 → 爬升 + 重置
- `transitionFailure` — 过滤非并发错误 → 冷却期检查 → 429/5xx 分支处理
- `deriveProfile` — 纯函数，输入(currentLimit, max) → 输出阈值配置

**V3 变更的简化效果**：
- 移除了 `limitReached` + `SAFE_ZONE_DIVISOR` + `keepRatio` 三个概念
- 爬升条件从"成功计数 + 利用率门控"简化为"成功计数"
- 退避策略从"按比例下降"统一为"固定 -1"
- 冷却期语义统一（成功累积不受限，仅阻止进一步下降）

## 建议（非阻塞）

### S1: `wasQueued` 字段保留在 `AdaptiveResult` 中但未使用

`AdaptiveResult.wasQueued` 仍然被 orchestrator 传入（`wasQueued: wasEverQueued`），但 V3 的 `transitionSuccess` 不再读取它。这不是 bug（可选字段），但构成了死数据。建议在后续清理中考虑是否移除。

**影响**: orchestrator.ts L161/L168 仍在传入 `wasQueued`，types.ts 仍声明该字段。

### S2: `AT_MAX_COUNTER_HALVE_DIVISOR` 命名建议

常量名传达了"怎么做"（用除法减半）而非"为什么"（避免满额振荡）。建议考虑 `AT_MAX_CARRY_RATIO` 或 `FULL_CAPACITY_CARRY_FACTOR` 等更侧重意图的命名。非阻塞——当前命名已足够清晰。

## 审查结论

**PASS** — 变更品味良好。代码简化显著（-74/+67，净减少 7 行且移除了 3 个概念），状态机逻辑清晰，所有品味原则均满足。两个建议均为代码整洁度改进，不影响正确性。
