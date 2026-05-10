# 实现计划

### Task 1: 新增 completedDetailsMap 和修改 complete()

**文件**: `core/src/monitor/request-tracker.ts`

**变更内容**:
1. 新增 `private completedDetails = new Map<string, { clientRequest?: string; upstreamRequest?: string; completedAt: number }>()`
2. 修改 `complete()` 方法：
   - 在创建 `completed` 对象前，将 `req.clientRequest` 和 `req.upstreamRequest` 存入 `completedDetails`
   - 创建 `completed` 时使用 spread 但排除这两个字段：`const { clientRequest, upstreamRequest, ...rest } = req; const completed = { ...rest, status: ..., completedAt: now, ... }`
3. 在 `startPushInterval()` 的定时清理中同步清理 `completedDetails`

**测试要点**:
- complete 后 recentCompleted 中无 clientRequest/upstreamRequest
- complete 后 completedDetails 中有对应条目

### Task 2: 修改 getRequestById() 合并详情

**文件**: `core/src/monitor/request-tracker.ts`

**变更内容**:
1. 修改 `getRequestById()` 逻辑：
   - 先从 activeMap 查找（pending 请求，完整数据）
   - 再从 recentCompleted 查找摘要 + 从 completedDetails 合并 clientRequest/upstreamRequest
   - 返回合并后的对象（不修改 recentCompleted 中的原始对象）

**测试要点**:
- pending 请求返回完整数据
- completed 请求返回摘要 + 详情合并
- TTL 过期后 completed 请求不再有详情（从 DB 加载是前端的责任）

### Task 3: 同步清理 completedDetails

**文件**: `core/src/monitor/request-tracker.ts`

**变更内容**:
1. 修改 `cleanupRecent()` 方法：在清理 recentCompleted 时，同步清理 completedDetails 中相同 ID 的条目
2. 修改 `killRequest()` 和其他删除请求的路径：确保清理 completedDetails

**测试要点**:
- cleanupRecent 后 completedDetails 中对应条目也被删除
- completedDetails 大小不超过 RECENT_COMPLETED_MAX

### Task 4: broadcast() 补 strip upstreamRequest

**文件**: `core/src/monitor/request-tracker.ts`

**变更内容**:
1. 在 `broadcast()` 方法中，`request_start`/`request_complete` 的 strip 逻辑中增加 `delete copy.upstreamRequest`

**测试要点**:
- broadcast request_start 事件中无 clientRequest/upstreamRequest
- broadcast request_complete 事件中无 clientRequest/upstreamRequest
- broadcast request_update 事件中无 clientRequest/upstreamRequest（已有 clientRequest strip，补 upstreamRequest）
