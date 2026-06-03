---
verdict: fail
must_fix: 2
review_metrics:
  files_reviewed: 3
  lines_reviewed: 210
  dimensions_checked: 6
  issues_found: 7
  must_fix: 2
  should_fix: 3
  nice_to_have: 2
  test_coverage: "adequate"
  test_cases: 42
  test_ac_coverage: "AC1-AC8 + E2E"
---

# Robustness Review: Adaptive Concurrency V3

**Reviewer**: Robustness Expert
**Date**: 2026-05-30
**Scope**: `adaptive-controller.ts`, `types.ts`, diff against V2
**Related Tests**: `tests/adaptive-controller.test.ts` (42 test cases)

## Summary

V3 变更简化了自适应并发控制器：移除 `limitReached` 利用率门控（改为无条件爬升）、冷却期语义翻转（只阻下降不阻上升）、429 固定 -1 下降（替代 keepRatio 乘法）、满额保留半数计数器。整体架构合理，测试覆盖充分（42 cases 覆盖 AC1-AC8 + E2E 场景）。

发现 **2 个 MUST FIX** 和 **3 个 SHOULD FIX** 问题。

---

## MUST FIX Issues

### MF-1: NaN 输入未防护 — `Math.max(NaN, ADAPTIVE_MIN)` 返回 NaN

**严重度**: 🔴 P0 — 静默破坏整个控制器

**位置**: `init()` L48, `syncProvider()` L90

**问题**: 两处使用 `Math.max(config.max, ADAPTIVE_MIN)` 和 `Math.max(p.max_concurrency, ADAPTIVE_MIN)` 做下限钳位。但 `Math.max(NaN, 1)` 返回 `NaN`，而非 `1`。

```typescript
// 当前代码 — NaN 泄漏路径
const max = Math.max(config.max, ADAPTIVE_MIN);
// config.max = undefined → Math.max(undefined, 1) = NaN
// config.max = NaN      → Math.max(NaN, 1) = NaN
```

**泄漏链路**:
1. `init(max: undefined)` → `entry.max = NaN`
2. `deriveProfile(currentLimit, NaN)`:
   - `level = Math.min(1, currentLimit / NaN)` = `NaN`
   - `climbThreshold = Math.round(2 + NaN)` = `NaN`
3. `s.consecutiveSuccesses >= NaN` → 永远 `false` → **爬升永远不触发**
4. `s.currentLimit = Math.min(s.currentLimit + 1, NaN)` = `NaN` → 如果触发则破坏状态
5. `syncToSemaphore` 将 `maxConcurrency: NaN` 传给信号量

**触发条件**: 数据库迁移缺少默认值、SQLite 返回 NULL、JSON 解析异常时 `max_concurrency` 可能为 `undefined`。

**建议修复**:

```typescript
private clampMax(value: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= ADAPTIVE_MIN ? n : ADAPTIVE_MIN;
}
```

在 `init()` 和 `syncProvider()` 两处替换 `Math.max(..., ADAPTIVE_MIN)` 为 `this.clampMax(...)`。

**测试验证**: 新增 `init(max: NaN)` 和 `init(max: undefined)` 测试用例，确认均降级为 1。

---

### MF-2: 满额时日志语义误导 — "limit increased" 但实际未增加

**严重度**: 🟠 P1 — 生产调试时误导运维判断

**位置**: `transitionSuccess()` L137

**问题**: 当 `currentLimit` 已等于 `max` 时，爬升代码仍然执行并输出 `"Adaptive: limit increased by 1"` 日志，但 `prevLimit === newLimit`。这在生产中大量出现（满额运行时每 2-3 次成功触发一次），会严重干扰问题排查。

```typescript
// 当前代码
s.currentLimit = Math.min(s.currentLimit + 1, entry.max); // max 时不变
// ...
this.logger?.info?.({ ..., prevLimit: 10, newLimit: 10, action: "limit_increased" },
  "Adaptive: limit increased by 1");  // ← 误导：实际没增加
```

**影响**: 满额运行时，每 2-3 次请求产生一条误导日志，在流量高峰期（每秒数百请求）造成大量噪音，且 `action: "limit_increased"` 会误导运维认为并发在持续增长。

**建议修复**:

```typescript
if (s.consecutiveSuccesses >= profile.climbThreshold) {
  const prevLimit = s.currentLimit;
  s.currentLimit = Math.min(s.currentLimit + 1, entry.max);
  if (s.currentLimit === entry.max) {
    s.consecutiveSuccesses = Math.floor(s.consecutiveSuccesses / AT_MAX_COUNTER_HALVE_DIVISOR);
    this.logger?.debug?.({ providerId, prevLimit, newLimit: s.currentLimit, action: "at_max_counter_cycle" }, "Adaptive: at max, counters preserved");
  } else {
    s.consecutiveSuccesses = 0;
    this.logger?.info?.({ providerId, requestId: result.requestId, prevLimit, newLimit: s.currentLimit, action: "limit_increased" }, "Adaptive: limit increased by 1");
  }
  this.syncToSemaphore(providerId);
}
```

