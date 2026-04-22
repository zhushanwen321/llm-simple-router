# 日志详情 Modal 结构化展示实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 为日志详情 Modal 的 request/response 增加结构化表单视图，支持 Tab 切换和一键复制，并对 Claude Code 请求做特殊展示。

**Architecture：** 纯前端改动。新增 3 个通用组件（`JsonCopyBlock`、`LogRequestViewer`、`LogResponseViewer`），在 `Logs.vue` 中替换现有 `<pre>` JSON 展示。

**Tech Stack：** Vue 3 + TypeScript + shadcn-vue + Tailwind CSS

---

## 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/components/ui/tabs/` | 安装 | shadcn-vue `tabs` 组件 |
| `frontend/src/components/logs/JsonCopyBlock.vue` | 新建 | 原始 JSON 展示 + 复制按钮 |
| `frontend/src/components/logs/LogRequestViewer.vue` | 新建 | Request 结构化 + JSON Tab |
| `frontend/src/components/logs/LogResponseViewer.vue` | 新建 | Response 结构化 + JSON/SSE Tab |
| `frontend/src/views/Logs.vue` | 修改 | 用 Viewer 替换 Collapsible 内的 `<pre>` |

**依赖说明**：`Card`、`Badge`、`Label` 已在项目中安装（`frontend/src/components/ui/card/`、`badge/`、`label/` 已存在），无需额外安装。`logs` 目录若不存在，创建组件文件时自动建立。

---

### Task 1: 安装 shadcn-vue tabs 组件

- [ ] **Step 1: 安装组件**

```bash
cd frontend && npx shadcn-vue@latest add tabs
```

Expected: `frontend/src/components/ui/tabs/` 目录被创建。

---

### Task 2: 创建 JsonCopyBlock.vue

- [ ] **Step 1: 创建文件**

**File:** `frontend/src/components/logs/JsonCopyBlock.vue`

```vue
<template>
  <div class="relative">
    <Button
      variant="outline"
      size="sm"
      class="absolute top-2 right-2 h-7 text-xs"
      @click="handleCopy"
    >
      {{ copied ? '已复制' : '复制' }}
    </Button>
    <pre class="bg-gray-900 text-gray-100 rounded-md p-3 text-xs overflow-auto max-h-[40vh] whitespace-pre-wrap break-all">{{ content }}</pre>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{ content: string }>()
const copied = ref(false)

async function handleCopy() {
  await navigator.clipboard.writeText(props.content)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}
</script>
```

- [ ] **Step 2: 验证编译通过**

```bash
cd frontend && npx vue-tsc --noEmit
```

Expected: 无 `JsonCopyBlock.vue` 相关报错。

---

### Task 3: 创建 LogRequestViewer.vue

Props: `raw: string`, `apiType: 'openai' | 'anthropic'`, `showUrl?: boolean`

- [ ] **Step 1: 创建组件骨架（Tabs + 错误兜底）**

**File:** `frontend/src/components/logs/LogRequestViewer.vue`

先写出骨架：
- 使用 `Tabs`、`TabsList`、`TabsTrigger`、`TabsContent` 包裹两个 Tab（结构化 / 原始 JSON）。
- 若 `raw` 解析失败，结构化 Tab 内显示红色提示文案「解析失败，请切换到原始 JSON 查看」。
- 原始 JSON Tab 内使用 `JsonCopyBlock`。

- [ ] **Step 2: 实现 Headers 区域**

在结构化 Tab 内添加折叠的 Headers 区：
- 默认折叠，触发器显示 `Headers (N 个)`。
- 表格展示所有 headers。
- 对 `Authorization` 脱敏显示为 `Bearer sk-****`。

- [ ] **Step 3: 实现 Body 参数卡片 + messages**

- 顶部参数卡片：`model`、`stream`、`max_tokens`、`thinking`（若有）。
- `messages` 列表：按 role 分色标签。user 消息中的 `<system-reminder>` 默认折叠仅显示长度；普通文本展开前 120 字符，可点击展开全文。

- [ ] **Step 4: 实现 tools / system / 其他字段**

- `tools`：前 8 个名称标签，超出显示 `+N`，点击展开全部。
- `system`（Anthropic 根级）：单独卡片，展示 block 类型标签。
- 未知字段放入「其他字段」折叠区，以 JSON 展示。

- [ ] **Step 5: 实现 Claude Code 上下文卡片**

- 检测 `headers['user-agent']?.includes('claude-cli')`。
- 若命中，在结构化 Tab 最顶部显示 indigo 色卡片：Claude Code 模式、thinking 预算、tools 数量。

- [ ] **Step 6: 验证编译通过**

```bash
cd frontend && npx vue-tsc --noEmit
```

---

### Task 4: 创建 LogResponseViewer.vue

Props: `raw: string`, `apiType: 'openai' | 'anthropic'`, `isStream: boolean`

- [ ] **Step 1: 创建组件骨架（Tabs + 错误兜底）**

