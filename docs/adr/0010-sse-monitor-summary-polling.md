# ADR 0010: SSE 监控数据摘要推送 + 按需轮询

Monitor 页面通过 SSE 实时广播活跃请求的状态更新。原来全量广播 SSE 事件（包含完整流式内容、请求体、上游响应），并发请求多时导致前端内存暴涨、SSE 连接带宽占用高、后台标签页持续消耗资源。

选定方案：stream_content_update 只推轻量摘要（id + totalChars + streamMetrics），用户点击查看详情时 HTTP 轮询获取完整内容。所有 SSE 广播事件 strip 大字段。页面不可见 > 30s 断开 SSE 连接。

## 核心规则

| 改动 | 具体措施 |
|------|---------|
| 摘要推送 | stream_content_update 只含 id + totalChars + streamMetrics |
| 大字段剥离 | 所有 SSE 广播前移除 streamContent/clientRequest/upstreamRequest |
| 缓冲区缩减 | StreamContentAccumulator 上限从 128KB/64KB 降至 32KB/16KB |
| 即时释放 | 完成请求立即清除 streamContent |
| 后台断连 | 页面不可见 > 30s 断开 SSE，切回时自动重连 |

## Considered Options

1. **全量 SSE 广播（保持现状）**：并发高时前端内存暴涨，SSE 连接成为瓶颈。
2. **WebSocket 双向通信**：支持按需订阅但引入新依赖（ws 库），且 SSE 已覆盖单向广播场景。
3. **纯 HTTP 轮询（不用 SSE）**：实时性差，轮询间隔短则浪费带宽。
4. **选定方案**：SSE 摘要推送 + HTTP 按需轮询详情。

## Consequences

- 前端需要维护两套数据获取逻辑：SSE 接收摘要 + HTTP 获取详情。
- 用户点击查看详情时有网络延迟（不再是即时数据），但通常 < 100ms。
- 后台标签页不消耗 SSE 资源，多标签页场景下内存显著降低。
- Monitor 页面的实时性从"逐 token 推送"降级为"摘要级推送"，对用户观察影响不大。
