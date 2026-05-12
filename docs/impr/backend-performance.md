# llm-simple-router 后端性能分析报告

> 分析日期：2026-05-12 | 代码基：feat-performance-impr 分支

---

## 总览评分：6.5/10

整体架构设计合理，核心路径的性能意识较强（keep-alive、statement cache、WAL 模式、流式缓冲区大小限制、SSE 节流广播等）。主要扣分点集中在三个方面：

1. **同步 SQLite 写入阻塞事件循环**，且发生在每条请求的热路径上（日志 + 指标各一次 INSERT），高并发时累积延迟显著。
2. **流式代理的内存冗余**：StreamProxy 维护两份相同的 chunk 数组（bufferChunks + captureChunks），MetricsExtractor 持有 3 个独立字符串数组并频繁 join()。
3. **JSON 序列化/解析在热路径上被重复调用**：同一个请求体在多个地方被 JSON.stringify，同一个 SSE data 字符串在 BaseSSETransform 和 SSEMetricsTransform 中分别 JSON.parse。

后续章节逐项分析。

---

## 1. 流式代理性能（评级：7/10）

### 1.1 Buffer 策略

`StreamProxy` 使用两阶段状态机（BUFFERING → STREAMING），在 BUFFERING 阶段积累数据直到：
- 总字节数 >= 4096 (BUFFER_SIZE_LIMIT)，或
- 检测到 `\n\n`（SSE 事件边界）

**优点：**
- 阈值 4096 字节合理，兼顾早期错误检测和首次字节延迟。
- 跨 chunk 边界 `\n\n` 检测通过 `lastChunkEndedWithNewline` 实现，无需每 chunk 做字符串拼接。

**问题：**

| 问题 | 严重度 | 描述 |
|------|--------|------|
| 重复 chunk 数组 | 中 | `bufferChunks` 和 `captureChunks` 存储相同的 Buffer 引用（分别 push），内存占用翻倍。BUFFERING 阶段的 chunk 列表本质上是临时结构，两份完全冗余。 |
| Buffer.concat 中间产物 | 中 | 当触发 startStreaming 时调用 `Buffer.concat(this.bufferChunks)` 生成临时 Buffer，然后逐 chunk 写回 pipeEntry。concat 产生了不必要的内存分配——可以直接遍历 bufferChunks 逐个写入。 |
| sseScanBuffer 字符串复制 | 低 | STREAMING 阶段的错误扫描使用 `this.sseScanBuffer.slice(-SSE_SCAN_MAX)`，每次 chunk 到达时都创建新的 8KB 字符串切片。更好的方案是用环形 buffer（固定大小 Buffer + 写入指针），只在需要匹配时才 decode 为字符串。 |
| PassThrough 手动转发 | 低 | `passThrough.on("data")` 手动写入 `reply.raw.write(chunk)`，注释说避免 Node.js 自动注册 close/finish handler。这种担忧合理，但代价是丢失了 pipe 的背压处理。当前实现吞掉所有 write 异常（客户端断开），行为正确但无法利用背压信号反压上游。 |

**改进建议：**
1. 移除 `captureChunks`，BUFFERING 阶段的早期错误检查改为定时检查（可用 idleTimer 扩展），或在 bufferChunks 积累到阈值时再做检查。
2. 进入 STREAMING 阶段时用 `for (const c of this.bufferChunks) this.pipeEntry.write(c)` 替代 `Buffer.concat` + 单次 write，避免中间 buffer 分配。
3. sseScanBuffer 改用 `Buffer.allocUnsafe(SSE_SCAN_MAX)` + 环形写入，仅在检测到 `event: error` 标记时才 decode 检查。

### 1.2 背压处理

当前实现未连接背压信号链。`passThrough.on("data")` 写入 `reply.raw` 时不检查 `write()` 的返回值（是否返回 false），也不监听 `drain` 事件。

**风险评估：** 低。流式 LLM 响应速率通常远低于 TCP 发送速率（几十 tokens/s vs 数百 MB/s 带宽），实际场景中背压不太可能触发。但如果未来支持高吞吐场景（如图片生成流），需要关注。

