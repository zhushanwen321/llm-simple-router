# 三指标 TPS 拆分实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将单一 `tokens_per_second` 拆分为 `thinking_tps`、`text_tps`、`total_tps` 三个独立指标，从根本上消除 thinking/tool_use 对 TPS 的干扰。

**Architecture:** 在 `MetricsExtractor` 中同时追踪 thinking 和 text 内容及各自的时间窗口，输出三个 TPS 值。数据库新增 6 列存储原始数据和计算结果。前端仪表盘/详情页分别展示。

**Tech Stack:** better-sqlite3, gpt-tokenizer, Fastify, Vue 3 + Chart.js

---

## 数据模型

### 三个 TPS 指标定义

| 指标 | 计算 | 含义 |
|------|------|------|
| `total_tps` | `output_tokens / (total_duration_ms / 1000)` | API 报告的总吞吐速度 |
| `thinking_tps` | `thinking_tokens / (thinking_duration_ms / 1000)` | 推理阶段的 token 速度 |
| `text_tps` | `text_tokens / (text_duration_ms / 1000)` | 用户可见文本的输出速度 |

### 时间窗口定义

```
streamStartTime          firstThinkingTime        firstTextTime            streamEndTime
    |                         |                        |                       |
    |<-- total_duration_ms -->|                        |                       |
    |                         |<-- thinking_duration ->|                       |
    |                                                  |<-- text_duration_ms ->|
```

- `thinking_duration_ms` = lastThinkingTime - firstThinkingTime（thinking 阶段的实际输出时间）
- `text_duration_ms` = streamEndTime - firstTextTime（text 阶段的输出时间）
- `total_duration_ms` = streamEndTime - streamStartTime（总流时间，不变）

### null 规则

- `thinking_tps` = null 当没有 thinking 内容
- `text_tps` = null 当没有 text 内容
- `total_tps` = null 当 output_tokens 或 total_duration_ms 缺失
- 统计时只 AVG 非 null 值（SQLite AVG 自动忽略 NULL）

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/db/migrations/030_add_tps_breakdown.sql` | 新建 | 新增 6 列 |
| `src/metrics/metrics-extractor.ts` | 修改 | 追踪 thinking，输出 3 个 TPS |
| `src/db/metrics.ts` | 修改 | INSERT/SELECT 新列 |
| `src/db/logs.ts` | 修改 | 双写新列 |
| `src/proxy/proxy-logging.ts` | 修改 | 透传新字段 |
| `src/proxy/transport-fn.ts` | 修改 | toStreamMetrics 新字段 |
| `src/admin/metrics.ts` | 修改 | API 返回新字段，timeseries 支持 text_tps |
| `src/monitor/types.ts` | 修改 | StreamMetricsSnapshot 新字段 |
| `frontend/src/api/client.ts` | 修改 | 类型定义 |
| `frontend/src/composables/useDashboard.ts` | 修改 | 曲线图用 text_tps |
| `frontend/src/views/Dashboard.vue` | 修改 | 展示 3 个速度卡片 |
| `frontend/src/views/metrics-helpers.ts` | 无变更 | — |
| `frontend/src/components/request-detail/types.ts` | 修改 | 映射新字段 |
| `frontend/src/components/request-detail/RequestOverviewPanel.vue` | 修改 | 展示 3 个速度 |
| `scripts/backfill-metrics.ts` | 修改 | 用新公式回填 |
| `tests/metrics-extractor.test.ts` | 修改 | 测试 3 个 TPS |
| `tests/metrics.test.ts` | 修改 | 测试新 timeseries |

---

### Task 1: 数据库迁移 — 新增 6 列

**Files:**
- Create: `src/db/migrations/030_add_tps_breakdown.sql`

- [ ] **Step 1: 编写迁移 SQL**

```sql
-- 030_add_tps_breakdown.sql
-- TPS 三指标拆分：thinking_tps、text_tps、total_tps

