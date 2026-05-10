# 自适应并发控制器优化

## 目标

重构 AdaptiveController，使用水位梯度参数 + 利用率门控替代固定参数 AIMD，解决 max ≤ 10 场景下的不稳定问题。

## 背景

当前控制器基于固定参数（连续 3 次成功 +1，连续 3 次失败 -2，429 减半），在 max ≤ 10 时存在：429 腰斩恢复慢、探针两阶段导致爬升慢、幽灵爬升（低负载时 limit 仍上升）、冷却期浪费成功计数。

## 方案

### 核心算法

两个影响因子驱动行为梯度：
- **capacity**（由 max 决定）：max 越小，整体越激进
- **level**（由 currentLimit / max）：越接近 max，越保守

参数推导函数：

```
level = currentLimit / max
capacity = min(1, log2(max) / 7)

climbThreshold = max(2, round(2 + capacity×2 + level×2))    // 2-6
dropThreshold  = max(1, round(5 - capacity×2 - level×2))    // 1-5
keepRatio      = currentLimit > 1 ? 1 - 1/currentLimit : 0.5  // 429 固定丢 1 格
cooldownMs     = round(10000 + level × 10000)                // 10-20s
climbStep      = 1
dropStep       = 1
```

### 利用率门控

安全区 = `currentLimit ≤ floor(max / 2)`：不需利用率证明即可爬升。
安全区外：必须 `limitReached=true`（有请求排过队）才允许爬升。

### 其他变更

- **去掉探针两阶段**：单阶段爬升，取消 `probeActive`
- **冷却期成功不累计**：保持当前行为
- **信号量超时/队列满**：按 429 同等处理（丢 1 格 + 冷却）

## 验收标准

### AC1: 参数推导
- deriveProfile(currentLimit, max) 返回 climbThreshold/dropThreshold/keepRatio/cooldownMs/climbStep/dropStep
- max=5, limit=1 时 climbThreshold=3, dropThreshold=4
- max=5, limit=5 时 climbThreshold=5, dropThreshold=2

### AC2: 429 处理
- 429 后丢 1 格（keepRatio = 1 - 1/currentLimit）
- limit=1 时 429 不再下降
- 进入冷却期（10-20s），冷却期成功不累计

### AC3: 利用率门控
- 安全区内（limit ≤ max/2）：连续成功达标即爬升
- 安全区外（limit > max/2）：limitReached=false 时连续成功达标不爬升，重置计数器（consecutiveSuccesses 和 limitReached 同时重置，重新积累证据）
- limitReached 通过 wasQueued 标记设置（orchestrator 用 wasEverQueued 局部变量捕获）

### AC4: 5xx 跌落
- 连续 dropThreshold 次失败后丢 1 格
- 不进入冷却期
- 成功时重置 consecutiveFailures

### AC5: 信号量超时/队列满
- orchestrator 对 SemaphoreTimeoutError/SemaphoreQueueFullError 传 `statusCode: 429` 给 adaptiveController
- controller 的 429 分支自然覆盖（丢 1 格 + 冷却）
- 网络错误（transport 层，statusCode=undefined）仍走 5xx 路径（连续失败退避），不受影响

### AC6: 去掉探针
- 无 probeActive 状态
- effectiveLimit = currentLimit（不再 +1）

### AC7: 现有测试全部通过
- adaptive-controller.test.ts 重写适配新逻辑
- proxy-semaphore.test.ts、retry-integration.test.ts 等不因重构失败

### AC8: 前端监控展示
- Monitor 页面 ConcurrencyPanel 仍正确显示 adaptiveLimit

## 数据流

### 变更字段

| 字段 | 变更 | 生产者 | 消费者 |
|---|---|---|---|
| AdaptiveState.probeActive | 移除 | AdaptiveController | syncToSemaphore |
| AdaptiveState.limitReached | 新增 | AdaptiveController.transitionSuccess | transitionSuccess 爬升决策 |
| AdaptiveResult.wasQueued | 新增 | orchestrator（用 wasEverQueued 捕获） | AdaptiveController.onRequestComplete |
| 信号量错误 statusCode | orchestrator 传入 429 | orchestrator catch 块 | AdaptiveController.transitionFailure |
| effectiveLimit 计算 | 简化为 currentLimit | AdaptiveController.syncToSemaphore | SemaphoreManager |

### 数据流图
```
orchestrator:
  onQueued 回调 → wasEverQueued = true（局部变量，不被 dequeue 重置）

  正常完成: onRequestComplete({ success, wasQueued: wasEverQueued })
  信号量错误: onRequestComplete({ success: false, statusCode: 429 })
  ProviderSwitchNeeded: onRequestComplete({ success: false, statusCode, retryRuleMatched: true })

AdaptiveController:
  transitionSuccess → 设置 limitReached (if wasQueued)
    → 检查 climbThreshold + safeZone/limitReached → 更新 currentLimit
  transitionFailure → 429 分支: 丢 1 格 + 冷却（覆盖信号量错误）
    → 5xx/undefined 分支: 连续失败退避（覆盖网络错误）
  syncToSemaphore(currentLimit) → SemaphoreManager.updateConfig
```

## 影响范围

| 文件 | 变更类型 |
|---|---|
| `router/src/core/concurrency/adaptive-controller.ts` | 重写 |
| `router/src/core/concurrency/types.ts` | 修改（AdaptiveState/AdaptiveResult） |
| `router/src/proxy/orchestration/orchestrator.ts` | 修改（传入 wasQueued） |
| `router/tests/adaptive-controller.test.ts` | 重写 |
| `docs/design/adaptive-concurrency.md` | 已创建 |
| `docs/design/adaptive-concurrency-research.md` | 已创建 |

## 不涉及

- 不改 SemaphoreManager
- 不改前端代码
- 不改 Admin API
- 不改 DB schema
- 不引入 EWMA 或延迟信号