**改进建议：** 短期不需要处理，可在代码注释中明确此假设。

### 1.3 超时管理

`idleTimer` 逻辑正确：每次收到 chunk 时重置，超时后同步写入错误 SSE 再调用 terminal。`setTimeout` 在主流场景中开销可忽略。唯一的微优化：可以用 `timer.refresh()` (Node 11+) 替代 `clearTimeout` + `setTimeout`，减少 Timer 对象分配。

---

## 2. 并发模型（评级：8/10）

### 2.1 信号量实现

`SemaphoreManager` 使用 Promise 队列实现，核心逻辑正确：

**优点：**
- Generation-based token 验证防止了 disable+re-enable 竞态条件后旧请求释放错误计数。
- `maxConcurrency` 动态降低时不截断 current（自然回落），避免信号量卡死。此设计细节处理得当。
- AbortSignal 集成：客户端断连时自动从队列中移除等待者。

**观察（非问题）：**
- 队列出队使用 `shift()`（O(n)），但单 provider 队列长度通常不超过 `maxQueueSize`（一般来说 < 1000），O(n) 在此规模下可忽略。若有极端配置（maxQueueSize=100000），可改为链表实现。
- 每个等待请求创建一个 `QueueEntry` 对象 + 可能的 AbortSignal listener + 可能的 setTimeout timer。在高并发排队场景（每秒数千请求排队），对象分配率可观。但这类场景通常受限于上游 capacity，队列规模不超过 maxQueueSize，实际影响有限。

### 2.2 自适应控制器

`AdaptiveController` 实现了水位梯度控制，公式参数化。`syncToSemaphore()` 调用 `semaphoreControl.updateConfig()` 更新限制，通过 generation 机制实现平滑切换。

**注意：** `onRequestComplete()` 的冷却期检查 `Date.now() < s.cooldownUntil` 会在冷却期内吞掉所有成功事件的计数累积。这是设计意图（429 后冷却期内不计分），逻辑正确。

### 2.3 可观测性

`SemaphoreManager.getStatus()` 返回 active/queued 计数。`AdaptiveController.getStatus()` 返回完整自适应状态。RequestTracker 通过 SSE 广播实时并发数据——设计完备。

---

## 3. 数据库性能（评级：5/10）

### 3.1 同步操作阻塞事件循环

**这是当前最大的性能风险。** `better-sqlite3` 是同步库，所有查询和写入直接阻塞当前事件循环 tick。

热路径上的同步 DB 操作统计（单次请求）：

| 操作 | 调用次数 | 说明 |
|------|----------|------|
| `insertRequestLog` | 1（成功）/ N（retry/failover） | 每条请求必须记录日志 |
| `insertMetrics` | 1（成功） | 指标写入 |
| `getSetting` | 2-3 | 读取 encryption_key、token_estimation_enabled 等 |
| `resolveMapping` 的 DB 查询 | 1（首次，后续缓存） | mapping_groups + schedules + providers |

这些操作在高并发（如每秒 200 请求）下会累积大量同步阻塞时间。假设单次 INSERT 耗时 0.5ms，200 QPS 意味着每秒有 ~100-150ms 的事件循环被 DB 写入独占，在这期间无法处理其他请求的 I/O 回调。

**改进建议：**

| 优先级 | 方案 | 说明 |
|--------|------|------|
| P0（推荐） | 日志写入改为 WAL 缓冲 + 异步批量写入 | 在内存中缓冲 50-100ms 的日志条目，用一个定时器批量 `INSERT`。请求线程只负责写入内存 buffer，不等待磁盘 I/O。实现复杂度中等，收益显著。 |
| P1 | Worker Thread 隔离 | 将 `better-sqlite3` 实例移到 Worker Thread，主线程通过 MessagePort 异步通信。由于项目中广泛使用 `getCachedStmt` 和 WeakMap，迁移工作量较大。 |
| P2 | 替换为异步 SQLite 绑定（如 `bun:sqlite` 或 `better-sqlite3` + `node:worker_threads`） | 长期方案，需评估生态兼容性。 |

**兼容性提醒：** 项目已有 `request_metrics` 独立表（migration 021、026），表明日志和指标已解耦——这是实现异步写入的良好前置条件。

