---
verdict: pass
must_fix: 0
review_metrics:
  callers_verified: 6
  interfaces_checked: 4
  nan_entry_points: 5
  nan_covered: 5
  breaking_changes: 0
  wasQueued_consumers: 2
  wasQueued_impact: none
  semaphore_nan_safety: verified
  files_reviewed:
    - router/src/core/concurrency/adaptive-controller.ts
    - router/src/core/concurrency/types.ts
    - router/src/core/concurrency/semaphore.ts
    - router/src/core/concurrency/index.ts
    - router/src/proxy/orchestration/orchestrator.ts
    - router/src/admin/providers.ts
    - router/src/admin/quick-setup.ts
    - router/src/index.ts
    - router/src/core/registry.ts
    - router/src/core/monitor/request-tracker.ts
    - router/src/proxy/handler/create-proxy-handler.ts
---

# Integration Review — Adaptive Concurrency V3

**Review Date**: 2026-05-30
**Reviewer**: Integration Expert (AI)
**Spec**: `2026-05-29-adaptive-concurrency-v3-fix`
**Verdict**: ✅ PASS (0 MUST FIX)

---

## 1. 接口变更影响分析

### 1.1 删除 `limitReached` 字段 — ✅ 无破坏性

**变更**: `AdaptiveState` 接口中删除 `limitReached` 字段。

**调用方影响分析**:

| 消费者 | 使用方式 | 影响 |
|--------|----------|------|
| `orchestrator.ts` | 从未直接访问 `limitReached` | ✅ 无影响 |
| `admin/providers.ts:496` | `adaptiveController?.getStatus(id)` → 直接返回 `AdaptiveState` 给前端 API | ✅ 前端不再收到此字段，但无代码依赖 |
| `request-tracker.ts` | 仅 import type `AdaptiveState`，未访问字段 | ✅ 无影响 |
| `registry.ts` | 仅声明 `getAdaptiveStatus(): AdaptiveState` | ✅ 无影响 |
| `adaptive-controller.ts` 内部 | V2 使用 `s.limitReached`，V3 已删除所有引用 | ✅ 已清理 |

**结论**: `limitReached` 是纯内部状态字段，删除后不影响任何外部调用方。JSON 序列化到前端时字段消失，前端无需此字段。

### 1.2 删除 `keepRatio` 字段 — ✅ 无破坏性

**变更**: `AdaptiveProfile` 接口中删除 `keepRatio`，`AdaptiveState` 从未包含此字段。

**调用方影响分析**: `AdaptiveProfile` 是 `AdaptiveController` 的纯内部接口（`private deriveProfile()` 返回值），未导出，无外部消费者。grep 确认：`keepRatio` 在整个代码库中零引用。

**结论**: ✅ 纯内部重构，零破坏性。

### 1.3 `AdaptiveResult.wasQueued` 保留但未使用 — ✅ 无影响

**变更**: `AdaptiveResult.wasQueued` 字段保留（types.ts L23），但 `adaptive-controller.ts` 不再读取它。

**调用方写入分析**:

| 调用点 | 传入 `wasQueued` | 值来源 |
|--------|-----------------|--------|
| `orchestrator.ts:161` | ✅ `wasQueued: wasEverQueued` | 闭包捕获的 `wasEverQueued` |
| `orchestrator.ts:168` | ✅ `wasQueued: wasEverQueued` | 同上 |
| `orchestrator.ts:171` | ✗ 未传入 | `SemaphoreTimeoutError`/`QueueFullError` 路径 |

**影响评估**: 
- **写入方**: orchestrator 仍然传入 `wasQueued`，字段值正确携带。不会报错。
- **消费方**: adaptive-controller 的 `transitionSuccess()` 和 `transitionFailure()` 均不读取 `result.wasQueued`。字段值被静默忽略。
- **序列化**: `AdaptiveResult` 不参与 JSON 序列化（纯内存对象），无 API 暴露。
- **向后兼容**: 未来如果需要恢复 `wasQueued` 语义，无需改接口。

**结论**: ✅ 调用方正确传入，controller 正确忽略，无功能影响。

---

## 2. NaN 防护覆盖分析

### 2.1 入口梳理

