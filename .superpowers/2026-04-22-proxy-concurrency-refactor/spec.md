# Proxy 并发控制架构重构设计

## 背景

当前 `handleProxyPost` 是 270 行的 God Function，同时承担映射解析、信号量管理、Tracker 生命周期、重试编排、Failover 循环、流/非流分发、日志和指标采集等职责。信号量 release 和 tracker complete 各散落在 6-7 个退出路径中，手动管理。

这导致：(1) 新增退出路径容易漏掉资源清理；(2) retry 和 failover 嵌套循环共享可变状态；(3) `upstreamStream` 用 5 个布尔标志管理流状态，close handler 在重试时累积。

## 设计决策

| 决策项 | 选择 |
|--------|------|
| 方案 | C：分层架构 + Resource Scope |
| Retry + Failover | 统一为 ResilienceLayer，状态驱动决策 |
| upstream-call.ts | 纳入重构，流代理用显式状态机 |
| reply.raw 使用方式 | 保持不变，只改善状态管理 |
| 测试策略 | TDD：先在现有代码上写 mock 测试，再重构 |
| 交付方式 | 分阶段 PR，合并到 dev 分支，最终合并 main |

## 架构总览

```
┌─────────────────────────────────────────────┐
│  ProxyOrchestrator                          │
│  职责：组装上下文，调度各层，处理早期拒绝     │
│  不含复杂控制流                              │
├─────────────────────────────────────────────┤
│  ResilienceLayer                            │
│  职责：统一 retry + failover 决策            │
│  输入：execute 回调 + 策略配置               │
│  输出：ResilienceResult + 所有尝试记录        │
├─────────────────────────────────────────────┤
│  TransportLayer                             │
│  职责：单次上游调用（流/非流）               │
│  输入：provider + headers + body             │
│  输出：结构化 TransportResult                │
└─────────────────────────────────────────────┘
         横切: SemaphoreScope, TrackerScope
```

## 核心类型

### TransportResult（discriminated union）

```typescript
type TransportResult =
  | { kind: "success"; statusCode: number; body: string; headers: Record<string, string> }
  | { kind: "stream_success"; statusCode: number; metrics?: MetricsResult }
  | { kind: "stream_error"; statusCode: number; body: string; headers: Record<string, string> }
  | { kind: "stream_abort"; statusCode: number }
  | { kind: "error"; statusCode: number; body: string; headers: Record<string, string> }
  | { kind: "throw"; error: Error };
```

- `stream_success`：流正常完成（200），数据已通过 pipe 发送给客户端
- `stream_error`：流式请求的上游返回非 200（如 429/500），body 为错误内容，需要发送给客户端
- `stream_abort`：流传输中客户端断连或 pipe 错误，不可恢复
- `error`：非流式请求的上游错误响应
- `throw`：网络层异常（ETIMEDOUT/ECONNRESET 等）

### ResilienceDecision

```typescript
type ResilienceDecision =
  | { action: "done" }
  | { action: "retry"; delayMs: number }
  | { action: "failover"; excludeTarget: Target }
  | { action: "abort"; reason: string };
```

## 各层设计

### TransportLayer

非流式：无状态纯函数，封装现有 `proxyNonStream` 逻辑。

流式：显式状态机，替换当前 5 个散落布尔标志。

```
状态转换：

  BUFFERING ──(检测到完整事件且非错误)──→ STREAMING ──(上游 end)──→ COMPLETED
      │                                      │
      │(检测到错误/超限)                      │(客户端断连/pipe 错误)
      ↓                                      ↓
  EARLY_ERROR                            ABORTED
```

| 状态 | 含义 | 可转换到 |
|------|------|---------|
| BUFFERING | 等待首个完整 SSE 事件 | STREAMING, EARLY_ERROR |
| STREAMING | 正在转发数据 | COMPLETED, ABORTED |
| COMPLETED | 上游正常结束 | 终态 |
| EARLY_ERROR | 缓冲阶段检测到可重试错误 | 终态 |
| ABORTED | 客户端断连或 pipe 异常 | 终态 |

实现要点：
- 单入口 resolve：所有终态通过 `terminal()` 方法 resolve
- close handler 只注册一次
- 状态转换有守卫：非法转换抛 assert
- ABORTED 和 COMPLETED 是不同终态，调用方直接看 kind

### ResilienceLayer