降级为 `debug` 级别且 action 语义正确，同时避免 info 级别日志洪水。

---

## SHOULD FIX Issues

### SF-1: `syncToSemaphore` 未包裹 try-catch

**位置**: `syncToSemaphore()` L197, 被 4 处调用

**问题**: `semaphoreControl.updateConfig()` 直接调用，无异常保护。如果信号量内部状态异常（如 provider 已被移除但 adaptive entry 仍在），异常会传播到 orchestrator 的热路径。

```typescript
private syncToSemaphore(providerId: string): void {
  const entry = this.entries.get(providerId);
  if (!entry) return;
  const effectiveLimit = Math.max(entry.state.currentLimit, ADAPTIVE_MIN);
  this.semaphoreControl.updateConfig(providerId, { ... }); // 可能抛异常
}
```

**建议**: 包裹 try-catch，异常时记录 warn 日志但不中断请求处理：

```typescript
private syncToSemaphore(providerId: string): void {
  const entry = this.entries.get(providerId);
  if (!entry) return;
  const effectiveLimit = Math.max(entry.state.currentLimit, ADAPTIVE_MIN);
  try {
    this.semaphoreControl.updateConfig(providerId, { ... });
  } catch (err) {
    this.logger?.warn?.({ providerId, effectiveLimit, err }, "Adaptive: failed to sync to semaphore");
  }
}
```

### SF-2: init / syncProvider 缺少状态变更日志

**位置**: `init()` L48-60, `syncProvider()` L84-106

**问题**: provider 初始化和配置变更时没有任何 info 级别日志。生产环境中排查 "为什么 limit 被重置" 这类问题时，缺少关键锚点。

当前只有 `syncToSemaphore` 间接调用的信号量变更，没有 adaptive 层面的初始化日志。

**建议**: 在 `init()` 和 `syncProvider()` 中增加 info 日志：

```typescript
init(providerId, config, semParams) {
  // ... existing logic ...
  this.logger?.info?.({ providerId, max, action: "provider_initialized" }, "Adaptive: provider initialized");
}
```

### SF-3: `deriveProfile` 无防御性检查

**位置**: `deriveProfile()` L112-118

**问题**: 虽然 MF-1 修复后调用方已确保 max ≥ 1，但 `deriveProfile` 作为独立方法缺乏内部断言。如果未来新增调用方忘记钳位，NaN 会直接泄漏。

**建议**: 在 `deriveProfile` 入口添加断言：

```typescript
private deriveProfile(currentLimit: number, max: number): AdaptiveProfile {
  if (!Number.isFinite(max) || max < 1) max = ADAPTIVE_MIN;
  if (!Number.isFinite(currentLimit) || currentLimit < 1) currentLimit = ADAPTIVE_MIN;
  // ...
}
```

---

## NICE TO HAVE

### NH-1: Date.now() 时间耦合

**位置**: L167, L180, L190（3 处 `Date.now()` 调用）

当前测试通过 `vi.useFakeTimers()` 控制，可工作但较脆弱。理想方案是注入 `nowProvider: () => number` 使时间可替换。但考虑到现有测试已通过 fake timers 覆盖，且修改涉及构造函数签名变更，优先级低。

### NH-2: 冷却期拦截日志缺少上下文

**位置**: `transitionFailure()` L168-170

```typescript
this.logger?.debug?.({ providerId, statusCode, action: "failure_blocked_by_cooldown" }, "...");
```

缺少 `cooldownUntil` 和 `remainingMs` 信息，调试时需额外推算。建议增加：

```typescript
this.logger?.debug?.({
  providerId, statusCode,
  cooldownUntil: s.cooldownUntil,
  remainingMs: s.cooldownUntil - Date.now(),
  action: "failure_blocked_by_cooldown"
}, "...");
```

---

## 六维度审查矩阵

| 维度 | 评分 | 说明 |
|------|------|------|
| **1. 错误处理** | ⚠️ 7/10 | 主要路径有保护，但 NaN 输入未防护（MF-1），syncToSemaphore 未防异常（SF-1） |
| **2. 异常/NaN** | ⚠️ 6/10 | NaN 可通过 init/syncProvider 泄漏到 deriveProfile 和信号量（MF-1）。无 Infinity 风险（max 由 DB INTEGER 约束） |
| **3. 日志** | ⚠️ 7/10 | 关键状态变更有日志，但满额时日志误导（MF-2），init/syncProvider 缺日志（SF-2），冷却拦截缺上下文（NH-2） |
| **4. Fail-fast** | ✅ 8/10 | max=0 正确钳位到 1（测试 AC-1 覆盖），statusCode 过滤严谨，unknown provider 静默忽略合理。但缺少 NaN/undefined 快速失败（MF-1） |
| **5. 测试友好** | ✅ 9/10 | DI 注入 Logger + SemaphoreControl，getStatus() 暴露状态，42 测试用例覆盖 AC1-AC8 + E2E。轻微扣分：Date.now() 依赖 fake timers |
| **6. 调试友好** | ✅ 8/10 | requestId 关联、prevLimit/newLimit 对、statusCode/retryRuleMatched 上下文。扣分：满额误导日志（MF-2）、缺 init 日志（SF-2） |