**File:** `frontend/src/components/logs/LogResponseViewer.vue`

- Tabs：结构化 / 原始 JSON（若 `isStream` 则标签文字为「原始 SSE 文本」）。
- 解析失败时结构化 Tab 显示错误提示并引导切换。
- 原始 Tab 使用 `JsonCopyBlock`。

- [ ] **Step 2: 实现 Status + Headers 区**

- 顶部展示 `statusCode` 徽章（绿/红按数值区分）。
- Headers 默认折叠，表格展示。

- [ ] **Step 3: 实现非流式 JSON 结构化**

- **OpenAI**：`choices` 列表卡片（role + content 折叠 + finish_reason），`usage` 四格指标卡片。
- **Anthropic**：`content` blocks 按类型分色卡片（text / thinking / tool_use），`usage` 四格指标卡片。

- [ ] **Step 4: 实现 SSE 事件解析与聚合**

- 按 `data:` 行解析事件数组。
- **OpenAI SSE**：展示 `role` delta、首个 `content` delta、finish_reason、usage chunk；中间重复 delta 聚合为 `+N 个 delta 事件已折叠`。
- **Anthropic SSE**：
  - `message_start`：id + model + input_tokens
  - `content_block_start`：index + type
  - `content_block_delta`：**按 delta 类型聚合**，保留前 3 条示例，其余折叠显示「+N 个 {type} 事件已折叠」。聚合算法：遍历所有事件，按 `delta.type` 分组计数与总字符长度。
  - `message_delta`：output_tokens + stop_reason（黄色高亮）
  - `message_stop`：完成标记

- [ ] **Step 5: 验证编译通过**

```bash
cd frontend && npx vue-tsc --noEmit
```

---

### Task 5: 修改 Logs.vue 集成新组件

- [ ] **Step 1: 导入并替换**

**File:** `frontend/src/views/Logs.vue`

修改点：
1. script 顶部导入新增的三个组件（无需额外导入 Tabs 组件，Viewer 内部已处理）。
2. **保留** `formatJson()` 函数，用于旧日志兼容和 Viewer 内部的 JSON 格式化。
3. 将每个 `CollapsibleContent` 内的 `<pre>` **替换为对应 Viewer**，保持 `Collapsible` / `CollapsibleTrigger` 结构不变：
   - `client_request` → `<LogRequestViewer :raw="detailData.client_request" :api-type="(detailData.api_type as 'openai' | 'anthropic') || 'anthropic'" />`
   - `upstream_request` → `<LogRequestViewer show-url :raw="detailData.upstream_request" :api-type="(detailData.api_type as 'openai' | 'anthropic') || 'anthropic'" />`
   - `upstream_response` → `<LogResponseViewer :raw="detailData.upstream_response" :api-type="(detailData.api_type as 'openai' | 'anthropic') || 'anthropic'" :is-stream="!!detailData.is_stream" />`
   - `client_response` → `<LogResponseViewer :raw="detailData.client_response" :api-type="(detailData.api_type as 'openai' | 'anthropic') || 'anthropic'" :is-stream="!!detailData.is_stream" />`
   
   > 注：`detailData.api_type` 在类型定义中是 `string`，而 Viewer 要求 `'openai' | 'anthropic'`，因此需要 `as` 断言并兜底。`is_stream` 是 `number`（SQLite boolean），`!!` 可正确转为 `boolean`。
4. 旧日志兼容（`!detailData.client_request` 时）：将 `request_body` 传给 `LogRequestViewer`，`response_body` 传给 `LogResponseViewer`，并传入相同的 `api-type`。

- [ ] **Step 2: 验证编译通过**

```bash
cd frontend && npx vue-tsc --noEmit
```

---

### Task 6: 启动并手工验证

- [ ] **Step 1: 启动前后端**

终端 1（后端）：
```bash
npm run dev
```

终端 2（前端）：
```bash
cd frontend && npm run dev
```

- [ ] **Step 2: 手工验证 checklist**

打开 `http://localhost:5173/admin/logs`，点击详情：
- [ ] anthropic 流式请求的 `client_request` 能展示结构化 messages、thinking、tools
- [ ] Claude Code 请求顶部出现 indigo 上下文卡片
- [ ] `upstream_response` 的 SSE 事件被聚合，不过度展开
- [ ] 每个阶段都能 Tab 切换到「原始 JSON」并一键复制
- [ ] 旧日志（无四阶段字段）展示正常

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/logs frontend/src/views/Logs.vue frontend/src/components/ui/tabs
git commit -m "feat(logs): add structured request/response viewer with tabs and copy"
```

---

## 验收标准

1. 无 TypeScript 编译错误。
2. Modal 中四阶段请求链均有「结构化」和「原始 JSON」两个 Tab。
3. Claude Code 请求顶部展示专用上下文卡片。
4. SSE 流式响应的 `content_block_delta` 不过度渲染，有聚合折叠。
5. messages 中的 `<system-reminder>` 默认折叠，不阻塞主信息阅读。
