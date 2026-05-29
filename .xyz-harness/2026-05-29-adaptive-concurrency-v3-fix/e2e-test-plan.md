---
verdict: pass
---

# E2E Test Plan — adaptive-concurrency-v3-fix

## Test Scenarios

### TS-1: max=0 入口防护 (AC-1)
1. 创建 AdaptiveController，调用 `init("p1", { max: 0 }, ...)`
2. 验证 `currentLimit = 1`（不是 0 或 NaN）
3. 验证 `deriveProfile(1, 1)` 返回有效数值
4. 调用 `syncProvider` 传入 `max_concurrency=0`
5. 验证结果同上

### TS-2: 高水位无条件爬升 (AC-2)
1. `init("p1", { max: 10 })`，手动设置 `currentLimit=8`
2. 发送 5 次成功（无 wasQueued）
3. 验证 `currentLimit=9`

### TS-3: 冷却期双向行为 (AC-3)
1. `init("p1", { max: 10 })`，发送 429 → `limit=9`
2. 冷却期内发送 5 次成功 → `limit=10`（爬升不受限）
3. 冷却期内发送 429 → 不下降（拦截）

### TS-4: 固定步进下降 (AC-4, AC-6)
1. `init("p1", { max: 10 })`，`currentLimit=6`
2. 发送 429 → 验证 `limit=5`
3. 重置到 `limit=10`，发送 10 次密集 429
4. 验证 `limit=9`（冷却期保护）

### TS-5: 满额半数保留 (AC-5)
1. `init("p1", { max: 10 })`，累积 5 次成功
2. 验证 `consecutiveSuccesses=2`（不是 0）

### TS-6: limit=1 完全恢复 (AC-7)
1. `init("p1", { max: 10 })`，手动设置 `currentLimit=1`
2. 发送 36 次连续成功
3. 验证 `currentLimit=10`

### TS-7: 冷却期不重置成功计数 (AC-8)
1. `init("p1", { max: 10 })`，发送 429 进入冷却
2. 累积 4 次成功（`consecutiveSuccesses=4`）
3. 发送 5xx（冷却期内）
4. 验证 `consecutiveSuccesses` 仍为 4

### TS-8: 5xx 下降后进入冷却期 (FR-4 补充)
1. `init("p1", { max: 10 })`，`currentLimit=6`
2. 发送 `dropThreshold` 次连续 5xx
3. 验证 `currentLimit` 下降 1 格
4. 验证 `cooldownUntil > 0`（进入冷却期）

## Test Environment

- **框架**: Vitest（从 vitest 导入 describe/it/expect/vi），禁止 node:test
- **运行命令**: `npx vitest run router/tests/adaptive-controller.test.ts`
- **Mock**: `createMockSemaphore()` 提供信号量 mock
- **Timer**: 需要冷却期边界的测试使用 `vi.useFakeTimers()` + `vi.advanceTimersByTime()`
- **无需网络/DB**: 纯算法测试，无外部依赖
