## 评审记录 v1
- 评审时间: 2026-05-11
- 评审类型: 编码评审（阶段④）
- 评审对象: adaptive-controller.ts + orchestrator.ts + types.ts + errors.ts + request-tracker.ts
- 评审轮次: 第 1 轮

### AC 合规矩阵

| AC | 合规 | 备注 |
|----|------|------|
| AC1 | ✅ | deriveProfile 参数推导正确。max=5 limit=1 → climbThreshold=3 dropThreshold=4；max=5 limit=5 → climbThreshold=5 dropThreshold=2。所有测试值与 spec 一致。 |
| AC2 | ⚠️ | 429 丢 1 格逻辑正确（keepRatio 实现）；limit=1 时保持 1 不下降。冷却期生效。但冷却期内 consecutiveSuccesses 累积问题见 Issue #1。 |
| AC3 | ✅ | 安全区内外门控逻辑正确。安全区外 + limitReached=false 时正确重置计数器。limitReached 通过 wasQueued 设置、爬升周期后重置，均符合 spec。 |
| AC4 | ✅ | 5xx 连续失败 dropThreshold 次后丢 1 格。不进入冷却期。成功重置 consecutiveFailures。跌落后重置计数器。所有行为与 spec 一致。 |
| AC5 | ✅ | orchestrator 对 SemaphoreTimeoutError/SemaphoreQueueFullError 传 statusCode:429。controller 的 429 分支自然覆盖。网络错误（statusCode=undefined）走 5xx 路径，正确。 |
| AC6 | ✅ | probeActive 已完全移除。AdaptiveState 无 probeActive 字段。effectiveLimit = currentLimit（不再 +1）。init 同步 max 而非 max+1。 |
| AC7 | ✅ | adaptive-controller.test.ts 重写完成（50 tests passing）。proxy-semaphore.test.ts、retry-integration.test.ts、scope.test.ts 均通过。 |
| AC8 | ✅ | request-tracker.ts getConcurrency() 使用 adaptiveState?.currentLimit，移除 probeActive 后 currentLimit 即为实际并发上限。前端 ConcurrencyPanel.vue 无需修改。 |

### 发现的问题

| # | 优先级 | 文件 | 描述 | 建议 |
|---|--------|------|------|------|
| 1 | MUST FIX | `router/src/core/concurrency/adaptive-controller.ts` L128-130 | **冷却期 consecutiveSuccesses 累积违反 spec**。`transitionSuccess()` 先执行 `s.consecutiveSuccesses++`（L128），再检查冷却期 `if (Date.now() < s.cooldownUntil) return`（L130）。导致冷却期内的成功请求递增了 consecutiveSuccesses 但未重置。冷却期结束后，第一次成功就可能因累积的计数超过 climbThreshold 而立即触发爬升，违反 spec「冷却期成功不累计」的要求。测试 `cooldown ends: resumes normal climb from zero` 使用 fake timers 跳过冷却期，未覆盖此场景。 | 将 `s.consecutiveSuccesses++` 移到冷却期检查之后：先检查冷却期并 return，再递增 consecutiveSuccesses。或者冷却期 return 前不递增，仅在冷却期结束后才开始累计。 |
| 2 | LOW | `router/src/core/concurrency/adaptive-controller.ts` L149-156 | **syncToSemaphore 在未爬升时被调用**。当 `consecutiveSuccesses >= climbThreshold` 但 `!safeZone && !limitReached` 时，不会爬升，但仍调用 `syncToSemaphore()`。syncToSemaphore 调用 `semaphoreControl.updateConfig()`，产生不必要的信号量配置同步。虽然无害（值未变），但造成无谓开销。 | 在 `if (safeZone \|\| s.limitReached)` 分支内调用 syncToSemaphore，未爬升时跳过。或将 syncToSemaphore 移到实际修改 currentLimit 的分支中。 |

### 分析详情

#### Issue #1: 冷却期 consecutiveSuccesses 累积

**代码路径分析：**

