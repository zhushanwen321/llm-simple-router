# 日志详情 Modal 结构化展示设计

## 背景与目标

当前 `Logs.vue` 的详情 Modal 将 request/response 四个阶段以原始 JSON 展示，排查效率低。目标是为可解析字段提供结构化表单视图，未知字段保留 JSON，并支持 Tab 切换与一键复制。

## 设计范围

仅改动前端展示层，零后端改动：
- 新增 3 个 Vue 组件
- 修改 `frontend/src/views/Logs.vue`
- 按需安装 shadcn-vue `tabs` 组件

## 组件拆分

```
frontend/src/components/logs/
├── LogRequestViewer.vue   # request 结构化 + JSON Tab
├── LogResponseViewer.vue  # response 结构化 + JSON/SSE Tab
└── JsonCopyBlock.vue      # 原始 JSON 展示 + 复制按钮
```

## 数据结构特征（基于 router.db 分析）

- 996 条日志中 100% 为 `anthropic`，95.6% 来自 `claude-cli`
- `claude-cli` 请求特征稳定：
  - `user-agent` 含 `claude-cli`
  - `anthropic-beta` 含 `claude-code-20250219`
  - `thinking.budget_tokens = 8000`
  - `tools` 固定 148 个
  - `messages` 中 user 消息含大量重复 `<system-reminder>`（单条可达 45KB）
- SSE 响应中 `content_block_delta` 事件极多（可达 2800+），需聚合展示

## Request 结构化设计（LogRequestViewer）

### 通用头部
- 固定展示 `model`、`stream`、`max_tokens`、`thinking`
- `Headers` 默认折叠，以 key-value 小表格展示

### OpenAI Request Body
| 字段 | 展示方式 |
|------|----------|
| `model` | 标签卡片 |
| `stream` | 布尔徽章 |
| `messages` | role 列表（system/user/assistant/tool），content 过长可折叠 |
| `tools` | 前 8 个名称标签 + `+N` 展开 |
| `temperature/top_p/max_tokens` | 参数小卡片并排 |
| `response_format/tool_choice/seed` | 折叠面板 |

### Anthropic Request Body
与 OpenAI 类似，额外处理：
- `system`：根级 system 单独卡片，含 block 类型标签
- `messages.content` 支持 `text` / `image` block 标签
- `thinking`：展示 `type` + `budget_tokens`

### Claude Code 特殊处理
当 `headers['user-agent']` 含 `claude-cli` 时，顶部显示 **Claude Code 上下文卡片**：
- 模式（从 user-agent 提取，如 `external, cli`）
- Thinking 预算
- Tools 数量
- 对 `<system-reminder>` 内容默认折叠，仅显示长度

## Response 结构化设计（LogResponseViewer）

### 非流式 JSON Response

**OpenAI**
- 顶部：id / model / system_fingerprint
- choices：message role + content（可折叠）+ finish_reason
- usage：prompt / completion / total / cached 四格指标

**Anthropic**
- 顶部：id / type / model / stop_reason
- content blocks：按类型分色（text / thinking / tool_use）
- usage：input / output / cache_creation / cache_read 四格指标

### 流式 SSE Response

自动将 `body` 按 `data:` 行解析为事件列表：

**OpenAI SSE**
- 展示关键事件：role delta、首个 content delta、finish_reason、usage chunk
- 中间重复 delta 聚合为 `+N 个 delta 事件已折叠`

**Anthropic SSE**
| 事件类型 | 展示内容 |
|----------|----------|
| `message_start` | msg_id + model + input_tokens |
| `content_block_start` | index + block type |
| `content_block_delta` | **聚合展示**：同类型 delta 数量与合计长度，保留前 3 条示例 |
| `message_delta` | output_tokens + stop_reason（高亮） |
| `message_stop` | 完成标记 |

保留「原始 SSE 文本」子 Tab，供格式排查。

## UI 交互

每个阶段内部为 **Card + Tabs**：
- Tab 1：**结构化** — 按上述规则渲染
- Tab 2：**原始 JSON/SSE** — `JsonCopyBlock` 组件，含右上角复制按钮

### 复制按钮
- 仅在原始 Tab 提供
- 复制格式化后的完整 JSON 字符串

### 错误兜底
- 解析失败时结构化 Tab 显示错误提示，并引导切换原始 Tab

### 旧日志兼容
- 无四阶段字段时，仍用 `request_body` / `response_body`，但套用相同 Viewer 组件

## 开发分支

`feat/model-mapping-strategy`（当前分支）
