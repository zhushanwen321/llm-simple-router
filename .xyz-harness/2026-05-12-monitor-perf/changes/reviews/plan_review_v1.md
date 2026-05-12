## 评审记录 v1

- 评审时间: 2026-05-12
- 评审类型: 计划评审（阶段②）
- 评审对象: spec.md + plan.md
- 评审轮次: 1/3

### 发现的问题

| # | 优先级 | 文件 | 描述 | 建议 |
|---|--------|------|------|------|
| 1 | **MUST FIX** | spec.md AC4 / plan.md | **AC4 与 plan 任务不一致**：AC4 要求"列表页每个流式请求显示 totalChars 数字"和"streamMetrics（tokensPerSecond、outputTokens、ttftMs）在列表页正常显示"。但当前 Monitor.vue 列表行中没有任何位置展示这些字段（已验证 Monitor.vue + monitor/ 组件均无相关代码），plan 的 5 个 Task 也无一个涉及在列表行中添加 totalChars/streamMetrics 的 UI 展示。AC4 无法通过。 | 二选一：(A) 在 plan 中新增 Task（或在 Task 3/4 中追加），在 Monitor.vue 的活跃请求列表行中添加 totalChars 和 streamMetrics 的展示 UI；(B) 将 AC4 改为"轻量数据通过 SSE 正确到达前端，可用于展示"（降低 AC 范围），另开后续需求做列表页 metrics 展示。推荐 (A)，因为这是本次优化的核心可观测性价值——用户需要在列表中看到流式进度，否则只能逐个点击查看。 |
| 2 | **MUST FIX** | spec.md B2 / plan.md Task 1 | **`broadcast()` 对 `request_start`/`request_complete` 的 strip 不完整**：spec B2 只要求在 `request_update` 和 `sendInitialSnapshot` 中 strip `streamContent`/`streamMetrics`。但 `broadcast()` 方法有一个 `else if` 分支处理 `request_start` 和 `request_complete`，当前只 strip `clientRequest`/`upstreamRequest`，未 strip `streamContent`/`streamMetrics`。虽然 `request_start` 时 streamContent 通常为空（防御性足够），但 `request_complete` 在 B3 实施前仍携带完整 `streamContent`（~384KB），如果 Task 1 先于 Task 2 合并，会有一个窗口期 `request_complete` 广播大 payload。 | 在 B2 的代码变更中，同步修改 `broadcast()` 的 `request_start`/`request_complete` 分支，增加 `delete copy.streamContent; delete copy.streamMetrics;`。这既是防御性编程，也消除 Task 1/2 实施顺序的依赖风险。Plan Task 1 的风险点已识别但未升格为 AC，应补充为 AC。 |
| 3 | **MUST FIX** | plan.md Task 3 | **`complete()` 后 `getRequestById()` 对已完成请求返回的 `streamContent` 为 `undefined`，但 spec 和 plan 均未明确说明轮询在此场景下的兜底行为**：Task 3 的 AC 说"请求完成时停止轮询"，但轮询停止依赖前端检测 status 变化。如果最后一次轮询请求发生在 status 变化检测之前，后端返回的 `streamContent` 为 `undefined`（因 B3 已清除），前端 `selectedStreamContent` 会被置空，可能导致详情对话框短暂闪烁空白。 | Task 3 应增加 AC：轮询响应中 `streamContent` 为空时，不清空 `selectedStreamContent`（保留上一次的值），或仅在响应包含有效 `streamContent` 时更新。同时在 `request_complete` SSE handler 中触发 `loadLogDetail()` 后，将 `selectedStreamContent` 置为 null（切换为 DB 数据源）。 |
| 4 | LOW | plan.md | **任务依赖关系未显式声明**：Task 3（前端按需获取）依赖 Task 1（后端轻量推送）——前端 handler 变更假设后端已改为轻量格式。Task 2（缓冲区降低+完成清理）与 Task 1 有交叉（B3 的 `streamContent: undefined` 影响 `request_complete` 广播）。Task 5 依赖全部。Plan 的 Task 顺序隐含了依赖，但未显式标注。 | 在 plan 开头或每个 Task 描述中增加"前置依赖"字段。最低要求：Task 3 标注"依赖 Task 1 完成"，Task 5 标注"依赖 Task 1-4 全部完成"。 |
| 5 | LOW | spec.md B3 / plan.md Task 2 | **`updateCompletedMetrics()` 在 `complete()` 之后仍会广播 `request_complete`，此时 `streamMetrics` 仍然存在**：这不是 bug（`streamMetrics` < 200 bytes），但与 B2 strip `streamMetrics` 的意图不完全一致。`request_update` strip 了 `streamMetrics`，但 `request_complete` 没有做相同的 strip。 | 确认这是有意设计：`request_complete` 保留 `streamMetrics` 用于前端展示最终指标。如果是，在 spec 中补充说明"request_complete 保留 streamMetrics（最终指标）"以消除歧义。 |
| 6 | LOW | spec.md 数据流 | **新增字段消费者清单不完整**：spec 的数据流表列了 `streamTotalChars` 和 `selectedStreamContent` 的消费者，但遗漏了 `ActiveRequest` 类型变更的消费者：`UnifiedRequestDialog.vue`（接收 streamContent prop 的组件）和 `ResponseViewer.vue`（最终消费 streamContent 的组件）。虽然 prop 传递链路未被破坏（UnifiedRequestDialog 中间转接），但作为数据消费者应在表中列出。 | 在数据流表中补充 `UnifiedRequestDialog.vue` 和 `ResponseViewer.vue` 作为 `selectedStreamContent` 的间接消费者。 |

### 评审总结

**结论：需修改后重审**

3 条 MUST FIX：

1. **AC4 缺少 UI 实现**：AC 要求列表页展示 totalChars/streamMetrics，但 plan 无对应任务。这是 AC 可验收性的根本缺口。
2. **`broadcast()` strip 范围不足**：`request_start`/`request_complete` 分支未同步 strip，存在 Task 1/2 实施顺序风险。
3. **轮询兜底行为未定义**：完成瞬间 `streamContent` 为空时的前端处理逻辑缺失，可能导致 UI 闪烁。

以上 3 条修复后可进入编码阶段。4-6 为 LOW 级建议，不阻塞流程。

### 亮点

- Spec 对数据流的"改前/改后"对比清晰，核心矛盾（利用率 ~10%）分析到位
- 复用已有 `GET /admin/api/monitor/request/:id` 端点而非新建，减少了实现复杂度
- Task 拆分粒度合理，后端（Task 1+2）→ 前端（Task 3+4）→ 集成（Task 5）的分层符合 CLAUDE.md 架构约束
- 已知技术债务的显式标注（不修的范围说明）减少了歧义
