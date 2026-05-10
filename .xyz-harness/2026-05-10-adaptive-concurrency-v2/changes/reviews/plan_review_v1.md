## 评审记录 v1
- 评审时间: 2026-05-10
- 评审类型: 计划评审
- 评审对象: spec.md + plan.md

### 发现的问题

| # | 优先级 | 文件 | 描述 | 建议 |
|---|--------|------|------|------|
| 1 | MUST FIX | spec.md 数据流 + plan.md Task 4 | **`wasQueued` 数据源错误**。Plan Task 4 写 "wasQueued: trackerReq.queued"，但 `trackerReq.queued` 在请求完成时始终为 `false`。原因是 orchestrator 中 dequeue 回调会将 `trackerReq.queued` 置为 `false`（line 109），而 `onRequestComplete` 在请求执行完毕后才调用。因此 `trackerReq.queued` 无法提供"是否曾经排队"的信号。 | 在 orchestrator 中引入局部变量 `wasEverQueued`，在 onQueued 回调中设为 `true`，传入 `onRequestComplete({ wasQueued: wasEverQueued })`。 |
| 2 | MUST FIX | spec.md 数据流 + plan.md Task 2 | **无法区分信号量超时/队列满与网络错误**。两者在 `AdaptiveResult` 中都是 `{ success: false, statusCode: undefined }`。但 spec AC5 要求信号量错误按 429 处理（立即丢 1 格 + 冷却），而设计文档明确网络错误应走 5xx 路径（连续失败才跌落）。当前 `AdaptiveResult` 新增的 `wasQueued` 字段无法区分这两类错误。 | 方案 A（推荐）：orchestrator 对信号量错误传入 `statusCode: 429`，复用现有 429 分支，无需新增字段。方案 B：在 `AdaptiveResult` 新增 `semaphoreError?: boolean`。方案 A 更简洁，且信号量错误在语义上确实等同于"上游说并发太高"。 |
| 3 | MUST FIX | plan.md Task 2 | **信号量错误分类条件会导致网络错误被误判**。Task 2 写 "statusCode=undefined, !retryRuleMatched: 按 429 同等处理"，但网络错误（transport 层连接失败/超时）也满足此条件，会导致所有网络错误都触发立即丢格 + 冷却，与设计文档"网络错误走 5xx 路径"矛盾，且是行为倒退（当前网络错误需连续 3 次才退避）。 | 采用 #2 的方案 A 后，信号量错误在 orchestrator 层已转为 `statusCode: 429`，controller 中不需要特殊判断 `statusCode=undefined` 的来源。`transitionFailure` 中 `statusCode=undefined` 统一走 5xx 路径（连续失败退避）。 |
| 4 | LOW | plan.md Task 5 | **Task 5 可能不需要代码变更**。当前 `request-tracker.ts:296` 已经使用 `adaptiveState?.currentLimit`（而非 `effectiveLimit`）。移除 `probeActive` 后，`currentLimit` 即为实际生效的并发上限，monitor 展示自动正确。Task 5 的描述"改用 adaptiveState.currentLimit"暗示需要代码变更，但实际无需修改。 | 将 Task 5 改为验证任务："验证移除 probeActive 后 monitor 展示正确（adaptiveLimit 与 semaphore 实际配置一致）"，或直接合并到 Task 6。 |
| 5 | LOW | spec.md AC7 | **AC7 提到的 `proxy-semaphore.test.ts` 存在但与自适应控制器无耦合**。该测试文件仅 `container.register("adaptiveController", () => undefined)` 注入空值。重构不会影响它通过。AC7 列举该文件容易误导，暗示需要适配此文件。 | AC7 改为："adaptive-controller.test.ts 重写适配新逻辑；其他测试文件（proxy-semaphore.test.ts、retry-integration.test.ts 等）因 adaptiveController 接口签名不变，无需修改"。 |
| 6 | LOW | plan.md | **Task 间依赖关系未显式声明**。Task 1→2→3 是顺序依赖，Task 4 可与 Task 2 并行，但 plan 没有说明。对 subagent 拆分执行会造成困惑。 | 在 plan 开头增加依赖关系说明：`Task 1 → {Task 2, Task 4}（可并行）→ Task 3 → Task 5 → Task 6`。 |
| 7 | LOW | spec.md 影响范围 | **spec 未提及 `router/src/core/concurrency/index.ts` 和 `router/src/core/index.ts`**。虽然这两个文件只是 re-export 类型，不需要代码变更，但作为类型签名的传播路径，应在影响范围中提及并注明"无需变更"。 | 在影响范围表中补充这两个文件，标记为"无需变更（re-export 类型自适应）"。 |
| 8 | INFO | docs/design/adaptive-concurrency.md 行为表 | max=10, limit=5 标注为"安全区边界"而非"无（安全区）"。`5 ≤ floor(10/2) = 5` 满足安全区条件，但标签"安全区边界"容易理解为需要 limitReached。 | 改为"无（安全区）"或加注释 `5 ≤ 5` 保持一致性。 |
| 9 | INFO | spec.md AC3 | **AC3 对 `limitReached` 的重置时机描述不够精确**。spec 说"limitReached 通过 wasQueued 标记设置"，但未说明重置时机。设计文档中爬升后 `limitReached` 被重置为 `false`（无论是否实际爬升），但如果利用率门控阻止了爬升，`limitReached` 和 `consecutiveSuccesses` 的重置行为需要明确。 | AC3 补充：当 consecutiveSuccesses 达到 climbThreshold 但利用率门控阻止爬升时，consecutiveSuccesses 和 limitReached 是否重置？建议按设计文档实现：无论是否爬升，都重置（重新积累证据）。 |

