# ADR 0007: 日志存储与查询性能优化

## Status

Proposed

## Context

管理后台的两个日志接口在请求量大时响应缓慢：

1. **`GET /admin/api/logs?view=grouped`**（列表）— 页面加载时调用
2. **`GET /admin/api/logs/:id`**（详情）— 点击某条日志时调用

### 当前架构

日志数据有两条存储路径：

| 路径 | 内容 | 实现 |
|------|------|------|
| SQLite `request_logs` 表 | 索引字段 + 摘要 | 列表查询直接读 DB |
| JSONL 文件 | 完整请求/响应体 | 按 10 分钟窗口分文件，定期 gzip 压缩 |

详情接口在 DB 字段为 null 时，从 JSONL 文件回填。这是 `log-detail-policy` 的设计——成功请求（200）的 `upstream_request`/`upstream_response` 只存 JSONL 不存 DB，节省主表空间。

### 性能瓶颈分析

实测数据：1,366 条日志，`client_request` 平均 626KB/条，JSONL 单窗口文件最大 311MB（压缩后）。

#### 瓶颈 1：详情接口 JSONL 回填（P0，影响感知最大）

```
logFileWriter.read(id, createdAt)
  → readFileSync(gzPath)         // 读 5-311MB 压缩文件
  → gunzipSync(compressed)        // 解压到 20-264MB
  → content.split("\n")           // 全量拆行
  → 逐行 JSON.parse 直到匹配      // 线性扫描
```

实测 65MB 压缩文件（242 条）：全量解析 0.96s。311MB 压缩文件（222 条）：2.06s。

几乎所有成功请求都会触发此路径（`upstream_request`/`upstream_response` 为 null）。

#### 瓶颈 2：列表查询 `json_extract(client_request)` 计算 thinking_level（P1）

列表查询的 `LOG_LIST_SELECT` 中：

```sql
CASE
  WHEN rl.client_request IS NULL THEN 'off'
  ELSE COALESCE(json_extract(rl.client_request, '$.body.reasoning.effort'), 'off')
END AS thinking_level
```

SQLite 需要读取每行 626KB 的 `client_request` 字段做 JSON 解析，只为提取一个字符串。20 行 × 626KB = 12MB IO。

#### 瓶颈 3：`getRequestLogById` 未缓存 prepared statement（P1）

```typescript
return db.prepare(`SELECT rl.*, ...`).get(id)  // 每次请求重新 prepare
```

写入路径用了 `getCachedStmt()`，但高频读路径没有。

#### 瓶颈 4：详情接口回填后二次 JSON.parse（P2）

JSONL 回填 `client_request` 后，admin handler 又做一次 `JSON.parse(log.client_request)` 提取 thinking_level。同一个大 JSON 解析两次。

### JSONL vs 单条 JSON 的对比实测

使用 65MB 压缩文件（242 条，264MB 解压后）实测：

**空间**：

| 格式 | 未压缩 | gzip 后 | 压缩率 |
|------|--------|---------|--------|
| JSONL（当前） | 264,462,256 bytes | 67,464,896 bytes | 25.5% |
| 单条 JSON 各自压缩 | 264,462,014 bytes | 67,590,581 bytes | 25.6% |

差异 +0.2%。每条 ~480KB，字段名重复（140 bytes/条）可忽略，gzip 跨行去重对大 payload 无收益。

**写入**：JSONL append 460ms，单条独立写 452ms。在低并发批量测试中无差异（详见下方 Consequences 中对高并发场景的分析）。

**读取**：

| 方案 | 按 id 查找 | 加速比 |
|------|-----------|--------|
| JSONL 未压缩扫描（找中间行） | 390ms | baseline |
| JSONL 压缩扫描（找中间行） | 550ms | baseline |
| 单条 JSON 直接 open | **2ms** | **195x** |
| 单条 JSON 解压 | **2.8ms** | **196x** |

## Decision

三项优化，按优先级排列。

### 优化 1：日志文件存储改为单条 JSON + 小时桶（P0）

将 JSONL 多行文件改为每条请求一个独立 JSON 文件，按小时分桶：

**当前结构**：
```
logs/{date}/{HH-MM}.jsonl[.gz]    # 10 分钟窗口，多行 append
```

**新结构**：
```
logs/{date}/{HH}/{id}.json[.gz]   # 每条请求独立文件
```

示例：
```
logs/2026-06-04/
├── 15-00.jsonl.gz              ← 旧格式（改版前数据）
├── 15-10.jsonl.gz
├── 15/                         ← 新格式
│   ├── {uuid1}.json
│   ├── {uuid2}.json
│   └── {uuid3}.json.gz         ← 压缩后
├── 16/
│   └── ...
```