所有将 `max_concurrency` 值传入 `AdaptiveController` 的路径：

| # | 入口 | 文件 | 行号 | `clampMax` 覆盖 |
|---|------|------|------|----------------|
| E1 | `init()` | `adaptive-controller.ts` | L48 | ✅ `const max = this.clampMax(config.max)` |
| E2 | `syncProvider()` 已有 entry | `adaptive-controller.ts` | L91 | ✅ `const max = this.clampMax(p.max_concurrency)` |
| E3 | `syncProvider()` 新 entry | `adaptive-controller.ts` | L96 | ✅ 委托给 `init()`，回到 E1 |
| E4 | `initializeProviderState()` | `index.ts` | L73 | ✅ 委托给 `init()`，回到 E1 |
| E5 | `quick-setup.ts` | `quick-setup.ts` | L187 | ✅ 委托给 `syncProvider()`，回到 E2/E3 |

**覆盖结论**: 所有 5 个入口最终都经过 `clampMax()` 钳制。

### 2.2 `clampMax()` 防护强度

```typescript
private clampMax(value: number): number {
  const n = Number(value);   // 处理 undefined → NaN, null → 0, string → NaN/number
  return Number.isFinite(n) && n >= ADAPTIVE_MIN ? n : ADAPTIVE_MIN;
}
```

| 输入 | `Number(input)` | `isFinite` | 结果 |
|------|----------------|-----------|------|
| `0` | `0` | ✗ (< 1) | `1` ✅ |
| `undefined` | `NaN` | ✗ | `1` ✅ |
| `null` | `0` | ✗ (< 1) | `1` ✅ |
| `NaN` | `NaN` | ✗ | `1` ✅ |
| `Infinity` | `Infinity` | ✗ | `1` ✅ |
| `-1` | `-1` | ✗ (< 1) | `1` ✅ |
| `1` | `1` | ✅ | `1` ✅ |
| `10` | `10` | ✅ | `10` ✅ |

**结论**: `clampMax()` 对 `NaN`、`undefined`、`null`、`Infinity`、`0`、负数均有防护。**所有入口均覆盖**。

### 2.3 `syncProvider()` 中已有 entry 的 NaN 防护完整性

```typescript
// L91-96
const max = this.clampMax(p.max_concurrency);       // max >= 1
existing.max = max;
existing.state.currentLimit = Math.min(
  Math.max(existing.state.currentLimit, ADAPTIVE_MIN),  // currentLimit >= 1
  max,                                                   // currentLimit <= max
);
```

- `existing.state.currentLimit` 可能是之前的合法值或新计算的值。`Math.max(..., ADAPTIVE_MIN)` 确保即使因某些边界条件 `currentLimit` 异常，也会被钳制。
- `Math.min(..., max)` 确保 `currentLimit` 不超过 `max`。

**结论**: ✅ 双重钳制，完备。

### 2.4 `deriveProfile()` 对 NaN 的免疫力

`deriveProfile()` 接收 `currentLimit` 和 `max`，两者在到达此函数时：
- `max` 已由 `clampMax()` 钳制 ≥ 1
- `currentLimit` 初始由 `clampMax` 设定，后续变更仅有 `+1`/`-1`（`Math.min`/`Math.max` 限定边界）

因此 `currentLimit / max` 不会产生 `NaN` 或 `Infinity`。

**结论**: ✅ `deriveProfile` 的所有数学运算在合法范围内。

---

## 3. 信号量侧 NaN 安全性

### 3.1 `syncToSemaphore()` 防护

```typescript
// L208-212
private syncToSemaphore(providerId: string): void {
  const entry = this.entries.get(providerId);
  if (!entry) return;
  const effectiveLimit = Math.max(entry.state.currentLimit, ADAPTIVE_MIN);
  this.semaphoreControl.updateConfig(providerId, {
    maxConcurrency: effectiveLimit,  // ≥ 1，永远不会是 NaN
    ...
  });
}
```

- `entry.state.currentLimit` 经过所有路径的 `Math.max(..., ADAPTIVE_MIN)` 保护
- `effectiveLimit = Math.max(currentLimit, 1)` 是二次防护
- 传入 `SemaphoreManager.updateConfig()` 的 `maxConcurrency` 恒为 ≥ 1 的有限整数

