---
verdict: pass
---

# Retry Rule Upgrade: Provider Isolation + JSON Matching + Error Logging

## Background

### 问题起源

Kimi provider 返回 HTTP 429 usage-limit 错误时，响应体包含 `"type":"rate_limit_error"`。这条错误被名为 "OpenCode DeepSeek 速率限制" 的重试规则误命中（`body_pattern: "error".*"type"\s*:\s*"rate_limit_error"`），触发 10 次 exponential backoff 重试，累计耗时约 7 分钟。期间客户端一直处于 "working" 状态，无任何响应返回。

**根因：** 重试规则的 `body_pattern` 是通用正则，无法限定到特定 provider。一条为 DeepSeek 设计的规则错误匹配了所有 provider 返回的 `rate_limit_error`。

### 现有基础设施

| 组件 | 文件 | 当前能力 |
|------|------|----------|
| retry_rules 表 | `migrations/011_*.sql` | status_code + body_pattern(正则) + retry_strategy |
| RetryRuleMatcher | `orchestration/retry-rules.ts` | 按 status_code 分组缓存，正则匹配 body |
| ResilienceLayer.decide() | `orchestration/resilience.ts` | 匹配规则后决定 retry/failover/done |
| failover-loop | `handler/failover-loop.ts` | 调用 orchestrator，处理最终结果 |
| stream.ts | `transport/stream.ts` | callStream 对非 200 返回 stream_error |
| orchestrator.sendResponse | `orchestration/orchestrator.ts` | 对 stream_error+!headersSent 发送 reply.send |
| tool-error-logger | `proxy/tool-error-logger.ts` | 参考：独立的错误日志写入模式 |
| RetryRules.vue | `frontend/src/views/RetryRules.vue` | 表格 + Dialog 编辑模式 |
| Admin API | `admin/retry-rules.ts` | CRUD + AI 生成规则 |

## Functional Requirements

### FR1: Provider 隔离

retry_rules 表新增 `provider_id` 列（TEXT NULL），支持两种规则类型：
- **通用规则**（`provider_id = NULL`）：对所有 provider 生效
- **绑定规则**（`provider_id = '<uuid>'`）：仅对指定 provider 生效

**匹配优先级（已确认）：**
1. 查找 `provider_id = 当前请求 provider` 且 `status_code = 上游状态码` 的绑定规则，按顺序匹配
2. 绑定规则全部不匹配时，fallback 到 `provider_id IS NULL` 的通用规则

一个 provider 可绑定多条规则（1:N）。绑定规则之间按 `created_at DESC` 排序。

### FR2: JSON 字段匹配

retry_rules 表新增 `body_matchers` 列（TEXT NULL），存储 JSON 数组格式的结构化匹配条件。

**body_matchers JSON 格式：**
```json
[
  { "path": "error.type", "operator": "contains", "value": "rate_limit_error" },
  { "path": "type", "operator": "equals", "value": "error" }
]
```

字段说明：
- `path`: JSON 响应体中的字段路径，用 `.` 分隔嵌套层级（如 `error.type`）
- `operator`: `equals`（精确匹配）| `contains`（包含子串）| `exists`（字段存在，忽略 value）
- `value`: 期望值（`exists` 操作符时忽略）

所有条件之间是 AND 关系。body_matchers 为 NULL 时 fallback 到 body_pattern 正则匹配。

**匹配逻辑优先级：**
1. 有 `body_matchers` → JSON.parse(body)，逐条检查 AND 条件。parse 失败返回 false
2. 无 `body_matchers` → 使用 `body_pattern` 正则匹配
3. 都没有 → 不匹配

### FR3: RetryRuleMatcher 升级

`RetryRuleMatcher` 的 `match()` 方法签名变更为 `match(statusCode, body, providerId)`：
- 缓存结构改为按 `(provider_id | null, status_code)` 二级分组
- 匹配时先查 provider 绑定组，再查通用组
- 每条规则的匹配逻辑支持 body_matchers（JSON）和 body_pattern（正则 fallback）