-- 原始数据列（用于审计和重新计算）
ALTER TABLE request_metrics ADD COLUMN thinking_tokens INTEGER;
ALTER TABLE request_metrics ADD COLUMN text_tokens INTEGER;
ALTER TABLE request_metrics ADD COLUMN thinking_duration_ms INTEGER;

-- 计算结果列
ALTER TABLE request_metrics ADD COLUMN thinking_tps REAL;
ALTER TABLE request_metrics ADD COLUMN text_tps REAL;
ALTER TABLE request_metrics ADD COLUMN total_tps REAL;
```

- [ ] **Step 2: 验证迁移**

Run: `node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); const fs = require('fs'); fs.readFileSync('src/db/migrations/006_create_request_metrics.sql', 'utf8').split(';').filter(s=>s.trim()).forEach(s=>db.exec(s)); fs.readFileSync('src/db/migrations/029_add_input_tokens_estimated.sql','utf8').split(';').filter(s=>s.trim()).forEach(s=>db.exec(s)); fs.readFileSync('src/db/migrations/030_add_tps_breakdown.sql','utf8').split(';').filter(s=>s.trim()).forEach(s=>db.exec(s)); console.log('OK');"`

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/030_add_tps_breakdown.sql
git commit -m "feat: migration 030 - add thinking_tps, text_tps, total_tps columns"
```

---

### Task 2: MetricsExtractor — 追踪 thinking 并输出 3 个 TPS

**Files:**
- Modify: `src/metrics/metrics-extractor.ts`
- Modify: `tests/metrics-extractor.test.ts`

**MetricsResult 接口变更：**

```typescript
export interface MetricsResult {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  ttft_ms: number | null;
  total_duration_ms: number | null;
  tokens_per_second: number | null;     // 保留，改为 total_tps 的别名
  thinking_tokens: number | null;
  text_tokens: number | null;
  thinking_duration_ms: number | null;
  thinking_tps: number | null;
  text_tps: number | null;
  total_tps: number | null;
  stop_reason: string | null;
  is_complete: number;
  input_tokens_estimated?: number;
}
```

**新增追踪字段（MetricsExtractor 类）：**

```typescript
// Thinking tracking
private thinkingContentBuffer = "";
private thinkingStreamStartTime: number | null = null;
private thinkingStreamEndTime: number | null = null;

