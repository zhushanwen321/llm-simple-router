# 计划评审报告

**评审对象**: spec.md + plan.md
**评审模式**: 计划评审（阶段②）
**评审轮次**: 第 1 轮
**评审日期**: 2026-05-10

## 评审结论：通过

无 MUST FIX 问题。Plan 覆盖了 spec 所有需求，任务拆分合理，依赖关系正确。以下为改进建议。

---

## 一、Spec 完整性检查

| 维度 | 评估 | 说明 |
|------|------|------|
| 目标明确 | ✅ | 从 ~20-80MB 降到 <1MB，量化清晰 |
| 范围合理 | ✅ | 仅改一个文件，无前端变更，向后兼容 |
| 验收标准可量化 | ✅ | AC1-AC6 均有明确验证方式（单元测试/手动验证） |
| 数据流完整 | ✅ | 生产者/存储/消费者/时序均列出 |
| 影响范围准确 | ✅ | 仅 `request-tracker.ts`，types.ts 无变更 |

### Spec 验证细节

1. **现有消费路径分析准确**：确认了 `loadLogDetail()` 走 DB 路径，`getRequestById()` 走 tracker。前端确实不需要改动。
2. **broadcast 漏 strip `upstreamRequest` 确认**：当前代码 L364/L369 只 `delete copy.clientRequest`，未处理 `upstreamRequest`。
3. **`sendInitialSnapshot()` 不受影响**：该方法只发送 activeMap 中的 pending 请求，走独立的 `client.write()` 而非 `broadcast()`。Pending 请求仍持有完整数据，行为不变。

---

## 二、Plan 可行性检查

### 任务拆分评估

| Task | 内容 | 合理性 | 备注 |
|------|------|--------|------|
| Task 1 | 新增 completedDetails + 修改 complete() | ✅ | 核心存储变更，优先级最高 |
| Task 2 | 修改 getRequestById() 合并详情 | ✅ | 依赖 Task 1，需在同一提交 |
| Task 3 | 同步清理 completedDetails | ✅ | 依赖 Task 1，防内存泄漏 |
| Task 4 | broadcast() 补 strip upstreamRequest | ✅ | 独立，可并行 |

### 依赖关系

```
Task 1 ──→ Task 2（getRequestById 需要 detailsMap 存在）
Task 1 ──→ Task 3（cleanup 需要 detailsMap 存在）
Task 4（独立，无依赖）
```

依赖关系正确。Task 1 是前置条件，Task 2/3 并行依赖 Task 1，Task 4 独立。

### 工作量估算

单文件变更（`request-tracker.ts`），预估总变更 ~80 行。4 个 Task 拆分粒度合理，每个 Task 10-30 行变更 + 对应测试。估算现实。

---

## 三、Spec 与 Plan 一致性检查

| Spec 需求 | Plan 覆盖 | 对应 Task |
|-----------|----------|-----------|
| complete() 时分离大字段到 detailsMap | ✅ | Task 1 |
| getRecent() 返回无大字段的摘要 | ✅ | Task 1 |
| getRequestById() 从 detailsMap 合并详情 | ✅ | Task 2 |
| detailsMap TTL=5min，与 recentCompleted 同步清理 | ✅ | Task 3 |
| detailsMap 上限 200 条 | ⚠️ 见 LOW-1 | Task 3 |
| broadcast strip upstreamRequest | ✅ | Task 4 |
| AC1: getRecent() 无大字段 | ✅ | Task 1 测试 |
| AC2: getRequestById() TTL 内返回完整数据 | ✅ | Task 2 测试 |
| AC3: detailsMap TTL 清理 | ✅ | Task 3 测试 |
| AC4: broadcast strip 两个字段 | ✅ | Task 4 测试 |
| AC5: 响应体 < 1MB | ✅ | 手动验证 |
| AC6: pending 请求行为不变 | ✅ | Task 2 测试 |

---

## 四、数据流合规检查

### detailsMap 数据消费者完整枚举

| 消费者 | 读取方式 | Plan 覆盖 |
|--------|---------|----------|
| `getRequestById()`（Admin API） | 合并 detailsMap 返回完整数据 | ✅ Task 2 |
| `get()`（内部方法） | 不读 detailsMap，返回摘要 | ⚠️ 见 LOW-2 |

### 外部调用者影响分析

经代码搜索，`get()` 有两个外部消费者：

| 文件 | 用途 | 影响 |
|------|------|------|
| `router/src/proxy/handler/failover-loop.ts:405` | `tracker.get(logId)?.streamContent` | 无影响，只读 streamContent |
| `router/src/proxy/hooks/builtin/request-logging.ts:98` | `tracker.get(ctx.logId)?.streamContent` | 无影响，只读 streamContent |