### 3.2 索引分析

现有索引（migration 009 + 044）：

```sql
-- request_logs
idx_request_logs_created_at ON request_logs(created_at DESC)
idx_request_logs_api_type ON request_logs(api_type)
idx_request_logs_provider_id ON request_logs(provider_id)
idx_request_logs_created_at_provider ON request_logs(created_at DESC, provider_id)
idx_request_logs_created_at_router_key ON request_logs(created_at DESC, router_key_id)

-- request_metrics
idx_metrics_router_key ON request_metrics(router_key_id)
idx_metrics_created_at_router_key ON request_metrics(created_at, router_key_id)
```

**缺失的索引：**

| 查询 | 所需索引 | 影响 |
|------|----------|------|
| `getMetricsSummary` 按 provider_id + is_complete + created_at 聚合 | `request_metrics(provider_id, is_complete, created_at)` | 统计 Dashboard 聚合查询扫描范围过大 |
| `getMetricsSummary` 按 backend_model + is_complete + created_at 聚合 | `request_metrics(backend_model, is_complete, created_at)` | 同上 |
| `getMetricsTimeseries` 按 (provider_id, is_complete, created_at) 分组 | 同上，复合索引可覆盖 | 时序查询需全表扫描后分组 |
| `getRequestLogsGrouped` 按 original_request_id IS NULL 过滤 + 时间排序 | `request_logs(original_request_id, created_at DESC)` | 分组视图页分页查询效率 |
| `getRequestLogChildren` 按 original_request_id = ? | 当前 original_request_id 无索引 | 子请求查询全表扫描 |
| Admin API 按 status_code 过滤 | `request_logs(status_code)` | 日志过滤页常用但无索引 |

`request_metrics` 表的索引严重不足。该表是 Dashboard 统计查询的主表，但仅有两个 router_key 相关索引。`getMetricsSummary` 和 `getMetricsTimeseries` 的高频查询使用 `is_complete = 1 AND created_at >= datetime(...)` 过滤，缺少覆盖索引会导致全表扫描。

**改进建议：**
```sql
-- 核心聚合索引
CREATE INDEX idx_metrics_agg ON request_metrics(is_complete, created_at, provider_id, backend_model);

-- 分组日志
CREATE INDEX idx_logs_original ON request_logs(original_request_id, created_at);
CREATE INDEX idx_logs_status ON request_logs(status_code);
```

### 3.3 PRAGMA 配置

当前配置（`initDatabase`）：

| PRAGMA | 值 | 评估 |
|--------|-----|------|
| journal_mode=WAL | 正确 | 读写并发不互相阻塞 |
| synchronous=NORMAL | 正确 | 性能最佳且 WAL 模式下安全 |
| cache_size=-16000 | 16MB，合理 | 对于日志密集型场景可加大到 32-64MB |
| mmap_size=67108864 | 64MB | 合理 |
| temp_store=MEMORY | 正确 | 避免临时文件 I/O |
| busy_timeout=5000 | 5s，偏长 | WAL 模式下基本不会触发 busy，可缩短到 1000ms |
| auto_vacuum=INCREMENTAL | 合理 | 配合 incremental_vacuum 手动管理 |
| journal_size_limit=67108864 | 64MB | 合理，限制 WAL 文件上限 |

### 3.4 Statement Caching

`getCachedStmt` 使用 `WeakMap<Database, Map<string, Statement>>` 模式缓存 prepared statement。此设计正确，避免每次调用重复 `prepare()`。

**注意：** `WeakMap` 以 `Database` 实例为 key，当 `Database` 实例被 GC 时，Map 自动回收。但多个请求共享同一个 `Database` 实例，`Map` 会持续增长到覆盖所有 SQL 模板。当前 SQL 模板数量有限（~30-40 个），不会造成问题。

### 3.5 日志写入性能

`insertRequestLog` 在热路径上同步写入约 19 个字段的 INSERT。每个失败重试（resilience 层）会额外产生日志条目。

`logResilienceResult` 对每个 attempt 调用一次 `insertRequestLog`。在 failover 场景下（尝试 N 个 provider），会产生 N 条日志记录——这是合理的审计需求，但强化了异步写入的必要性。

