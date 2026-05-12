# 性能优化 PR 遗留风险清单

来源：PR124（36项性能优化）+ PR129（8项稳定性修复）
创建时间：2026-05-12
状态：P1 #1 已修复，其余待后续迭代处理

---

## P1 — 已修复

### #1 enhancement-config TTL 缓存未与 Admin PUT 联动（已修复）

Admin PUT `/admin/api/proxy-enhancement` 写入 DB 后未清除 `enhancement-config.ts` 的模块级 TTL 缓存，导致配置变更延迟最多 30 秒生效。

- 修复：`router/src/admin/proxy-enhancement.ts` PUT 端点末尾加 `clearEnhancementConfigCache()`

---

## P1 — 待修复

### #2 failover 浅拷贝 + 插件修改嵌套对象可能导致迭代间数据污染

**文件**: `router/src/proxy/handler/failover-loop.ts`

```typescript
// 行 208: 只做浅拷贝，嵌套对象（如 messages 数组）与 ctx.body 共享引用
let currentBody = { ...ctx.body };
```

```typescript
// 行 301-305: applyPluginAdjustments 将 currentBody 直接传入 pluginCtx
// 插件通过 pluginCtx.body 可以修改嵌套属性（如 messages[0].content）
const pluginResult = applyPluginAdjustments(pluginRegistry, currentBody, clientApiType, provider);

// 行 90-107: applyPluginAdjustments 内部
function applyPluginAdjustments(...) {
  const pluginCtx = {
    body,  // ← 直接引用 currentBody，浅拷贝不保护嵌套对象
    ...
  };
  pluginRegistry.applyBeforeRequest(pluginCtx);
  pluginRegistry.applyAfterRequest(pluginCtx);
}
```

**触发条件**（需全部满足）：
1. failover 实际发生（>=2次迭代）
2. 插件或中间处理修改了 body 的嵌套对象（如 `messages` 数组内的元素）

**影响**: 第二次及后续 failover 迭代中的 `currentBody` 包含前一次迭代对嵌套对象的修改。

**建议**: 在 `applyPluginAdjustments` 返回前对 body 做 `structuredClone`，或在插件接口文档中约束禁止修改嵌套属性。

---

## P2 — 待修复

### #3 settings.ts 两个热路径函数未走 TTL 缓存

**文件**: `router/src/db/settings.ts`

```typescript
// 行 73-76: 直接用 getCachedStmt 查询，绕过 getSetting() 的 TTL 缓存
export function getDetailLogEnabled(db: Database.Database): boolean {
  const row = getCachedStmt(db, "SELECT value FROM settings WHERE key = ?").get("detail_log_enabled") as { value: string } | undefined;
  return row ? row.value !== "0" : true;
}

// 行 89-92: 同上
export function getLogFileRetentionDays(db: Database.Database): number {
  const row = getCachedStmt(db, "SELECT value FROM settings WHERE key = ?").get("log_file_retention_days") as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : DEFAULT_LOG_FILE_RETENTION_DAYS;
}
```

`getSetting()` 有 WeakMap + 30s TTL 缓存，但这两个函数直接查 DB。`getDetailLogEnabled` 在每次日志写入的热路径上被调用（通过 `shouldPreserveDetail`），虽然 prepared statement 缓存避免了重复 compile，但仍有不必要的 SQLite 查询开销。

**建议**: 重构为内部调用 `getSetting(db, "detail_log_enabled")` 和 `getSetting(db, "log_file_retention_days")`。

---

### #4 stream-extractor.ts reasoning_content 被当作 text 类型处理

**文件**: `router/src/core/monitor/stream-extractor.ts`

```typescript
// 行 25-26: OpenAI 格式的 reasoning_content 被提取为 text，block type 标记为 "text"
const text = (delta?.content as string) ?? (delta?.reasoning_content as string) ?? "";
return { text, block: text ? { index: 0, type: "text", content: text } : null };
```

OpenAI 推理模型（o1/o3/o4-mini 等）的 `reasoning_content` 是思考过程，与实际回复 `content` 语义不同。当前代码将两者合并为 `text` 类型，导致：
- Monitor 页面无法区分推理内容和实际回复
- 流内容预览中思考过程混在输出内容中

**建议**: 为 `reasoning_content` 添加 `{ type: "thinking" }` block type，与 Anthropic 格式的 thinking block 保持一致。

---

### #5 metrics-extractor.ts reasoning_content 计入 TTFT 和 text TPS

**文件**: `router/src/metrics/metrics-extractor.ts`

```typescript
// 行 307-313: reasoning_content 触发 TTFT 计算
if (
  !this.firstContentReceived &&
  delta &&
  ((delta.content !== undefined && delta.content !== "") ||
   (delta.reasoning_content !== undefined && delta.reasoning_content !== ""))
) {
  this.firstContentReceived = true;
  this.ttftMs = Date.now() - this.requestStartTime;
  this.textStreamStartTime = Date.now();
}

// 行 321-324: reasoning_content 被累积到 textChunks，用于 text TPS 计算
const contentText = delta?.content || delta?.reasoning_content || "";
if (contentText && this.textTotalLength < MetricsExtractor.MAX_BUFFER_SIZE) {
  this.textChunks.push(contentText);
  this.textTotalLength += contentText.length;
}
```

**影响**:
1. **TTFT 失真**: 推理模型的 TTFT 反映的是第一个思考 token 的时间，而非第一个实际输出 token 的时间，导致与其他模型的 TTFT 不可比
2. **text TPS 高估**: `reasoning_content` 的 token 被计入 text TPS，实际包含了思考阶段的输出速度

**建议**: 区分 `reasoning_content` 和 `content` 的计时与累积：
- TTFT 仅在收到 `content`（非 `reasoning_content`）时触发
- `reasoning_content` 累积到 `thinkingChunks`（已有此数组用于 Anthropic 格式），统一 thinking TPS 计算

---

### #6 stream-content-accumulator.ts 缓冲区上限 4x 降低

**文件**: `router/src/core/monitor/stream-content-accumulator.ts`

```typescript
// 行 4-5: 从 128KB/64KB 降低到 32KB/16KB
export const DEFAULT_MAX_RAW = 32768;   // 原 131072
export const DEFAULT_MAX_TEXT = 16384;  // 原 65536
```

**影响**: 对长输出的流式请求（如代码生成、长文翻译），Monitor 页面上的流内容预览会被更积极地截断。用户如果依赖 Monitor 查看完整输出，体验会变差。

**评估**: 这是有意的内存优化。Monitor 用于实时监控而非完整日志查看（完整日志在 request_logs 表和 JSONL 文件中）。可接受，但应在 Monitor UI 中提示用户"内容已截断"。

---