两者仅访问 `streamContent`，该字段不在剥离范围内，行为不受影响。

---

## 五、问题清单

### LOW-1: completedDetails 容量强制约束缺失

**位置**: Plan Task 1 / Task 3
**问题**: Spec 要求"上限：与 recentCompleted 相同，最多 200 条"。Plan Task 1 的 `complete()` 实现中未提及对 `completedDetails` 的容量限制。当前 `recentCompleted` 在 `complete()` 中有 `this.recentCompleted.length = RECENT_COMPLETED_MAX` 的硬截断，但 Plan 未为 `completedDetails` 添加同样的保护。

虽然 `cleanupRecent()` 每 5 秒运行会清理过期条目，但在高峰期（5 秒内完成 >200 请求），`completedDetails` 可能短暂超过 200 条。

**建议**: 在 `complete()` 中，存储 details 后检查 `completedDetails.size > RECENT_COMPLETED_MAX` 并移除最早条目；或在 `cleanupRecent()` 中明确同步清理逻辑（基于 ID 或独立 TTL 遍历）。

### LOW-2: `get()` 方法行为变更未在 Plan 中记录

**位置**: Plan Task 2
**问题**: Task 1 修改 `complete()` 后，`recentCompleted` 中的条目不再包含 `clientRequest`/`upstreamRequest`。`get()` 方法（L218）从 `recentCompleted` 查找 completed 请求，返回的数据将缺少这两个字段。

当前 `getRequestById()` 仅委托 `get()`，Task 2 将 `getRequestById()` 改为独立实现（合并 detailsMap），但 `get()` 本身的行为静默变更了。虽然外部消费者只读 `streamContent`（不受影响），Plan 应显式记录这一变更，并确认现有测试无需修改。

**建议**: 在 Plan 中增加说明："`get()` 对 completed 请求将返回摘要数据（无 clientRequest/upstreamRequest）。外部消费者（failover-loop.ts、request-logging.ts）仅访问 streamContent，不受影响。现有测试不检查这两个字段，无需修改。"

### LOW-3: Task 3 对 killRequest() 的描述可能引起误解

**位置**: Plan Task 3
**问题**: Task 3 提到"修改 `killRequest()` 和其他删除请求的路径：确保清理 completedDetails"。但 `killRequest()` 的执行路径是 `killRequest()` → `callback()` → `complete()`。`complete()` 已在 Task 1 中修改为将 details 存入 `completedDetails`，不存在需要额外清理的场景。

如果实现者误读此条，在 `killRequest()` 中添加了额外的 `completedDetails.delete()` 操作，会导致刚存入的 details 被立即删除。

**建议**: 将 Task 3 中对 `killRequest()` 的描述改为："注意：`killRequest()` → `complete()` 路径已在 Task 1 中处理，无需额外修改 killRequest()。"

### INFO-1: Task 2 和 Task 1 建议在同一提交

**位置**: Plan Task 1 / Task 2
**说明**: Task 1 完成后、Task 2 完成前，`getRequestById()` 返回的 completed 请求数据会缺少 `clientRequest`/`upstreamRequest`。虽然 TDD 模式下可以逐步实现，但建议 Task 1 和 Task 2 在同一个 commit 中完成，避免中间状态影响其他开发者或 CI。

### INFO-2: cleanupRecent() 同步机制建议

**位置**: Plan Task 3
**说明**: Plan 未指定 `completedDetails` 与 `recentCompleted` 的同步清理机制。两种可行方案：

**方案 A（基于 ID 同步）**：在 `cleanupRecent()` 中，先收集被移除的条目 ID，再逐一从 `completedDetails` 删除。需要修改 `cleanupRecent()` 的实现方式（当前用 `slice` 直接赋值）。

**方案 B（独立 TTL 遍历）**：在 `cleanupRecent()` 中增加对 `completedDetails` 的独立遍历，按 `completedAt < cutoff` 清理。代码更简洁，但可能与 `recentCompleted` 的 200 条上限不完全同步。

**推荐方案 A**，确保 `completedDetails` 中的条目严格与 `recentCompleted` 一一对应。

---

## 六、评审总结

| 类别 | 数量 |
|------|------|
| MUST FIX | 0 |
| LOW | 3 |
| INFO | 2 |

Plan 整体质量良好，spec 需求全覆盖，任务拆分粒度合理，依赖关系正确。LOW 级问题均为 Plan 的表述精度和边界条件完整性，不影响实现正确性。

**结论：通过**