// Text tracking (已有 textContentBuffer, textStreamStartTime)
// 新增 textStreamEndTime 追踪最后一个 text_delta 的时间
```

**getMetrics() 计算逻辑：**

```typescript
getMetrics(): MetricsResult {
  let totalDurationMs: number | null = null;
  let totalTps: number | null = null;
  let thinkingTps: number | null = null;
  let textTps: number | null = null;
  let thinkingTokens: number | null = null;
  let textTokens: number | null = null;
  let thinkingDurationMs: number | null = null;

  if (this.streamStartTime !== null && this.streamEndTime !== null && this.outputTokens !== null) {
    totalDurationMs = this.streamEndTime - this.streamStartTime;

    // total_tps: API output_tokens / total_duration
    if (totalDurationMs > 0) {
      totalTps = this.outputTokens / (totalDurationMs / MS_PER_SECOND);
    }

    // thinking_tps: tokenizer count on thinking content / thinking duration
    if (this.thinkingContentBuffer.length > 0) {
      thinkingTokens = encode(this.thinkingContentBuffer).length;
      if (this.thinkingStreamStartTime !== null && this.thinkingStreamEndTime !== null) {
        thinkingDurationMs = this.thinkingStreamEndTime - this.thinkingStreamStartTime;
        if (thinkingDurationMs > 0) {
          thinkingTps = thinkingTokens / (thinkingDurationMs / MS_PER_SECOND);
        }
      }
    }

    // text_tps: tokenizer count on text content / text duration
    if (this.textContentBuffer.length > 0 && this.textStreamStartTime !== null) {
      textTokens = encode(this.textContentBuffer).length;
      const textDurationMs = this.streamEndTime - this.textStreamStartTime;
      if (textDurationMs > 0) {
        textTps = textTokens / (textDurationMs / MS_PER_SECOND);
      }
    }
  }

  return {
    input_tokens: this.inputTokens,
    output_tokens: this.outputTokens,
    cache_creation_tokens: this.cacheCreationTokens,
    cache_read_tokens: this.cacheReadTokens,
    ttft_ms: this.ttftMs,
    total_duration_ms: totalDurationMs,
    tokens_per_second: totalTps,  // 向后兼容，值 = total_tps
    thinking_tokens: thinkingTokens,
    text_tokens: textTokens,
    thinking_duration_ms: thinkingDurationMs,
    thinking_tps: thinkingTps,
    text_tps: textTps,
    total_tps: totalTps,
    stop_reason: this.stopReason,
    is_complete: this.complete ? 1 : 0,
  };
}
```

**processAnthropicEvent 变更：**

在 `thinking_delta` 处理中：
```typescript
if (delta?.type === "thinking_delta") {
  this.hasThinkingContent = true;
  const thinking = delta.thinking ?? "";
  if (this.thinkingStreamStartTime === null) {
    this.thinkingStreamStartTime = Date.now();
  }
  if (thinking) {
    this.thinkingContentBuffer += thinking;
    this.thinkingStreamEndTime = Date.now();  // 持续更新到最后一个 thinking_delta
  }
}
```

在 `text_delta` 处理中，保持不变（已有 `textStreamStartTime`）。

**processOpenAIEvent 变更：** 无 thinking 追踪（OpenAI 不发 thinking_delta），text 追踪保持不变。

**非流式响应（fromNonStreamResponse）：** 新字段全部返回 null（非流式无法测量 TPS）。

- [ ] **Step 1: 编写测试（思考模型 3 个 TPS）**

在 `tests/metrics-extractor.test.ts` 中新增测试：

```typescript
test("thinking model: computes thinking_tps, text_tps, total_tps separately", () => {
  const extractor = new MetricsExtractor("anthropic", 1000);

  // message_start
  extractor.processEvent({ data: JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 100 } } }) });

  // thinking_delta events (simulate 500ms of thinking)
  const thinking1 = { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me think about this carefully" } };
  extractor.processEvent({ data: JSON.stringify(thinking1) });

  // text_delta events
  const text1 = { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "The answer is 42." } };
  extractor.processEvent({ data: JSON.stringify(text1) });

  // message_delta with output_tokens
  const end = { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 500 } };
  extractor.processEvent({ data: JSON.stringify(end) });

  const result = extractor.getMetrics();
  expect(result.thinking_tokens).not.toBeNull();
  expect(result.thinking_tokens!).toBeGreaterThan(0);
  expect(result.text_tokens).not.toBeNull();
  expect(result.text_tokens!).toBeGreaterThan(0);
  expect(result.total_tps).not.toBeNull();  // output_tokens / total_duration
  expect(result.thinking_tps).not.toBeNull();
  expect(result.text_tps).not.toBeNull();
  expect(result.tokens_per_second).toBe(result.total_tps);  // 向后兼容
});

test("tool_use only: thinking_tps=null, text_tps=null, total_tps=calculated", () => {
  const extractor = new MetricsExtractor("anthropic", 1000);
  extractor.processEvent({ data: JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 50 } } }) });
  extractor.processEvent({ data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' } }) });
  extractor.processEvent({ data: JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } }) });

  const result = extractor.getMetrics();
  expect(result.thinking_tps).toBeNull();
  expect(result.text_tps).toBeNull();
  expect(result.total_tps).not.toBeNull();  // 仍有总吞吐
  expect(result.thinking_tokens).toBeNull();
  expect(result.text_tokens).toBeNull();
});