### 3.2 `SemaphoreManager.updateConfig()` 行为分析

```typescript
updateConfig(providerId: string, config: ConcurrencyConfig): void {
  const entry = this.getOrCreate(providerId);
  entry.config = config;

  if (config.maxConcurrency === 0) {
    // 清空队列、重置 current
    ...
    return;
  }
  // maxConcurrency > 0: 排队逻辑
  while (entry.current < config.maxConcurrency && entry.queue.length > 0) { ... }
}
```

由于 `syncToSemaphore()` 保证 `maxConcurrency ≥ 1`，`updateConfig` 不会进入 `=== 0` 分支。`entry.current < config.maxConcurrency` 比较正常（两边都是有限数字）。

### 3.3 `SemaphoreManager.acquire()` 行为分析

```typescript
const maxConcurrency = override?.max_concurrency ?? entry.config.maxConcurrency;
if (maxConcurrency === 0) return { generation: entry.generation, bypassed: true };
if (entry.current < maxConcurrency) { ... }
```

即使 `override?.max_concurrency` 为 `0`，`acquire()` 正确处理为 bypassed。而 adaptive 模式下的信号量配置由 `syncToSemaphore()` 控制，不经过 `override` 路径。

**结论**: ✅ 信号量侧对 NaN 免疫。`SemaphoreManager` 收到的 `maxConcurrency` 始终 ≥ 1。

---

## 4. orchestrator 集成验证

### 4.1 `createOrchestrator()` 工厂函数

```typescript
export function createOrchestrator(
  semaphoreManager?: SemaphoreManager,
  tracker?: RequestTracker,
  adaptiveController?: AdaptiveController,
): ProxyOrchestrator | undefined {
  ...
  return new ProxyOrchestrator({
    semaphoreScope, trackerScope,
    resilience: new ResilienceLayerClass(),
    adaptiveController,   // ← 可选依赖
  });
}
```

- `adaptiveController` 是可选参数（`?`），V3 未改变其可选性
- orchestrator 通过 `this.deps.adaptiveController?.onRequestComplete()` 可选链调用
- V3 删除了 `limitReached`/`keepRatio` 对 orchestrator 的依赖，这些字段从未在 orchestrator 中使用

### 4.2 `onRequestComplete()` 调用点分析

**正常完成路径** (L161):
```typescript
this.deps.adaptiveController?.onRequestComplete(providerId, {
  success: status === "completed",
  statusCode,
  retryRuleMatched,
  requestId: config.trackerId,
  wasQueued: wasEverQueued,
});
```
- `success`: boolean ✅
- `statusCode`: number | undefined ✅
- `retryRuleMatched`: boolean ✅（V3 新增字段，controller 正确使用）
- `wasQueued`: boolean ✅（传入但 controller 忽略，无影响）

**ProviderSwitchNeeded 路径** (L168):
```typescript
this.deps.adaptiveController?.onRequestComplete(providerId, {
  success: false,
  statusCode,
  retryRuleMatched: true,   // failover = 有意义的失败
  requestId: config.trackerId,
  wasQueued: wasEverQueued,
});
```
- `retryRuleMatched: true` 确保失败不计入 statusCode 过滤，直接进入退避逻辑 ✅

**信号量错误路径** (L171):
```typescript
this.deps.adaptiveController?.onRequestComplete(providerId, {
  success: false,
  statusCode: 429,           // 统一用 429 表示并发压力
  requestId: config.trackerId,
});
```
- 不传 `wasQueued`（可选字段，默认 undefined）✅
- `statusCode: 429` 触发立即 -1 + 冷却期 ✅
- 不传 `retryRuleMatched`（默认 undefined）→ controller 的 statusCode 过滤: `statusCode !== 429` 为 false，进入 429 分支 ✅

### 4.3 `wasEverQueued` 闭包捕获

```typescript
let wasEverQueued = false;
// ...
() => {
  trackerReq.queued = true;
  this.deps.trackerScope.markQueued(trackerReq.id, true);
  wasEverQueued = true;   // ← 闭包捕获外层变量
},
```