---

## 4. HTTP 传输层（评级：8/10）

### 4.1 连接复用

`ProxyAgentFactory` 提供两层 Agent：
- 无代理：全局 keep-alive Agent（`http.Agent` / `https.Agent`），`maxSockets=50`，`keepAliveMsecs=30000`
- 有代理：按 provider 缓存的 `HttpsProxyAgent` / `SocksProxyAgent`

**优点：**
- 全局 Agent 避免了每个请求创建新 TCP 连接的开销。
- `keepAliveMsecs=30000` 保持空闲连接 30 秒，减少 TLS 握手次数。
- 有代理的 provider 按 URL 缓存 agent，配置变更时通过 `invalidate()` 清理。

**问题：**
- `maxSockets=50` 对所有 provider 共享。若上游有 10 个活跃 provider，每个只有 5 个可用连接——显著不足。Node.js Agent 的 `maxSockets` 是按 host:port 维度的，但这是全局 Agent，所有请求共享同一个 Agent 实例下的 socket 池。实际上，应该按 provider 的 host 维度创建独立的 Agent 或更高上限。

**改进建议：**
1. 为不同 host 创建独立的 Agent 实例，或使用 `keepAliveMaxFreeSockets` + 更高 `maxSockets`。
2. 考虑按 provider 维度设置 Agent（当前实现对所有无代理 provider 使用同一个全局 Agent），不同 provider 的并发压力不同，共享 socket 池可能导致队头阻塞。

### 4.2 DNS 缓存

Node.js 默认使用系统 DNS 解析器（`dns.lookup`），依赖操作系统缓存。未显式设置 DNS TTL。

**风险评估：** 低。上游 provider 的 IP 通常稳定。若频繁遇到 DNS 解析延迟，可引入 `cacheable-lookup` 或设置 `dns.setDefaultResultOrder('ipv4first')`。

### 4.3 超时配置

- 流式超时：`getModelStreamTimeout` 从 provider 配置读取，默认 ~3000s
- 非流式：依赖 Node.js 默认 socket 超时（无显式设置）
- 队列超时：`queueTimeoutMs`，从 provider 配置读取
- 空闲超时（StreamProxy）：`idleTimer`，流式阶段无新数据时触发

**缺失：** `callNonStream` 未设置 `req.setTimeout()`，若上游不响应（TCP 连接建立成功但 HTTP response 永不到达），请求将永久挂起，直到 Node.js 默认 socket 超时（通常 2 分钟）或客户端断开。

**改进建议：** 在 `callNonStream` 中添加 `req.setTimeout(timeoutMs, ...)` 并 abort 请求。

### 4.4 JSON.stringify 开销

`callNonStream` 和 `callStream` 中都会执行 `JSON.stringify(body)`。对于包含大量 tool definitions 或长 system prompt 的请求，body 可能达到 100KB-1MB，序列化开销可观。

**改进建议：** `failover-loop.ts` 中已经预计算了 `reqBodyStr`，可将其作为参数传入 transport 层，避免重复序列化。当前 `transport-fn.ts` 将 body 传入但 http.ts 仍然重新 `JSON.stringify`。

---

## 5. 内存管理（评级：6/10）

### 5.1 StreamProxy Buffer 内存

**冗余存储（见 1.1）：** `bufferChunks` 和 `captureChunks` 完全相同。对于流式大响应（如 100KB 响应体），BUFFERING 阶段会持有两份 chunk 引用。

### 5.2 MetricsExtractor 内存

当前实现维护三个独立的字符串数组：
- `thinkingChunks: string[]`（上限 500KB 总长）
- `textChunks: string[]`（上限 500KB 总长）
- `toolUseChunks: string[]`（上限 500KB 总长）

**问题：**
- 每次 `getMetrics()` 调用（按 throttle 5s 或流结束时）执行 `thinkingChunks.join("")`，这会创建一个最多 500KB 的中间字符串，然后传给 `countTokens()` 做 token 计数。
- `countTokens` 对 >4000 字符的文本采用采样策略，但 join 仍然产生了完整字符串。
- 实际上，`getMetrics()` 中 `join()` 创建完整字符串后，`countTokens` 只读取前 4000 字符——完全不需要 join。可修改 `countTokens` 接受 string array 参数，内部只 join 前 SAMPLE_SIZE 字符。

