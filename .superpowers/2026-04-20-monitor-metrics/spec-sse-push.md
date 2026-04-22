---
name: monitor-sse-push
description: SSE 推送机制设计 — 事件类型、端点、频率控制、连接管理
type: project
---

# SSE 推送机制

## 端点

```
GET /admin/api/monitor/stream
```

- 经过 admin JWT 认证（基于 Cookie，复用现有 `admin-auth` 中间件）
- 前端使用原生 `EventSource` 建立 SSE 连接（Cookie 自动携带）
- 每个 SSE 连接维护一个 ServerResponse 对象
- `RequestTracker` 持有 `Set<ServerResponse>` 连接集合

## 事件类型

| event 字段 | data 内容 | 说明 |
|------------|----------|------|
| `request_start` | `ActiveRequest` | 新请求开始 |
| `request_update` | `{ id, ...patch }` | 请求状态/流式指标变化 |
| `request_complete` | `{ id, status, statusCode }` | 请求完成 |
| `concurrency_update` | `ProviderConcurrencySnapshot[]` | 所有 provider 并发度 |
| `stats_update` | `StatsSnapshot` | 统计快照 |
| `runtime_update` | `RuntimeMetrics` | 运行时指标 |

## 推送频率

统一一个 `setInterval(5000)` 定时器，每次推送：
1. `request_update` — 所有活跃请求的最新状态
2. `concurrency_update` — 所有 provider 并发度
3. `stats_update` — 统计快照

每 2 个周期（10s）额外附带 `runtime_update`。

`request_start` 和 `request_complete` 仍在事件发生时立即推送（非定时）。

## 连接管理

```typescript
addClient(res: ServerResponse): void {
  this.clients.add(res);
  res.on("close", () => this.clients.delete(res));
}

broadcast(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of this.clients) {
    try {
      if (!res.writableEnded) res.write(msg);
    } catch {
      this.clients.delete(res);
    }
  }
}
```

- 客户端断开时通过 `res.on("close")` 自动从集合中移除
- `write` 失败（EPIPE 等）时 catch 并移除该客户端