V3 未改变此逻辑。`wasEverQueued` 正确传递到所有 3 个 `onRequestComplete` 调用点。即使 controller 不使用此值，orchestrator 侧的值也是正确的。

**结论**: ✅ orchestrator 集成无破坏性变更，所有调用点参数正确。

---

## 5. Admin API 集成验证

### 5.1 创建 Provider（POST /admin/api/providers）

```typescript
adaptiveController?.syncProvider(id, {
  adaptive_enabled: isAdaptiveEnabled,
  max_concurrency: body.max_concurrency ?? PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency,
  queue_timeout_ms: ...,
  max_queue_size: ...,
});
```

- `PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency = 0` → `syncProvider` → `clampMax(0)` → `1` ✅
- 非自适应模式: `syncProvider` → `this.remove()` + `semaphoreControl.updateConfig(maxConcurrency: 0)` → 信号量 bypassed ✅

### 5.2 更新 Provider（PUT /admin/api/providers/:id）

```typescript
adaptiveController?.syncProvider(id, {
  adaptive_enabled: updated.adaptive_enabled,
  max_concurrency: updated.max_concurrency,
  ...
});
```

- `updated` 来自 DB 查询结果，`max_concurrency` 可能是 `0` → `clampMax(0)` → `1` ✅
- 禁用 adaptive: `syncProvider` → `this.remove()` + `semaphoreControl.updateConfig()` 恢复原始值 ✅
- 已禁用 → 重新启用: `needsSync = true` → `syncProvider` → `init()` 路径 ✅

### 5.3 删除/禁用 Provider

```typescript
// 禁用
stateRegistry?.removeProvider(id);
adaptiveController?.remove(id);

// 删除
adaptiveController?.remove(id);
```

- `remove()` 仅删除 Map entry，不涉及 NaN ✅

### 5.4 快速配置（quick-setup）

```typescript
adaptiveController?.syncProvider(providerId, {
  adaptive_enabled: finalAdaptiveEnabled,
  max_concurrency: finalMaxConcurrency,
  ...
});
```

- `finalMaxConcurrency` 来自 `body.provider.max_concurrency ?? DEFAULTS` → 经 `syncProvider` → `clampMax` ✅

### 5.5 自适应状态查询（GET /admin/api/providers/:id/adaptive-status）

```typescript
const status = adaptiveController?.getStatus(id);
return status;  // → AdaptiveState JSON
```

- `AdaptiveState` 不再包含 `limitReached`，前端不会收到此字段
- 前端如果之前渲染了 `limitReached`，会得到 `undefined`，不会报错（JS 对缺失字段返回 undefined）
- 前端代码不在本次变更范围内，但 JSON 序列化的向后兼容性是安全的

**结论**: ✅ 所有 Admin API 集成点正确，`clampMax` 覆盖所有入口。

---

## 6. 导出完整性验证

### 6.1 `index.ts` 导出清单

```typescript
export { SemaphoreManager } from "./semaphore.js";
export { AdaptiveController } from "./adaptive-controller.js";
export type { AcquireToken } from "./semaphore.js";
export type {
  ConcurrencyConfig, AdaptiveState, AdaptiveResult,
  ISemaphoreControl, ProviderConcurrencyParams,
} from "./types.js";
```

| 类型 | 变更 | 影响 |
|------|------|------|
| `AdaptiveController` | 类签名未变 | ✅ 无影响 |
| `AdaptiveState` | 删除 `limitReached` | ✅ 见 §1.1 |
| `AdaptiveResult` | `wasQueued` 保留 | ✅ 见 §1.3 |
| `ConcurrencyConfig` | 无变更 | ✅ |
| `ISemaphoreControl` | 无变更 | ✅ |
| `ProviderConcurrencyParams` | 无变更 | ✅ |

### 6.2 `core/index.ts` re-export

```typescript
export { SemaphoreManager, AdaptiveController } from "./concurrency/index.js";
export type { AcquireToken, ConcurrencyConfig, AdaptiveState, AdaptiveResult,
  ISemaphoreControl, ProviderConcurrencyParams } from "./concurrency/index.js";
```

- Re-export 清单与 `concurrency/index.ts` 一致 ✅