**改进建议：**
1. `countTokens` 增加 `countTokensFromChunks(chunks: string[]): number` 重载，避免中间 join。
2. 或者直接在 `MetricsExtractor.getMetrics()` 中将 join 替换为按需读取（只取前 SAMPLE_SIZE 字符）。

### 5.3 RequestTracker 内存

- `activeMap`：每条活跃请求一个 `ActiveRequest` 对象。高并发下（1000 活跃请求），每个对象 ~200 bytes，总计 200KB——可忽略。
- `recentCompleted`：最多 200 条，5 分钟 TTL。`ActiveRequest` 对象包含 `clientRequest` 和 `upstreamRequest` 字符串（分别是完整的 JSON 请求体和上游请求摘要）。这些字符串可能各为 10-100KB。200 条 * 100KB = 20MB——不可忽略。
- `streamAccumulators`：Map 存储 `StreamContentAccumulator` 实例，每个维护最多 `DEFAULT_MAX_RAW * 30` 的原始行缓存。流式请求完成后应立即清理，但当前仅在 `complete()` 时清理（通过 `scheduleCleanup`）。

**改进建议：**
1. 对 `recentCompleted` 中的 `clientRequest` 和 `upstreamRequest` 做更积极的截断（当前可能存储完整请求体），或改为引用已写入 DB 的日志 ID 而非内联数据。
2. 确保 `streamAccumulators` 在流式请求完成/异常时被及时清理，增加防御性清理逻辑（如定时器扫描过期 accumulator）。

### 5.4 事件监听器泄漏风险

检查所有 `on("data")` / `on("end")` / `on("error")` 注册，关键的清理点：
- `StreamProxy.registerCloseHandler()` 注册 `reply.raw.on("close")`——只注册一次（`closeHandlerRegistered` 标志），生命周期跟随 reply，无泄漏。
- `callStream` 中 `upstreamRes.on("data")` / `upstreamRes.on("end")` / `upstreamRes.on("error")`——这些是单次响应监听器，响应结束后由 Node.js 自动清理，无泄漏。
- `create-proxy-handler.ts` 中 `request.raw.socket.on("error")`——在 `reply.raw.on("close")` 中 remove，正确。

**结论：** 当前实践中未发现明显的事件监听器泄漏模式。

---

## 6. 格式转换性能（评级：6/10）

### 6.1 六向转换

系统支持 OpenAI ↔ Anthropic ↔ Responses 的六向转换。转换路径：

- **请求转换**（`formatRegistry.transformRequest`）：同步执行，在每次请求开始时调用一次。CPU 开销主要体现在对象结构重组和字段映射。对于包含大量 tool definitions 的请求，开销中等（~1-5ms）。
- **流式转换**（`formatRegistry.createStreamTransform`）：通过 Transform stream 逐事件转换。每个 SSE 事件需要 `JSON.parse` → 类型判断 → 重组 → `JSON.stringify`。对于高 tps 的流式响应（如 100 tps），每秒 100 次 JSON 操作。

**问题：**

| 问题 | 影响 |
|------|------|
| **双重 JSON.parse** | `BaseSSETransform`（格式转换流）和 `SSEMetricsTransform`（指标采集流）分别对同一个 SSE data 做 `JSON.parse`。`SSEMetricsTransform` 是旁路采集，理论上可以接收已解析的对象而非原始文本。 |
| **流式转换中多余的数据重组** | Anthropic content_block_delta → OpenAI choices.delta 转换需要重组 JSON 结构。每条 delta 都需要创建新对象 + JSON.stringify。对于高频小 delta 的场景（如 thinking 流），元数据开销可能超过实际内容。 |
| **requestTransform 无缓存** | 同一个 client_model + provider 的转换结果理论上固定（tool definitions 不变时），但当前每次都重新执行转换。不常见但可优化。 |

