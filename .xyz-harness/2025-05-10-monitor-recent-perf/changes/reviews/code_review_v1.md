# 编码评审报告 — monitor recent 接口性能优化

**评审模式**: 编码评审（阶段④）
**评审轮次**: v1
**评审日期**: 2026-05-10
**变更文件**: `router/src/core/monitor/request-tracker.ts`, `router/tests/core/monitor/request-tracker-details.test.ts`

---

## Spec 合规检查

### AC1: `getRecent()` 返回无 clientRequest/upstreamRequest

**状态**: ✅ 通过

`complete()` 方法通过解构 `const { clientRequest, upstreamRequest, ...rest } = req` 将大字段分离，`recentCompleted` 中存储的 `completed` 对象由 `{ ...rest, ... }` 构建，不包含这两个字段。

测试: `test_complete_recentCompleted_noClientRequest_字段被剥离`

### AC2: `getRequestById()` 对 completed 请求返回完整 clientRequest（TTL 内）

**状态**: ✅ 通过

`getRequestById()` 重写为三步查找：
1. `activeMap.get(id)` — pending 请求完整返回
2. `recentCompleted.find()` + `completedDetails.get()` — completed 请求合并返回
3. 合并时创建新对象 `{ ...completed, clientRequest: details.clientRequest, upstreamRequest: details.upstreamRequest }`，不修改 recentCompleted 原始条目

测试: `test_getRequestById_completed_合并clientRequest和upstreamRequest`, `test_getRequestById_completed_返回完整摘要加详情`

### AC3: detailsMap 条目在 TTL 过期后随 recentCompleted 一起清理

**状态**: ✅ 通过

`cleanupRecent()` 在 slice 前，先收集被丢弃条目的 ID，同步从 `completedDetails` 中删除：

```typescript
const trimmed = this.recentCompleted.slice(0, Math.min(i, RECENT_COMPLETED_MAX));
const trimmedIds = new Set(trimmed.map((r) => r.id));
for (const entry of this.recentCompleted) {
  if (!trimmedIds.has(entry.id)) {
    this.completedDetails.delete(entry.id);
  }
}
this.recentCompleted = trimmed;
```

测试: `test_cleanupRecent_清理过期的completedDetails条目` (fake timer 推进 5min+1ms)

### AC4: broadcast() 同时 strip clientRequest 和 upstreamRequest

**状态**: ✅ 通过

在 `request_update`（数组分支）和 `request_complete`/`request_start`（单对象分支）两个 strip 路径中均添加了 `delete copy.upstreamRequest`。

测试: `test_broadcast_request_complete_无clientRequest和upstreamRequest`, `test_broadcast_request_start_无clientRequest和upstreamRequest`, `test_broadcast_request_update_无clientRequest和upstreamRequest`

### AC5: `/admin/api/monitor/recent` 响应体 < 1MB

**状态**: ✅ 通过（代码结构保障）

`getRecent()` 返回的 `recentCompleted` 条目不含大字段。200 条摘要数据的量级为 KB 级别，远低于 1MB 上限。此项为手动验证，代码层面已保障。

### AC6: pending 请求的 `getRequestById()` 行为不变

**状态**: ✅ 通过

`getRequestById()` 首先检查 `activeMap.get(id)`，找到即直接返回，不经过 completedDetails 合并路径。

测试: `test_getRequestById_pending_返回完整数据`

---

## 代码质量检查

### 错误处理

- `complete()` 中 `if (!req)` 的空值检查已存在，后续操作安全。
- `getRequestById()` 的三步查找逻辑清晰，每步都有明确的返回，无遗漏路径。
- `completedDetails` 的容量保护有 `if (oldestKey)` 防御，不会对 undefined 执行 delete。

### 边界条件

- 请求无 clientRequest/upstreamRequest 时，`completedDetails` 不写入（`if (clientRequest !== undefined || upstreamRequest !== undefined)`），`getRequestById()` 返回无详情的摘要，行为正确。
- `completedDetails` 容量上限 200 与 `recentCompleted` 一致，溢出时逐个淘汰最旧条目。
- `cleanupRecent()` 同步清理保证 `completedDetails` 不会泄漏已从 `recentCompleted` 移除的条目。

### 时序正确性

- `completedDetails.set()` 在 `recentCompleted.unshift()` 之前执行（spec 要求）。
- `cleanupRecent()` 在同一个方法中同步清理两个数据结构（spec 要求）。

