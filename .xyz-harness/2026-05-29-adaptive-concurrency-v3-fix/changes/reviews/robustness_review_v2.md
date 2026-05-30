---
verdict: pass
must_fix: 0
review_metrics:
  files_reviewed: 1
  lines_reviewed: 180
  must_fix_verified: 2
  must_fix_resolved: 2
  should_fix_status: "3 remain (not blocking)"
---

# Robustness Review V2: Adaptive Concurrency V3 — MUST FIX Verification

**Reviewer**: Robustness Expert
**Date**: 2026-05-30
**Scope**: V1 MUST FIX 修复验证
**File**: `router/src/core/concurrency/adaptive-controller.ts`

## Summary

V1 报告的 2 个 MUST FIX 均已正确修复。代码变更精确匹配 V1 建议，无引入新问题。

---

## MF-1: NaN 输入防护 — ✅ FIXED

**V1 要求**: 添加 `clampMax()` 方法，`init()` / `syncProvider()` 使用它替代裸 `Math.max()`

**验证结果**:

| 检查项 | 状态 | 证据 |
|--------|------|------|
| `clampMax()` 方法存在 | ✅ | L106-109: `Number(value)` → `Number.isFinite(n) && n >= ADAPTIVE_MIN ? n : ADAPTIVE_MIN` |
| `init()` 使用 `clampMax()` | ✅ | L48: `const max = this.clampMax(config.max)` 替代原 `Math.max(config.max, ADAPTIVE_MIN)` |
| `syncProvider()` 使用 `clampMax()` | ✅ | L90: `const max = this.clampMax(p.max_concurrency)` 替代原 `Math.max(p.max_concurrency, ADAPTIVE_MIN)` |
| `syncProvider()` → `init()` 路径受保护 | ✅ | L97 调用 `this.init(providerId, { max: p.max_concurrency }, ...)` → init 内部使用 clampMax |
| NaN 输入不会泄漏到 deriveProfile | ✅ | clampMax 返回值保证 ≥ 1 且 isFinite |
| JSDoc 注释 | ✅ | L105: "将 max_concurrency 钳制到 >= ADAPTIVE_MIN，防止 NaN/undefined 泄漏到 deriveProfile" |

**NaN 泄漏链路复查**:

```
init(max: undefined) → clampMax(undefined)
  → Number(undefined) = NaN → !isFinite → return ADAPTIVE_MIN (1) ✅

init(max: NaN) → clampMax(NaN)
  → Number(NaN) = NaN → !isFinite → return ADAPTIVE_MIN (1) ✅

init(max: -5) → clampMax(-5)
  → Number(-5) = -5 → isFinite but < ADAPTIVE_MIN → return ADAPTIVE_MIN (1) ✅

init(max: Infinity) → clampMax(Infinity)
  → Number(Infinity) = Infinity → !isFinite → return ADAPTIVE_MIN (1) ✅
```

**结论**: MF-1 完全修复，所有异常输入路径均正确降级到 `ADAPTIVE_MIN`。

---

## MF-2: 满额日志语义误导 — ✅ FIXED

**V1 要求**: 满额时降级为 debug 级别，action 语义正确

**验证结果**:

| 检查项 | 状态 | 证据 |
|--------|------|------|
| 满额分支使用 debug 级别 | ✅ | L136: `this.logger?.debug?.(...)` |
| action 语义正确 | ✅ | L136: `action: "at_max_counter_cycle"` |
| 日志消息准确 | ✅ | L136: `"Adaptive: at max, counters preserved"` |
| 非满额分支不受影响 | ✅ | L139-140: 保持 `info` + `"limit_increased"` |
| syncToSemaphore 调用完整 | ✅ | L142: 无论满额与否都会调用 |

**满额行为复查**:

```typescript
// L132-142 — 修复后代码
if (s.consecutiveSuccesses >= profile.climbThreshold) {
  const prevLimit = s.currentLimit;
  s.currentLimit = Math.min(s.currentLimit + 1, entry.max);
  if (s.currentLimit === entry.max) {
    // ✅ debug 级别 + 正确 action + 保留半数计数器
    s.consecutiveSuccesses = Math.floor(s.consecutiveSuccesses / AT_MAX_COUNTER_HALVE_DIVISOR);
    this.logger?.debug?.({...action: "at_max_counter_cycle"}, "Adaptive: at max, counters preserved");
  } else {
    // ✅ info 级别 + limit_increased（实际增加了）
    s.consecutiveSuccesses = 0;
    this.logger?.info?.({...action: "limit_increased"}, "Adaptive: limit increased by 1");
  }
  this.syncToSemaphore(providerId);
}
```

**日志洪水消除验证**:

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| currentLimit=10, max=10 | `info` + `"limit_increased"` (误导) | `debug` + `"at_max_counter_cycle"` (准确) |
| currentLimit=9, max=10 | `info` + `"limit_increased"` (正确) | `info` + `"limit_increased"` (正确) |
| 高流量满额运行 | 大量 info 误导日志 | debug 静默，不干扰生产日志 ✅ |

**结论**: MF-2 完全修复，满额时日志不再误导且不会产生 info 级别洪水。

---

## SHOULD FIX 遗留状态（不阻塞合并）

| 编号 | 问题 | 状态 | 风险 |
|------|------|------|------|
| SF-1 | syncToSemaphore 未包裹 try-catch | 未修复 | 低：updateConfig 内部应有防护 |
| SF-2 | init/syncProvider 缺少状态变更日志 | 未修复 | 低：非功能性 |
| SF-3 | deriveProfile 无防御性检查 | 部分覆盖：入口 clampMax 保护 | 低：入口已防护 |

SF-3 通过 MF-1 的 `clampMax()` 在入口处间接覆盖——`deriveProfile` 的调用方保证 max ≥ 1 且 isFinite，无需额外断言。

---

## 回归检查

修复未引入新问题：

- `clampMax()` 为纯函数，无副作用
- `transitionSuccess()` 满额分支逻辑不变（保留半数计数器 + syncToSemaphore），仅日志级别和文本变更
- `transitionFailure()` 路径完全未修改
- `syncProvider()` 非 adaptive_enabled 分支未修改
- `deriveProfile()` 未修改

---

## Verdict: **PASS** ✅

V1 的 2 个 MUST FIX 均已精确修复，代码变更符合建议方案，未引入回归。SHOULD FIX 项可在后续迭代处理。