统一 retry + failover 决策引擎。内部维护 `ResilienceState`，每次执行后通过 `decide()` 决定下一步。

决策流程（按优先级）：

1. `kind === "stream_abort"` → 不可恢复，abort
2. `kind === "success"` 且 statusCode < 400 → done
3. `kind === "throw"` → 网络异常可重试则 retry，否则 failover 或 abort
4. statusCode >= failoverThreshold → body 匹配 retry 规则则 retry，否则 failover 或 done
5. 其他 4xx → body 匹配 retry 规则则 retry，否则 done

同一 target 重试计数用尽后，如果 failover 可用且还有未排除的 target，切换 target 并重置重试计数。

### SemaphoreScope

```typescript
async withSlot<T>(providerId, signal, onQueued, fn): Promise<T> {
  const token = await this.manager.acquire(providerId, signal, onQueued);
  try { return await fn(); }
  finally { this.manager.release(providerId, token); }
}
```

一个请求只占一个槽位。Failover 切换 backend_model 但同 provider 时不重新 acquire。跨 provider failover 由 ResilienceLayer 抛出 `ProviderSwitchNeeded` 异常跳出 scope，Orchestrator 捕获后用新 providerId 重新调用 `withSlot()`。`ProviderSwitchNeeded` 携带 `targetProviderId` 字段，Orchestrator 据此决定是否重新 acquire。

约束：`semaphore.release()` 保证不抛异常（当前实现已满足：只做 dequeue 或 decrement，失败时 silent return）。

### TrackerScope

```typescript
async track<T>(req, fn, extractStatus): Promise<T> {
  this.tracker.start(req);
  try {
    const result = await fn();
    this.tracker.complete(req.id, extractStatus(result));
    return result;
  } catch (e) {
    this.tracker.complete(req.id, { status: "failed" });
    throw e;
  }
}
```

start/complete 永远配对。队列状态通知（queued: true/false）通过 SemaphoreScope 的 onQueued 回调触发，与 TrackerScope 解耦。

### ProxyOrchestrator

薄的编排层，只做三件事：

1. 组装 RequestContext
2. 调度各层
3. 处理早期拒绝（映射找不到、白名单不通过、Provider 不可用）

早期拒绝不消耗信号量槽位、不注册 tracker。通过检查后才进入 TrackerScope + SemaphoreScope + ResilienceLayer 的正式处理流程。

调用栈：

```
ProxyOrchestrator.handle()
  ├─ 早期拒绝检查（同步）
  └─ TrackerScope.track()
       └─ SemaphoreScope.withSlot()
            └─ ResilienceLayer.execute()
                 ├─ TransportLayer.call()
                 ├─ decide() → retry/failover/done
                 └─ ... (循环直到 done)
       ← finally: tracker.complete()
  ← finally: semaphore.release()
```

## 分阶段 PR 计划

### PR-1：TransportLayer 重构
- 新建 `src/proxy/transport.ts`，实现 StreamProxy 状态机和非流式封装
- 所有 transport 测试使用 mock
- 替换 `upstream-call.ts` 的调用方
- 删除 `upstream-call.ts`

### PR-2：ResilienceLayer 重构
- 新建 `src/proxy/resilience.ts`，统一 retry + failover 决策引擎
- 替换 `retry.ts` 和 `handleProxyPost` 中的 while(true) 循环
- 删除 `retry.ts`

### PR-3：横切层 + Orchestrator 重构
- 新建 `src/proxy/scope.ts`（SemaphoreScope + TrackerScope）
- 新建 `src/proxy/orchestrator.ts`（ProxyOrchestrator）
- 重写 `handleProxyPost` 为编排调用
- 更新 `openai.ts`、`anthropic.ts` 适配新接口

每个 PR 合并后代码可编译且测试通过，但不保证独立发布（PR 之间有删除旧文件的破坏性变更）。

分支策略：从 main 创建 `refactor/proxy-concurrency` 作为 dev 分支，3 个 PR 依次合并到 dev，验证通过后 dev 合并到 main。

## 测试策略

TDD 模式：在现有代码上先写 mock 测试覆盖所有路径，确认通过后重构，重构后测试不变只改导入路径。

Mock 原则：
- 不启动真实 HTTP 服务器
- 上游响应用 mock 函数模拟
- reply.raw 用 spy/mock 模拟 headersSent、writableEnded 等状态
- 信号量用 in-memory 实例，不 mock