test("pure text model: thinking_tps=null, text_tps=calculated, total_tps=calculated", () => {
  const extractor = new MetricsExtractor("anthropic", 1000);
  extractor.processEvent({ data: JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 100 } } }) });
  extractor.processEvent({ data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello world" } }) });
  extractor.processEvent({ data: JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } }) });

  const result = extractor.getMetrics();
  expect(result.thinking_tps).toBeNull();
  expect(result.text_tps).not.toBeNull();
  expect(result.total_tps).not.toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/metrics-extractor.test.ts`

- [ ] **Step 3: 实现 MetricsExtractor 变更**

修改 `src/metrics/metrics-extractor.ts`：
1. 新增 `thinkingContentBuffer`, `thinkingStreamStartTime`, `thinkingStreamEndTime` 字段
2. 修改 `MetricsResult` 接口
3. 修改 `processAnthropicEvent` — `thinking_delta` 时追踪 thinking 内容和时间
4. 重写 `getMetrics()` — 计算 3 个 TPS
5. `tokens_per_second` 设为 `total_tps`（向后兼容）
6. 非流式响应函数中所有新字段设 null

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/metrics-extractor.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/metrics/metrics-extractor.ts tests/metrics-extractor.test.ts
git commit -m "feat: MetricsExtractor - split into thinking_tps, text_tps, total_tps"
```

---

### Task 3: 数据层 — 存储、查询、双写

**Files:**
- Modify: `src/db/metrics.ts` — INSERT/SELECT 新列，timeseries 支持 text_tps
- Modify: `src/db/logs.ts` — 双写新列到 request_logs（可选，仅冗余展示用）

**metrics.ts 变更：**

`MetricsRow` 新增字段：
```typescript
thinking_tokens: number | null;
text_tokens: number | null;
thinking_duration_ms: number | null;
thinking_tps: number | null;
text_tps: number | null;
total_tps: number | null;
```

`MetricsInsert` 新增同上可选字段。

`insertMetrics` — INSERT 语句加入新列。

`getMetricsSummary` — `avg_tps` 改为 `AVG(rm.text_tps)` (用户关心的"输出速度")。

`getMetricsTimeseries` — `METRIC_EXPR` 新增：
```typescript
text_tps: "AVG(rm.text_tps)",
thinking_tps: "AVG(rm.thinking_tps)",
total_tps: "AVG(rm.total_tps)",
```

**logs.ts 变更：** `updateLogMetrics` 双写新列。但 request_logs 表**不加列**（避免迁移复杂度），仅冗余写 `tokens_per_second`（仍 = total_tps 向后兼容）。详细的 3 指标只存 request_metrics。

- [ ] **Step 1: 修改 metrics.ts — INSERT 和类型**

- [ ] **Step 2: 修改 metrics.ts — METRIC_EXPR 新增 3 个指标**

- [ ] **Step 3: 修改 metrics.ts — getMetricsSummary 改用 text_tps**

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/metrics.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/db/metrics.ts tests/metrics.test.ts
git commit -m "feat: db layer - store and query thinking_tps, text_tps, total_tps"
```

---

### Task 4: 传输层 — 透传新字段

**Files:**
- Modify: `src/proxy/transport-fn.ts` — `toStreamMetrics` 映射新字段
- Modify: `src/monitor/types.ts` — `StreamMetricsSnapshot` 新增字段
- Modify: `src/proxy/proxy-logging.ts` — `collectTransportMetrics` 透传新字段

**transport-fn.ts:**
```typescript
function toStreamMetrics(m: MetricsResult) {
  return {
    ...existing,
    thinkingTps: m.thinking_tps,
    textTps: m.text_tps,
    totalTps: m.total_tps,
    thinkingTokens: m.thinking_tokens,
    textTokens: m.text_tokens,
  };
}
```

**monitor/types.ts:**
```typescript
export interface StreamMetricsSnapshot {
  // ...existing
  thinkingTps: number | null;
  textTps: number | null;
  totalTps: number | null;
  thinkingTokens: number | null;
  textTokens: number | null;
}
```

- [ ] **Step 1: 修改 3 个文件**

- [ ] **Step 2: 运行全部测试**

Run: `npx vitest run`

- [ ] **Step 3: Commit**

```bash
git add src/proxy/transport-fn.ts src/monitor/types.ts src/proxy/proxy-logging.ts
git commit -m "feat: transport layer - propagate thinking_tps, text_tps, total_tps"
```

---

### Task 5: Admin API — 暴露新指标

**Files:**
- Modify: `src/admin/metrics.ts` — 新的 metric type 和 API 字段

`MetricsMetric` type 新增 `"thinking_tps" | "text_tps" | "total_tps"`。
API 返回的 summary row 新增 `avg_text_tps`, `avg_thinking_tps`, `avg_total_tps`。

- [ ] **Step 1: 修改 admin API**

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/metrics.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/admin/metrics.ts
git commit -m "feat: admin API - expose thinking_tps, text_tps, total_tps"
```