**改动点**：

| 组件 | 改动 |
|------|------|
| `LogFileWriter.write()` | 计算路径 `{date}/{HH}/{id}.json`，**异步 writeFile（fire-and-forget）**替代 WriteStream append（见下方写入策略说明） |
| `LogFileWriter.read()` | 新格式：直接 open `{date}/{HH}/{id}.json`；旧格式 fallback：扫描 `{date}/{HH-MM}.jsonl` |
| `LogFileWriter.streams` | 去掉 WriteStream 缓存 Map（每条只写一次） |
| `log-file-compressor.ts` | 遍历 `{date}/{HH}/*.json`，按 mtime 判断是否超过 10 分钟，压缩为 `.json.gz`（见下方压缩策略说明） |
| `log-file-compressor.ts` 清理 | `rm -rf {date}/` 逻辑不变 |

**历史兼容**：`read()` fallback 链——

```
1. {date}/{HH}/{id}.json        → O(1) 直接命中
2. {date}/{HH}/{id}.json.gz     → O(1) 解压单文件
3. {date}/{HH}-{MM}.jsonl       → 旧格式线性扫描（精确窗口，只扫 1 个文件）
4. {date}/{HH}-{MM}.jsonl.gz    → 旧格式压缩线性扫描
```

旧数据无需迁移，随保留天数自然过期清理。过渡期内旧格式数据仍在保留期中，用户查看历史日志时走 fallback 路径，性能与当前一致（不差于现状）。同一天目录下新旧格式共存，路径层级不同，互不冲突。

**分桶选择**：日均 1,300 请求时无桶也够用，但按小时分桶（~55 文件/桶）对未来扩展更好，改动量仅多一行 hour 提取。

**写入策略**：不使用 `writeFileSync`（480KB JSON 的同步写入可能阻塞事件循环 5-20ms，高并发下累积为显著延迟）。改用异步 fire-and-forget 模式，保持当前 `write(): void` 同步签名不变，内部异步写入不阻塞事件循环：

```typescript
write(entry: LogFileEntry): void {
  const filePath = this.buildPath(entry);
  fs.promises.mkdir(dirname(filePath), { recursive: true })
    .then(() => fs.promises.writeFile(filePath, JSON.stringify(entry)))
    .catch(() => { /* 辅助通道，失败不影响主流程 */ });
}
```

这样做的好处：
1. `insertRequestLog()` 调用链无需改为 async
2. 不阻塞事件循环
3. 文件写入是辅助通道，fire-and-forget 的丢数据风险与当前 WriteStream 一致（进程崩溃时都可能丢失缓冲数据）

**压缩策略**：新格式文件按 `{date}/{HH}/{id}.json` 存储，文件名不含分钟信息。压缩时机通过文件 **mtime** 判断（而非目录结构），保持与当前一致的 10 分钟压缩粒度：

```typescript
// 遍历 {date}/{HH}/*.json，mtime 超过 10 分钟的压缩
const stat = statSync(filePath);
if (now - stat.mtimeMs > COMPRESSION_INTERVAL_MS) {
  const content = readFileSync(filePath);
  writeFileSync(filePath + '.gz', gzipSync(content));
  unlinkSync(filePath);
}
```

### 优化 2：`thinking_level` 写入时计算并存为 DB 列（P1）

将 `thinking_level` 从查询时 `json_extract(client_request)` 改为写入时计算、存为 `request_logs` 表的独立列。

**改动点**：

| 组件 | 改动 |
|------|------|
| 新增 DB 迁移 | `ALTER TABLE request_logs ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'off'` |
| `insertRequestLog()` | 写入前从 `client_request` 计算 `thinking_level`（提取函数需按 `api_type` 分支处理，见下方） |

**thinking_level 提取逻辑**（从 `client_request` JSON 中提取，需按 `api_type` 分支）：

```typescript
function extractThinkingLevel(apiType: string, clientRequest: string | null): string {
  if (!clientRequest) return 'off';
  try {
    const parsed = JSON.parse(clientRequest);
    const body = parsed?.body;
    if (!body) return 'off';
    if (apiType === 'anthropic') {
      // Anthropic: body.thinking.type → "enabled" | "disabled"
      return body.thinking?.type ?? 'off';
    }
    // OpenAI + Responses: body.reasoning.effort → "low" | "medium" | "high"
    // 兼容旧格式: body.reasoning_effort
    return body.reasoning?.effort ?? body.reasoning_effort ?? 'off';
  } catch {
    return 'off';
  }
}
```