---

## 架构合规检查

- 变更自包含于 `request-tracker.ts`，无跨模块边界违规。✅
- `completedDetails` 为 private Map，封装在 RequestTracker 类内部。✅
- Admin API 消费路径（`/admin/api/monitor/recent` → `getRecent()`，`/admin/api/monitor/request/:id` → `getRequestById()`）无需修改。✅
- 前端无变更，已走 DB 日志路径加载 completed 请求详情。✅
- 未违反 CLAUDE.md 中任何架构约束。✅

---

## 数据消费者完整性检查

| 字段 | 生产者 | 存储位置 | 消费者 | 验证 |
|------|--------|---------|--------|------|
| `recentCompleted[].clientRequest` | 不再填充 | 无 | — | ✅ 不再返回 |
| `completedDetails[id]` | `complete()` | 内存 Map | `getRequestById()` | ✅ 合并返回 |
| SSE `request_update` | `broadcast()` | 实时推送 | 前端 Monitor | ✅ strip 两个字段 |
| SSE `request_start/complete` | `broadcast()` | 实时推送 | 前端 Monitor | ✅ strip 两个字段 |
| `sendInitialSnapshot` | `addClient()` | SSE 初始推送 | 新连接前端 | ⚠️ 见 LOW-1 |

---

## 问题清单

### LOW-1: `sendInitialSnapshot()` 未 strip `upstreamRequest`（预存问题）

**文件**: `router/src/core/monitor/request-tracker.ts:324-327`

`sendInitialSnapshot()` 绕过 `broadcast()` 直接构造 SSE 消息发送 pending 请求，保留了 `clientRequest`（注释说明是有意的）和 `upstreamRequest`。而 `broadcast("request_update", ...)` 会 strip 这两个字段。

这导致初始快照有 `upstreamRequest`，后续 `request_update` 广播没有。这是**预存行为**（`clientRequest` 一直如此），本次变更未引入新问题。仅影响少量 pending 请求，无实际功能影响。

**建议**: 后续可考虑统一 `sendInitialSnapshot` 和 `broadcast` 的 strip 策略，或在 `sendInitialSnapshot` 中也 strip `upstreamRequest`。

---

### LOW-2: `completedDetails` 容量淘汰为 O(n) 线性扫描

**文件**: `router/src/core/monitor/request-tracker.ts:178-186`

`complete()` 中 `completedDetails` 超过上限时，遍历整个 Map 找最旧条目。200 条的 Map 遍历开销可忽略，且只在 `size > 200` 时触发（即第 201 次 complete 时），实际影响极小。

**建议**: 如未来需要扩展到更大容量，可考虑用双向链表 + Map 维护 LRU 顺序。当前规模无需优化。

---

### INFO-1: `cleanupRecent()` 每次清理创建临时 Set

**文件**: `router/src/core/monitor/request-tracker.ts:461`

每 5 秒 tick 时 `cleanupRecent()` 创建 `new Set(trimmed.map(...))`，对于 200 条数据（通常更少，因为有 TTL 过滤）开销可忽略。纯风格观察，无需修改。

---

## 测试评估

- 6 个 AC 全部有对应测试覆盖。
- 测试使用 `vi.useFakeTimers()` 验证 TTL 过期行为，正确。
- 容量限制测试创建 205 个请求验证淘汰逻辑。
- 测试通过 `(tracker as any).completedDetails` 访问私有字段验证内部状态，可接受。
- 测试文件 404 行，未超出 `max-lines: 500` 限制。
- mock 策略合理：`statsAggregator` 和 `runtimeCollector` 在 `beforeEach` 中统一 mock。

---

## 代码品味检查

| 原则 | 评估 |
|------|------|
| 兜底响应 | ✅ `getRequestById()` 三步查找全部有明确返回 |
| 完整错误提取 | ✅ 不涉及上游错误解析 |
| 幂等注册 | ✅ 不涉及注册模式 |
| structuredClone | ✅ 使用 spread `{ ...completed, ... }` 创建新对象，未用 JSON roundtrip |
| SSE data 拼接 | ✅ 不涉及多行 data |
| headers 安全 | ✅ 不涉及 headers |

---

## 结论

**通过**。无 MUST FIX 问题。实现完整覆盖 spec 全部 6 条验收标准，代码质量良好，架构合规，测试充分。LOW 级问题均为预存行为或性能微优化建议，不阻塞合并。