### 详细分析

#### MUST FIX #1: wasQueued 数据源

追踪 orchestrator 执行流程：

```
1. semaphoreScope.withSlot(providerId, signal,
     onQueued: () => { trackerReq.queued = true },     // 入队
     onDequeue: () => { trackerReq.queued = false },    // 出队
     fn: () => executeResilience(...)                    // 执行
   )
2. 请求完成后：onRequestComplete({ ..., wasQueued: trackerReq.queued })
```

问题：步骤 2 中 `trackerReq.queued` 始终为 `false`，因为出队回调（步骤 1 的 onDequeue）在执行 `fn` 前已将其设为 `false`。

对于信号量超时/队列满的场景：
- `SemaphoreQueueFullError`：请求从未入队，`trackerReq.queued = false`
- `SemaphoreTimeoutError`：请求在队列中等待超时，`trackerReq.queued = true`（未被 dequeue）

所以 `trackerReq.queued` 仅在超时场景可能为 `true`，但正常完成路径始终为 `false`。

修复方案：在 orchestrator 中引入 `wasEverQueued` 局部变量。

#### MUST FIX #2+#3: 信号量错误 vs 网络错误

当前 `AdaptiveResult` 无法区分两类 `statusCode=undefined` 的失败：

| 场景 | statusCode | 来源 | 期望行为 |
|------|-----------|------|---------|
| 信号量超时 | undefined | orchestrator catch (SemaphoreTimeoutError) | 429-like（立即丢 1 格 + 冷却） |
| 队列满 | undefined | orchestrator catch (SemaphoreQueueFullError) | 429-like（立即丢 1 格 + 冷却） |
| 网络错误 | undefined | resilience 层 transport 失败 | 5xx-like（连续失败退避） |

推荐方案 A：orchestrator 对信号量错误传 `statusCode: 429`：

```typescript
// orchestrator catch 块
} else if (e instanceof SemaphoreTimeoutError || e instanceof SemaphoreQueueFullError) {
  this.deps.adaptiveController?.onRequestComplete(providerId, {
    success: false,
    statusCode: 429,  // 语义：并发超了
    requestId: config.trackerId,
  });
}
```

这样 controller 的 `transitionFailure` 不需要新增任何分支，现有 429 逻辑自然覆盖。

### AC 覆盖矩阵

| AC | Plan 覆盖 | 备注 |
|----|----------|------|
| AC1: 参数推导 | Task 2 (deriveProfile) + Task 3 (参数验证测试) | 覆盖 |
| AC2: 429 处理 | Task 2 (transitionFailure) + Task 3 (429 测试) | 覆盖 |
| AC3: 利用率门控 | Task 2 (transitionSuccess safeZone) + Task 3 (门控测试) | 覆盖，但 wasQueued 数据源需修复 |
| AC4: 5xx 跌落 | Task 2 (transitionFailure) + Task 3 (5xx 测试) | 覆盖 |
| AC5: 信号量超时/队列满 | Task 2 提到但分类逻辑有误 + Task 3 (信号量测试) | **需修复**：与网络错误无法区分 |
| AC6: 去掉探针 | Task 2 (移除 probeActive) | 覆盖 |
| AC7: 现有测试通过 | Task 3 (重写) + Task 6 (全量验证) | 覆盖 |
| AC8: 前端监控展示 | Task 5 | 覆盖（可能不需要代码变更） |

### 结论

**需修改后重审**。

3 个 MUST FIX 问题均集中在**信号传递**层面：
1. `wasQueued` 的数据源在正常完成路径上恒为 `false`，需要引入 `wasEverQueued` 中间变量
2. 信号量错误与网络错误无法通过现有 `AdaptiveResult` 区分
3. Task 2 的分类条件会将网络错误误判为 429

三个问题相互关联，核心修复点是：在 orchestrator 层为信号量错误传入 `statusCode: 429`，同时引入 `wasEverQueued` 变量传入 `wasQueued`。修复后 controller 不需要新增分支或字段。

建议修改 spec 数据流表和 plan Task 2/Task 4 后重新提交评审。