三种 `api_type` 的字段路径：

| api_type | 字段路径 | 可能的值 |
|----------|---------|----------|
| `anthropic` | `body.thinking.type` | `"enabled"`, `"disabled"` 等 |
| `openai` | `body.reasoning.effort` 或 `body.reasoning_effort`（旧格式） | `"low"`, `"medium"`, `"high"` |
| `openai-responses` | `body.reasoning.effort` | `"low"`, `"medium"`, `"high"` |

`openai` 和 `openai-responses` 的 ELSE 分支天然统一（都是 `reasoning.effort`）。与当前 SQL `LOG_LIST_SELECT` 和 admin handler 的分支逻辑完全一致，仅从查询时移到写入时执行。
| DB 迁移回填（可选） | 一次性 UPDATE 从 `client_request` 计算历史行的 `thinking_level` |
| `LOG_LIST_SELECT` | `thinking_level` 列直接读取，去掉 `json_extract` CASE 表达式 |
| `getRequestLogById` | 同上 |
| admin handler 回填逻辑 | 去掉回填后的无条件 `JSON.parse(client_request)`，保留兜底逻辑：`thinking_level === 'off' && client_request` 时解析 `client_request` 重新计算（兼容历史数据，详见 Consequences） |

列表查询完全避免读取 `client_request` 大字段（626KB/条 × 20 行 = 12MB），直接读 `thinking_level` 列。

**历史数据兼容**：ALTER TABLE ADD COLUMN DEFAULT 'off' 后，现有行的 `thinking_level` 全部为 'off'，可能与真实值不符。两种处理策略：

1. **（推荐）详情接口保留 fallback**：详情查询中，如果 `thinking_level === 'off'` 且 `client_request IS NOT NULL`，调用同一 `extractThinkingLevel()` 函数重新计算真实值（含 api_type 分支逻辑）。列表页中历史数据统一显示 'off'，牺牲准确性换取性能。过渡期结束后（所有旧数据过期）可移除此 fallback。
2. **（可选）一次性迁移回填**：在 DB 迁移中执行 UPDATE，从 `client_request` 计算 `thinking_level` 回填所有历史行。数据量大时耗时较长（每条需 json_extract），但一次完成后数据完全准确。

两种策略可组合使用：迁移回填尽力而为，详情 fallback 兜底遗漏行。

### 优化 3：`getRequestLogById` 使用 `getCachedStmt`（P1）

```typescript
// Before
return db.prepare(`SELECT rl.*, ...`).get(id)

// After
return getCachedStmt(db, `SELECT rl.*, ...`).get(id)
```

单行改动，消除每次请求的重复 prepare 开销。

## Consequences

### 正面

- **详情接口**：新数据从 0.5-2s 降到 ~3ms。旧数据走 fallback，性能与当前一致（不退步），过渡期随保留天数自然结束
- **列表接口**：去掉 `json_extract` 后减少 12MB/页 IO
- **写入**：异步 writeFile 不阻塞事件循环，与当前 WriteStream 行为一致
- **空间**：+0.2%（可忽略）
- **代码简化**：去掉 WriteStream 缓存池，write/read 逻辑更直观
- **压缩粒度不变**：通过 mtime 判断保持 10 分钟压缩延迟

### 负面

- **文件数量增加**：日均 1,300 个文件（分桶后 55 个/小时），对 APFS/ext4 无压力，远未达到需要关注的量级
- **历史数据 thinking_level 不准确**：ALTER TABLE DEFAULT 'off' 导致现有行显示为 'off'。列表页可接受；详情页通过 fallback 兜底（见优化 2 的历史数据兼容策略）
- **压缩器遍历开销增加**：从每个窗口 1 个文件变为每条 1 个文件，目录遍历文件数增加。但压缩器每 10 分钟执行一次，且单文件压缩更快（280KB vs 264MB），总 CPU 开销不增反降
- **旧数据回退**：改版前写入的 JSONL 文件，`read()` 走 fallback 线性扫描。性能与当前一致（不退步），过渡期随保留天数自然结束

### 不在本次范围

- `client_request` 大字段从主表分离到独立表（TOAST 模式）：收益大但改动面广，后续独立优化
- 前端 `openLogDetail` 的串行请求改为 `Promise.allSettled` 并行：收益低（减少 1 次 RTT），独立 PR
- WriteStream → 异步 writeFile 后的有序性保证：当前 fire-and-forget 模式下，同一请求的 `write()` 和后续 `updateLogStreamContent()` 不保证顺序。但 `stream_text_content` 走 DB UPDATE 不走文件写入，无冲突
