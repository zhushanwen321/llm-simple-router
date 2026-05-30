---
verdict: pass
---

# Adaptive Concurrency V3 — 修复并发度降至零且永不恢复

## Background

自适应并发控制器 V2 存在三个架构级缺陷，导致 provider 并发度快速降至 0/1 后永久无法恢复：

1. **max=0 输入无防护**：`PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency = 0` 导致 `init({max:0})` → `deriveProfile(0,0)` 产出 NaN 阈值，状态机冻结
2. **冷却期语义倒置**：冷却期阻止成功累积（恢复通道），不阻止失败累积（下降通道），短时间内连续 429 造成指数坍缩
3. **利用率门控死锁**：`currentLimit > max/2` 时需 `limitReached=true`（请求曾排队）才允许爬升，低并发时无人排队，永久锁死在 max/2 以上

V2 中 429 坍缩 10→1 最快约 1.8s。V3 通过冷却期语义翻转 + 固定步进下降，将此值提升到 ~200s（慢 100 倍），同时消除所有死锁区。

完整的设计分析和 20+ 极端场景模拟见 `docs/design/adaptive-concurrency-v3.md`。

## Functional Requirements

### FR-1: max 输入防护

`init()` 和 `syncProvider()` 入口必须将 `max_concurrency` 钳制到 `≥ 1`，防止 NaN 污染 deriveProfile 计算。

- `init()`: `config.max = Math.max(config.max, 1)` 在 set entry 之前
- `syncProvider()`: `p.max_concurrency = Math.max(p.max_concurrency, 1)` 在 update entry 之前

### FR-2: 移除利用率门控

删除 `transitionSuccess()` 中的 `safeZone` / `limitReached` 判断。所有水位（1 到 max）均可无条件爬升。

- 删除 `AdaptiveState.limitReached` 字段
- 删除 `SAFE_ZONE_DIVISOR` 常量
- 删除 `transitionSuccess()` 中 `wasQueued` 相关逻辑

### FR-3: 冷却期语义翻转

冷却期从"阻止成功累积"改为"阻止进一步下降"。

- `transitionSuccess()`: 移除冷却期检查（`if (Date.now() < s.cooldownUntil) return`），成功在任何时刻都可累积
- `transitionFailure()`: 冷却期前置检查移到函数顶部（在 statusCode 过滤之后、failure 计数之前），冷却期内所有失败类型（429/5xx/net）均被拦截
- 冷却期拦截时不清零 `consecutiveSuccesses`（当前实现在失败路径中 `s.consecutiveSuccesses = 0`，拦截后不应执行此操作）

### FR-4: 429 固定步进下降

429 路径从乘法衰减改为固定 -1。

- 删除 `AdaptiveProfile.keepRatio` 字段
- 删除 `KEEP_RATIO_MIN` 常量
- 429 路径：`s.currentLimit = Math.max(s.currentLimit - 1, ADAPTIVE_MIN)`
- 5xx/net 路径：与 429 使用相同的固定 -1 下降，并新增冷却期触发（`s.cooldownUntil = Date.now() + profile.cooldownMs`）。V2 中 5xx 下降不设冷却期，导致纯 5xx 场景的下降速度退化

### FR-5: 满额时保留部分成功计数

当 `currentLimit == max` 且 `consecutiveSuccesses >= climbThreshold` 时，不再将计数器清零，而是保留一半。

- `transitionSuccess()` 中爬升分支：当 `limit < max` 时正常清零，当 `limit == max`（已在顶）时 `s.consecutiveSuccesses = Math.floor(s.consecutiveSuccesses / 2)`

### FR-6: deriveProfile 简化

移除不再使用的参数计算。

- 删除 `keepRatio` 计算（FR-4 已移除该字段）
- `AdaptiveProfile` 接口只保留 `climbThreshold`、`dropThreshold`、`cooldownMs`

## Acceptance Criteria

### AC-1: max=0 不再导致 NaN

- **Given** provider 的 `max_concurrency = 0`
- **When** 调用 `init()` 或 `syncProvider()`
- **Then** max 被钳制为 1，`deriveProfile(1, 1)` 返回有效数值（climbThreshold=4, dropThreshold=3, cooldownMs=20000）
- **And** `currentLimit` 初始化为 1（不是 0 或 NaN）

### AC-2: 高水位无条件爬升

- **Given** `max=10, currentLimit=8`（高水位，> max/2）
- **When** 连续 5 次成功，无 `wasQueued` 信号
- **Then** `currentLimit` 从 8 升到 9
- **And** 不依赖 `limitReached` 或 `wasQueued`

