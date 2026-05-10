# 实现计划

## Task 1: 更新类型定义

**文件**: `router/src/core/concurrency/types.ts`

**变更**:
- AdaptiveState: 移除 `probeActive`，新增 `limitReached: boolean`
- AdaptiveResult: 新增 `wasQueued?: boolean`

**验证**: tsc 编译通过

---

## Task 2: 重写 AdaptiveController

**文件**: `router/src/core/concurrency/adaptive-controller.ts`

**变更**:
- 新增 `deriveProfile()` 私有方法
- `init()`: 初始化 `limitReached=false`，不再初始化 `probeActive`
- `transitionSuccess()`:
  - 冷却期内 return（不累计成功）
  - 设置 `limitReached`（if wasQueued）
  - 爬升时检查 safeZone/limitReached
  - 重置时同时重置 limitReached
  - 调用 deriveProfile 获取参数
- `transitionFailure()`:
  - 429: keepRatio = 1 - 1/currentLimit, 丢 1 格
  - 5xx: deriveProfile 获取 dropThreshold, 连续失败达标丢 1 格
  - 信号量超时/队列满(statusCode=undefined, !retryRuleMatched): 按 429 同等处理
- `syncToSemaphore()`: effectiveLimit = currentLimit（移除 probeActive 判断）
- 移除所有 `probeActive` 相关逻辑

**验证**: 现有测试先重写（Task 3），然后通过

---

## Task 3: 重写 adaptive-controller.test.ts

**文件**: `router/tests/adaptive-controller.test.ts`

**变更**:
- 移除所有 probeActive 相关测试
- 新增 deriveProfile 参数验证测试（各 max/limit 组合）
- 新增利用率门控测试（安全区内/外，limitReached true/false）
- 新增 429 丢 1 格测试（各 currentLimit）
- 新增信号量超时按 429 处理测试
- 新增 5xx 跌落测试（dropThreshold 随 level 变化）
- 新增冷却期行为测试
- 新增 remove/syncProvider 兼容测试

**验证**: `npx vitest run router/tests/adaptive-controller.test.ts` 全部通过

---

## Task 4: 更新 orchestrator 信号传递

**文件**: `router/src/proxy/orchestration/orchestrator.ts`

**变更**:
- 在 `withSlot` 回调中引入 `wasEverQueued` 局部变量：onQueued 时设为 true
- 正常完成路径：`onRequestComplete({ ..., wasQueued: wasEverQueued })`
- 信号量错误 catch 块：`onRequestComplete({ success: false, statusCode: 429, requestId: config.trackerId })` — 复用 429 语义
- ProviderSwitchNeeded catch 块和成功路径：传入 `wasQueued: wasEverQueued`
- 注意：`trackerReq.queued` 不可直接用作 `wasQueued`，因为 dequeue 回调会重置它

**验证**: tsc 编译通过 + 现有集成测试通过

---

## Task 5: 验证 monitor 展示

**文件**: `router/src/core/monitor/request-tracker.ts`（可能无需修改）

**验证**:
- 当前 `getConcurrency()` 已使用 `adaptiveState?.currentLimit`
- 移除 probeActive 后 currentLimit 即为实际生效的并发上限
- 确认 adaptiveLimit 与 semaphore 实际配置一致

**如果无需修改**：合并到 Task 6。

---

## Task 6: 验证全量测试

**验证命令**:
- `cd router && npx vitest run`
- `cd router && npm run lint`
- `cd router && npx tsc --noEmit`

确保所有测试通过，无 lint 错误，类型检查通过。

---

## 依赖关系

```
Task 1 (类型) → {Task 2 (controller), Task 4 (orchestrator)}（可并行）→ Task 3 (测试) → Task 5 (验证 monitor) → Task 6 (全量验证)
```
