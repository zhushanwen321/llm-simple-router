# 移除 select-model 实验性功能

## 背景：工具调用循环 Bug

### 现象

用户使用 GLM-5.1 模型时，LLM 反复发出相同的工具调用（如 `scp -r` 或 `chmod +x`），路由器的循环检测机制完全失效，导致：

- `scp -r` 连续重复 **23 次**（12:38:52 → 12:40:07，约 75 秒）
- `chmod +x` 连续重复 **11 次**（08:15 → 08:16）
- 每次循环浪费 ~53 input tokens + 44 output tokens
- 循环只靠 LLM 自己"醒悟"才停止，路由器毫无干预

### 根因

**文件**: `router/src/proxy/enhancement/response-cleaner.ts` 的 `cleanRouterResponses()` 函数

该函数原本设计为清理路由器自身的合成消息（`/select-model` 命令交互、`<router-response>` 标签等），但过滤条件过于宽泛，误删了正常的 assistant(tool_use) 消息：

```typescript
// 第 62-63 行 — Bug 所在
const stripped = combined.replace(RE_ROUTER_RESPONSE, "").trim();
if (!stripped && !(msg as Record<string, unknown>).tool_calls) return false;
```

当 assistant 消息**只包含** `tool_use` block（没有 text block），且不是 OpenAI 格式（没有 `tool_calls` 属性）时：
1. `stripped` = `""`（无文本可提取）
2. `msg.tool_calls` = `undefined`（Anthropic 格式用 `content` 里的 `tool_use` block）
3. 结果：`return false` → **整条 assistant 消息被删除**

### 连锁效应

1. `cleanRouterResponses()` 误删所有历史的 `assistant(tool_use)` + `user(tool_result)` 消息对
2. **pipeline_snapshot 证据**：`router_tags_stripped` 从 1 递增到 21，恰好等于循环轮数
3. `applyToolRoundLimit()` 拿到的 messages 已被清洗，只剩 0-1 轮工具调用
4. 永远达不到 `DEFAULT_MAX_ROUNDS = 5` 的阈值 → **tool-round-limiter 失效**
5. `tool_call_loop_enabled` 配置默认为 `false` → **ToolLoopGuard 也未启用**
6. 两层防护全部失效，循环无限进行

### 结论

`cleanRouterResponses()` 是为 select-model 功能服务的——它清理 `/select-model` 命令产生的合成 AskUserQuestion tool_use/tool_result 对和 `<router-response>` 标签。但这个功能过于复杂且收益为零，反而引入了严重的循环检测失效 Bug。因此决定整体移除 select-model 功能。

---

## 移除范围

### 核心原则

移除所有 select-model 相关的复杂逻辑（命令解析、AskUserQuestion 合成响应、tool_result 回调、消息清洗），但保留简单有用的内联模型切换（`$SELECT-MODEL=xxx` 和 `[router-model: xxx]`）。

### 需要删除的文件

| 文件 | 原因 |
|------|------|
| `router/src/proxy/enhancement/response-cleaner.ts` | Bug 源头，清理 router 合成消息的逻辑 |
| `router/tests/response-cleaner.test.ts` | 对应测试 |
| `router/src/proxy/patch/router-cleanup.ts` | 清理上游请求中的 router 合成 tool_use（从未被调用） |
| `router/src/proxy/response-transform.ts` | 非流式响应注入 `<router-response type="model-info">` 标签 |
| `router/tests/response-transform.test.ts` | 对应测试 |
| `frontend/src/components/proxy-enhancement/SessionTable.vue` | Session 状态表格组件 |

### 需要修改的文件

#### `router/src/proxy/enhancement/directive-parser.ts`

- **删除** `parseToolResult()` 函数（解析 AskUserQuestion tool_result 回调）
- **删除** `TOOL_USE_ID_PREFIX` 和 `TOOL_USE_ID_PROVIDER_PREFIX` 常量
- **删除** `[router-command: ...]` 正则解析（select-model 命令通道）
- **保留** `$SELECT-MODEL=xxx` 和 `[router-model: xxx]` 解析（内联模型切换，简单有用）
- **简化** `DirectiveParseResult`：移除 `command` 和 `isCommandMessage` 字段

#### `router/src/proxy/enhancement/enhancement-handler.ts`（最大改动）