---

## 特别关注项审查

### max=0 输入防护

| 入口 | 防护 | 测试覆盖 |
|------|------|----------|
| `init(max: 0)` | ✅ `Math.max(0, 1) = 1` | AC-1 ✅ |
| `syncProvider(max_concurrency: 0)` | ✅ `Math.max(0, 1) = 1` | AC-1 ✅ |
| `init(max: -1)` | ✅ `Math.max(-1, 1) = 1` | 无（应补充） |
| `init(max: undefined)` | ❌ `Math.max(undefined, 1) = NaN` | 无（MF-1） |
| `init(max: NaN)` | ❌ `Math.max(NaN, 1) = NaN` | 无（MF-1） |

### NaN 通过 deriveProfile 泄漏分析

```
deriveProfile(currentLimit: number, max: number)
  → level = Math.min(1, currentLimit / max)
     max=NaN → level=NaN
  → capacity = Math.min(1, Math.log2(max) / 7)
     max=NaN → capacity=NaN
  → climbThreshold = Math.round(2 + NaN*2 + NaN*2) = NaN
  → dropThreshold = Math.round(5 - NaN*2 - NaN*2) = NaN
  → cooldownMs = Math.round(10000 + NaN*10000) = NaN
```

**后果**:
- `consecutiveSuccesses >= NaN` → 永远 `false` → 爬升永远不触发 ✅（不会错误爬升）
- `consecutiveFailures >= NaN` → 永远 `false` → 下降永远不触发 ✅（不会错误下降）
- `cooldownUntil = Date.now() + NaN` = `NaN` → `Date.now() < NaN` = `false` → 永远不在冷却期 ✅（不会卡死）
- `syncToSemaphore(NaN)` → 信号量收到 `maxConcurrency: NaN` ❌ **信号量行为未定义**

结论：NaN 导致控制器静默冻结（不爬不降），但信号量侧可能异常。

### Date.now() 时间依赖

3 处调用均在使用 `vi.useFakeTimers()` 的测试中覆盖。冷却期边界条件：

| 条件 | 结果 | 正确性 |
|------|------|--------|
| `cooldownUntil = 0`（初始） | `Date.now() < 0` → `false` | ✅ 不误触冷却 |
| `Date.now() === cooldownUntil` | `now < until` → `false` | ✅ 精确到期 |
| `Date.now() === cooldownUntil - 1` | `now < until` → `true` | ✅ 冷却中 |
| 系统时钟回拨 | `now` 变小 → 冷却期延长 | ⚠️ 极端情况，可接受 |

### 冷却期拦截边界条件

**V3 语义翻转验证**:

| 场景 | 冷却期内成功 | 冷却期内失败 | 正确性 |
|------|-------------|-------------|--------|
| 429 后发成功 | ✅ 累积 + 可爬升（AC-3 test） | — | ✅ |
| 429 后发 429 | — | ✅ 被拦截（AC-3 test） | ✅ |
| 429 后发 5xx | — | ✅ 被拦截（AC-3 test） | ✅ |
| 429 后累积成功 + 5xx | ✅ 不重置成功计数（AC-8 test） | ✅ 拦截 | ✅ |

冷却期结束后行为：5xx 恢复正常退避路径（cooldown test: "after cooldown ends, failures resume" ✅）

---

## 测试覆盖评估

42 个测试用例，覆盖：
- ✅ AC-1: max=0 入口防护（3 cases）
- ✅ AC-2: 高水位无条件爬升（2 cases）
- ✅ AC-3: 冷却期语义翻转（3 cases）
- ✅ AC-4: 429 固定 -1 下降（7 cases）
- ✅ AC-5: 满额保留半数计数（3 cases）
- ✅ AC-6: 密集 429 只降 1 格（1 case）
- ✅ AC-7: limit=1 完整恢复（1 case）
- ✅ AC-8: 冷却期失败不重置成功（2 cases）
- ✅ deriveProfile 参数推导（3 cases）
- ✅ 5xx 失败处理（6 cases）
- ✅ 冷却期行为（2 cases）
- ✅ remove/re-init/syncProvider（8 cases）
- ✅ 非并发错误过滤（6 cases）
- ✅ max 上限（3 cases）
- ✅ V3 状态清理（2 cases）
- ✅ E2E 场景（3 cases）

**缺失测试**:
- ❌ `init(max: NaN)` / `init(max: undefined)` → 需 MF-1 修复后补充
- ❌ `syncProvider(max_concurrency: -1)` → 应补充
- ❌ 满额 syncToSemaphore 调用频率验证 → 应确认不会过度调用

---

## 结论

**Verdict: FAIL** — 2 个 MUST FIX 需要修复后才能合并。

MF-1（NaN 防护）是静默破坏性 bug，虽然触发条件需要 DB 异常输入，但一旦触发极难排查（控制器静默冻结，无任何错误日志）。MF-2（日志误导）在满额运行时会造成大量噪音。两者修复工作量均较小（< 30 行），建议一并修复后重新提交审查。
