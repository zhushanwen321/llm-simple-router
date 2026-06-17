---
verdict: pass
---

# E2E Test Plan — Transport 超时与资源泄漏修复

## Test Scenarios

覆盖 spec AC-1 ~ AC-13。测试环境：`buildApp({ config, db })` + 内存 SQLite + mock 上游 http.createServer。

### 场景 1：kill 进行中请求（AC-1, AC-2, AC-13）
- 构造流式/非流式请求发往 mock 上游（响应前 hold 住）
- acquire 槽位后，调用 `DELETE /admin/api/monitor/request/:id`
- 断言：`getConcurrency().active` 立即递减；`activeMap` 无残留；再次 kill 同 id 返回 false；无双重 release（current 不超减）
- 断言：upstreamReq.destroyed === true（mock 上游连接被切断）

### 场景 2：客户端断连（AC-3, AC-3b, AC-9）
- 流式 TTFT 阶段：发请求后立即 `request.raw.destroy()` 模拟客户端断
- 非流式：同上
- 断言：并发度下降，upstreamReq 销毁，resilience attempts 长度=1（未 retry）

### 场景 3：上游真 hang（AC-4, AC-12）
- mock 上游 accept 后不回任何数据
- stream_timeout_ms / non_stream_timeout_ms 设小值（如 200ms）
- 断言：超时后请求结束（throw），槽位释放
- callGet 路径：连通性探测 hang → 30s（测试注入小值）超时

### 场景 4：loop_detection / upstream_error 资源销毁（AC-8）
- 触发流式 loop detection（构造重复 chunk）
- 断言：upstreamRes.destroyed === true，上游不再被消费（mock 计数 data 事件停止增长）

### 场景 5：kill 排队中请求（AC-10）
- max_concurrency=1，两个请求并发，第二个排队中 kill
- 断言：返回成功，不抛 TypeError，信号量 current 未受影响

### 场景 6：graceful shutdown abort（AC-11）
- inflight 请求存在时触发 close()
- 断言：所有 killCallbacks 被调用，upstreamReq 销毁

### 场景 7：超时配置端到端（AC-5, AC-6, AC-7）
- 模型编辑页设置 stream=400s, non_stream=700s → 保存 → 重载
- 断言：DB models JSON 含两字段；getModelTimeouts 返回 {400000, 700000}
- =0 时 getModelTimeouts 返回 Infinity

### 场景 8：adaptive 不误降（G5-001）
- 启用 adaptive，客户端断连（非上游错误）
- 断言：consecutiveFailures 不增加，currentLimit 不变

## Test Environment

- 后端：`initDatabase(":memory:")` + `buildApp({ config, db })`，mock 上游用 `http.createServer` 随机端口
- 前端：ModelCard 组件测试（@vue/test-utils），验证主行双 Input 渲染、emit 事件
- 超时测试用小注入值（如 50ms）避免真实等待 300s
