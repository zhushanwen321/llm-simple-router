---
verdict: pass
---

# Use Cases — adaptive-concurrency-v3-fix

## UC-1: Provider 并发度自动恢复

- **Actor**: 运维监控系统
- **Preconditions**: Provider 已启用自适应并发，当前 limit < max（因之前的 429/5xx 下降）
- **Main Flow**:
  1. 上游 API 恢复正常，连续返回成功响应
  2. AdaptiveController 累积 consecutiveSuccesses
  3. 达到 climbThreshold 时 limit +1
  4. 重复步骤 2-3 直到 limit 回到 max
- **Alternative Paths**:
  - 恢复过程中再次收到 429 → 冷却期保护，最多降 1 格
  - 恢复过程中收到 5xx → 冷却期拦截（如果还在冷却期内）
- **Postconditions**: limit 恢复到 max，无人工干预
- **Module Boundaries**: AdaptiveController.onRequestComplete(success=true) → transitionSuccess()
- **AC 覆盖**: AC-7（完全恢复）, AC-3（冷却期不阻止爬升）

## UC-2: 新 Provider 无需手动配置并发

- **Actor**: 部署脚本
- **Preconditions**: 新增 Provider，DB 中 `max_concurrency=0`（PROVIDER_CONCURRENCY_DEFAULTS）
- **Main Flow**:
  1. 系统启动或 syncProvider 被调用，传入 `max_concurrency=0`
  2. AdaptiveController 将 max 钳制为 1
  3. deriveProfile(1, 1) 返回有效参数
  4. Provider 以 limit=1 开始服务
  5. 随着成功累积，limit 逐步爬升
- **Alternative Paths**:
  - 如果首次请求就失败 → limit 保持 1（ADAPTIVE_MIN 保底）
- **Postconditions**: Provider 正常工作，无 NaN 错误
- **Module Boundaries**: AdaptiveController.init() / syncProvider() → Math.max(max, 1)
- **AC 覆盖**: AC-1（max=0 防护）

## UC-3: 灾难性故障自动降级

- **Actor**: LLM 代理路由器
- **Preconditions**: 上游持续返回 5xx 或网络错误
- **Main Flow**:
  1. AdaptiveController 收到连续 5xx 失败
  2. consecutiveFailures 达到 dropThreshold → limit -1
  3. 触发冷却期（10-20s）
  4. 冷却期内所有失败被拦截
  5. 冷却期结束后，如果仍然失败 → 再次 limit -1
  6. 重复直到 limit=1（ADAPTIVE_MIN）
- **Alternative Paths**:
  - 上游在 limit=1 时恢复 → 36 次成功后恢复到 max（UC-1）
  - 收到 429 → 立即 -1 + 冷却期（无需等待 consecutiveFailures）
- **Postconditions**: limit 逐步降到 1，每 10-20s 降 1 格，不会到 0
- **Module Boundaries**: AdaptiveController.transitionFailure() → 冷却期前置拦截
- **AC 覆盖**: AC-6（密集攻击只降 1 格）, AC-8（冷却期不重置成功计数）, AC-4（固定 -1）

## UC-Spec AC 覆盖映射

| UC | AC 覆盖 |
|----|---------|
| UC-1 | AC-3, AC-7 |
| UC-2 | AC-1 |
| UC-3 | AC-4, AC-6, AC-8 |
| (无 UC) | AC-2, AC-5 — 纯算法行为，不独立构成业务用例 |
