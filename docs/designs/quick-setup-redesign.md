# QuickSetup Page Redesign

## 概述

QuickSetup 页面的交互原型重设计。目标：信息密度优先、操作流程清晰、与后端数据模型对齐。

Demo 文件：`docs/designs/demo-quick-setup.html`（Approach A = 改进版，Approach B = 当前布局参考）

## 页面结构（4 步流程）

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1 (done)   Step 2 (current)   Step 3 (current)   Step 4 (optional) │
│ Select Client   Configure Provider  Model Mappings    Retry Rules      │
└─────────────────────────────────────────────────────────────────┘
```

4 步进度条始终可见。done / current / optional 三种视觉状态。

## Card 设计

### 1. Select Client

- 卡片网格展示 5 种客户端类型（Claude Code / Codex CLI / Pi / OpenAI SDK / Anthropic SDK）
- "Popular" 标签标注高频选项
- 格式名用用户友好名称："Anthropic API" / "OpenAI Responses API"
- 选中后底部显示 info bar（选择的客户端 + 格式类型）

### 2. Provider Connection

两行布局，每组有 group label：

**Row 1 — Provider 组**：Provider select + Plan select
**Row 2 — Endpoint 组**：Format select + Base URL input + API Key input + Verify button
**Row 3 — Concurrency Control**（border-t 分隔，始终可见）：
  - Mode select (Auto-adaptive / Manual / None)
  - Max Concurrency input
  - Queue Timeout input
  - Queue Size input
  - Adaptive hint text

### 3. Model Configuration

全宽 list/accordion 布局，每个 model 一行：

- Toggle 开关（启用/禁用）
- Model name（monospace）
- 4 个 capability 图标（text/image/audio/video），从后端状态高亮
- Context window 下拉选择（非文本输入）
- 展开/折叠按钮

**展开态**（可编辑）：
  - Context window select
  - Patch chips（toggleable，从后端 defaults）
  - Stream timeout input

### 4. Model Mappings

每条映射是一个可折叠 entry。

**Collapsed 态**（水平管道）：
```
[sonnet] → [① deepseek-chat]  [Default]  [toggle] [delete]
[opus]   → [① deepseek-reasoner] › [② deepseek-r1-0528] | [↓ deepseek-chat] | [♦ gpt-4o]  [Default]  [toggle] [delete]
```

**Expanded 态**（垂直编辑器），三个 section：

| Section | 标识色 | 边框 | 内容 |
|---------|--------|------|------|
| Failover chain | teal | 实线 | ①②③ CascadingModelSelect + "Add failover target" |
| Context overflow | teal | 虚线 | ↓ CascadingModelSelect |
| Multimodal Fallback | blue | 虚线 | ♦ CascadingModelSelect + Session lock 警告框 |

**Add new mapping 行**：与 collapsed entry 相同的视觉结构：
```
[model-name input] → [Select model...]  [Custom]  [+]
```

### 5. Retry Rules

场景：选了 DeepSeek provider，展示 General + DeepSeek 相关规则。

- Select all checkbox
- 每条规则：checkbox + name + detail + provider 下拉按钮
- Provider 下拉：General (Global) / 当前 Provider (Provider-only)
- Configured 规则（DB 已存在）：disabled checkbox + 灰色

### 6. Transform Rules（折叠，Optional）

在 Model Configuration card 底部，点击展开。3 个输入框：
- Inject Headers (JSON)
- Drop Fields (comma-separated)
- Request Defaults (JSON)

### Footer Bar

固定底部，左右分栏：

**左侧**：`[Client badge] → [Provider / Plan badge] · N models · N mappings · N rules`
**右侧**：Validation status indicator + Validate button + Save Config button (with loading state)

## 后端数据层改动

### Provider Group shortname

`recommended-providers.json` 新增 `shortname` 字段：

| group | shortname |
|-------|-----------|
| DeepSeek | deepseek |
| 百度千帆 | qianfan |
| 科大讯飞 | iflytek |
| 硅基流动 | siliconflow |
| 智谱 | zhipu |
| 月之暗面 | moonshot |
| Minimax | minimax |
| 火山引擎 | volcengine |
| 阿里云 | aliyun |
| 腾讯云 | tencent |
| OpenCode | opencode |
| 阶跃星辰 | stepfun |

### 推荐规则 providers 标注

`recommended-retry-rules.json` 的 `providers[]` 从中文 group 名改为 shortname：

| 规则 | providers (旧) | providers (新) |
|------|---------------|---------------|
| 429 Too Many Requests | `[]` | `[]` |
| 503 Service Unavailable | `[]` | `[]` |
| ZAI 网络错误 | `["智谱"]` | `["zhipu"]` |
| KIMI 401 认证错误 | `["月之暗面"]` | `["moonshot"]` |
| DeepSeek 并发限流 | `["DeepSeek","OpenCode"]` | `["deepseek","opencode"]` |

### 接口改动

| 层 | 文件 | 改动 |
|---|------|------|
| 后端类型 | `config/recommended.ts` | `ProviderGroup` 加 `shortname: string` |
| 后端 API | `admin/quick-setup.ts` | Schema 加 `provider_shortname`，创建 retry rule 时绑定到新 provider_id |
| 前端类型 | `api/client.ts` | `ProviderGroup` 加 `shortname`，`QuickSetupPayload.retry_rules` 加 `provider_shortname` |
| 前端逻辑 | `composables/useQuickSetup.ts` | `makeRecommendedRules()` 用 shortname 过滤；`buildRetryRulesPayload()` 传 shortname |

### 数据流

```
前端选择 DeepSeek provider
  → selectedGroup = "DeepSeek"
  → shortname = "deepseek" (从 providerGroups 查找)
  → recommendedRules 过滤: providers.includes("deepseek") || providers.length === 0
  → 展示 General + DeepSeek 规则
  → 用户可切换每条规则的 provider 标签
  → submit: provider_shortname = "deepseek" → 后端映射为新 provider UUID → retry_rules.provider_id
  → 运行时: RetryRuleMatcher 按 provider_id 匹配
```

## 关键设计决策

1. **List/accordion > card grid**：每个 model 信息量大（capabilities + context + patches + timeout），4 列 card grid 放不下，改为全宽行
2. **Mapping 三色 section**：Failover (teal) / Overflow (teal dashed) / Multimodal (blue dashed) 用颜色和线型区分三种功能
3. **Retry provider 下拉**：QuickSetup 是单 provider 流程，下拉只有 General / 当前 Provider 两个选项
4. **Concurrency 在 Connection card 内**：与 Vue 实现一致（border-t 分隔），始终可见不折叠
5. **Transform Rules 折叠**：极少使用，折叠减少视觉噪音
6. **Add mapping 行 = collapsed entry 结构**：视觉一致性，`[input] → [select] [tag] [+]` 而不是独立的表单行