**改进建议：**
1. `SSEMetricsTransform` 接收已解析的 JSON 对象而非原始 data 字符串。当前 `onContentDelta` 回调已做了一半工作（从 data 提取文本），但 `MetricsExtractor.processEvent` 仍然独立 `JSON.parse`。两阶段可合并。
2. 短期的优化：在流式转换链中，`BaseSSETransform` parse 后可将结果通过某种 side channel 传递给 `SSEMetricsTransform`，避免第二次 parse。
3. `tool-mapper.ts` 中的 tool definition 转换结果可考虑缓存（以 client tools JSON + target API type 为 key）。对于包含数十个大型 tools 的请求，转换开销可能超过 5ms。

### 6.2 Transform Stream 实现

`BaseSSETransform` 使用 `SafeSSEParser`（SSEParser 子类 + 64KB 缓冲区保护）。`_transform` 中：
1. `chunk.toString("utf-8")` — Buffer → string
2. `parser.feed(text)` — 行缓冲 + 事件分割
3. `processEvent(event)` — JSON.parse + 类型判断 + 重组
4. `pushAnthropicSSE()` / `pushOpenAISSE()` — JSON.stringify + push

每一步都是必要的，无显著冗余。`_flush` 中调用 `ensureTerminated()` 在 `process.nextTick` 上下文中传播（通过 `setImmediate` 延迟 reply 关闭），代码适配正确。

---

## 7. 钩子系统开销（评级：8/10）

### 7.1 钩子注册和执行

9 个内置 hook，按优先级排序。`proxyPipeline.emit` 串行执行，每个 hook 的 `execute()` 返回 Promise。

**评估：**

- `pre_route` 阶段的 `client-detection` hook 需要读取 DB settings，是同步调用，开销 ~0.5ms。
- `enhancement-preprocess` (在 create-proxy-handler 中手动调用，非通过 pipeline)：包含工具轮数限制检查 + 工具循环检测，其中 `applyToolRoundLimit` 需要 `JSON.parse` + 遍历 messages + `JSON.stringify`，对于长对话开销中等（~1-3ms）。
- `cache-estimation` hook 在非流式请求成功后才执行（通过 `collectTransportMetrics`），使用 `cacheEstimator.estimateHit()`，涉及 tokenizer 调用。

**优点：** hook 执行链短（9 个），无递归嵌套调用，优先级控制避免复杂依赖。

### 7.2 可优化项

`cache-estimation` hook 在主请求路径的 `collectTransportMetrics` 中被调用。`cacheEstimator.estimateHit()` 需要 tokenize 请求体以计算前缀匹配。当前在 `estimateInputTokens` fallback（token 估算）之后再次 tokenize——两次 tokenize 同一请求体。

**改进建议：** 在 `collectTransportMetrics` 中将 `estimateInputTokens` 的结果缓存到 metadata，`cache-estimation` hook 复用已有的 tokenization 结果。

---

## 8. 日志和监控（评级：6/10）

### 8.1 日志写入同步性

`insertRequestLog` 和 `insertMetrics` 都是同步 better-sqlite3 调用（参见第 3 节），阻塞事件循环。

### 8.2 RequestTracker 广播效率

`RequestTracker.broadcast` 向所有连接的 SSE 客户端推送事件。当前事件类型：
- `request_start`：每请求一次
- `request_update`：queued 状态变化
- `stream_content_update`：每 500ms 批量
- `stream_metrics`：metrics 更新
- `snapshot`：每 5s 完整状态快照（含 activeMap + recentCompleted + stats）
- `runtime`：每 2s

高并发场景下的消息量：
- 200 QPS → 每秒 ~200 次 `request_start` 广播
- 每个活跃请求每 500ms 产生一次 `stream_content_update`
- 每 5s 产生一次完整状态快照（1000 活跃请求的 JSON 序列化）

**改进建议：**
1. `request_start` 的广播可改为增量而非全量（当前传递给每个 SSE client 的是单个 `ActiveRequest` 对象，非批量——这已经是增量，没问题）。
2. `snapshot`（5s 定时完整快照）在高并发下需要序列化所有活跃请求的 JSON。当前只有 200 条 recentCompleted，但活跃请求可能多达 1000+。建议增加 snapshot 的数据量上限或改用增量 diff 协议。

