# proxy-core 故障转移集成

## 改动位置

`src/proxy/proxy-core.ts` 的 `handleProxyPost` 函数。

## 流程

```
1. resolveMapping(clientModel, { now }) → primary target
2. 执行 proxy 请求（含 retryableCall）
3. 如果最终结果失败且策略为 failover：
   a. 将当前 target 加入 excludeTargets
   b. resolveMapping(clientModel, { now, excludeTargets }) → next target
   c. 如果有 next target，用新 provider/model 重新发起请求
   d. 循环直到成功或无更多 target
```

## 判断"最终结果失败"

- retryableCall 的最后一次 attempt 的 statusCode >= 400
- 或 retryableCall 抛出异常

## 每次切换 target

- 新的 provider（从 resolveMapping 获取新的 provider_id）
- 新的 body.model（resolved.backend_model）
- 新的 apiKey（解密新 provider 的 api_key）
- 日志中 is_retry = 1（语义为"重试请求"，不区分同 provider 重试和跨 provider 故障转移）

## 流式请求限制

failover 循环**仅在 response headers 发送前**生效。一旦 proxyStream 开始向客户端写入 headers 或 pipe 数据，无法切换 target。

具体实现：
- 在 failover 循环入口检查 `reply.raw.headersSent`
- 流式请求如果 headers 已发送，直接返回当前结果，不再尝试下一个 target
- 这意味着流式请求的 failover 仅在连接建立失败、上游返回错误且未开始流式传输时生效

## 限制

- 非 failover 策略完全不受影响，走原有路径
- failover 循环上限 = targets 数量（最多尝试所有 target）
