# 自适应并发控制器设计

## 背景

LLM API 代理路由器的自适应并发控制器需要解决的核心问题：在不知道上游 API 真实承载能力的情况下，动态调整并发上限，最大化利用并发度的同时，遇错快速稳定到安全值。

### 场景特征

| 特征 | 值 | 影响 |
|---|---|---|
| 典型 max | ≤ 10 | 每个槽位占总容量 10-33%，丢失一个影响很大 |
| 可用信号 | 成功/失败（429、5xx、网络错误） | 无法使用延迟信号（LLM 推理时间 0.5s-120s，波动不可预测） |
| 流量模式 | 突发性高 | 没有稳定的 QPS 基线 |
| 上游透明度 | 不透明 | 无法探测上游真实容量 |

### 现有控制器的问题

现有实现基于固定参数 AIMD（连续 3 次成功 +1，连续 3 次失败 -2，429 减半），在 max ≤ 10 时存在以下缺陷：

1. **爬升/跌落不对称**：429 瞬间腰斩，恢复需要 6×N 次连续成功
2. **探测两阶段**：开探针 + 确认，每次爬升需要 2×threshold 次成功
3. **冷却期浪费**：30s 冷却内成功全部丢弃
4. **幽灵爬升**：实际并发低时 limit 仍持续上升，突发流量时瞬间过载
5. **固定参数**：不随 max 或当前位置调整行为

---

## 算法设计

### 核心思路

两个影响因子驱动行为梯度：

- **capacity**（由 max 决定）：max 越小，整体行为越激进（容易爬升、不容易跌落）
- **level**（由当前位置决定）：越接近 max，行为越保守（难爬升、易跌落）

### 参数推导函数

```typescript
function deriveProfile(currentLimit: number, max: number) {
  const level = currentLimit / max;                              // 0..1
  const capacity = Math.min(1, Math.log2(max) / 7);             // max=3→0.23, max=10→0.47

  return {
    climbThreshold: Math.max(2, Math.round(2 + capacity * 2 + level * 2)),
    dropThreshold:  Math.max(1, Math.round(5 - capacity * 2 - level * 2)),
    keepRatio:      currentLimit > 1 ? 1 - 1 / currentLimit : 0.5,
    cooldownMs:     Math.round(10_000 + level * 10_000),
    climbStep:      1,
    dropStep:       1,
  };
}
```

### 各参数含义

| 参数 | 公式 | 范围 | 说明 |
|---|---|---|---|
| climbThreshold | `round(2 + capacity×2 + level×2)` | 2-6 | 连续成功几次才爬升 |
| dropThreshold | `round(5 - capacity×2 - level×2)` | 1-5 | 连续失败几次才跌落 |
| keepRatio | `1 - 1/currentLimit` | 0.5-0.9 | 429 后保留比例（固定丢 1 格） |
| cooldownMs | `round(10000 + level×10000)` | 10s-20s | 429 后冷却时间 |
| climbStep | 固定 1 | 1 | 每次爬升量（max ≤ 20 时恒为 1） |
| dropStep | 固定 1 | 1 | 每次跌落量（max ≤ 20 时恒为 1） |

### 利用率门控

防止"幽灵爬升"——实际并发低时 limit 不应上升。

**安全区**：`currentLimit ≤ floor(max / 2)` 时，不需要利用率证明即可爬升（离上限远，风险小）。

**安全区外**：`currentLimit > floor(max / 2)` 时，必须证明当前 limit 被实际用满（`limitReached = true`）才允许爬升。

```typescript
// 爬升决策
if (consecutiveSuccesses >= climbThreshold) {
  const safeZone = currentLimit <= Math.floor(max / 2);
  if (safeZone || limitReached) {
    currentLimit = Math.min(currentLimit + 1, max);
  }
  // 无论是否爬升，重置计数周期
  consecutiveSuccesses = 0;
  limitReached = false;
}
```

`limitReached` 通过请求是否排过队来判断：信号量的 `acquire()` 在 `current >= maxConcurrency` 时会将请求放入等待队列。orchestrator 在回调时传入 `wasQueued` 标记。

### 429 处理

429 是最明确的"并发超了"信号，处理策略：

- 固定丢失 1 个槽位（`keepRatio = 1 - 1/currentLimit`）
- 进入冷却期（10-20s，取决于 level）
- 冷却期内成功不累计（从零开始计数）
- 重置 `consecutiveFailures`（429 已经处理了退避，不需要再叠加 5xx 退避）

