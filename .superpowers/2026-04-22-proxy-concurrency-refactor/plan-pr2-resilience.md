# PR-2: ResilienceLayer 重构 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**目标:** 新建 `src/proxy/resilience.ts`，统一 retry + failover 决策引擎。

**前置条件:** PR-1 已完成，`src/proxy/types.ts` 含 `TransportResult` 类型。

**Spec:** `.superpowers/2026-04-22-proxy-concurrency-refactor/spec.md`

**子文档:**
- [测试代码](./plan-pr2-tests.md) - `tests/resilience.test.ts` 完整测试用例
- [实现代码](./plan-pr2-impl.md) - `src/proxy/resilience.ts` 完整实现

---

## 现有逻辑迁移映射

| 行为 | 现有位置 | 迁移到 |
|------|---------|--------|
| `FixedIntervalStrategy` / `ExponentialBackoffStrategy` | `retry.ts:35-52` | `resilience.ts` |
| `isRetryableThrow()` | `retry.ts:77-82` | `resilience.ts` decide() |
| `parseRetryAfter()` | `retry.ts:91-96` | `resilience.ts` decide() |
| `retryableCall()` 循环 | `retry.ts:108-165` | `resilience.ts` execute() |
| failover while(true) + excludeTargets | `proxy-core.ts:155-431` | `resilience.ts` execute() |

**保留不变:** `RetryRuleMatcher`（`retry-rules.ts`），`RetryRule`（`src/db/retry-rules.ts`）

---

## 核心类型（在 `resilience.ts` 中定义）

```typescript
interface ResilienceConfig {
  maxRetries: number; baseDelayMs: number; failoverThreshold: number;
  ruleMatcher?: RetryRuleMatcher; isFailover: boolean;
}
interface ResilienceAttempt {
  target: Target; attemptIndex: number; statusCode: number | null;
  error: string | null; latencyMs: number; responseBody: string | null;
}
interface ResilienceResult {
  result: TransportResult; attempts: ResilienceAttempt[]; excludedTargets: Target[];
}
type ResilienceDecision =
  | { action: "done" }
  | { action: "retry"; delayMs: number }
  | { action: "failover"; excludeTarget: Target }
  | { action: "abort"; reason: string };
interface ResilienceState {
  attemptCount: number; currentTarget: Target; excludedTargets: Target[];
}
```

---

## 关键设计决策

1. **PR-2 不删除 retry.ts，不修改 handleProxyPost**。PR-2 只提供可独立使用的 ResilienceLayer。`retry.ts` 和 `while(true)` 的替换由 PR-3 完成。

2. **attemptCount 追踪使用 per-target Map**。failover 切换 target 后自动重置，新 target 从 0 开始。

3. **decide() 不知道 targets 列表**。failover 决策始终返回 `{ action: "failover" }`，由 execute() 检查可用 target。

4. **所有测试使用 vi.fn mock**。不启动真实 HTTP 服务器，不依赖数据库。

---

## 实现步骤

### Phase 1: 测试先行 (TDD)

#### Step 1.1: 创建测试文件骨架
- [ ] 创建 `tests/resilience.test.ts`
- [ ] 定义辅助函数：`makeSuccess`, `makeStreamAbort`, `makeStreamError`, `makeError`, `makeThrow`, `defaultConfig`, `failoverConfig`, `createMatcherWithDefaults`
- [ ] 验证: 文件创建无语法错误

#### Step 1.2: 编写 decide() 单元测试
- [ ] 14 个测试用例覆盖 5 条优先级决策路径（完整代码见 [测试代码子文档](./plan-pr2-tests.md)）
- [ ] 验证: 测试文件无语法错误

#### Step 1.3: 编写 execute() 集成测试
- [ ] 12 个测试用例覆盖 retry/failover 循环（完整代码见 [测试代码子文档](./plan-pr2-tests.md)）
- [ ] 验证: 测试文件无语法错误

#### Step 1.4: 编写策略类测试
- [ ] 3 个测试用例从 `retry.test.ts` 迁移（`FixedIntervalStrategy`, `ExponentialBackoffStrategy`, `createStrategy`）
- [ ] 验证: 测试文件完整

### Phase 2: 实现 ResilienceLayer

#### Step 2.1: 创建 resilience.ts 类型 + 策略类
- [ ] 创建 `src/proxy/resilience.ts`
- [ ] 迁移 `RetryStrategy`、`FixedIntervalStrategy`、`ExponentialBackoffStrategy`、`createStrategy`
- [ ] 定义所有 Resilience 类型
- [ ] 验证: `npx tsc --noEmit` 通过

#### Step 2.2: 实现 decide() 方法
- [ ] 实现按 5 条优先级顺序的决策逻辑（完整代码见 [实现代码子文档](./plan-pr2-impl.md)）
- [ ] 验证: `npx vitest run tests/resilience.test.ts` decide 测试通过

#### Step 2.3: 实现 execute() 方法
- [ ] 实现循环逻辑：懒加载 targets、调用 fn、捕获异常、记录 attempt、调用 decide()
- [ ] 验证: `npx vitest run tests/resilience.test.ts` execute 测试通过

#### Step 2.4: 修复 attemptCount 计算
- [ ] 用 per-target Map 替换简单计数
- [ ] 验证: failover+retry 组合测试通过

### Phase 3: 适配 proxy-logging.ts

#### Step 3.1: 更新类型导入
- [ ] `proxy-logging.ts` 导入从 `retry.ts` 的 `Attempt` 改为 `resilience.ts` 的 `ResilienceAttempt`
- [ ] 字段完全兼容（只多一个 `target` 字段）
- [ ] 验证: `npx tsc --noEmit` 通过

#### Step 3.2: 验证兼容性
- [ ] 运行 `npx vitest run tests/failover-log-grouping.test.ts`

### Phase 4: 确认 scope

- [ ] 确认不修改 `proxy-core.ts`（PR-3 负责）
- [ ] 确认不删除 `retry.ts`（PR-3 负责）

### Phase 5: 清理 + 提交

- [ ] `npx vitest run` 全量通过
- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run lint` 通过
- [ ] 创建分支 `refactor/resilience-layer`，提交并推送

---

## 耗时估算

| Phase | 文件 | 耗时 |
|-------|------|------|
| 1. TDD | `tests/resilience.test.ts` | 15 min |
| 2. 实现 | `src/proxy/resilience.ts` | 16 min |
| 3. 适配 | `src/proxy/proxy-logging.ts` | 4 min |
| 4. 确认 | - | 2 min |
| 5. 清理 | 全量验证 + PR | 7 min |
| **Total** | | **~44 min** |

## PR 间依赖

```
PR-1 (TransportLayer) → PR-2 (ResilienceLayer) → PR-3 (Orchestrator)
                          ↑
                     本 PR
```
