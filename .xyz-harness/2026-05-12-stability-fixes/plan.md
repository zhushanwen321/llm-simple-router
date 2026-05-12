# 稳定性修复 — Plan

> 日期：2026-05-12 | 基于 spec.md | 8 项修复，按依赖顺序排列

---

### Task 1：前端全局错误处理 + 404 兜底路由

### 描述
注册 Vue 全局错误处理器并添加 catch-all 路由，消除组件渲染异常导致的白屏风险。这是纯前端改动，无后端依赖。

### 验收标准
- [ ] `main.ts` 中注册 `app.config.errorHandler`，console.error + toast.error
- [ ] 路由表末尾有 `/:pathMatch(.*)*` catch-all 路由
- [ ] `cd frontend && npx vue-tsc -b --noEmit` 通过
- [ ] `cd frontend && npx eslint . --max-warnings=0` 通过

### 文件变更
| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/main.ts` | 修改 | 注册 errorHandler，导入 Toaster |
| `frontend/src/router/index.ts` | 修改 | 添加 catch-all 路由 |

### 风险点
- errorHandler 中调用 toast 需要确认 vue-sonner 的程序化调用方式（`toast.error()` 从 `vue-sonner` 导入即可，不需要组件实例上下文）
- catch-all 路由必须放在路由表最末尾

---

### Task 2：i18n 翻译不阻塞 app mount

### 描述
将 `loadLocaleMessages` 从 mount 前置条件改为异步后台加载，消除首屏白屏。先挂载应用显示 loading 指示器，locale 加载完成后自动切换。

### 验收标准
- [ ] `app.mount('#app')` 不被 `loadLocaleMessages` 阻塞
- [ ] locale 未加载时 App.vue 显示 loading 状态
- [ ] locale 加载完成后自动切换到正常内容
- [ ] `cd frontend && npx vue-tsc -b --noEmit` 通过

### 文件变更
| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/main.ts` | 修改 | 先 mount 再 load locale |
| `frontend/src/i18n/index.ts` | 修改 | 导出 locale 加载状态 ref |
| `frontend/src/App.vue` | 修改 | 添加 locale loading 状态展示 |

### 风险点
- 需要确保 `i18n.global.mergeLocaleMessage` 在 app mount 后调用仍然正确（vue-i18n 支持此模式）
- **避免 loading 闪烁**：本地开发环境 16 个 JSON 加载 < 50ms，spinner 一闪而过反而差于白屏。方案：App.vue 中使用最小显示时间（200ms），或者更简单的做法——locale 加载完成前只显示空 div（不显示 spinner），因为 mount 到 locale 加载完成通常极短
- `useI18n()` 在 locale 未加载时会返回 key 本身作为 fallback，这是可接受的

---

### Task 3：useDashboard refreshTimer 泄漏修复

### 描述
在 `onUnmounted` 中添加 `clearTimeout(refreshTimer)`，修复组件卸载后 timer 仍触发 API 请求的问题。

### 验收标准
- [ ] `onUnmounted` 中清理了 `refreshTimer`
- [ ] `cd frontend && npx vue-tsc -b --noEmit` 通过

### 文件变更
| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/composables/useDashboard.ts` | 修改 | onUnmounted 添加 clearTimeout |

### 风险点
- 极低风险。只需添加一行 clearTimeout

---

### Task 4：SQLite 日志写入透明内部缓冲

### 描述
创建 `LogWriteBuffer` 类，在 `logs.ts` 和 `metrics.ts` 模块内部透明使用，所有现有调用点零修改。

### 实现方案

#### 方案选择：透明内部缓冲

**为什么不用上层封装**：热路径上 `insertRequestLog`/`insertMetrics` 有 10+ 个调用点（proxy-logging.ts 5 个、failover-loop.ts 2 个、create-proxy-handler.ts 1 个、error-logging.ts 2 个、index.ts errorHandler 1 个），上层封装需要修改所有调用点，引入风险。透明内部缓冲只需要修改 `logs.ts`/`metrics.ts` 两个文件内部。

#### LogWriteBuffer 类设计

```typescript
// router/src/db/log-write-buffer.ts
interface BufferedLogEntry {
  type: 'log'
  data: RequestLogInsert
  context?: LogWriteContext
}
interface BufferedMetricsEntry {
  type: 'metrics'
  data: MetricsInsert
}

