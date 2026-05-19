---
verdict: pass
---

# 新增 Codex CLI 快速配置客户端

## Background

OpenAI 推出了 Codex CLI（终端编程助手），使用 OpenAI Responses API 格式。用户希望在快速配置页面新增 Codex 客户端选项，并预设 5 个客户端模型（GPT-5.5 / GPT-5.4 / GPT-5.4-Mini / GPT-5.3-Codex / GPT-5.2），方便一键映射到各供应商的后端模型。

## Functional Requirements

### FR1: 新增客户端类型 `codex`

- 在 `ClientType` 联合类型中新增 `"codex"`
- 在 `CLIENTS` 数组中，`claude-code` 之后插入 Codex 条目：
  - id: `"codex"`
  - name: `"Codex CLI"`
  - icon: `"CX"`, iconClass: `"cx"`
  - format: `"openai-responses"`（Codex CLI 使用 OpenAI Responses API）
  - defaultProvider: `"DeepSeek"`
  - defaultPlan: `"OpenAI"`
  - descriptionKey: `"quickSetup.client.codexDesc"`

### FR2: 客户端模型列表

在 `DEFAULT_CLIENT_MAPPINGS` 中新增 Codex 的默认客户端模型：

```typescript
"codex": ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"]
```

### FR3: 客户端模型 → 后端模型映射分配

每个客户端模型按能力梯度映射到各供应商的最强/最合适的后端模型。原则：
- **GPT-5.5**（最强）→ 各供应商的最强旗舰模型
- **GPT-5.4**（次旗舰）→ 各供应商的次强模型
- **GPT-5.4-Mini**（轻量版）→ 各供应商的高性价比模型
- **GPT-5.3-Codex**（代码专用）→ 各供应商的代码优化模型
- **GPT-5.2**（基础）→ 各供应商的基础模型

默认映射方案（用户首次选择供应商套餐时自动生成，用户可手动调整）：

| 客户端模型 | DeepSeek | 智谱 Coding | 月之暗面 Coding | 火山引擎 Coding | 阿里云 Coding | 腾讯云 Coding | OpenCode |
|---|---|---|---|---|---|---|---|
| gpt-5.5 | deepseek-v4-pro | glm-5.1 | kimi-for-coding | ark-code-latest | qwen3.6-plus | tc-code-latest | glm-5.1 |
| gpt-5.4 | deepseek-v4-flash | glm-5 | kimi-k2.5 | doubao-seed-2.0-code | qwen3-coder-next | hunyuan-2.0-instruct | deepseek-v4-pro |
| gpt-5.4-mini | deepseek-v4-flash | glm-5-turbo | kimi-k2.5 | kimi-k2.5 | qwen3-coder-plus | hunyuan-turbos | kimi-k2.5 |
| gpt-5.3-codex | deepseek-v4-flash | glm-4.7 | kimi-k2.5 | glm-4.7 | qwen3-coder-plus | glm-5 | deepseek-v4-flash |
| gpt-5.2 | deepseek-v4-flash | glm-4.5-air | kimi-k2.5 | deepseek-v3.2 | kimi-k2.5 | kimi-k2.5 | glm-5 |

### FR4: UI 展示

- QuickSetup.vue 中的客户端选择区域自动展示新的 Codex 按钮
- Codex 按钮排在 Claude Code 之后，Pi 之前
- 图标颜色：`bg-teal-600 text-white`（青绿色，与其他客户端区分）
- 选择 Codex 后，映射区域显示 5 个客户端模型行

### FR5: i18n

- 中文：`"codex": "Codex CLI"`, `"codexDesc": "OpenAI 终端编程助手（Responses API）"`
- 英文：`"codex": "Codex CLI"`, `"codexDesc": "OpenAI terminal coding assistant (Responses API)"`

## Acceptance Criteria

- AC1: 快速配置页面显示 5 个客户端按钮（Claude Code / Codex CLI / Pi / OpenAI SDK / Anthropic SDK），Codex 在第二位
- AC2: 选择 Codex 客户端后，apiType 自动切换为 `openai-responses`
- AC3: 映射区域显示 5 个客户端模型：gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.2
- AC4: 选择供应商套餐后，每个客户端模型自动填充默认后端模型
- AC5: 保存配置成功，Provider 的 api_type 为 `openai-responses`，映射组创建正确
- AC6: 中英文界面均正确显示 Codex 客户端名称和描述

## Constraints

- 不修改现有客户端（claude-code / pi / openai-sdk / anthropic-sdk）的行为
- Codex 使用 `openai-responses` 格式，需要供应商套餐支持该格式（或 openai 格式兼容）
- 默认映射仅为建议值，用户可自由修改
- 遵循现有的 QuickSetup 状态机和 composable 模式

## Complexity Assessment

- **领域复杂度**: 低 — 新增枚举值和配置数据
- **存储复杂度**: 无 — 无新 DB 表
- **数据流复杂度**: 低 — 复用现有 QuickSetup 流程
- **API 复杂度**: 无 — 无新 API 端点
- **非功能复杂度**: 低 — 纯前端配置变更
