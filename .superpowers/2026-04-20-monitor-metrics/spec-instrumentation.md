---
name: monitor-instrumentation
description: proxy-core.ts 埋点位置和 RequestTracker 接口设计
type: project
---

# 埋点设计

## RequestTracker 接口

```typescript
class RequestTracker {
  start(req: ActiveRequest): void;
  update(id: string, patch: Partial<ActiveRequest>): void;
  complete(id: string, result: { status: "completed" | "failed"; statusCode?: number }): void;

  getActive(): ActiveRequest[];
  getRecent(limit?: number): ActiveRequest[];
  get(id: string): ActiveRequest | undefined;

  getStats(): StatsSnapshot;
  getConcurrency(): ProviderConcurrencySnapshot[];
  getRuntime(): RuntimeMetrics;

  addClient(res: ServerResponse): void;
  removeClient(res: ServerResponse): void;
}
```

## 埋点位置（proxy-core.ts handleProxyPost）

```
1. 请求入口 → tracker.start({ id, model, providerId, isStream, ... })
2. semaphore acquire 失败 → tracker.complete(id, { status: "failed" })
3. retryableCall 返回后 → tracker.update(id, {
     retryCount: attempts.length - 1,
     attempts,
     providerId: resolved.provider_id,   // failover 时更新为当前 provider
     streamMetrics: ...                   // 流式时提取
   })
4. 请求成功/失败出口 → tracker.complete(id, { status, statusCode })
```

## 设计原则

- 埋点只在 `handleProxyPost` 的入口/出口，不侵入 `retryableCall` 或 `upstreamStream` 内部
- 重试次数从 `RetryResult.attempts.length - 1` 提取
- `ActiveRequest.providerId` 表示当前正在尝试的 provider，failover 切换时通过 `update()` 更新
- `RequestTracker` 作为单例注入 `ProxyHandlerDeps`

## 流式指标实时获取

`SSEMetricsTransform` 在 `retryableCall` 闭包内创建，外部无法直接访问。解决方案：

`SSEMetricsTransform` 增加一个 `onMetrics` 回调参数。每次处理 SSE 事件后，回调被触发，将 `MetricsExtractor.getMetrics()` 的中间结果传给 `RequestTracker.update()`。回调内部做 5 秒节流，避免过于频繁。

```typescript
const metricsTransform = new SSEMetricsTransform(apiType, startTime, {
  onMetrics: (metrics) => tracker.update(logId, { streamMetrics: metrics }),
});
```

## 重试状态

删除 `ActiveRequest.status` 中的 `"retrying"` 状态。由于不侵入 `retryableCall` 内部，无法在重试过程中实时感知。重试信息在 `retryableCall` 返回后一次性更新到 `attempts` 和 `retryCount`。前端通过 `retryCount > 0` 判断是否发生过重试。

status 简化为：`"pending" | "completed" | "failed"`

## 并发度数据来源

`getConcurrency()` 组合两个数据源：
1. `semaphoreManager.getStatus(providerId)` → active, queued
2. DB 查询 provider 列表 → providerName, maxConcurrency, queueTimeoutMs, maxQueueSize

缓存策略：在 `RequestTracker` 内缓存一份 provider 配置镜像，`updateConfig` 时同步更新，避免每次推送都查 DB。

## 最近完成列表

- `complete()` 时将请求移入 `recentCompleted: ActiveRequest[]`
- 保留最近 5 分钟内完成的请求，条目上限 200
- 超时或超限请求由定时器清理（每次推送时检查）
