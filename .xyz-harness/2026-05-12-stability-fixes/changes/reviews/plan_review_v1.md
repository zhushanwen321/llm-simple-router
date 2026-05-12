# 计划评审 v1

- 评审时间: 2026-05-12
- 评审类型: 计划评审（spec.md + plan.md）
- 评审对象: 稳定性修复批次 — 8 项修复（F1-F8）

---

## 发现的问题

| # | 优先级 | 文件/范围 | 描述 | 建议 |
|---|--------|----------|------|------|
| 1 | **MUST FIX** | Task 4 (LogWriteBuffer) | **调用路径不完整**。Spec 和 Plan 声称修改 `proxy/log-helpers.ts` 和 `index.ts` errorHandler，但实际热路径上 `insertRequestLog` 和 `insertMetrics` 的调用点远不止这些。经过全量 grep：`proxy-logging.ts`（`logResilienceResult` + `collectTransportMetrics`，5 个调用点）、`proxy/handler/failover-loop.ts`（2 个调用点）、`proxy/handler/create-proxy-handler.ts`（1 个调用点）、`proxy/hooks/builtin/error-logging.ts`（2 个调用点）——共 10+ 个调用点。Plan 只提到了 `log-helpers.ts` 和 `index.ts`，遗漏了大量调用路径。如果不修改这些调用点，缓冲化无法覆盖热路径，性能收益大打折扣。 | Plan 必须列出所有 `insertRequestLog`/`insertMetrics` 的调用点并逐一说明处理方式。或者改为不修改调用点，而是在 `insertRequestLog`/`insertMetrics` 函数内部透明地使用缓冲（通过模块级 singleton），这样调用点零修改。后者风险更低。 |
| 2 | **MUST FIX** | Task 4 (LogWriteBuffer) | **insertMetrics 返回值问题被低估**。`insertMetrics(db, m)` 返回 UUID string，`collectTransportMetrics` 中 `extractFn` 闭包的返回值虽然没有被使用，但 `logResilienceResult` 最后返回 `lastSuccessLogId`（是 request_log 的 ID，不是 metrics ID）。然而如果将来有人依赖 metrics ID，缓冲化会导致 ID 不存在于 DB 中。Plan 中"返回临时 UUID"的方案不完整——`insertMetrics` 当前在函数内部 `const id = randomUUID()` 再 `INSERT`，改为缓冲后这个 ID 不会立即写入 DB，任何在 flush 前通过 ID 查询 metrics 的代码都会返回空。 | 方案 A：在缓冲层预生成 ID（push 时生成，flush 时使用），保持 API 契约不变。方案 B：改为在 `insertMetrics` 内部通过 singleton 透明缓冲，不需要改变签名。两种方案都需要明确写入 Plan。 |
| 3 | **MUST FIX** | Task 4 (LogWriteBuffer) | **LogFileWriter 与 LogWriteBuffer 协作未说明**。`insertRequestLog` 内部同时写文件（`writeContext.logFileWriter.write()`）和写 DB。文件写入是异步的 WriteStream，DB 写入将变为缓冲。Plan 未说明 LogFileWriter 的写入是否也走缓冲，还是保持现状（文件写入不需要缓冲，它本身已经是异步 WriteStream）。如果 LogWriteBuffer 只缓冲 DB 部分，那 `insertRequestLog` 函数需要拆分为"文件写入立即执行 + DB 写入缓冲"两步。 | Plan 中需明确：LogFileWriter.write() 保持同步调用（它已经是异步 WriteStream，不阻塞事件循环），只有 DB INSERT 部分走 LogWriteBuffer 缓冲。这意味着不能简单地将 `insertRequestLog` 整体替换为 `buffer.pushLog()`，需要在 `insertRequestLog` 内部区分文件写入和 DB 写入。 |
| 4 | **MUST FIX** | Task 4 (LogWriteBuffer) | **测试策略矛盾**。Plan 说"测试中的 :memory: db 可以选择不走缓冲（直接调用原始函数），降低测试复杂度"。但 LogWriteBuffer 如果是透明封装在 `insertRequestLog` 内部，测试会自动走缓冲，无法绕过。如果 LogWriteBuffer 是上层封装，那热路径需要改调用方式，又回到问题 #1。两者互相矛盾。 | 需要在 Plan 中明确一种模式并贯穿始终。推荐方案：在 `insertRequestLog`/`insertMetrics` 内部通过模块级变量控制是否使用缓冲（`let bufferEnabled = true`），测试时设置 `bufferEnabled = false`。或者 LogWriteBuffer 提供 `passthrough` 模式。 |
| 5 | **MUST FIX** | Task 6 (captureChunks 移除) | **时序分析存在遗漏**。Plan 声称"onEnd 中 BUFFERING 分支只在从未触发 startStreaming 的情况下执行"——这在当前代码中是正确的，因为 `onEnd` 检查 `this.state === "BUFFERING"`，而 `startStreaming` 会将其转为 STREAMING。但 Plan 忽略了一个关键路径：**checkEarlyError 为 undefined 时**。看 `callStream` 中 `if (!checkEarlyError) proxy.startStreaming()`——当没有 early error checker 时，startStreaming 在收到上游 response 后立即调用，此时 bufferChunks 立即被清空。这个路径不涉及 captureChunks，不受影响。但当 checkEarlyError 存在且 onEnd 时仍在 BUFFERING（即整个响应 < 4KB 且无 `\n\n`），确实 bufferChunks 未被清空。分析结论虽然正确，但 Plan 中缺少对 `checkEarlyError` 为 undefined 路径的说明，容易导致实现者遗漏这个分支。 | 在 Plan 中补充完整的时序分析：区分 checkEarlyError 存在和不存在两条路径，并说明两者都不受影响的原因。 |
| 6 | **MUST FIX** | Task 6 (captureChunks 移除) | **onData 中 bufferChunks 的早期错误检测路径也依赖 captureChunks**。当 `totalBuffered >= BUFFER_SIZE_LIMIT` 时，代码 `Buffer.concat(this.bufferChunks)` 并用 `checkEarlyError` 检测。如果检测到错误，transition 到 EARLY_ERROR 并 terminal，此时 bufferChunks 不会被清空。但 `onEnd` 不会执行（因为 `this.resolved = true`），所以没有问题。但如果有 `\n\n` 检测通过后 startStreaming 被调用，bufferChunks 被 flush 并清空。此时如果上游又发来数据（STREAMING 阶段），captureChunks 继续累积但 bufferChunks 不再累积。移除 captureChunks 后，如果 onEnd 时仍在 STREAMING 状态，不需要 captureChunks（代码走的是 `this.state === "STREAMING"` 分支直接 transition COMPLETED）。分析正确但 Plan 中缺少 STREAMING 阶段 onEnd 的分析。 | 在 Plan 中补充 STREAMING 阶段 onEnd 不依赖 captureChunks 的分析。 |
| 7 | **MUST FIX** | Spec F5 / Task 5 | **索引 idx_logs_original 已存在于 migration 018**。`018_add_failover_field.sql` 中已创建 `CREATE INDEX IF NOT EXISTS idx_request_logs_original_request_id ON request_logs(original_request_id)`。Spec 和 Plan 中的 migration 045 又要创建 `idx_logs_original`，虽然 `IF NOT EXISTS` 不会报错，但索引名不同（018 用 `idx_request_logs_original_request_id`，045 用 `idx_logs_original`），会导致创建一个重复索引，浪费存储和写入性能。 | 方案 A：删除 045 中 `idx_logs_original`（已有索引覆盖），或者方案 B：先 DROP 旧索引再 CREATE 新索引（如果新索引增加了 created_at DESC 列，确实更优）。需在 Plan 中明确选择。 |
| 8 | LOW | Task 4 (LogWriteBuffer) | **`stop()` 方法是同步还是异步**。Plan 说 `close() 中调用 stop() 确保 flush`，`stop()` 内部做最后一次 flush。但 `LogFileWriter.stop()` 返回 `Promise<void>`（异步，因为 WriteStream 的 finish 事件是异步的）。如果 LogWriteBuffer 的 flush 是同步的（better-sqlite3），那 stop 应该是同步的。Plan 需要明确 stop 的同步/异步语义。 | 明确 LogWriteBuffer.stop() 为同步方法（内部调用同步 flush），与 LogFileWriter.stop()（异步）区分。在 index.ts close 函数中，先同步 `logBuffer.stop()`，再 `await logFileWriter?.stop()`。 |
| 9 | LOW | Task 2 (i18n mount) | **loading 闪烁风险**。Plan 风险点提到了"loading 状态切换要避免闪烁"，但没有给出具体方案。在本地开发环境，16 个 JSON 文件加载通常 < 50ms，会导致 loading spinner 一闪而过，反而比白屏更差。 | 建议：在 App.vue 中添加最小显示时间（如 200ms），或使用 `v-show` + transition 代替 `v-if`。更简单的方案是 locale 加载完成前不显示任何内容（保持空 div），不显示 loading spinner——因为 mount 后到 locale 加载完成通常极短。 |
| 10 | LOW | Task 2 (i18n mount) | **Spec 影响文件表缺少 `i18n/index.ts`**。F2 的影响文件表只有 `main.ts` 和 `App.vue`，但实现需要从 `i18n/index.ts` 导出 locale 加载状态 ref。Plan 的文件变更表已正确包含，但 Spec 不一致。 | 更新 Spec F2 影响文件表，添加 `frontend/src/i18n/index.ts`。 |
| 11 | LOW | Task 1 (errorHandler) | **toast.error 在 errorHandler 中的可用性未验证**。Plan 风险点提到了 `vue-sonner` 的程序化调用，但需要确认 `toast.error()` 在 `app.config.errorHandler` 中是否可用（errorHandler 不在组件上下文中执行）。`vue-sonner` 的 `toast` 是独立函数，不依赖组件上下文，应该可用。但需要确认 Toaster 组件是否已挂载——如果错误在 mount 前抛出，Toaster 还未渲染，toast 不会显示。 | 建议在 errorHandler 中同时使用 console.error（兜底）和 toast.error（尝试），确保至少有日志。代码可以 `try { toast.error(msg) } catch { /* Toaster 未挂载 */ }` 或者干脆只做 console.error，toast 不是必须的。 |
| 12 | LOW | Task 1 (errorHandler) | **errorHandler 与 router guard 的交互**。`App.vue` 中 `checkAuth()` 调用 `api.getStats()`，如果网络错误会 catch 并 redirect。但 router `beforeEach` 也调用 `api.getStats()`。如果这些在 mount 前抛出错误，errorHandler 可能不会被触发（因为 errorHandler 在 `app.mount` 后才生效）。这不是 bug，只是边界情况需知晓。 | 无需修改，记录为已知限制即可。 |
| 13 | LOW | Task 5 (index) | **idx_logs_status 的必要性**。Spec 中添加 `CREATE INDEX IF NOT EXISTS idx_logs_status ON request_logs(status_code)`，但 `status_code` 只有几个离散值（200, 400, 429, 500 等），区分度很低，SQLite 查询优化器大概率不会使用这个索引。单列索引在低区分度列上收益很小。 | 考虑是否真的需要这个索引。如果 Logs 页面的 status_code 过滤是高频操作且表数据量大，可以保留。否则移除，避免无谓的写入开销。 |
| 14 | LOW | Task 7 (join 截断) | **countTokensFromChunks 的 limit 参数语义与 countTokens 不同**。`countTokens(text)` 内部在 `text.length > 4000` 时只取前 4000 字符采样再外推。`countTokensFromChunks` 在 chunks 累积到 4000 字符后停止，然后调用 `countTokens(combined)`——但 `combined.length` 恰好可能是 4000 或略大（因为最后一个 chunk 可能超出），此时 `countTokens` 不会再采样（因为 `<= SAMPLE_SIZE`），直接 encode 整个字符串。对于超过 4000 字符的内容，结果不是外推值而是截断值，与原始行为不同。 | 两种方案：1) `countTokensFromChunks` 在达到 limit 后也做外推（需要知道总字符数）；2) 在 `countTokensFromChunks` 中累积到 limit 后直接 `countTokens(combined.slice(0, SAMPLE_SIZE))` 并外推。注意 `metrics-extractor.ts` 中已经有 `MAX_BUFFER_SIZE = 500_000` 限制，实际 chunks 总长度可能远超 4000，所以外推是必要的。当前 Plan 的实现方案会导致 thinking tokens 计算偏低（只算前 4000 字符，不外推）。 |
| 15 | INFO | Task 4 (LogWriteBuffer) | **ServiceContainer 集成方式未说明**。项目使用 `ServiceContainer` 管理所有服务的 DI。LogWriteBuffer 需要注册到容器中还是通过参数传递？Plan 未说明。 | LogWriteBuffer 应注册到 ServiceContainer（与 LogFileWriter 模式一致），通过 `SERVICE_KEYS.logWriteBuffer` 解析。需在 `core/container.ts` 中添加 key。 |
| 16 | INFO | Spec F4 | **Spec 声称"200 QPS 下每秒 ~100-150ms 被 DB 独占"**，这个数据需要来源。better-sqlite3 单次 INSERT 耗时约 0.1-0.5ms，200 QPS（每次请求 insertRequestLog + insertMetrics = 2 次 INSERT）约 0.2-0.2ms × 200 = 40-200ms。数据范围合理但不精确。 | 建议在 Spec 中标注数据来源（benchmark 或估算），或改为定性描述"在高 QPS 下 DB 写入占用事件循环时间的比例显著"。 |
| 17 | INFO | Task 4 (LogWriteBuffer) | **db.transaction() 批量写入的正确性**。Plan 说"flush 内部用 db.transaction() 包裹批量 INSERT"。better-sqlite3 的 `db.transaction()` 返回一个包装函数，在 WAL 模式下批量写入确实更高效。但需要注意 transaction 函数不能递归调用自身，且 `getCachedStmt` 缓存的 prepared statement 在 transaction 内使用是安全的。 | 实现时注意 transaction 的使用方式：`const flushTx = db.transaction(() => { ... })` 然后 `flushTx()`。 |
| 18 | INFO | Plan 总体 | **Subagent 任务分组合理**。前端 task (1,2,3,8) 一组、后端简单 task (5,6,7) 一组、后端复杂 task (4) 独立一组，分组合理。但前端 task 2 (i18n mount) 和 task 1 (errorHandler) 都修改 `main.ts`，建议串行而非并行。 | Plan 已建议按编号顺序执行，合理。无需修改。 |
| 19 | INFO | Spec F6 | **Spec 声称"内存占用翻倍"**。`captureChunks` 和 `bufferChunks` 存储的是 Buffer 引用（不是拷贝），因为 Node.js `Buffer.from()` 和 `push(chunk)` 只增加引用计数。实际内存翻倍的是引用数组本身（每个引用 8 字节 × chunk 数量），而非 Buffer 数据本身。对于典型请求（几十个 chunk），额外内存可能只有几百字节，不是显著的内存浪费。 | 描述可以更准确：去掉 `Buffer` 数组重复（减少引用管理和维护复杂度）是合理的简化，但"内存翻倍"的表述有些夸大。建议改为"维护冗余的 buffer 引用数组，增加状态管理复杂度"。 |
| 20 | INFO | Spec F1 | **errorHandler 是否需要处理 Promise rejection**。Vue 3 的 `app.config.errorHandler` 只捕获组件生命周期和事件处理器中的错误，不捕获 `Promise` rejection（需要 `window.addEventListener('unhandledrejection', ...)`）。 | 考虑是否需要同时注册 unhandledrejection handler。可以在 errorHandler 旁边添加全局 rejection handler，或者记录为后续 backlog。 |