### 5xx / 网络错误处理

- 需要连续 `dropThreshold` 次失败才触发退避
- 每次退避丢 1 格（`dropStep = 1`）
- 不进入冷却期（5xx 可能是瞬时问题，不需要冷却）
- 4xx 客户端错误不触发退避（除非 `retryRuleMatched = true`）

### 信号量超时/队列满

直接按 429 同等处理（丢 1 格 + 冷却），因为队列满是比 429 更明确的"并发超了"信号。

### 去掉探针两阶段

当前控制器的爬升需要：开探针（3 次成功）→ 确认（3 次成功）= 6 次成功才 +1。

新设计：单阶段，`climbThreshold` 次成功直接 +1。取消 `probeActive` 状态。

---

## 行为表

### max=3

| limit | level | 爬升门槛 | 跌落门槛 | 429→ | 冷却 | 爬升额外条件 |
|---|---|---|---|---|---|---|
| 1 | 0.33 | 3 | 4 | stay 1 | 13s | 无（安全区） |
| 2 | 0.67 | 4 | 3 | → 1 | 17s | 需 limitReached |
| 3 | 1.00 | 4 | 3 | → 2 | 20s | 需 limitReached |

### max=5

| limit | level | 爬升门槛 | 跌落门槛 | 429→ | 冷却 | 爬升额外条件 |
|---|---|---|---|---|---|---|
| 1 | 0.20 | 3 | 4 | stay 1 | 12s | 无（安全区） |
| 2 | 0.40 | 3 | 4 | → 1 | 14s | 无（安全区） |
| 3 | 0.60 | 4 | 3 | → 2 | 16s | 需 limitReached |
| 4 | 0.80 | 4 | 3 | → 3 | 18s | 需 limitReached |
| 5 | 1.00 | 5 | 2 | → 4 | 20s | 需 limitReached |

### max=10

| limit | level | 爬升门槛 | 跌落门槛 | 429→ | 冷却 | 爬升额外条件 |
|---|---|---|---|---|---|---|
| 1 | 0.10 | 3 | 4 | stay 1 | 11s | 无（安全区） |
| 3 | 0.30 | 3 | 4 | → 2 | 13s | 无（安全区） |
| 5 | 0.50 | 4 | 3 | → 4 | 15s | 安全区边界 |
| 7 | 0.70 | 4 | 3 | → 6 | 17s | 需 limitReached |
| 10 | 1.00 | 5 | 2 | → 9 | 20s | 需 limitReached |

---

## 恢复场景对比

### max=5，运行在 limit=5，收到 429，之后全部成功

| | 当前控制器 | 新设计 |
|---|---|---|
| 429 后 | 5→**2**（腰斩） | 5→**4**（丢 1） |
| 冷却 | 30s，成功丢弃 | 20s，成功不累计 |
| 恢复机制 | 开探针(3次)+确认(3次)×3轮 | 直升，每级 4-5 次成功 |
| 恢复到 5 | **~30s + 18次连续成功** | **~20s + 5次成功** |

### max=5，limit=5，实际并发=2，全部成功

| | 当前控制器 | 新设计 |
|---|---|---|
| 行为 | 连续成功 → limit 持续上升到 5→6→... | 安全区外 + limitReached=false → **不爬升** |
| 突发流量 | 瞬间 6 并发全放行 → 可能过载 | limit 维持在实际并发水平 → 渐进式探测 |

---

## 实现要点

### AdaptiveState 变更

```typescript
interface AdaptiveState {
  currentLimit: number;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  cooldownUntil: number;
  limitReached: boolean;   // 本计数周期内，limit 是否被实际触及
}
```

### AdaptiveResult 变更

```typescript
interface AdaptiveResult {
  success: boolean;
  statusCode?: number;
  retryRuleMatched?: boolean;
  requestId?: string;
  wasQueued?: boolean;     // 这个请求是否排过队（利用率信号）
}
```

### 移除

- `probeActive` 字段（取消探针两阶段）
- `syncToSemaphore` 中的 effectiveLimit 计算（直接用 `currentLimit`）

### 新增

- `deriveProfile()` 函数：根据 `currentLimit` 和 `max` 计算当前参数
- 利用率门控：`limitReached` 在 `transitionSuccess` 中设置和检查
- 信号量超时/队列满：按 429 同等处理
