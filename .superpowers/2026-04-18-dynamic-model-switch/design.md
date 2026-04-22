# 动态模型切换设计

## 背景

Claude Code 只支持 opus/sonnet/haiku 三种模型。通过 Router 的模型映射可以
将每种映射到不同 provider 的模型，但三模型上限无法突破。

本设计通过消息内嵌指令 + 交互式命令，让 Router 在代理层动态替换模型。

## 两种模型选择方式

### 方式 1：内联指令

在消息任意位置嵌入指令，Router 匹配并替换模型：

```
$SELECT-MODEL=glm-5.1
```

或 HTML 注释形式：

```
<!-- router:model=glm-5.1 -->
```

### 方式 2：交互式 /select-model 命令

通过 `.claude/commands/select-model.md` 自定义命令实现两步选择：

**Step 1**: 用户输入 `/select-model`
- Router 返回模型列表 + 选项编号

**Step 2**: 用户输入 `/select-model A`
- Router 记录选择，返回确认

### 优先级

```
消息中的指令 > 会话状态记忆 > 原始 model 字段
```

### 降级策略

当 Router 无法匹配指令中的模型名（`resolveMapping` 返回 null）时：
- **不替换模型** — 使用原始 model 字段
- **不清除指令文本** — LLM 会看到原文，自行处理
- **不更新会话记忆** — 避免记住无效模型

这确保匹配失败不影响正常请求。

## 统一标签机制

所有 Router 增强的响应内容用 `<router-response>` 标签包裹。Router 在每个
请求转发前，从 messages 中移除所有 `<router-response>...</router-response>`
及其对应的 user message（含命令标记的）。

| 标签类型 | 用途 |
|----------|------|
| `type="model-list"` | `/select-model` 返回的模型列表 |
| `type="model-selected"` | `/select-model A` 的选择确认 |
| `type="model-info"` | 每次响应附加的当前模型信息 |
| `type="error"` | 命令执行错误 |

## 功能模块

### F1. 指令解析器

**文件**: `src/proxy/directive-parser.ts`（新增）

从最后一条 `role: "user"` 消息中提取指令。

**支持的指令**:

| 指令 | 正则 | 作用 |
|------|------|------|
| 模型选择 | `/\$SELECT-MODEL=([a-zA-Z0-9._:-]+)/g` | 内联指定模型 |
| 模型选择 | `/<!--\s*router:model=([a-zA-Z0-9._\/:-]+)\s*-->/g` | HTML 注释形式 |
| 命令 | `/<!--\s*router:command=(\S+)\s*-->/g` | Router 命令 |

**解析范围**:
- 仅最后一条 `role: "user"` 的消息
- 仅 `type: "text"` 的 content block
- 不扫描 `tool_result`、`image` 等非文本 block

**返回值**:

```typescript
interface DirectiveParseResult {
  // 内联模型指令
  modelName: string | null;
  // Router 命令（如 "select-model", "select-model A"）
  command: string | null;
  // 清理后的请求体
  cleanedBody: Record<string, unknown>;
  // 是否包含命令标记（需要整条消息从历史中移除）
  isCommandMessage: boolean;
}
```

**模型名校验**: 长度 <= 128 字符，只允许 `[a-zA-Z0-9._:-]`，不允许纯数字或以 `.` 开头。

### F2. 会话状态记忆

**文件**: `src/proxy/model-state.ts`（新增）

按 API key ID (`routerKeyId`) 记录最后指定的模型。

- 存储: `Map<number | null, { model: string, updatedAt: number }>`
- TTL: 24 小时滑动过期（每次成功指定刷新）
- `default` 清除记忆，回到原始 model 字段
- **仅在 `resolveMapping` 成功后更新**，失败不更新

**不做 subagent 传播** — 后续版本按需添加。

### F3. handleProxyPost 集成

**文件**: `src/proxy/proxy-core.ts`（修改）

插入点: `clientModel` 提取后（L452）、while 循环前（L459）。

```
1. directiveParser.parseDirective(body)
2. 有命令 → 走命令处理分支（F5），构造假响应，return
3. 有模型指令 → resolveMapping(db, 指令模型)
   → 成功：更新记忆，替换 clientModel，清理请求体
   → 失败：降级，不清理，不更新，用原始 clientModel
4. 无指令 → 查询记忆，有则替换 clientModel
5. 清理 messages 中的 <router-response> 标签
6. 走原有 resolveMapping + proxy 流程
```

**与 failover 的交互**: 指令解析只在 while 循环外执行一次。

**审计**: `client_request` 记录原始请求体（含指令），`request_body` 记录清理后的。

### F4. 响应中附加模型信息

当实际模型与原始 `model` 字段不同时，在响应中附加标签。

**流式**: 在 SSE 流的 `message_delta` 事件之前，注入:
```
event: content_block_delta
data: {"type":"content_block_delta","index":N,"delta":{"type":"text_delta",
  "text":"\n\n<router-response type=\"model-info\">当前模型: glm-5.1</router-response>"}}
```

**非流式**: 在 `content[0].text` 末尾追加:
```
\n\n<router-response type="model-info">当前模型: glm-5.1</router-response>
```

标签会被 F3 的清理机制在后续请求中移除，不影响 LLM 推理。

### F5. /select-model 命令处理

**命令文件**: `.claude/commands/select-model.md`（项目根目录）

```markdown
---
description: 选择 Router 路由的目标模型
---
<!-- router:command=select-model $ARGUMENTS -->
```

**处理流程**:

1. Router 识别 `<!-- router:command=select-model -->` (无参数)
   - 查询 DB 中所有 mapping_groups，列出模型
   - 构造假 Anthropic 流式/非流式响应（根据请求的 `stream` 字段）
   - 响应内容:
     ```
     <router-response type="model-list">
     可用模型:
     A. glm-5.1 (Zhipu)
     B. deepseek-v3 (DeepSeek)
     C. 回到默认
     输入 /select-model A 选择
     </router-response>
     ```

2. Router 识别 `<!-- router:command=select-model A -->` (有参数)
   - 解析选项编号，映射到具体模型名
   - 更新会话记忆
   - 返回确认:
     ```
     <router-response type="model-selected">
     已选择: glm-5.1
     </router-response>
     ```

**假响应构造**: 必须构造合法的 Anthropic API 响应格式，包含正确的
`type`/`role`/`content`/`model`/`stop_reason`/`usage` 字段。

**消息清理**: 包含 `router:command=` 的 user message 和对应的假响应
（`<router-response>` 包裹的内容）在后续请求中全部移除。

### F6. Router 响应标签清理器

**文件**: `src/proxy/response-cleaner.ts`（新增）

在 F3 步骤 5 中调用，从请求体的 messages 中移除:
1. 所有 `<router-response>...</router-response>` 标签及其内容
2. 整条包含 `<!-- router:command=` 的 user message

遍历所有 messages 的 text content block，用正则匹配和替换。

## 安全约束

- 模型名校验: 长度 <= 128，字符白名单 `[a-zA-Z0-9._:-]`
- 白名单 (`allowed_models`): 基于解析后的 clientModel 校验
- `resolveMapping` 失败时不更新记忆，防止记住无效模型
- 命令标记从历史消息中彻底清除，不泄漏给 LLM

## 不做的事

- Subagent 模型选择 — 后续按需添加
- Hook 集成 — Router 服务端完全处理
- 持久化状态 — 内存 Map，重启后重新指定
