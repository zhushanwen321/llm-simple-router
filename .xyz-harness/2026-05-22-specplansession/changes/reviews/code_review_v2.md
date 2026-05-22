---
verdict: pass
must_fix: 0
review:
  type: code_review
  round: 2
  timestamp: "2026-05-22T23:15:00"
  target: "fix-usage-limit-return branch — MUST FIX #1 re-inspection"
  summary: "第 2 轮编码评审：MUST FIX #1（provider unavailable 破坏 failover 链）已正确修复。评审通过。"

statistics:
  total_issues: 1
  must_fix_resolved: 1
  low: 0
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "router/src/proxy/handler/failover-loop.ts"
    title: "Provider unavailable 从 return 改回 continue，恢复 failover 链"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

---

# 编码评审 v2

## 评审记录
- 评审时间：2026-05-22 23:15
- 评审类型：第 2 轮编码评审（MUST FIX 验证）
- 评审对象：`router/src/proxy/handler/failover-loop.ts` — provider unavailable 处理逻辑

## MUST FIX 验证

### #1: Provider unavailable 从 `return` 改回 `continue` — ✅ 已修复

**问题回顾**（v1 评审）：
- v1 对应的第 1 轮评审发现 `failover-loop.ts` L323 附近，provider unavailable 处理使用了 `return rejectAndReply(...)`，导致当 mapping group 配置多个 target（failover 模式）时，一个 provider 不可用就直接返回错误，不再尝试下一个 target。
- 旧代码（v1 中发现的新代码）：`return rejectAndReply(reply, rCtx, errors.providerUnavailable(), ...)`
- 期望行为：记录日志 → 排除该 target → `continue` 尝试下一个

**当前代码验证**（读取 `failover-loop.ts` 全文件）：

```typescript
const provider = getProviderById(db, resolved.provider_id);
if (!provider || !provider.is_active) {
  insertRejectedLog({
    db, logId, apiType: clientApiType as "openai" | "openai-responses" | "anthropic",
    model: clientModel, statusCode: 503,
    errorMessage: `Provider '${resolved.provider_id}' unavailable`,
    startTime, isStream, routerKeyId,
    originalBody: rawBody, clientHeaders: cliHdrs,
    providerId: resolved.provider_id, originalModel: null,
    isFailover: isFailoverIteration, originalRequestId: isFailoverIteration ? rootLogId : null,
    sessionId: ctx.metadata.get("session_id") as string | undefined,
    pipelineSnapshot: iterationSnapshot.toJSON(),
    matcher, logFileWriter,
    mapping_reason: rCtx.mappingReason ?? null,
  });
  excludeTargets.push(resolved);
  continue;
}
```

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 不再使用 `rejectAndReply` | ✅ | 直接调用 `insertRejectedLog`，不经过 `rejectAndReply` |
| 调用 `insertRejectedLog` | ✅ | 写入完整的拒绝日志（含 providerId、mapping_reason 等字段） |
| `excludeTargets.push(resolved)` | ✅ | 将不可用的 provider 加入排除列表 |
| `continue` | ✅ | 进入下一轮 while 循环，尝试下一个 target |
| 首迭代 snapshot 正确 | ✅ | 使用 `iterationSnapshot.toJSON()`，非空 snapshot |
| failover 恢复 | ✅ | `filterExcluded(cachedTargets, excludeTargets)` 会在下一次迭代中跳过已排除的 target |

**代码质量**：
- `insertRejectedLog` 调用传入了完整的参数集，与同文件中其他 `rejectAndReply` 分支保持一致的字段
- 使用本地 `rCtx` 中的 `mappingReason`，不会丢失首次迭代时计算的 `resolved.mappingReason`
- 不触发错误响应，不打断 failover 循环

## 结论

**评审通过（PASS）。** MUST FIX #1 已正确修复，`provider unavailable` 场景恢复了 `insertRejectedLog → excludeTargets.push → continue` 的模式，failover 多 target 轮询行为恢复正常，无回归。

（本轮仅验证 MUST FIX #1，LOW/INFO 级别问题由开发者自行决定处理时机。）
