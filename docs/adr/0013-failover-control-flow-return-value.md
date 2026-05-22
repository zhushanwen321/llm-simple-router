# ADR 0013: Failover 控制流返回值 —— ResilienceResult.action

failover-loop 的 L3 控制流原本依赖检查 `TransportResult.kind`（`tr.kind`）来判断是否成功、重试或 failover。这种方式的问题在于：
1. L3 需要重复 resilience 层的决策逻辑（"statusCode >= 400 就是失败"），违反了 DRY 原则。
2. `TransportResult.kind` 是传输层的原始枚举，不表达 resilience 层的语义（"应当重试"、"应当 failover"）。
3. `tr.kind` 不能区分 "重试次数已耗尽" 和 "其他不可恢复错误"。

选定方案：在 `ResilienceResult` 中新增 `action` 字段，编码 resilience 层已经做出的最终决策。

## ResilienceResult.action

```typescript
export interface ResilienceResult {
  result: TransportResult;
  attempts: ResilienceAttempt[];
  excludedTargets: Target[];
  finalDecision?: ResilienceDecision;
  /** resilience 决策结果 */
  action: 'continue' | 'failover' | 'retry' | 'stop';
}
```

### 取值含义

| 值 | 含义 | 对应 ResilienceDecision |
|----|------|------------------------|
| `'continue'` | 传输成功，可以正常返回响应 | `{ action: "done" }` |
| `'failover'` | 需要切换到下一个 provider 再试 | `{ action: "failover" }` |
| `'retry'` | 同一个 target 需要重试（含延迟） | `{ action: "retry" }` |
| `'stop'` | 所有尝试耗尽，不可恢复 | `{ action: "abort" }` |

### 设置位置

`ResilienceLayer.execute()` 的返回路径中设置 action：
- finalDecision.action === "done" → action: "continue"
- finalDecision.action === "abort" → action: "stop"

跨 provider failover 通过 `ProviderSwitchNeeded` 异常传递，不经过 ResilienceResult 的 action 字段。

### 消费方

failover-loop.ts 的 L3 结果处理段改为：

```
rr.action === 'continue' → 正常返回（200）
rr.action === 'stop' + 有更多 target → 继续 failover
rr.action === 'stop' + 无更多 target → 返回错误
rr.action === 'failover' / 'retry' → 继续循环
```

## Considered Options

1. **继续使用 tr.kind**：不需要改接口，但 DRY 违规，L3 重复 resilience 逻辑。
2. **新增 action 字段（选定）**：最简洁的扩展，零侵入已有下游。
3. **将 finalDecision 改为必填并重命名**：命名更清晰（"done"→"continue"、"abort"→"stop"），但改动更大，需要迁移所有现有 finalDecision 消费者。

选定 option 2 是因为改动最小且与 `finalDecision` 共存——`finalDecision` 保留完整决策信息供诊断日志，`action` 提供简洁的 switch 值供控制流使用。

## Consequences

- failover-loop 的 L3 逻辑更简洁，不再重复 resilience 的决策规则。
- 新增 `action` 字段要求所有创建 `ResilienceResult` 的地方（包括测试 mock）都必须指定 action 值。
- `TransportResult` 接口不变，模块边界清晰。
