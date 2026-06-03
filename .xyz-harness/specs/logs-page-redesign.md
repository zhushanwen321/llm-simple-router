# 请求日志页面重设计

> 设计审查日期: 2026-05-23
> Demo 文件: `docs/designs/demo-logs.html`
> 状态: 设计已完成，待实现

## 设计审查发现

### P1（必须修复）
1. **筛选变更无加载状态** — 切换筛选条件时表格无任何反馈，用户不确定是否在加载
2. **清理对话框职责混用** — "清理日志"对话框同时包含"确认清理"和"自动清理设置"两个不相关操作

### P2（应该修复）
3. **空状态死胡同** — 筛选结果为空时只显示"暂无日志"，无清除筛选的出口
4. **概览面板层次扁平** — 所有信息视觉权重相同，无主次之分
5. **失败请求无错误提示** — 详情面板中错误信息被淹没在常规字段中

### P3（可以改进）
6. **展开箭头用 HTML 实体** — `▼` 在不同系统渲染不一致
7. **时间列非等宽字体** — 时间戳对齐差
8. **错误列硬编码宽度** — `max-w-[200px]` 在不同屏幕表现不一
9. **关闭按钮位置** — 在左面板中，不在对话框顶部
10. **进度条 3px 不易感知**
11. **Mapping reason 显示原始字段名** — 如 `group_base_rule` 未翻译

## 设计方案

### 表格列重构

旧列：展开 | 时间 | 模型 | Provider | API | 状态 | 耗时 | Tokens | SSE | 错误 | 操作（11列）

新列：展开 | ID | 时间 | 客户端模型[API] | 目标模型[API] @Provider | 耗时 | 标签 | 错误 | 操作（9列）

**关键设计决策：**
- **客户端模型 vs 目标模型分离** — 映射关系一目了然
- **API type 内嵌为 tag** — 节省列空间，`[openai]`/`[anthropic]` 紧跟模型名
- **目标模型始终显示 model 名** — 不再只显示 `@ Provider`；映射到不同后端时用 primary（teal）色高亮
- **标签列合并** — status badge + SSE + retry/failover 合并到一列
- **ID 列** — mono 字体 muted 色，便于定位

### 详情对话框左面板

**层次结构（从上到下）：**

```
┌─ 执行链 ───────────── gpt-4o [openai] 基础规则 ─┐  ← header: label + 客户端模型
│ #1 deepseek-chat @ DeepSeek                        │  ← line 1: 模型@provider（可横滚）
│    429  0.8s [openai] retry                        │  ← line 2: 状态+耗时+API+标签
│ #2 gpt-4o @ OpenAI                                 │
│    200  2.3s [openai]                              │
└────────────────────────────────────────────────────┘

● completed  SSE  a3f2b1c4                            ← badges + session 合并行

[错误 banner]（仅失败时）                              ← danger 色容器

┌─────────┬──────────┐                               ← metrics grid
│ 延迟     │ TTFT     │
│ 2.3s    │ 0.4s     │
├─────────┼──────────┤
│ Input   │ Output   │
│ 1,200   │ 842      │
├─────────┼──────────┤
│ Speed   │ Cache    │
│ 556 tok/s│ 240     │
└─────────┴──────────┘

客户端    Claude Code                                    ← key-value 紧凑列表
状态码    200
来源 IP   192.168.1.100

[生成重试规则]                                           ← AI 按钮（8px 间距）
```

**执行链设计规则：**
- 所有请求都有执行链（至少一条记录）
- Header 行：左侧"执行链"label，右侧客户端模型 + API tag + 映射原因
- 每步两行：
  - 第一行：`#N` + 可横滚容器（model @ provider）
  - 第二行：status badge + latency + API tag + retry/final 标签
- 第一条记录如果是中间步骤（非最终成功），标注 `retry`
- 最后一条如果前面有失败，标注 `最终`

**Session 显示：**
- 合并到 badges 行，mono 字体 10px muted 色，不单独占一行

**Mapping reason 翻译：**

| 原始值 | 中文 |
|--------|------|
| direct_format | 直连 |
| group_base_rule | 基础规则 |
| group_schedule | 定时调度 |
| fallback_provider | 回退 |
| overflow_redirect | 溢出重定向 |
| failover_retry | 故障转移 |

### 右面板

**响应 Tab — 结构化视图（默认）：**
- 成功：回复内容块 + Usage 指标网格 + stop_reason badge
- 失败：错误块（danger 色背景 + 错误消息 + type/code）
- Raw JSON toggle 切换到原始视图

**请求 Tab — 结构化视图（默认）：**
- 模型映射（from → to）
- System Prompt
- Messages 列表（role badge + 内容预览）
- Stream 状态
- Parameters key-value
- Headers（含脱敏）

### 列表页改进

- **Loading overlay** — 切换筛选时显示 skeleton 骨架屏
- **空状态** — 有筛选时显示"清除所有筛选"按钮
- **清理按钮降级** — `destructive` variant → `ghost` variant
- **清理对话框拆分** — 只做日志清理，保留天数移到分页下方内联
- **保留天数内联** — 分页下方 `自动清理：保留 [30] 天 [保存]`
- **多余 `>` 字符** — 删除分页区域 HTML 中多余字符

### 右面板视图切换

Tab bar 右侧 "Raw JSON" toggle 按钮：
- 默认：结构化视图
- 点击后：原始 JSON（行号 + 语法高亮 + 复制按钮）
- 两个 Tab 共享 toggle 状态

## 涉及文件

### Demo
- `docs/designs/demo-logs.html` — 高保真 HTML 原型

### 前端（已实现）
- `frontend/src/composables/useLogs.ts` — loading ref
- `frontend/src/views/Logs.vue` — 表格页主体
- `frontend/src/components/logs/LogTableRow.vue` — 表格行
- `frontend/src/components/request-detail/RequestOverviewPanel.vue` — 概览面板
- `frontend/src/components/request-detail/UnifiedRequestDialog.vue` — 对话框
- `frontend/src/i18n/locales/zh-CN/logs.json` — 中文翻译
- `frontend/src/i18n/locales/en/logs.json` — 英文翻译

### 前端（待实现 — 表格列重构 + 执行链）
- `frontend/src/views/Logs.vue` — 表头更新
- `frontend/src/components/logs/LogTableRow.vue` — 列渲染逻辑
- `frontend/src/components/logs/types.ts` — LogEntry 类型定义
- `frontend/src/composables/useLogs.ts` — buildFilterParams 返回新字段
- `frontend/src/components/request-detail/RequestOverviewPanel.vue` — 执行链布局
- `frontend/src/components/request-detail/types.ts` — UnifiedRequestOverview 类型（retryHistory 需要 model/apiType）

### 后端（待评估）
- `src/admin/logs.ts` — 日志查询 API 可能需要返回新字段（clientModel, clientApi, backendModel, targetApi）
- `src/db/logs.ts` — 查询 SQL 可能需要调整
