# Provider + 模型级别流式超时

## 背景

使用 Open Design + pi 组合调用 GLM-5.1 时，模型 extended thinking 阶段偶发无限循环（24+ 分钟无输出），上游未正确执行 `budget_tokens` 限制导致连接挂起。当前全局超时 `STREAM_TIMEOUT_MS` 默认 50 分钟，粒度过粗。

## 目标

在 Provider + 模型维度配置流式请求超时，替代全局单一超时，精准控制不同模型的超时行为。

## 设计

### 1. 数据模型

**Provider `models` 字段扩展：**

```json
// 迁移前（字符串数组）
["glm-5.1", "glm-5-turbo"]

// 迁移后（对象数组）
[
  { "id": "glm-5.1", "stream_timeout_ms": 600000 },
  { "id": "glm-5-turbo" }
]
```

- `id` — 模型标识（必填）
- `stream_timeout_ms` — 流式超时毫秒数（可选，默认 600,000 即 10 分钟）

**迁移 SQL**（新增 migration）：
- 遍历所有 providers，将 `models` 中的字符串元素转为 `{"id": "xxx"}`
- 不删除数据，仅格式转换

### 2. 超时机制

两种超时共用同一个 `stream_timeout_ms` 值：

| 阶段 | 起算点 | 重置条件 | 触发动作 |
|------|--------|---------|---------|
| TTFT 超时 | 请求发到上游 | 收到第一个 SSE 数据即结束计时 | 返回 408 |
| 空闲超时 | 上次收到数据 | 每收到一个 chunk 重置 | 返回 408 |

**超时查找链：**

```
provider.models 中匹配当前 backend_model → stream_timeout_ms
  → 未配置则使用默认值 600,000 ms（10 分钟）
```

**实现位置：** `StreamProxy` 的 `idleTimer` 机制（`router/src/proxy/transport/stream.ts`）。当前已支持 `timeoutMs` 参数，只需将硬编码的全局值替换为按模型查找的结果。

### 3. 错误响应

超时触发时中断流式连接，返回错误响应：

```
HTTP 408 Request Timeout
```

按 API 类型返回不同格式：

**Anthropic：**
```json
{
  "type": "error",
  "error": {
    "type": "api_error",
    "message": "Stream timeout: no data received for 600000ms (model: glm-5.1, provider: xxx)"
  }
}
```

**OpenAI / OpenAI-Responses：**
```json
{
  "error": {
    "message": "Stream timeout: no data received for 600000ms (model: glm-5.1, provider: xxx)",
    "type": "server_error",
    "code": "stream_timeout"
  }
}
```

### 4. API 层

**Provider CRUD** 已有，需适配 models 字段的新格式：
- `POST /admin/api/providers` — 创建时接受对象数组
- `PUT /admin/api/providers/:id` — 更新时接受对象数组
- `GET /admin/api/providers` — 返回对象数组

**读取超时值的工具函数：**
```typescript
function getModelStreamTimeout(provider: Provider, backendModel: string): number {
  const models = parseModels(provider.models); // 兼容旧格式字符串和新格式对象
  const entry = models.find(m => m.id === backendModel);
  return entry?.stream_timeout_ms ?? 600_000;
}
```

### 5. 前端

**Provider 编辑弹窗：**
- 每个模型行增加"超时"输入框（数字，单位秒，placeholder "默认 600s"）
- 空值表示使用默认 10 分钟

**快速配置页：**
- 模型映射编辑时，展示对应 Provider 下该模型的超时配置
- 支持快速修改

### 6. 涉及文件

| 文件 | 改动 |
|------|------|
| `router/src/db/migrations/0XX_models_object.sql` | 新增迁移：字符串数组 → 对象数组 |
| `router/src/proxy/transport/stream.ts` | 接收按模型解析的 timeoutMs（已有机制，无需改状态机） |
| `router/src/proxy/handler/proxy-handler.ts` | 查找当前模型的超时值，传入 transport 层 |
| `router/src/proxy/transport/transport-fn.ts` | 传递 timeoutMs |
| `router/src/db/providers.ts` | 适配 models 字段新格式的读写 |
| `router/src/admin/providers.ts` | CRUD 适配 |
| `router/src/admin/mappings.ts` | 快速配置页 API 适配 |
| `frontend/src/views/Providers.vue` | 模型行增加超时输入 |
| `frontend/src/views/ModelMappings.vue` | 快速配置支持 |

### 7. 测试

- 迁移 SQL 测试：旧格式数据正确转换
- 超时机制测试：mock 上游慢响应，验证 TTFT 和空闲超时均触发 408
- 默认值测试：未配置超时的模型使用 10 分钟默认值
- API 测试：Provider CRUD 支持新格式
- 兼容性测试：迁移后旧客户端仍能正常工作

## 不做的事

- 不改变全局 `STREAM_TIMEOUT_MS` 环境变量的行为（保留作为最终兜底）
- 不新增独立的超时配置表（复用 models JSON 字段）
- 不支持 TTFT 超时和空闲超时分别配置（共用同一个值）
- 不在此 feature 中引入自动 failover（超时只中断，不重试）