**结论**: ✅ 导出完整，无遗漏。

---

## 7. 跨模块数据流完整性

### 7.1 数据流路径

```
Admin API (providers.ts / quick-setup.ts)
  ↓ syncProvider() / init()
AdaptiveController (adaptive-controller.ts)
  ↓ clampMax() → syncToSemaphore()
SemaphoreManager (semaphore.ts)
  ↓ updateConfig()
SemaphoreScope.acquire/release
  ↓ onRequestComplete()
Orchestrator → AdaptiveController.transitionSuccess/Failure
  ↓ syncToSemaphore()
SemaphoreManager (循环闭环)
```

每个环节的 NaN 防护:

| 环节 | NaN 防护机制 | 状态 |
|------|-------------|------|
| Admin → AdaptiveController | `clampMax()` | ✅ |
| init → deriveProfile | `clampMax()` 保证 max ≥ 1 | ✅ |
| transitionSuccess → currentLimit+1 | `Math.min(currentLimit+1, max)` | ✅ |
| transitionFailure → currentLimit-1 | `Math.max(currentLimit-1, ADAPTIVE_MIN)` | ✅ |
| syncToSemaphore → SemaphoreManager | `Math.max(currentLimit, ADAPTIVE_MIN)` | ✅ |
| SemaphoreManager 内部 | `maxConcurrency === 0` bypass + `current < maxConcurrency` 比较 | ✅ |

### 7.2 无限循环风险

`syncToSemaphore()` 仅在 `currentLimit` 变更时调用（transitionSuccess 达到 climbThreshold / transitionFailure 达到 dropThreshold / 429）。不存在 sync → transition → sync 的循环。

**结论**: ✅ 数据流完整，无 NaN 泄漏路径，无无限循环风险。

---

## 8. INFO 级别观察

### 8.1 `wasQueued` 可考虑标记为 `@deprecated`

`AdaptiveResult.wasQueued` 在 V3 中虽保留但不再使用。建议在后续版本中添加 `@deprecated` JSDoc 注释，避免新代码误读此字段。

### 8.2 `syncProvider` 非 adaptive 路径的 `max_concurrency` 未钳制

当 `adaptive_enabled = false` 时，`syncProvider` 执行:
```typescript
this.semaphoreControl.updateConfig(providerId, {
  maxConcurrency: p.max_concurrency,  // 可能是 0
  ...
});
```
这是正确行为：`maxConcurrency: 0` 表示"不限制并发"，信号量 `acquire()` 返回 bypassed token。非 adaptive 模式下 0 = 无限是设计意图，不需要钳制。

### 8.3 `initializeProviderState` 对 `max_concurrency = 0` 且非 adaptive 的 Provider

```typescript
} else if (p.max_concurrency > 0) {
  semaphoreManager.updateConfig(p.id, { ... });
}
```

`max_concurrency = 0` 且非 adaptive 的 Provider 不会配置信号量（正确：0 = 无限）。这些 Provider 在 `acquire()` 时使用默认 entry (`maxConcurrency: 0`) → bypassed。

---

## 9. 综合判定

| 验证维度 | 项数 | 通过 | 失败 |
|---------|------|------|------|
| 接口变更影响 | 3 (limitReached, keepRatio, wasQueued) | 3 | 0 |
| NaN 防护入口覆盖 | 5 | 5 | 0 |
| 信号量 NaN 安全 | 3 (updateConfig, acquire, syncToSemaphore) | 3 | 0 |
| orchestrator 集成 | 4 (工厂、3 个调用点) | 4 | 0 |
| Admin API 集成 | 5 (create, update, delete, quick-setup, status) | 5 | 0 |
| 导出完整性 | 6 类型 | 6 | 0 |
| 数据流完整性 | 6 环节 | 6 | 0 |

**Verdict**: ✅ **PASS** — 集成审查通过。删除的接口字段（`limitReached`、`keepRatio`）无外部消费者；保留的 `wasQueued` 字段正确传入但被忽略，不影响行为；NaN 防护通过 `clampMax()` 覆盖所有 5 个入口，信号量侧二次防护完备；所有调用方（orchestrator、admin、quick-setup）集成点无破坏性变更。