### 8.3 SSEMetricsTransform 节流

`onMetrics` 回调 throttle 5s，合理。`onChunk` 每行都触发，但只追加到 tracker 的 streamAccumulator。

### 8.4 LogFileWriter

`insertRequestLog` 中先写文件（`writeContext.logFileWriter.write()`），再写 DB。这是同步文件写入（`fs.appendFileSync` 或 stream write），增加了解耦点但可能引入 I/O 延迟。

如果 logFileWriter 使用 `fs.createWriteStream`，写入是异步的（缓冲 → 事件循环清空时 flush），不会阻塞。但如果使用 `fs.appendFileSync`，则和 SQLite 一样阻塞事件循环。

---

## 9. Token 计数（评级：7/10）

### 9.1 gpt-tokenizer 调用频率

`countTokens` 被调用的位置：
1. `estimateInputTokens`：API 未返回 input_tokens 时（如 GLM），在 `collectTransportMetrics` 中调用
2. `getMetrics()` (MetricsExtractor)：流式结束时计算 thinking_tokens、text_tokens、tool_use_tokens
3. `cache-estimation` hook：`cacheEstimator.estimateHit()`

对于未返回 usage 的 upstream API，一次请求可能触发 tokenizer 2-3 次：
- 1 次：`estimateInputTokens`（非流式或 metrics 缺失）
- 1 次：`cacheEstimator.estimateHit()`（非流式请求）
- 1-3 次：`getMetrics()` 中的 thinking/text/tool_use count（仅流式）

### 9.2 长文本采样策略

`countTokens` 对 >4000 字符的文本只编码前 4000 字符，按字符比率外推。此策略在两种情况下有显著误差：
1. 文本包含大量非 ASCII 字符（中文、代码）：中文字符 token 化效率低于英文，字符比率外推会低估 token 数。
2. 文本结构不均匀（如前面是系统 prompt，后面是 JSON tools）：采样可能只覆盖 prompt 部分。

**实用考量：** 当前此估算值仅用于 `input_tokens_estimated` 字段（标记为 estimated），不用于计费或限流决策。精度偏差在实际使用中影响有限。

### 9.3 性能优化机会

`getMetrics()` 中 `thinkingChunks.join("")` → `countTokens(content)` 的模式是主要开销（见 5.2 节）。对于 500KB thinking 内容，join 分配 500KB 字符串，然后 countTokens 只使用前 4000 字符。

**改进建议：** 添加 `countTokensFromChunks(chunks: string[], limit: number)` 函数，只 join 必要的前 N 个字符。

---

## 10. 资源池化（评级：7/10）

### 10.1 HTTP Agent 连接池

当前配置：全局 `http.Agent({ keepAlive: true, maxSockets: 50 })` / `https.Agent({ keepAlive: true, maxSockets: 50 })`。所有无代理 provider 共享同一个 Agent。

**问题：**
- `maxSockets=50` 是按 host 而非全局的——Node.js Agent 内部对每个 host:port 维护一个 socket 池，`maxSockets` 是每个 host 的上限。所以每个 provider host 最多 50 个并发连接，总体上限远高于 50——此理解需要验证。如果 Node.js 版本 >19，`maxSockets` 确实 per-origin，50 合理。
- 但 `keepAliveMaxFreeSockets` 未设置（默认 256），空闲连接数上限偏高。对于只有少数 provider 的场景影响不大。

### 10.2 Proxy Agent 缓存

按 provider.id → `{ agent, proxyUrl }` 缓存。配置变更时通过 `invalidate()` 清理。缓存无上限，但 provider 数量通常 < 100，无问题。

### 10.3 数据库连接

`better-sqlite3` 是单连接模型，无需连接池。当前使用一个 `Database` 实例，正确。

### 10.4 缺失的资源池化

无。系统组件合理。

---

## 优先级排序改进清单

### 高优先级（建议本迭代修复）