---

### Task 6: 前端 — 仪表盘三指标曲线和卡片

**Files:**
- Modify: `frontend/src/api/client.ts` — 类型定义
- Modify: `frontend/src/composables/useDashboard.ts` — 新增曲线数据
- Modify: `frontend/src/views/Dashboard.vue` — 展示 3 个速度
- Modify: `frontend/src/views/metrics-helpers.ts` — 无变更（已是泛型）

**Dashboard 变更：**
1. 原来的 "Token 输出速度" 曲线改为 **text_tps**
2. 摘要卡片改为 3 个：Thinking 速度、Text 速度、Total 速度
3. 曲线图选项：支持切换 thinking_tps / text_tps / total_tps

- [ ] **Step 1: 修改 client.ts 类型**

- [ ] **Step 2: 修改 useDashboard.ts — 曲线改用 text_tps**

- [ ] **Step 3: 修改 Dashboard.vue — 3 个速度卡片 + 曲线图**

- [ ] **Step 4: 验证前端构建**

Run: `cd frontend && npm run build`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat: dashboard - display thinking_tps, text_tps, total_tps"
```

---

### Task 7: 前端 — 请求详情页展示三指标

**Files:**
- Modify: `frontend/src/components/request-detail/types.ts` — 映射新字段
- Modify: `frontend/src/components/request-detail/RequestOverviewPanel.vue` — 展示 3 个速度
- Modify: `frontend/src/components/logs/types.ts` — 日志列表类型

- [ ] **Step 1: 修改类型定义和映射**

- [ ] **Step 2: 修改 RequestOverviewPanel.vue**

- [ ] **Step 3: 验证前端构建**

Run: `cd frontend && npm run build`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: request detail - show thinking_tps, text_tps, total_tps"
```

---

### Task 8: Backfill — 历史数据迁移

**Files:**
- Modify: `scripts/backfill-metrics.ts`

对已有的 stream_text_content 数据：
1. 提取 thinking 内容 → `thinking_tokens` (tokenizer) → `thinking_tps`
2. 提取 text 内容 → `text_tokens` (tokenizer) → `text_tps`
3. `total_tps` = `output_tokens / total_duration_ms * 1000`
4. 将 `tokens_per_second` 统一设为 `total_tps`

- [ ] **Step 1: 编写 backfill 脚本**

- [ ] **Step 2: 在生产 DB 上执行**

Run: `npx tsx scripts/backfill-metrics.ts ~/.llm-simple-router/router.db`

- [ ] **Step 3: 验证数据**

Run: `node -e "..."` 查询分布验证

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-metrics.ts
git commit -m "feat: backfill - compute thinking_tps, text_tps, total_tps for historical data"
```

---

### Task 9: 端到端验证

- [ ] **Step 1: 全部测试通过**

Run: `npx vitest run`

- [ ] **Step 2: ESLint 通过**

Run: `npm run lint`

- [ ] **Step 3: 前端构建通过**

Run: `cd frontend && npm run build`

- [ ] **Step 4: 最终 Commit & Push**