### AC-3: 冷却期保护下降不保护上升

- **Given** `max=10, currentLimit=10`
- **When** 429 触发 → `currentLimit=9, cooldownUntil=T+20s`
- **Then** 在 `T+5s`（冷却期内）连续 5 次成功后 `currentLimit` 升到 10
- **And** 在 `T+10s`（冷却期内）的 429 被拦截，不触发进一步下降

### AC-4: 429 固定 -1 下降

- **Given** `max=10, currentLimit=6`
- **When** 收到 429
- **Then** `currentLimit = max(6-1, 1) = 5`（固定 -1，不是 `floor(6 * 5/6) = 5`）
- **And** 对于 `currentLimit=3`，429 后 `currentLimit = 2`（不是 V2 的 `floor(3 * 2/3) = 2`）
- **And** 对于 `currentLimit=2`，429 后 `currentLimit = 1`（不是 V2 的 `floor(2 * 1/2) = 1`）

注：在整数 limit 下，固定 -1 和乘法衰减数值结果相同，但固定 -1 语义更清晰，无浮点精度风险。

### AC-5: 满额时保留半数计数器

- **Given** `max=10, currentLimit=10, consecutiveSuccesses=5`
- **When** `consecutiveSuccesses >= climbThreshold(5)` 且 `currentLimit == max`
- **Then** `consecutiveSuccesses = floor(5/2) = 2`（不是 0）
- **And** 后续只需 3 次连续成功（而不是 5 次）即可再次触发检查

### AC-6: 连续 429 攻击下降速度

- **Given** `max=10, currentLimit=10`
- **When** 10 次 429 在 2 秒内密集到达
- **Then** `currentLimit` 降 1 格（10→9），其余 9 次被冷却期拦截
- **And** V2 中同样场景 `currentLimit` 会降至 1（9 次乘法衰减）

### AC-7: 从 limit=1 完全恢复

- **Given** `max=10, currentLimit=1`
- **When** 36 次连续成功
- **Then** `currentLimit` 恢复到 10
- **And** 恢复过程中不出现死锁或停滞

### AC-8: 冷却期内失败不重置成功计数

- **Given** `max=10, currentLimit=9, consecutiveSuccesses=4`（已累积 4 次成功，climbThreshold=5）
- **When** 冷却期内收到一个 5xx
- **Then** 5xx 被冷却期拦截
- **And** `consecutiveSuccesses` 保持 4（不被清零）

## Constraints

- 仅修改 `router/src/core/concurrency/` 下的文件（`adaptive-controller.ts` 和 `types.ts`）
- 不修改 `semaphore.ts`、`orchestrator.ts`、`scope.ts`
- 不修改 DB schema 或 migration
- 不修改 admin API 或前端
- 不修改 `deriveProfile` 的公式（climbThreshold/dropThreshold/cooldownMs 计算逻辑不变）
- 保持 `AdaptiveResult` 接口不变（`wasQueued` 保留但不再被使用）
- 保持 `PROVIDER_CONCURRENCY_DEFAULTS.max_concurrency = 0` 不变（在 controller 入口防护，不修改默认值本身，因为 0 表示"未配置"）
- 保持所有现有日志格式和级别不变
- 保持 `syncToSemaphore()` 中的 `Math.max(currentLimit, ADAPTIVE_MIN)` 双重防护

## 业务用例

### UC-1: Provider 并发度自动恢复

- **Actor**: 运维监控系统
- **场景**: 上游 API 短暂返回 429 后恢复正常
- **预期结果**: 并发度在 5-10 次成功后恢复到原始值，无需人工干预

### UC-2: 新 Provider 无需手动配置并发

- **Actor**: 部署脚本
- **场景**: 新增 provider 时 `max_concurrency=0`（未配置）
- **预期结果**: 自适应控制器以 max=1 启动，不产生 NaN 错误，逐步爬升

### UC-3: 灾难性故障自动降级

- **Actor**: LLM 代理路由器
- **场景**: 上游持续返回 5xx
- **预期结果**: 并发度逐步下降（每 10-20s 降 1 格），最低到 1，不会降到 0

## Complexity Assessment

- **影响范围**: 2 个文件（`adaptive-controller.ts` 约 30 行修改，`types.ts` 2 个字段删除）
- **测试更新**: `adaptive-controller.test.ts` 需要更新以匹配新行为
- **风险等级**: 中。算法变更影响运行时行为，但改动集中、逻辑清晰
- **依赖项**: 无外部依赖变更
- **回滚策略**: 单文件回滚即可恢复 V2 行为
