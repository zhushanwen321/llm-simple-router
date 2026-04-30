# 请求日志管线重构设计

## 问题

当前 `request_logs` 表的 3 个数据字段存在快照点选择错误的问题：

| 字段 | 期望语义 | 实际语义 |
|------|---------|---------|
| `client_request` | 客户端原始请求 | applyEnhancement + toolGuard 处理后的中间态 |
| `upstream_request` | 发给上游的最终请求 | 正确（保持不变） |
| `upstream_response` | 上游原始响应 | 非流式时包含注入的 model-info 标签 |

此外缺少变换元数据——无法从日志重建代理做了哪些操作。

根因是管线中使用 in-place mutation 模式：`request.body` 在多个阶段被原地修改，快照时机决定了日志语义，但没有任何机制保证一致性。

## 架构决策

### 不引入类层次/责任链模式

各阶段的接口差异大（输入/输出完全不同），控制流非线性（early return、while 循环、异常驱动的 failover），不适合套用线性 Chain of Responsibility。TypeScript 函数返回值类型的强制力与 abstract method 等价，但无类层次的额外复杂度。

### 消除 in-place mutation，改为函数式数据流

每个加工函数接收 body 作为输入参数，返回 `{ body, meta }` 元组。body 作为值在管线中流动，原始数据天然保留，不需要"选择快照点"。

## 方案

### 数据模型

**3 个边界字段 + 1 个元数据字段：**

- `client_request` — `request.body` 的原始值（第一个加工函数的输入）
- `upstream_request` — 最后一个加工函数的输出（发给上游的最终请求）
- `upstream_response` — transport 层的原始返回（model-info 注入移到日志记录之后）
- `pipeline_snapshot` (TEXT, JSON) — 有序数组，记录每个管线阶段的变换元数据

**`client_response` 不恢复：** 可从 `upstream_response` + `pipeline_snapshot.response_transform` 推导。

### 数据流（消除 mutation 后）

```
request.body (Fastify 原始)
    │
    ▼
rawBody = 深拷贝 request.body          ← client_request = JSON.stringify({ headers, body: rawBody })
    │
    ▼
applyEnhancement(rawBody, ...)          → { body: enhancedBody, meta: enhMeta }
    │                                        snapshot.add(enhMeta)
    ▼
maybeInjectBreak(enhancedBody, ...)     → { body: guardedBody, meta: guardMeta }
    │                                        snapshot.add(guardMeta)
    ▼
routing: body.model = backend_model     → routedBody = { ...guardedBody, model: backend }
    │                                        snapshot.add({ stage: "routing", ... })
    ▼
applyOverflowRedirect(routedBody, ...)  → { body: overflowBody, meta: overflowMeta }
    │                                        snapshot.add(overflowMeta)
    ▼
applyProviderPatches(overflowBody, ...) → { body: patchedBody, meta: patchMeta }
    │                                        snapshot.add(patchMeta)
    │
    ▼
upstream_request = JSON.stringify({ url, headers, body: patchedBody })
    │
    ▼
transport(patchedBody)                  → raw upstream response
    │
    ▼
upstream_response 捕获                  ← 日志记录（此时 response 未经任何修改）
    │
    ▼
maybeInjectModelInfoTag(response)       → finalResponse
    │                                        snapshot.add({ stage: "response_transform", ... })
    ▼
reply.send(finalResponse)
```

### pipeline_snapshot JSON 结构

```json
[
  { "stage": "enhancement", "router_tags_stripped": 2, "directive": { "type": "select_model", "value": "gpt-4o" } },
  { "stage": "tool_guard", "action": "inject_break_prompt", "tool": "read_file" },
  { "stage": "routing", "client_model": "gpt-4o", "backend_model": "deepseek-v3", "provider_id": "p_abc", "strategy": "failover" },
  { "stage": "overflow", "triggered": true, "redirect_to": "claude-3-opus", "redirect_provider": "p_def" },
  { "stage": "provider_patch", "types": ["deepseek_tool_use_to_text"] },
  { "stage": "response_transform", "model_info_tag_injected": true }
]
```

每个 stage 只在对应步骤实际执行后才记录，未触发的不出现。

### StageRecord 类型

```typescript
type StageRecord =
  | { stage: "enhancement"; router_tags_stripped: number; directive: DirectiveMeta | null }
  | { stage: "tool_guard"; action: string; tool: string }
  | { stage: "routing"; client_model: string; backend_model: string; provider_id: string; strategy: string }
  | { stage: "overflow"; triggered: boolean; redirect_to?: string; redirect_provider?: string }
  | { stage: "provider_patch"; types: string[] }
  | { stage: "response_transform"; model_info_tag_injected: boolean };
```

## 加工函数签名变更

### 统一返回值模式

每个加工函数返回 `{ body, meta }` 元组，TypeScript 类型系统强制 meta 不被遗漏：

```typescript
interface StageResult<B, M> {
  body: B;
  meta: M;
}
```

