# 请求日志管线重构设计

## 问题

当前 `request_logs` 表的 3 个数据字段存在快照点选择错误的问题：

| 字段 | 期望语义 | 实际语义 |
|------|---------|---------|
| `client_request` | 客户端原始请求 | applyEnhancement + toolGuard 处理后的中间态 |
| `upstream_request` | 发给上游的最终请求 | 正确（保持不变） |
| `upstream_response` | 上游原始响应 | 非流式时包含注入的 model-info 标签 |

此外缺少变换元数据——无法从日志重建代理做了哪些操作。

## 方案：3 边界字段 + pipeline_snapshot

### 数据模型

**保留 3 个边界字段（修正语义）：**

- `client_request` — 快照点前移到 `applyEnhancement` 之前，记录真正的原始请求
- `upstream_request` — 不变，记录发给上游的最终请求
- `upstream_response` — 在 transport 层直接捕获，model-info 注入移到日志记录之后

**新增字段：**

- `pipeline_snapshot` (TEXT, JSON) — 有序数组，记录每个管线阶段的变换元数据

**`client_response` 不恢复：** 可从 `upstream_response` + `pipeline_snapshot.response_transform` 推导。

### pipeline_snapshot JSON 结构

```json
[
  {
    "stage": "enhancement",
    "router_tags_stripped": 2,
    "directive": { "type": "select_model", "value": "gpt-4o" }
  },
  {
    "stage": "tool_guard",
    "action": "inject_break_prompt",
    "tool": "read_file"
  },
  {
    "stage": "routing",
    "client_model": "gpt-4o",
    "backend_model": "deepseek-v3",
    "provider_id": "p_abc",
    "strategy": "failover"
  },
  {
    "stage": "overflow",
    "triggered": true,
    "redirect_to": "claude-3-opus",
    "redirect_provider": "p_def"
  },
  {
    "stage": "provider_patch",
    "types": ["deepseek_tool_use_to_text"]
  },
  {
    "stage": "response_transform",
    "model_info_tag_injected": true
  }
]
```

每个 stage 只在对应步骤实际执行后才记录，未触发的不出现。

### StageRecord 类型定义

```typescript
type StageRecord =
  | { stage: "enhancement"; router_tags_stripped: number; directive: DirectiveMeta | null }
  | { stage: "tool_guard"; action: string; tool: string }
  | { stage: "routing"; client_model: string; backend_model: string; provider_id: string; strategy: string }
  | { stage: "overflow"; triggered: boolean; redirect_to?: string; redirect_provider?: string }
  | { stage: "provider_patch"; types: string[] }
  | { stage: "response_transform"; model_info_tag_injected: boolean };
```

## 管线代码变更

### 1. client_request 快照点前移

`proxy-handler.ts`：在 `applyEnhancement()` 调用之前捕获 `rawClientBody`。

### 2. model-info 注入从 transport 层移到 handler 层

- `transport-fn.ts`：删除 `buildTransportFn` 中的 model-info 注入逻辑（第 108-116 行）
- `proxy-handler.ts`：在 `logResilienceResult()` 之后、`reply.send()` 之前执行注入
- resilience 层因此捕获的是 transport 的原始返回

### 3. 加工函数返回值扩展

| 函数 | 当前返回 | 新增返回 |
|------|---------|---------|
| `applyEnhancement` | effectiveModel, originalModel, interceptResponse | `meta: { router_tags_stripped, directive }` |
| `applyProviderPatches` | void | `{ types: string[] }` |
| `applyOverflowRedirect` | 结果或 null | 不变（已有足够信息） |

### 4. PipelineSnapshot 收集器

新增 `src/proxy/pipeline-snapshot.ts`：

```typescript
class PipelineSnapshot {
  private stages: StageRecord[] = [];
  add(record: StageRecord): void;
  toJSON(): string;
}
```

在 `proxy-handler.ts` 中贯穿使用，每个管线阶段后调用 `snapshot.add()`。

## 文件变更清单

| 文件 | 类型 | 描述 |
|------|------|------|
| `src/proxy/pipeline-snapshot.ts` | 新增 | PipelineSnapshot 类和 StageRecord 类型 |
| `src/proxy/proxy-handler.ts` | 修改 | 快照点前移 + model-info 注入 + snapshot 收集 |
| `src/proxy/transport-fn.ts` | 修改 | 删除 model-info 注入逻辑 |
| `src/proxy/enhancement-handler.ts` | 修改 | 返回值增加 meta |
| `src/proxy/patch-*.ts` 或相关文件 | 修改 | applyProviderPatches 返回 patch 类型列表 |
| `src/proxy/log-helpers.ts` | 修改 | insertSuccessLog/insertRejectedLog 接受 pipeline_snapshot |
| `src/proxy/proxy-logging.ts` | 修改 | logResilienceResult 传递 pipeline_snapshot |
| `src/db/migrations/0xx_add_pipeline_snapshot.sql` | 新增 | ALTER TABLE 添加列 |
| `frontend/src/views/Logs.vue` | 修改 | 日志详情展示 pipeline_snapshot |

## 数据库迁移

```sql
ALTER TABLE request_logs ADD COLUMN pipeline_snapshot TEXT;
```

向前兼容：旧日志行该列为 null。不需要回填。

`client_request` 和 `upstream_response` 的语义变化不涉及表结构变更，只需修改代码中的快照点。

## 测试策略

| 类型 | 覆盖内容 |
|------|---------|
| 单元测试 | PipelineSnapshot.add/toJSON |
| 单元测试 | 各加工函数新返回值（enhancement meta、provider patch types） |
| 集成测试 | client_request 包含原始指令标记（未被剥离） |
| 集成测试 | upstream_response 不含 model-info 标签 |
| 集成测试 | pipeline_snapshot 端到端：验证 JSON 结构和 stages |
| 迁移测试 | 新列存在性 |

**重点测试场景：**
- 带 `$SELECT-MODEL` 指令的请求 → client_request 保留指令、pipeline_snapshot 记录 directive
- DeepSeek provider 请求 → upstream_request 含 patch 后 body、pipeline_snapshot 记录 provider_patch
- overflow 触发 → pipeline_snapshot 记录 redirect 信息
- 流式请求 → upstream_response.body 为 null、stream_text_content 有值
