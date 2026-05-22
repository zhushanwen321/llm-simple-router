---
verdict: pass
must_fix: 0
---

issues:
  - id: 1
    severity: MUST_FIX
    location: "router/src/proxy/orchestration/resilience.ts:299"
    title: "resilience.ts 仍主动 throw ProviderSwitchNeeded，未迁移到 action 返回值"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "case 'failover' 分支改为返回 action: 'failover' 结果对象，不再 throw ProviderSwitchNeeded。全文件无 ProviderSwitchNeeded 引用残留。"

  - id: 2
    severity: MUST_FIX
    location: "router/src/proxy/handler/failover-loop.ts:309"
    title: "failover-loop.ts 仍保留 ProviderSwitchNeeded catch 分支"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "ProviderSwitchNeeded catch 分支已删除。failover/retry 处理通过 rr.action === 'failover'|'retry' 分支进行。仅保留注释说明外部 plugin 异常传播策略。"

---

# 编码评审 v2 — 第 1 轮 MUST FIX 修复验证

## 验证结果

### MUST FIX #1: resilience.ts 无 ProviderSwitchNeeded throw

**状态：已修复 ✅**

`router/src/proxy/orchestration/resilience.ts` 的 `case "failover"` 分支（line 295）当前实现：

```typescript
case "failover":
  excludedTargets.push(decision.excludeTarget);
  globalAttemptIndex++;
  // 跨 provider failover 使用 action 返回值驱动，不再使用异常
  const nextExcludedSet = new Set(...);
  const nextAvail = targets().filter(...);
  if (nextAvail.length > 0 && nextAvail[0].provider_id !== currentTarget.provider_id) {
    return { result: transportResult, attempts: allAttempts, excludedTargets,
             finalDecision: decision, action: "failover" };
  }
  // 同 provider failover：内部继续循环
  continue;
```

- 替代原先的 `throw new ProviderSwitchNeeded(...)` ✓
- `grep -rn "throw.*ProviderSwitchNeeded" router/src/` 返回空 ✓
- `grep -n "ProviderSwitchNeeded" resilience.ts` 返回空 ✓

### MUST FIX #2: failover-loop.ts 无 ProviderSwitchNeeded catch

**状态：已修复 ✅**

`router/src/proxy/handler/failover-loop.ts` 的 catch 块（line 314+）不再包含 `e instanceof ProviderSwitchNeeded` 分支：

- failover/retry 处理前移至 action 检查分支：
  ```typescript
  if (rr.action === 'failover' || rr.action === 'retry') {
    // 日志记录后 continue
  }
  if (rr.action === 'stop' && allTargets.length > 1) {
    // continue 尝试下一个 target
  }
  ```
- `grep -n "instanceof ProviderSwitchNeeded" router/src/` 返回空 ✓
- line 321 仅保留注释说明外部 plugin 异常传播策略 ✓
- `case "failover"` 不再抛异常，catch 分支自然无需处理 ✓

### orchestrator.ts 一致性验证

`orchestrator.ts`（line 140-147）对 action-based failover/retry 的处理正确：

```typescript
// failover/retry 场景不发送响应，由 failover-loop 处理
if (result.action !== 'failover' && result.action !== 'retry') {
  this.sendResponse(reply, result.result, ctx);
}
```

failover/retry 时不发送 response，由 failover-loop 继续循环。控制流统一为 action 返回值驱动。

### LOW 问题评估

第 1 轮 7 条 LOW / 3 条 INFO 问题不阻塞本次验证：
- #3 (ProviderSwitchNeeded @deprecated)：非功能性问题，不阻塞
- #4-#9 (scope 偏差)：属于实现范围缩减决策，非 bug
- #10-#12 (INFO)：已有正确修复或已知差异

### 测试结果

```
Test Files  1 failed | 132 passed (133)
     Tests  1 failed | 1543 passed (1544)
```

唯一失败 `router/tests/admin/transform-rules.test.ts:81` 为预先存在的问题（stash 后同样失败），与 MUST FIX 项无关。

## 结论

**PASS。第 1 轮 2 条 MUST FIX 已全部修复并验证。控制流已完成从异常驱动到 action 返回值驱动的迁移。**
