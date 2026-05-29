---
verdict: pass
complexity: L1
---

# Adaptive Concurrency V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复自适应并发控制器的三个架构缺陷（NaN 冻结、冷却期倒置、利用率死锁），使并发度在异常后能可靠恢复。

**Architecture:** 纯算法层修改——在 `AdaptiveController` 的状态机中翻转冷却期语义、移除利用率门控、将乘法衰减改为固定 -1、增加入口防护。不涉及 DB/API/前端。

**Tech Stack:** TypeScript, Vitest, Node.js

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/core/concurrency/types.ts` | modify | BG1 | 删除 `AdaptiveState.limitReached`、`AdaptiveProfile.keepRatio` |
| `router/src/core/concurrency/adaptive-controller.ts` | modify | BG1 | 核心算法变更（6 项 FR） |
| `router/tests/adaptive-controller.test.ts` | modify | BG1 | 测试更新匹配 V3 行为 |

## Interface Contracts

### Module: concurrency/adaptive-controller

#### Class: AdaptiveController

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| init | `(providerId: string, config: { max: number }, semParams: { queueTimeoutMs: number; maxQueueSize: number }) => void` | void | max=0 → clamp to 1 | AC-1 |
| syncProvider | `(providerId: string, p: ProviderConcurrencyParams) => void` | void | max_concurrency=0 → clamp to 1 | AC-1 |
| onRequestComplete | `(providerId: string, result: AdaptiveResult) => void` | void | cooldown blocks drops only | AC-3/6/8 |
| deriveProfile | `(currentLimit: number, max: number) => AdaptiveProfile` | AdaptiveProfile (无 keepRatio) | max=1 → valid numerics | AC-1 |

#### Data: AdaptiveState

| Field | Type | V3 Change |
|-------|------|-----------|
| currentLimit | number | 不变 |
| limitReached | boolean | **删除** |
| consecutiveSuccesses | number | 不变 |
| consecutiveFailures | number | 不变 |
| cooldownUntil | number | 不变 |

#### Data: AdaptiveProfile

| Field | Type | V3 Change |
|-------|------|-----------|
| climbThreshold | number | 不变 |
| dropThreshold | number | 不变 |
| keepRatio | number | **删除** |
| cooldownMs | number | 不变 |

## Spec Coverage Matrix

| Spec AC | Interface Method | Data Flow | Task |
|---------|-----------------|-----------|------|
| AC-1 | AdaptiveController.init / syncProvider | init: config.max → Math.max(max,1) → entry.max → deriveProfile | Task 1 |
| AC-2 | AdaptiveController.transitionSuccess | transitionSuccess: consecutiveSuccesses → climbThreshold → currentLimit+1 (无 safeZone 检查) | Task 2 |
| AC-3 | AdaptiveController.transitionSuccess / transitionFailure | transitionSuccess: 无 cooldown 检查; transitionFailure: cooldown 前置拦截 | Task 2 |
| AC-4 | AdaptiveController.transitionFailure | transitionFailure(429): currentLimit - 1 (固定步进) | Task 3 |
| AC-5 | AdaptiveController.transitionSuccess | transitionSuccess(at max): Math.floor(consecutiveSuccesses/2) | Task 4 |
| AC-6 | AdaptiveController.transitionFailure | transitionFailure: cooldown 拦截密集 429 | Task 3 |
| AC-7 | AdaptiveController.transitionSuccess | 36 次成功 → limit 1→10 | Task 5 |
| AC-8 | AdaptiveController.transitionFailure | transitionFailure(cooldown): 不清零 consecutiveSuccesses | Task 3 |

## Spec Metrics Traceability

| Spec 指标 | 采纳状态 | 对应 Task |
|-----------|---------|----------|
| AC-1 max=0 NaN 防护 | adopted | Task 1 |
| AC-2 高水位无条件爬升 | adopted | Task 2 |
| AC-3 冷却期翻转 | adopted | Task 2 |
| AC-4 429 固定 -1 | adopted | Task 3 |
| AC-5 满额保留半数计数 | adopted | Task 4 |
| AC-6 密集 429 只降 1 格 | adopted | Task 3 |
| AC-7 limit=1 完全恢复 | adopted | Task 5 |
| AC-8 冷却期不重置成功计数 | adopted | Task 3 |

---

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | 入口防护 + 类型清理 | backend | — | BG1 |
| 2 | 冷却期翻转 + 移除利用率门控 | backend | Task 1 | BG1 |
| 3 | 429 固定 -1 + 5xx 冷却期 + 冷却期拦截行为 | backend | Task 2 | BG1 |
| 4 | 满额时保留部分成功计数 | backend | Task 3 | BG1 |
| 5 | 集成验证：limit=1 恢复 + E2E 场景 | backend | Task 4 | BG1 |

---

### Task 1: 入口防护 + 类型清理

**Type:** backend

**Files:**
- Modify: `router/src/core/concurrency/types.ts` — 删除 `AdaptiveState.limitReached` 字段
- Modify: `router/src/core/concurrency/types.ts` — 删除 `AdaptiveProfile.keepRatio` 字段
- Modify: `router/src/core/concurrency/adaptive-controller.ts:49-57` — init() 入口加 `Math.max(config.max, 1)`
- Modify: `router/src/core/concurrency/adaptive-controller.ts:76-91` — syncProvider() 入口加 `Math.max(p.max_concurrency, 1)`
- Modify: `router/src/core/concurrency/adaptive-controller.ts:34-36` — 删除 `SAFE_ZONE_DIVISOR`、`KEEP_RATIO_MIN` 常量
- Modify: `router/src/core/concurrency/adaptive-controller.ts:97-104` — deriveProfile 删除 `keepRatio` 计算
- Test: `router/tests/adaptive-controller.test.ts`

**实现要点：**

`types.ts` 变更：
- `AdaptiveState` 删除 `limitReached: boolean` 字段
- `AdaptiveProfile` 删除 `keepRatio: number` 字段

`adaptive-controller.ts` 变更：
- 删除常量 `SAFE_ZONE_DIVISOR = 2` 和 `KEEP_RATIO_MIN = 0.5`
- `init()` 在 `const initialLimit = config.max` 之前加 `config.max = Math.max(config.max, 1)`
- `syncProvider()` 在 `existing.max = p.max_concurrency` 之前加 `p.max_concurrency = Math.max(p.max_concurrency, 1)`
- `deriveProfile()` 删除 `keepRatio` 计算行，只返回 `climbThreshold`、`dropThreshold`、`cooldownMs`
- `init()` 中 `state` 初始化删除 `limitReached: false`

**测试要点（TDD）：**

AC-1 测试用例：
- `init({ max: 0 })` → `currentLimit = 1`，`deriveProfile(1,1)` 返回有效数值（climbThreshold=4, dropThreshold=3, cooldownMs=20000）
- `syncProvider({ max_concurrency: 0, adaptive_enabled: 1 })` → `currentLimit = 1`
- 现有 init 测试中 `limitReached` 断言需删除（字段已移除）
- `deriveProfile` helper 函数中删除 `keepRatio` 相关断言

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 写最小实现**
- [ ] **Step 4: 运行测试确认通过**
- [ ] **Step 5: Commit**

```bash
npx vitest run router/tests/adaptive-controller.test.ts
```

---

### Task 2: 冷却期翻转 + 移除利用率门控

**Type:** backend

**Depends on:** Task 1

**Files:**
- Modify: `router/src/core/concurrency/adaptive-controller.ts:125-153` — transitionSuccess()
- Test: `router/tests/adaptive-controller.test.ts`

**实现要点：**

`transitionSuccess()` 变更：
1. **删除冷却期检查**：移除 `if (Date.now() < s.cooldownUntil) return;`（第 133 行附近）。成功在任何时刻都可累积。
2. **删除利用率门控**：移除 `safeZone` / `limitReached` 判断块（第 145-149 行附近）。爬升条件简化为：
   ```
   if (s.consecutiveSuccesses >= profile.climbThreshold) {
     const prevLimit = s.currentLimit;
     s.currentLimit = Math.min(s.currentLimit + 1, entry.max);
     // 日志保持不变
     s.consecutiveSuccesses = 0;  // Task 4 会改为条件保留
     this.syncToSemaphore(providerId);
   }
   ```
3. **删除 wasQueued 处理**：移除 `if (result.wasQueued) { s.limitReached = true; }` 块

**测试要点：**

AC-2 测试：
- `max=10, limit=8, wasQueued=false`，连续 5 次成功 → `limit=9`（无条件爬升）
- `max=10, limit=6, wasQueued=false`，连续 4 次成功 → `limit=7`（无需 limitReached）

AC-3 测试（冷却期内爬升部分）：
- `max=10, limit=10` → 429 → `limit=9, cd=T+20s` → 冷却期内 5 次成功 → `limit=10`

**删除的旧测试：**
- AC3 "utilization gating" 整个 describe 块（safeZone/limitReached 相关 5 个用例）
- cooldown behavior 中 "successes during cooldown do not trigger climb" 用例（行为已变）

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 写最小实现**
- [ ] **Step 4: 运行测试确认通过**
- [ ] **Step 5: Commit**

---

### Task 3: 429 固定 -1 + 5xx 冷却期 + 冷却期拦截行为

**Type:** backend

**Depends on:** Task 2

**Files:**
- Modify: `router/src/core/concurrency/adaptive-controller.ts:155-197` — transitionFailure()
- Test: `router/tests/adaptive-controller.test.ts`

**实现要点：**

`transitionFailure()` 变更（按代码顺序）：

1. **statusCode 过滤保留**（不变）：第 167-172 行的过滤逻辑不动

2. **冷却期前置检查**：在 statusCode 过滤之后、failure 计数之前插入：
   ```typescript
   // 冷却期内拦截所有失败（不计数、不重置成功计数）
   if (Date.now() < s.cooldownUntil) {
     this.logger?.debug?.({ ... }, "Adaptive: failure blocked by cooldown");
     return;
   }
   ```
   注意：这个 return 在 `s.consecutiveFailures++` 和 `s.consecutiveSuccesses = 0` 之前，所以冷却期拦截时不会清零成功计数（AC-8）。

3. **429 路径改为固定 -1**：
   ```typescript
   // 旧: s.currentLimit = Math.max(Math.floor(s.currentLimit * profile.keepRatio), ADAPTIVE_MIN)
   // 新:
   s.currentLimit = Math.max(s.currentLimit - 1, ADAPTIVE_MIN);
   ```

4. **5xx 路径新增冷却期**：在 `s.currentLimit = Math.max(s.currentLimit - 1, ADAPTIVE_MIN)` 之后加：
   ```typescript
   s.cooldownUntil = Date.now() + profile.cooldownMs;
   ```

**测试要点：**

AC-4 测试：
- `max=10, limit=6` → 429 → `limit=5`（固定 -1）
- `max=10, limit=2` → 429 → `limit=1`（固定 -1）
- `max=10, limit=1` → 429 → `limit=1`（ADAPTIVE_MIN 保底）

AC-6 测试：
- `max=10, limit=10` → 10 次密集 429 → `limit=9`（其余被冷却期拦截）

AC-8 测试：
- `max=10, limit=9, consecutiveSuccesses=4` → 冷却期内 5xx → `consecutiveSuccesses` 保持 4

5xx 冷却期测试：
- `max=10, limit=6` → 连续 `dropThreshold` 次 5xx → `limit=5` 且 `cooldownUntil > 0`

**删除的旧测试：**
- AC4 "does NOT enter cooldown on 5xx" — 行为已变，5xx 现在也进入冷却期
- AC5 "semaphore error" 中的 `keepRatio` 断言

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 写最小实现**
- [ ] **Step 4: 运行测试确认通过**
- [ ] **Step 5: Commit**

---

### Task 4: 满额时保留部分成功计数

**Type:** backend

**Depends on:** Task 3

**Files:**
- Modify: `router/src/core/concurrency/adaptive-controller.ts` — transitionSuccess() 爬升分支
- Test: `router/tests/adaptive-controller.test.ts`

**实现要点：**

`transitionSuccess()` 中爬升分支的条件重置：

```typescript
if (s.consecutiveSuccesses >= profile.climbThreshold) {
  const prevLimit = s.currentLimit;
  s.currentLimit = Math.min(s.currentLimit + 1, entry.max);
  // 满额时保留半数计数器，避免反复从 0 开始爬升
  if (s.currentLimit === entry.max) {
    s.consecutiveSuccesses = Math.floor(s.consecutiveSuccesses / 2);
  } else {
    s.consecutiveSuccesses = 0;
  }
  // ... 日志不变
  this.syncToSemaphore(providerId);
}
```

**测试要点：**

AC-5 测试：
- `max=10, limit=10, consecutiveSuccesses=5`（climbThreshold=5）→ 爬升分支触发但 limit 不变 → `consecutiveSuccesses=floor(5/2)=2`
- 后续 3 次成功（2+3=5 >= climbThreshold=5）→ 再次触发
- `max=10, limit=8, consecutiveSuccesses=4` → 爬升到 9 → `consecutiveSuccesses=0`（未满额，正常清零）

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 写最小实现**
- [ ] **Step 4: 运行测试确认通过**
- [ ] **Step 5: Commit**

---

### Task 5: 集成验证 — limit=1 恢复 + E2E 场景

**Type:** backend

**Depends on:** Task 4

**Files:**
- Modify: `router/tests/adaptive-controller.test.ts` — 新增集成场景测试

**实现要点：**

本 Task 只写测试，不改实现代码。验证整体 V3 行为：

AC-7 测试（limit=1 完全恢复）：
- `max=10, limit=1`，模拟 deriveProfile 参数推导每一步的 climbThreshold，喂入足够成功数
- 验证 `currentLimit` 经过 `1→2→3→4→5→6→7→8→9→10` 全路径
- 不使用 fake timer（冷却期不影响爬升）

E2E 场景测试（来自设计文档 E15）：
- `max=10, limit=10` → 1 次 429 → `limit=9, cd=T+20s`
- 冷却期内 5 次成功 → `limit=10`（验证冷却期不阻止爬升）

E2E 场景测试（来自设计文档 E18）：
- `5xx → success → 5xx → success → 5xx → 5xx` → 成功打断失败计数器重置 → 只有最后 2 次连续 5xx 算数 → 不够 dropThreshold(3)

- [ ] **Step 1: 写集成测试**
- [ ] **Step 2: 运行全部测试确认通过**
- [ ] **Step 3: Commit**

```bash
npx vitest run router/tests/adaptive-controller.test.ts
```

---

## Execution Groups

#### BG1: Adaptive Concurrency V3 Algorithm

**Description:** 自适应并发控制器的全部算法变更。5 个 Task 按 TDD 流程串行执行。

**Tasks:** Task 1, Task 2, Task 3, Task 4, Task 5

**Files (预估):** 3 个文件（1 modify types.ts + 1 modify controller + 1 modify test）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择（executor: high、tdd-coder: medium） |
| 注入上下文 | spec.md 全文 + plan.md Task 描述 + deriveProfile 公式 + CLAUDE.md 编码规范 |
| 读取文件 | `router/src/core/concurrency/adaptive-controller.ts`、`router/src/core/concurrency/types.ts`、`router/tests/adaptive-controller.test.ts` |
| 修改/创建文件 | 上述 3 个文件 |

**Execution Flow (BG1 内部):** 串行派遣，每个 Task 走完整 subagent 链后再开始下一个 Task。

  Task 1:
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写失败测试
    2. general-purpose (read xyz-harness-backend-dev) → 写实现代码
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

  Task 2 (depends on Task 1):
    1-3. 同上

  Task 3 (depends on Task 2):
    1-3. 同上

  Task 4 (depends on Task 3):
    1-3. 同上

  Task 5 (depends on Task 4):
    1. general-purpose (read xyz-harness-backend-dev) → 写集成测试
    2. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

**Dependencies:** 无

**设计细节:** 直接写在本 plan 中（L1 不拆子文档）

## Dependency Graph & Wave Schedule

```
Task 1 ──→ Task 2 ──→ Task 3 ──→ Task 4 ──→ Task 5
```

| Wave | Tasks | 说明 |
|------|-------|------|
| Wave 1 | Task 1 | 入口防护 + 类型清理（基础） |
| Wave 2 | Task 2 | 冷却期翻转 + 移除利用率门控 |
| Wave 3 | Task 3 | 429 固定 -1 + 5xx 冷却期 |
| Wave 4 | Task 4 | 满额保留半数计数 |
| Wave 5 | Task 5 | 集成验证 |
