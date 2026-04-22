---
name: monitor-data-model
description: 监控功能的内存数据模型定义
type: project
---

# 数据模型

## ActiveRequest — 活跃请求

```typescript
interface ActiveRequest {
  id: string;                    // request log ID
  apiType: "openai" | "anthropic";
  model: string;                 // 客户端请求的模型
  providerId: string;
  providerName: string;
  isStream: boolean;
  startTime: number;             // Date.now()
  status: "pending" | "completed" | "failed";
  retryCount: number;
  attempts: AttemptSnapshot[];
  streamMetrics?: StreamMetricsSnapshot;
  clientIp?: string;
  completedAt?: number;          // 完成时间戳，用于"最近完成"列表
}
```

## AttemptSnapshot — 单次尝试快照

```typescript
interface AttemptSnapshot {
  statusCode: number | null;
  error: string | null;
  latencyMs: number;
  providerId: string;            // failover 时 provider 可能变化
}
```

## StreamMetricsSnapshot — 流式实时指标

```typescript
interface StreamMetricsSnapshot {
  inputTokens: number | null;
  outputTokens: number | null;
  ttftMs: number | null;
  stopReason: string | null;
  isComplete: boolean;
}
```

## ProviderConcurrencySnapshot — 并发度状态

```typescript
interface ProviderConcurrencySnapshot {
  providerId: string;
  providerName: string;
  maxConcurrency: number;        // 0 = 未限制
  active: number;
  queued: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}
```

## StatsSnapshot — 累计统计

```typescript
interface StatsSnapshot {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  retryCount: number;
  failoverCount: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p99LatencyMs: number;
  byProvider: Record<string, ProviderStats>;
  byStatusCode: Record<number, number>;
}

interface ProviderStats {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  retryCount: number;
  topErrors: Array<{ code: number; count: number }>;
}
```

## RuntimeMetrics — Node.js 运行时

```typescript
interface RuntimeMetrics {
  uptimeMs: number;
  memoryUsage: NodeJS.MemoryUsage;
  activeHandles: number;
  activeRequests: number;
  eventLoopDelayMs: number;      // perf_hooks monitorEventLoopDelay 的 mean 值
}
```