所有调用方（`resilience.ts` 的 `decide()`、`transport-fn.ts` 的 `checkEarlyError`）传入 `providerId`。

### FR4: stream_error 响应路径修复

当 `stream_error`（上游在 SSE 流开始前返回非 200）经过 resilience 重试耗尽后（`done`/`abort`），`sendResponse()` 应发送格式化的错误响应：

- `orchestrator.ts` `sendResponse()`: 对 `stream_error + !headersSent` 分支，使用 adapter 的 `formatError()` 格式化错误体，设置 `content-type: application/json`
- `failover-loop.ts`: resilience 最终结果为 `stream_error` 时，补充调用 `updateLogClientStatus()` 记录客户端状态码

### FR5: upstream_error_logs 表

新建 `upstream_error_logs` 表，记录最终失败的请求错误信息。

**表结构：**
```sql
CREATE TABLE upstream_error_logs (
  id TEXT PRIMARY KEY,
  request_log_id TEXT REFERENCES request_logs(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  backend_model TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  error_type TEXT,
  error_message TEXT,
  client_agent_type TEXT NOT NULL DEFAULT 'unknown',
  router_key_id TEXT,
  session_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

索引：`created_at`、`(provider_id, created_at)`、`(status_code, created_at)`。

**写入时机：** failover-loop 中，resilience 最终结果为失败（`done`/`abort` 且 status >= 400）时，在 `logResilienceResult` 之后写入。`error_type` 和 `error_message` 从最后一个 attempt 的 responseBody 中提取。

**用途：** 后续诊断分析，暂不做前端展示。按 `created_at` 定期清理（复用现有日志清理逻辑）。

### FR6: 前端 RetryRules 页面适配

**表格新增列：**
- "Provider" 列（在 "响应体匹配" 之后）：通用规则显示 Badge "通用"，绑定规则显示 provider 名称

**Dialog 编辑面板新增：**
- **Provider 绑定**（名称字段之后）：Select 组件，选项为 "通用（所有 Provider）" + 所有已配置 provider
- **响应体匹配升级**（替换现有 body_pattern Input）：Tab 切换 `正则匹配` | `JSON 字段匹配`
  - 正则匹配 Tab：保留现有 Input（body_pattern）
  - JSON 字段匹配 Tab：可增删的匹配条件列表，每行三个控件（字段路径 Input、操作符 Select、值 Input）。exists 操作符时隐藏值 Input。"+" 按钮添加新行

**表格 "响应体匹配" 列展示逻辑：**
- 有 body_matchers → 显示 JSON 条件摘要（如 `error.type contains "rate_limit_error"`）
- 无 body_matchers → 显示 body_pattern 正则（现有行为）

### FR7: DB Schema 变更

新增迁移文件 `049_add_provider_isolation_and_matchers.sql`：
- `ALTER TABLE retry_rules ADD COLUMN provider_id TEXT NULL DEFAULT NULL`
- `ALTER TABLE retry_rules ADD COLUMN body_matchers TEXT NULL DEFAULT NULL`
- 新建 `upstream_error_logs` 表及索引

现有规则不受影响：`provider_id = NULL`、`body_matchers = NULL`，行为不变。

### FR8: Admin API 适配

`admin/retry-rules.ts` 的 CRUD 端点适配新字段：
- Create/Update 接受 `provider_id`（string | null）和 `body_matchers`（JSON string | null）
- GET 返回包含新字段的完整规则
- `RetryRule` 类型定义新增 `provider_id` 和 `body_matchers` 字段
- AI 生成规则端点：生成结果不自动填充 provider_id（需用户手动绑定）

### FR9: StateRegistry 刷新

规则更新后 `stateRegistry.refreshRetryRules()` 触发 `RetryRuleMatcher.load()` 重新加载。`load()` 逻辑需适配新的缓存结构（按 provider_id + status_code 二级分组）。

## Acceptance Criteria

### AC1: Provider 隔离

- 绑定规则只匹配指定 provider 的请求，不影响其他 provider
- 通用规则（provider_id = NULL）对所有 provider 生效
- 匹配优先级：绑定规则优先，通用规则 fallback
- 一个 provider 可绑定多条规则，按 created_at DESC 排序

**测试场景：**
- Provider A 的 429 规则不匹配 Provider B 的 429 响应
- 无绑定规则时 fallback 到通用规则
- 绑定规则存在但不匹配时 fallback 到通用规则

### AC2: JSON 字段匹配

- body_matchers 配置后按 AND 逻辑匹配 JSON 响应体
- `equals`: 精确匹配字段值
- `contains`: 字段值包含指定子串
- `exists`: 字段存在即匹配，忽略 value
- body_matchers 为 NULL 时 fallback 到 body_pattern 正则
- body 不是合法 JSON 时 body_matchers 不匹配，fallback 到正则
- 嵌套路径（如 `error.type`）正确解析

**测试场景：**
- Kimi 429 `{"error":{"type":"rate_limit_error","message":"usage limit"}}` → body_matchers `[{"path":"error.type","operator":"contains","value":"rate_limit_error"}]` 匹配
- 非 JSON 响应 → body_matchers 返回 false → fallback 到正则
- 多条件 AND：两个条件都满足才匹配，任一不满足不匹配

### AC3: 429 usage-limit 不再误触发重试

- Kimi 429 usage-limit 错误绑定到专用规则（不重试或低次数重试）
- 不再匹配为其他 provider 设计的 rate_limit_error 规则
- 客户端在合理时间内收到错误响应（不再等待 7 分钟）

### AC4: stream_error 响应正确返回客户端

- stream_error 重试耗尽后，客户端收到格式化的 JSON 错误响应
- `client_status_code` 正确记录到 request_logs
- 错误响应格式与客户端 API 类型匹配（anthropic/openai 格式）

### AC5: upstream_error_logs 写入

- 最终失败的请求（status >= 400）写入 upstream_error_logs
- error_type 和 error_message 从上游响应体正确提取
- retry_count 记录实际重试次数
- 日志可按 provider_id、status_code、created_at 查询

### AC6: 前端 Provider 选择

- Dialog 中可选择 provider 或 "通用"
- 绑定规则在表格中显示 provider 名称
- 通用规则在表格中显示 "通用" Badge

### AC7: 前端 JSON 字段匹配编辑

- Tab 切换正则/JSON 匹配模式
- JSON 模式下可增删匹配条件行
- exists 操作符隐藏值输入
- 保存时正确序列化 body_matchers JSON

### AC8: 向后兼容

- 现有规则（无 provider_id、无 body_matchers）行为不变
- 现有 API 调用（不传新字段）正常工作
- DB 迁移不影响现有数据

## Data Consumer Checklist

CLAUDE.md 要求新增 DB 列时必须列出所有 4 类消费者并逐一验证。

### 1. DB 写入

| 新字段/表 | 写入函数 | 来源 |
|-----------|----------|------|
| retry_rules.provider_id | `createRetryRule()` / `updateRetryRule()` | Admin API Create/Update 请求体 |
| retry_rules.body_matchers | `createRetryRule()` / `updateRetryRule()` | Admin API Create/Update 请求体 |
| upstream_error_logs 表 | `logUpstreamError()`（新）| failover-loop catch 块 |

**验证方式**：`createRetryRule()` INSERT 语句已包含 provider_id 和 body_matchers 列；`logUpstreamError()` 为新函数，在 failover-loop 中调用。

### 2. 内存缓存加载（RetryRuleMatcher）

| 新字段 | 加载点 | 消费逻辑 |
|--------|--------|----------|
| provider_id | `RetryRuleMatcher.load()` | 缓存 key 为 `${providerId ?? '__global__'}:${statusCode}` |
| body_matchers | `RetryRuleMatcher.load()` | JSON.parse 为 `BodyMatcher[]`，优先于 body_pattern |

**验证方式**：`RetryRuleMatcher.load()` 已适配新缓存结构，`match()` 签名包含 `providerId?` 参数。

### 3. Admin API 查询

| 新字段 | 查询端点 | 说明 |
|--------|----------|------|
| provider_id | `GET /admin/api/retry-rules` / `GET /admin/api/retry-rules/:id` | 随 `SELECT *` 自动返回 |
| body_matchers | 同上 | 随 `SELECT *` 自动返回 |

**验证方式**：Admin API 的 CRUD 模式使用白名单字段集（`RETRY_FIELDS`），已添加 `provider_id` 和 `body_matchers`。

### 4. 前端展示

| 新字段 | 展示点 | 说明 |
|--------|--------|------|
| provider_id | `RetryRules.vue` 表格 Provider 列 + Dialog Provider 选择 | 通用规则显示 Badge "通用"，绑定规则显示 provider 名称 |
| body_matchers | `RetryRules.vue` 表格响应体匹配列 + Dialog JSON 匹配编辑器 | 有 body_matchers 时显示 JSON 条件摘要，无则显示 body_pattern |

**验证方式**：前端 RetryRules.vue 已适配 provider_id 和 body_matchers 字段的展示与编辑。

### 5. SSE 实时监控推送

**不在本次范围内**。新字段不推送到 SSE 监控。

### 所有消费者覆盖确认：

| 消费者 | provider_id | body_matchers | upstream_error_logs |
|---------|-------------|---------------|--------------------|
| DB 写入 | ✅ createRetryRule | ✅ createRetryRule | ✅ logUpstreamError |
| 内存缓存 | ✅ RetryRuleMatcher.load | ✅ RetryRuleMatcher.load | N/A |
| Admin API | ✅ GET/POST/PUT | ✅ GET/POST/PUT | N/A（不在本 PR）|
| 前端 | ✅ RetryRules.vue | ✅ RetryRules.vue | N/A |
| SSE 监控 | N/A（Out of Scope）| N/A（Out of Scope）| N/A |

## Constraints

- **DB 迁移向后兼容：** `ALTER TABLE ADD COLUMN` 不破坏现有数据和查询
- **现有 Admin API 签名兼容：** 新字段 optional，不传时默认 NULL
- **前端 UI 框架：** shadcn-vue 组件库，禁止原生 HTML 元素
- **测试覆盖：** RetryRuleMatcher 的 match() 和 JSON 匹配纯函数需要单元测试
- **禁止 eslint-disable：** 所有 lint 问题正面解决
- **迁移文件编号：** 从 049 开始（当前最大 048）
- **Performance：** JSON 字段匹配不应比正则慢超过 2x（纯函数，JSON.parse 一次 + 路径查找）

## Complexity Assessment

**整体复杂度：中等偏高**

| 子需求 | 复杂度 | 风险 |
|--------|--------|------|
| DB Schema + 迁移 | 低 | 低 |
| RetryRuleMatcher 升级 | 中 | 中（缓存结构重设计） |
| JSON 字段匹配纯函数 | 中 | 低（可独立测试） |
| resilience/resilience 调用方适配 | 低 | 低（传参变更） |
| stream_error 响应修复 | 中 | 中（需覆盖 stream + non-stream 路径） |
| upstream_error_logs 表 + 写入 | 低 | 低（参考 tool-error-logger） |
| Admin API 适配 | 低 | 低 |
| 前端 Dialog 适配 | 中 | 中（新交互组件） |
| AI 生成规则适配 | 低 | 低（不自动填充 provider_id） |

**关键依赖链：** DB Schema → Matcher 升级 → resilience 适配 → failover-loop 适配 → 前端适配。需按此顺序实现。