```
transitionSuccess():
  L128: s.consecutiveSuccesses++          ← 先递增
  L129: s.consecutiveFailures = 0
  L130: if (Date.now() < s.cooldownUntil) return  ← 后检查冷却期
  ...
  L142: if (s.consecutiveSuccesses >= profile.climbThreshold) {
          // 爬升判断
```

**问题模拟：**

1. max=10, limit=5 → 429 → limit=4, cooldown 15s, consecutiveSuccesses=0（429 重置）
2. 冷却期内 20 次成功：consecutiveSuccesses=20（每次递增后 return）
3. 冷却期结束，第 1 次成功：consecutiveSuccesses=21 >= climbThreshold(4) → 立即爬升到 5

**Spec 预期：** 冷却期结束后应从 0 开始累计，需要 4 次连续成功才爬升。

**修复方案（最小改动）：**

```typescript
private transitionSuccess(...): void {
  const s = entry.state;
  s.consecutiveFailures = 0;

  // 冷却期内不累计成功
  if (Date.now() < s.cooldownUntil) return;

  s.consecutiveSuccesses++;  // 移到冷却期检查之后
  ...
}
```

**风险评估：** 此 bug 导致冷却期后爬升过快，削弱了 429 退避的效果。在安全区内影响最大（无需 limitReached 即可爬升），安全区外因 limitReached 门控而影响较小。

#### Issue #2: 不必要的 syncToSemaphore 调用

当达到 climbThreshold 但未通过利用率门控时，syncToSemaphore 仍被调用。updateConfig 会重新设置信号量配置，虽然值不变，但在高并发场景下可能产生不必要的开销。这是一个性能优化建议，不影响正确性。

### 数据流正确性验证

| 数据流 | 正确性 | 说明 |
|--------|--------|------|
| wasEverQueued 生命周期 | ✅ | 局部变量在 onQueued 回调中设为 true，闭包捕获，不被 dequeue 重置。正常完成/ProviderSwitchNeeded 路径都传入 wasQueued: wasEverQueued。 |
| 信号量错误 statusCode:429 | ✅ | orchestrator catch 块对 SemaphoreTimeoutError/SemaphoreQueueFullError 统一传 statusCode:429。controller 的 429 分支自然覆盖。 |
| limitReached 设置/重置 | ✅ | wasQueued=true 时设置 limitReached。爬升周期结束（无论是否实际爬升）后重置。429 路径不触及 limitReached。 |
| keepRatio 计算 | ✅ | currentLimit>1 时 keepRatio = 1-1/currentLimit，精确实现「丢 1 格」。currentLimit=1 时 keepRatio=0.5，floor(1*0.5)=0 被 clamp 到 ADAPTIVE_MIN=1。 |

### 架构合规

- ✅ 信号量/自适应控制器/追踪器分层清晰：AdaptiveController 通过 ISemaphoreControl 接口与 SemaphoreManager 解耦
- ✅ orchestrator 通过 AdaptiveResult 接口传递信号，不直接操作 AdaptiveController 内部状态
- ✅ request-tracker 通过 IAdaptiveStatus 接口查询状态，不依赖具体实现
- ✅ 移除了 `@llm-router/core` 包依赖，代码归入 `router/src/core/`，减少跨包复杂度
- ✅ probeActive 完全移除，无残留引用

### 潜在 Bug 检查

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 并发安全 | ✅ | 所有 Map 和 state 操作都是同步的，Node.js 单线程事件循环保证不交错 |
| 冷却期边界 | ✅ | `Date.now() < cooldownUntil` 排除边界（冷却期精确到 ms 级足够） |
| keepRatio limit=1 | ✅ | floor(1*0.5)=0 被 max(_, 1) 限制，不降为 0 |
| max ceiling | ✅ | 爬升时 min(currentLimit+1, max)，不会超过 max |
| unknown provider | ✅ | onRequestComplete 对未知 provider 静默忽略 |

### 结论

**需修改后重审**。存在 1 条 MUST FIX：冷却期内 consecutiveSuccesses 累积违反 spec「冷却期成功不累计」的要求，导致冷却期后可能立即爬升而非从零开始累计。修复方式简单（将递增操作移到冷却期检查之后），但对 429 退避效果影响较大，需修正。

