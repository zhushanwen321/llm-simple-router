# Monitor 页面性能优化 - 全流程追溯

## 基本信息
- 需求描述：将 Monitor 页面内存从 >1GB 降至 <50MB，核心变更为流式内容按需获取
- 开始时间：2026-05-12
- 当前阶段：1 需求分析

## 阶段状态

| 阶段 | 状态 | 评审轮次 | 备注 |
|------|------|---------|------|
| 1 需求分析 | ✅ 通过 | - | 2026-05-12 |
| 2 需求评审 | ⬜ 未开始 | - | - |
| 3 编码实现 | ⬜ 未开始 | - | - |
| 4 编码评审 | ⬜ 未开始 | - | - |
| 5 测试编写 | ⬜ 未开始 | - | - |
| 6 测试评审 | ⬜ 未开始 | - | - |
| 7 代码推送 | ⬜ 未开始 | - | - |
| 8 CI 验证 | ⬜ 未开始 | - | - |
| 9 部署验证 | ⬜ 未开始 | - | - |
| 10 用户确认 | ⬜ 未开始 | - | - |
| 11 自动复盘 | ⬜ 未开始 | - | - |

## 评审摘要

（待填写）

## 异常记录

（待填写）

## 阶段 3 - 编码实现（Task 1：后端 broadcast 轻量化）

- 状态：done
- 变更文件：
  - `router/src/core/monitor/request-tracker.ts`
  - `router/tests/core/monitor/request-tracker-details.test.ts`
- 摘要：将 SSE broadcast 从推送完整 streamContent 改为轻量摘要（totalChars + streamMetrics），所有 SSE 事件 strip streamContent，request_update 额外 strip streamMetrics。新增 5 个测试覆盖轻量化行为，全部 1336 测试通过。
- 时间：2026-05-12T15:13:00Z

## 阶段 3 - 编码实现（Task 3：前端按需获取 streamContent）

- 状态：done
- 变更文件：
  - `frontend/src/types/monitor.ts`
  - `frontend/src/composables/useMonitorData.ts`
  - `frontend/src/views/Monitor.vue`
- 摘要：前端 stream_content_update handler 改为轻量更新（totalChars + streamMetrics），新增 HTTP 轮询机制按需获取完整 streamContent（500ms 间隔），活跃请求列表展示 tokensPerSecond 和 outputTokens。vue-tsc + eslint + 后端测试全部通过。
- 时间：2026-05-12T15:25:00Z