| # | 问题 | 建议方案 | 预期收益 | 实现复杂度 |
|---|------|---------|---------|-----------|
| H1 | 同步 SQLite 日志写入阻塞事件循环 | 内存缓冲 + 批量异步写入（50-100ms 批量） | 高并发下 P99 延迟降低 30-50% | 中 |
| H2 | `request_metrics` 缺少复合索引 | 添加 `(is_complete, created_at, provider_id, backend_model)` 索引 | Dashboard 查询速度提升 10-100x | 低 |
| H3 | StreamProxy 重复 chunk 数组 (bufferChunks + captureChunks) | 移除 captureChunks，用 bufferChunks 做早期错误检测 | 流式请求内存减半 | 低 |
| H4 | MetricsExtractor getMetrics() 中不必要的 join()  | join 前截断到 SAMPLE_SIZE；或改为 countTokens 接受 chunks 参数 | 流式请求内存峰值降低 ~500KB | 低 |

### 中优先级（下个迭代）

| # | 问题 | 建议方案 | 预期收益 | 实现复杂度 |
|---|------|---------|---------|-----------|
| M1 | callNonStream 缺少请求超时 | 添加 `req.setTimeout()` | 防止上游不响应导致连接挂起 | 低 |
| M2 | transport 层重复 JSON.stringify(body) | 复用 failover-loop 中已计算的 reqBodyStr | 减少大请求体序列化开销 | 低 |
| M3 | SSEMetricsTransform 与 BaseSSETransform 双重 JSON.parse | SSEMetricsTransform 接收已解析对象，避免第二次 parse | 流式每 chunk 减少一次 JSON.parse | 中 |
| M4 | request_logs 缺少 original_request_id 和 status_code 索引 | 添加索引 | 日志查询和分组视图性能提升 | 低 |
| M5 | recentCompleted 存储完整 clientRequest/upstreamRequest JSON | 截断或改为按需从 DB 读取 | 内存占用降低 >50% | 低 |
| M6 | sseScanBuffer 每次 slice(-8KB) 创建新字符串 | 改用环形 Buffer + 按需 decode | 微优化，减少 GC 压力 | 低 |

### 低优先级（长期优化）

| # | 问题 | 建议方案 | 预期收益 | 实现复杂度 |
|---|------|---------|---------|-----------|
| L1 | Worker Thread 隔离 SQLite | 将 better-sqlite3 移到 Worker Thread，主线程异步通信 | 彻底消除同步阻塞 | 高 |
| L2 | HTTP Agent 按 provider host 独立创建 | 替代全局共享 Agent | 避免跨 provider 队头阻塞 | 中 |
| L3 | tool-mapper 转换结果缓存 | 以 client tools + target API type 为 key 缓存转换结果 | 大 tools 请求减少 ~5ms | 中 |
| L4 | request_metrics 查询百分位 (P50/P95) 实现 | 当前返回 null，实际需要 app 层计算 | 补齐 Dashboard 功能 | 中 |
| L5 | countTokens 改用 Streaming BPE | 对 >4000 字符文本避免采样误差 | 提高 token 估算精度 | 高 |
| L6 | StreamProxy Buffer.concat 优化 | 遍历 bufferChunks 逐个写入，避免 concat | 减少内存分配 | 低 |
| L7 | pipeline hook 执行引入并行化 | 无数据依赖的 hook 并发执行 | 减少请求前处理耗时 | 高 |
| L8 | PRAGMA cache_size 增大到 32MB | 日志密集型场景下提高缓存命中率 | 减少磁盘 I/O | 低 |

---

## 附录：性能测试建议

| 测试场景 | 目标 | 指标 |
|---------|------|------|
| 50 并发 × 流式请求（3 个 provider） | 基线性能 | P50/P99 延迟、TTFT、吞吐 |
| 200 并发 × 流式请求（3 个 provider） | 高并发压力 | 错误率、信号量队列深度、P99 延迟 |
| 10 并发 × 非流式请求（tools > 50） | 格式转换压力 | 转换耗时、内存峰值 |
| 日志量 100 万条下的 Dashboard 查询 | 统计查询性能 | `getMetricsSummary` 耗时 |
| Provider 故障恢复（模拟 5xx） | Resilience 性能 | failover 耗时、重试次数分布 |