- **删除** 所有 select-model 命令处理逻辑（`/select-model` 无参/有参）
- **删除** AskUserQuestion 合成响应构造（`buildAskUserQuestionPayload`）
- **删除** tool_result 回调处理（用户在 UI 点选模型后的解析）
- **删除** `cleanRouterResponses()` 调用（Bug 源头）
- **删除** `buildModelInfoTag()` 函数（`<router-response type="model-info">` 注入）
- **删除** 所有辅助函数：`buildSelectModelResponse`、`buildModelQuestions`、`buildProviderQuestions`、`getUniqueProviders`、`getModelsForProvider`、`buildDisplayModels`、`hasAskUserQuestion`
- **删除** 相关常量：`MODEL_INFO_TAG_TYPE`、`SKIP_LABEL`、`TWO_STEP_THRESHOLD`、`MODELS_PER_GROUP`
- **简化** `EnhancementMeta`：移除 `router_tags_stripped`（不再清洗消息）
- **保留** 会话记忆模型查找（`modelState.get()`）
- **保留** 内联指令模型切换（`$SELECT-MODEL`、`[router-model:]`）

#### `router/src/proxy/handler/proxy-handler.ts`

- **删除** `maybeInjectModelInfoTag` 导入和调用
- **删除** `response_transform` pipeline snapshot stage
- **删除** `router_tags_stripped` 相关逻辑
- **简化** enhancement stage 的 snapshot 记录

#### `router/src/proxy/transport/transport-fn.ts`

- **删除** `buildModelInfoTag` 导入和非流式响应中的 model-info 标签注入

#### `router/src/proxy/pipeline-snapshot.ts`

- **简化** `DirectiveMeta` 类型：移除 `"router_command"` 和 `"select_model"`，只保留 `"router_model"`
- **移除** `response_transform` stage
- **移除** `router_tags_stripped` 字段（改为简单的 `directive_applied: boolean`）

#### `router/src/proxy/enhancement/index.ts`

- **删除** `cleanRouterResponses`、`parseToolResult`、`TOOL_USE_ID_PREFIX`、`TOOL_USE_ID_PROVIDER_PREFIX` 导出
- **删除** `buildModelInfoTag` 导出

#### `router/src/admin/proxy-enhancement.ts`

- **删除** session-states 相关的三个 API 端点（GET 列表、GET 历史、DELETE）
- **保留** proxy-enhancement 配置的 GET/PUT 端点

#### `frontend/src/views/ProxyEnhancement.vue`

- **删除** "使用说明" Collapsible（select-model 使用文档）
- **删除** SessionTable 组件和 Session 管理卡片
- **删除** 相关状态变量和方法

#### `frontend/src/api/client.ts`

- **删除** `SESSION_STATES` API 常量
- **删除** `SessionState`、`SessionHistoryEntry` 类型
- **删除** `getSessionStates`、`getSessionHistory`、`deleteSessionState` API 方法

#### `router/src/index.ts`

- **删除** `modelState.init(db)` 注入
- **删除** `clearModelState` 和 `deleteModelState` 注册到 StateRegistry

### 不动的文件

| 文件 | 原因 |
|------|------|
| `router/src/db/session-states.ts` | DB 层保留，迁移不可逆 |
| `router/src/db/migrations/016_create_session_model_tables.sql` | 迁移不可修改 |
| `router/src/proxy/routing/model-state.ts` | 保留，内联指令仍需要会话记忆 |
| `router/src/core/registry.ts` | 保留接口定义，不再实现即可 |

### 需要更新的测试

| 测试文件 | 改动 |
|---------|------|
| `router/tests/response-cleaner.test.ts` | **删除** |
| `router/tests/response-transform.test.ts` | **删除** |
| `router/tests/directive-parser.test.ts` | 移除 `[router-command:]` 相关用例 |
| `router/tests/pipeline-snapshot.test.ts` | 移除 `response_transform` 和 `router_command` 相关断言 |
| `router/tests/proxy-handler.test.ts` | 移除 `buildModelInfoTag` mock，简化 enhancement mock |
| `router/tests/integration.test.ts` | 移除 `router-response` 标签和 `response_transform` 相关断言 |

---

## 修复后效果

1. **循环检测恢复**：tool-round-limiter 能正确计数连续工具调用轮数，达到 5 轮后注入警告提示词
2. **ToolLoopGuard 可选启用**：开启 `tool_call_loop_enabled` 后，N-gram 检测同一工具重复调用，三级递进拦截
3. **消息完整性**：assistant(tool_use) 消息不再被误删，LLM 能看到完整对话历史
4. **代码简化**：移除约 500+ 行复杂的 select-model 逻辑，消除 Bug 根源