### 各函数变更

**`applyEnhancement`：**

```typescript
// BEFORE: in-place 修改 request.body，返回路由结果
function applyEnhancement(db, request, clientModel, sessionId): {
  effectiveModel, originalModel, interceptResponse
}

// AFTER: 接收 body 参数，返回新 body + 元数据
function applyEnhancement(db, body, headers, clientModel, sessionId): {
  body: Record<string, unknown>;       // 新 body（指令已剥离）
  effectiveModel: string;
  originalModel: string | null;
  interceptResponse: ... | null;
  meta: { router_tags_stripped: number; directive: DirectiveMeta | null };
}
```

**`applyProviderPatches`：**

```typescript
// BEFORE: void，in-place 修改 body
function applyProviderPatches(body, provider): void

// AFTER: 返回新 body + patch 类型列表
function applyProviderPatches(body, provider): {
  body: Record<string, unknown>;
  meta: { types: string[] };
}
```

**`applyOverflowRedirect`：** 返回值已足够表达是否触发，meta 可从返回值构建，不需改签名。

**`toolGuard.injectLoopBreakPrompt`：**

```typescript
// BEFORE: in-place 修改 body
function injectLoopBreakPrompt(body, apiType, toolName): void

// AFTER: 返回新 body
function injectLoopBreakPrompt(body, apiType, toolName): {
  body: Record<string, unknown>;
}
```

**`maybeInjectModelInfoTag`（从 transport-fn.ts 提取）：**

```typescript
// 新增函数，在 handler 层调用
function maybeInjectModelInfoTag(responseBody, originalModel, effectiveModel): {
  body: string;
  meta: { model_info_tag_injected: boolean };
}
```

### PipelineSnapshot 收集器

新增 `src/proxy/pipeline-snapshot.ts`：

```typescript
class PipelineSnapshot {
  private stages: StageRecord[] = [];
  add(record: StageRecord): void { this.stages.push(record); }
  toJSON(): string { return JSON.stringify(this.stages); }
}
```

## 文件变更清单

| 文件 | 类型 | 描述 |
|------|------|------|
| `src/proxy/pipeline-snapshot.ts` | 新增 | PipelineSnapshot 类和 StageRecord 类型 |
| `src/proxy/proxy-handler.ts` | 修改 | 管线改为函数式数据流 + snapshot 收集 + model-info 注入 |
| `src/proxy/transport-fn.ts` | 修改 | 删除 model-info 注入逻辑 |
| `src/proxy/enhancement-handler.ts` | 修改 | 接收 body 参数，返回新 body + meta |
| `src/proxy/response-cleaner.ts` | 修改 | 返回新 body 而非 in-place 修改 |
| `src/proxy/directive-parser.ts` | 修改 | 返回新 body 而非 in-place 修改 |
| `src/proxy/patch-*.ts` 或相关文件 | 修改 | applyProviderPatches 返回新 body + meta |
| `src/proxy/loop-prevention/*.ts` | 修改 | injectLoopBreakPrompt 返回新 body |
| `src/proxy/log-helpers.ts` | 修改 | 接受 pipeline_snapshot 参数 |
| `src/proxy/proxy-logging.ts` | 修改 | logResilienceResult 传递 pipeline_snapshot |
| `src/db/migrations/0xx_add_pipeline_snapshot.sql` | 新增 | ALTER TABLE 添加列 |
| `frontend/src/views/Logs.vue` | 修改 | 日志详情展示 pipeline_snapshot |

## 数据库迁移

```sql
ALTER TABLE request_logs ADD COLUMN pipeline_snapshot TEXT;
```

向前兼容：旧日志行该列为 null。不需要回填。

`client_request` 和 `upstream_response` 的语义变化不涉及表结构变更，由代码中的函数式数据流自动保证。

## 测试策略

| 类型 | 覆盖内容 |
|------|---------|
| 单元测试 | PipelineSnapshot.add/toJSON |
| 单元测试 | 各加工函数：输入不变、返回新 body + meta |
| 单元测试 | enhancement meta 包含 router_tags_stripped 和 directive |
| 单元测试 | applyProviderPatches meta 包含 patch types |
| 集成测试 | client_request 包含原始指令标记（未被剥离） |
| 集成测试 | upstream_response 不含 model-info 标签 |
| 集成测试 | pipeline_snapshot 端到端：验证 JSON 结构和 stages |
| 集成测试 | body 不被 in-place 修改：验证 rawBody 在管线前后一致 |
| 迁移测试 | 新列存在性 |

**重点测试场景：**
- 带 `$SELECT-MODEL` 指令的请求 → client_request 保留指令、pipeline_snapshot 记录 directive
- DeepSeek provider 请求 → upstream_request 含 patch 后 body、pipeline_snapshot 记录 provider_patch
- overflow 触发 → pipeline_snapshot 记录 redirect 信息
- 流式请求 → upstream_response.body 为 null、stream_text_content 有值