---

## 总结

### 必须修复 (MUST FIX) 汇总

1. **Task 4 调用路径不完整**（#1）——10+ 个 `insertRequestLog`/`insertMetrics` 调用点未被覆盖
2. **Task 4 insertMetrics 返回值问题**（#2）——缓冲化后 ID 不存在于 DB，影响未来依赖
3. **Task 4 LogFileWriter 协作未说明**（#3）——文件写入和 DB 写入需要分离处理
4. **Task 4 测试策略矛盾**（#4）——透明缓冲 vs 上层封装互相矛盾
5. **Task 6 时序分析不完整**（#5, #6）——缺少 checkEarlyError=undefined 路径和 STREAMING 阶段 onEnd 分析
6. **Task 5 索引重复**（#7）——idx_request_logs_original_request_id 已存在于 018

### 关键建议

Task 4 (LogWriteBuffer) 是本批次最复杂的改动，4 个 MUST FIX 问题都集中在它身上。核心矛盾在于：Plan 的"上层封装"方案需要修改所有调用点（#1），而"透明内部缓冲"方案需要仔细处理 LogFileWriter 协作（#3）和测试隔离（#4）。

**推荐方案**：在 `logs.ts` 和 `metrics.ts` 模块内部实现透明缓冲，通过模块级 singleton LogWriteBuffer 控制：
- `insertRequestLog()` 内部先执行 LogFileWriter.write()（保持同步），然后 buffer.push()（仅 DB 部分）
- `insertMetrics()` 内部预生成 ID，buffer.push()（仅 DB 部分）
- 提供 `initLogBuffer(db)` / `stopLogBuffer()` 供 `index.ts` 调用
- 测试中不调用 `initLogBuffer()`，保持原有同步行为

这样所有调用点零修改，测试零修改，只需要 `index.ts` 中初始化和关闭。

---

## 结论

**需修改后重审**。Task 4 存在 4 个 MUST FIX 问题，Task 5 和 Task 6 各有 1 个。建议重点修订 Task 4 的实现方案后再提交二审。其余 task（1, 2, 3, 7, 8）可以先行进入编码阶段。