class LogWriteBuffer {
  private buffer: (BufferedLogEntry | BufferedMetricsEntry)[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private readonly flushIntervalMs: number  // 默认 100ms
  private readonly maxBufferSize: number     // 默认 50

  constructor(
    private db: Database.Database,
    private rawInsertLog: (db: Database, data: RequestLogInsert, ctx?: LogWriteContext) => void,
    private rawInsertMetrics: (db: Database, data: MetricsInsert) => string,
    options?: { flushIntervalMs?: number; maxBufferSize?: number }
  )

  pushLog(data: RequestLogInsert, context?: LogWriteContext): void
  pushMetrics(data: MetricsInsert): string  // 预生成 UUID，返回给调用方
  flush(): void   // 同步批量写入（db.transaction 包裹）
  stop(): void    // 停止定时器 + 最后一次 flush（同步）
}
```

#### 透明集成方式

```typescript
// router/src/db/logs.ts
let logBuffer: LogWriteBuffer | null = null

export function initLogBuffer(db: Database.Database): void {
  logBuffer = new LogWriteBuffer(db, rawInsertRequestLog, rawInsertMetrics)
}

export function stopLogBuffer(): void {
  logBuffer?.stop()
  logBuffer = null
}

export function insertRequestLog(db: Database, log: RequestLogInsert, writeContext?: LogWriteContext): void {
  // LogFileWriter 保持同步调用（它内部是异步 WriteStream，不阻塞事件循环）
  if (writeContext?.logFileWriter) {
    writeContext.logFileWriter.write(/* ... */)
  }
  // DB INSERT 走缓冲（如果已初始化），否则走同步
  if (logBuffer) {
    logBuffer.pushLog(log, writeContext)
  } else {
    rawInsertRequestLog(db, log, writeContext)
  }
}
```

```typescript
// router/src/db/metrics.ts
let logBuffer: LogWriteBuffer | null = null

export function initLogBuffer(db: Database.Database, buffer: LogWriteBuffer): void {
  logBuffer = buffer  // 共享同一个 buffer 实例
}

export function insertMetrics(db: Database, m: MetricsInsert): string {
  const id = randomUUID()  // 预生成 UUID
  if (logBuffer) {
    logBuffer.pushMetrics({ ...m, id })  // 缓冲
  } else {
    rawInsertMetrics(db, { ...m, id })   // 同步
  }
  return id  // 保持返回值语义
}
```

#### index.ts 集成

```typescript
// buildApp 中：
initLogBuffer(db)  // 初始化缓冲

// close() 中（注意顺序）：
stopLogBuffer()                // 同步 flush DB 缓冲
await logFileWriter?.stop()    // 异步 flush 文件缓冲
```

#### flush 策略

- 定时：每 100ms flush 一次
- 阈值：缓冲达到 50 条立即 flush
- 关闭：`stop()` 时同步 flush 所有剩余数据
- flush 内部用 `db.transaction(() => { ...entries.forEach(rawInsert...) })` 批量写入
- stop() 是同步方法（与 LogFileWriter.stop() 异步区分）

#### 测试策略

- 现有测试不调用 `initLogBuffer()`，所有 `insertRequestLog`/`insertMetrics` 走原有同步路径
- 新增 `tests/log-write-buffer.test.ts` 单独测试缓冲逻辑
- 测试中验证：缓冲 → flush → DB 数据正确

### 验收标准
- [ ] LogWriteBuffer 类实现，含 pushLog/pushMetrics/flush/stop 方法
- [ ] insertRequestLog 内部透明使用缓冲（LogFileWriter 同步调用保持不变）
- [ ] insertMetrics 内部透明使用缓冲（预生成 UUID，返回值语义不变）
- [ ] 所有现有调用点（10+ 个）零修改
- [ ] close() 中 stopLogBuffer() 在 logFileWriter.stop() 之前调用
- [ ] LogWriteBuffer 注册到 ServiceContainer
- [ ] 现有测试全部通过（测试不初始化缓冲）
- [ ] 新增 LogWriteBuffer 单元测试（缓冲/flush/stop/阈值触发）
- [ ] `npm run build` 通过
- [ ] `npm run lint` 通过

### 文件变更
| 文件 | 操作 | 说明 |
|------|------|------|
| `router/src/db/log-write-buffer.ts` | 新建 | LogWriteBuffer 类 |
| `router/src/db/logs.ts` | 修改 | insertRequestLog 内部添加缓冲逻辑 |
| `router/src/db/metrics.ts` | 修改 | insertMetrics 内部添加缓冲逻辑 |
| `router/src/core/container.ts` | 修改 | 添加 SERVICE_KEYS.logWriteBuffer |
| `router/src/index.ts` | 修改 | buildApp 中 initLogBuffer，close 中 stopLogBuffer |
| `tests/log-write-buffer.test.ts` | 新建 | 缓冲逻辑单元测试 |

### 风险点
- LogFileWriter.write() 和 DB INSERT 需要在 insertRequestLog 内部分离：文件写入保持同步调用（WriteStream 内部异步），DB INSERT 走缓冲
- insertMetrics 预生成 UUID：flush 前通过 ID 查询 metrics 会返回空——当前无此场景，可接受
- 进程崩溃时未 flush 的缓冲会丢失：可接受，日志本身就是尽力而为
- getCachedStmt 的 prepared statement 在 transaction 内使用安全（better-sqlite3 支持）

---

### Task 5：request_metrics 复合索引

### 描述
新增 migration 045，添加 Dashboard 查询和日志查询所需的复合索引。注意避免与 018 已有索引重复。

### 索引设计
```sql
-- request_metrics 核心聚合索引
CREATE INDEX IF NOT EXISTS idx_metrics_agg
  ON request_metrics(is_complete, created_at DESC, provider_id, backend_model);

-- request_logs 子请求+时间排序复合索引（018 已有 original_request_id 单列索引，本索引额外覆盖时间排序）
CREATE INDEX IF NOT EXISTS idx_logs_original_time
  ON request_logs(original_request_id, created_at DESC);
```

**不包含的索引**：
- `status_code` 单列索引：区分度太低，SQLite 优化器不会使用
- `original_request_id` 单列索引：018 已有

### 验收标准
- [ ] 新增 migration 045 文件，包含 2 个索引
- [ ] 索引覆盖：(is_complete, created_at DESC, provider_id, backend_model)
- [ ] 不与 018 migration 的 idx_request_logs_original_request_id 重复
- [ ] 现有测试通过（migration 自动执行）

### 文件变更
| 文件 | 操作 | 说明 |
|------|------|------|
| `router/src/db/migrations/045_add_metrics_composite_indexes.sql` | 新建 | 2 个复合索引 |

### 风险点
- `CREATE INDEX IF NOT EXISTS` 保证幂等
- 在大数据量表上创建索引可能耗时（首次启动时），但 SQLite WAL 模式下不会阻塞读

---

### Task 6：StreamProxy 移除冗余 captureChunks

### 描述
移除 `captureChunks` 数组，BUFFERING 阶段只维护一份 `bufferChunks`。所有对 `captureChunks` 的引用改为 `bufferChunks`。

### 实现方案

**完整时序分析（覆盖所有路径）**：

**路径 1：checkEarlyError 不存在**
- onData: push 到 bufferChunks
- 收到上游 response 后立即 `startStreaming()`（因为 `!checkEarlyError`）
- startStreaming: Buffer.concat(bufferChunks) → flush → bufferChunks.length = 0
- 后续 onData: 直接写 pipeEntry（STREAMING）
- onEnd: state=STREAMING → 走 STREAMING 分支 → **不使用任何 buffer 数组**

**路径 2：checkEarlyError 存在，BUFFERING 阶段内触发 startStreaming**
- onData: push 到 bufferChunks → 检测到阈值/\n\n → startStreaming()
- startStreaming: Buffer.concat(bufferChunks) → error check → flush → bufferChunks.length = 0
- 后续 onData: 直接写 pipeEntry
- onEnd: state=STREAMING → **不使用 buffer 数组**

**路径 3：checkEarlyError 存在，整个响应在 BUFFERING 完成**
- onData: push 到 bufferChunks（未触发 startStreaming）
- onEnd: state=BUFFERING → Buffer.concat(bufferChunks) → final error check
- **bufferChunks 此时尚未被清空**（startStreaming 未触发），可以直接使用

**结论**：三个路径都不需要 captureChunks。

**改动**：全局搜索替换 `captureChunks` → `bufferChunks`，删除 captureChunks 的声明和初始化。

### 验收标准
- [ ] captureChunks 数组被移除
- [ ] 所有对 captureChunks 的引用改为 bufferChunks
- [ ] 三个路径的 early error 检测功能不受影响
- [ ] 流式代理功能不受影响
- [ ] 现有测试通过

### 文件变更
| 文件 | 操作 | 说明 |
|------|------|------|
| `router/src/proxy/transport/stream.ts` | 修改 | 移除 captureChunks |

### 风险点
- 路径 3 的正确性依赖于 startStreaming 未触发时 bufferChunks 未被清空——已通过代码确认
- 移除后 BUFFERING 阶段只维护一份引用数组，减少状态管理复杂度

---

### Task 7：MetricsExtractor join 截断优化

### 描述
在 `token-counter.ts` 中新增 `countTokensFromChunks` 函数，只 join 前 SAMPLE_SIZE 字符，避免创建完整大字符串。MetricsExtractor 使用新函数。

### 实现方案

```typescript
// token-counter.ts
const SAMPLE_SIZE = 4000

export function countTokensFromChunks(chunks: string[]): number {
  // 累积到 SAMPLE_SIZE 字符后停止
  let combined = ''
  let totalChars = 0
  for (const chunk of chunks) {
    if (combined.length < SAMPLE_SIZE) {
      combined += chunk
    }
    totalChars += chunk.length
  }
  // 如果总字符数 <= SAMPLE_SIZE，直接计数
  if (combined.length <= SAMPLE_SIZE) {
    return countTokens(combined)
  }
  // 超过 SAMPLE_SIZE，截取后外推（与 countTokens 的采样逻辑一致）
  const sampleTokens = countTokens(combined.slice(0, SAMPLE_SIZE))
  return Math.ceil(sampleTokens * (totalChars / SAMPLE_SIZE))
}
```

```typescript
// metrics-extractor.ts getMetrics() 中
// 旧：countTokens(this.thinkingChunks.join(""))
// 新：countTokensFromChunks(this.thinkingChunks)
```

### 验收标准
- [ ] countTokensFromChunks 函数实现
- [ ] MetricsExtractor.getMetrics() 使用新函数
- [ ] 结果数学等价：前 4000 字符的采样值不变
- [ ] 新增 countTokensFromChunks 单元测试
- [ ] `npm run build` 通过

### 文件变更
| 文件 | 操作 | 说明 |
|------|------|------|
| `router/src/utils/token-counter.ts` | 修改 | 新增 countTokensFromChunks |
| `router/src/metrics/metrics-extractor.ts` | 修改 | 使用新函数 |
| `tests/token-counter.test.ts` | 修改 | 新增测试 |

### 风险点
- chunks 中单个 chunk 可能超过 limit，此时直接截取 chunk 前 limit 字符即可
- 需要确认 thinkingChunks/textChunks/toolUseChunks 的实际使用场景——流式场景下每条 delta 很小（几十字节），chunks 数量多但每个很短，循环截断效率高

---

### Task 8：Google Fonts @import 改为 link preconnect

### 描述
将 `style.css` 中的 `@import url(...)` 字体加载改为 `index.html` 中的 `<link>` 标签 + preconnect，消除 CSS 请求链。

### 验收标准
- [ ] style.css 中 @import 字体行已移除
- [ ] index.html `<head>` 中有 preconnect + link 标签
- [ ] `cd frontend && npx vite build` 通过
- [ ] 字体渲染正常

### 文件变更
| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/style.css` | 修改 | 移除 @import |
| `frontend/index.html` | 修改 | 添加 preconnect + link |

### 风险点
- 极低风险。标准的前端优化操作

---

### Task 依赖关系

```
Task 1 (errorHandler) ─── 无依赖
Task 2 (i18n mount)   ─── 无依赖
Task 3 (refreshTimer) ─── 无依赖
Task 4 (log buffer)   ─── 无依赖，但最复杂
Task 5 (index)        ─── 无依赖
Task 6 (captureChunks)─── 无依赖
Task 7 (join 截断)    ─── 无依赖
Task 8 (fonts)        ─── 无依赖
```

所有 task 互相独立，可并行开发。但建议按编号顺序逐个实现，降低上下文切换开销。

### Task 执行策略

- **前端 task（1,2,3,8）**：由一个 subagent 批量处理
- **后端简单 task（5,6,7）**：由一个 subagent 批量处理
- **后端复杂 task（4）**：独立 subagent，需要更多上下文和测试
