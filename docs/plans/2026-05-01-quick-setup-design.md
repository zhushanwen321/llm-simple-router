# 快速配置页面设计

> 日期: 2026-05-01
> 状态: 设计已确认，待实现

## 背景

当前前端菜单对新手用户不友好。配置供应商、模型映射、API 密钥等多个步骤分散在不同页面，用户不知道操作顺序。个人开发者（目标用户）只需要 1-2 个供应商，需要快速跑起来。

## 设计概要

### 菜单重构

| 原菜单 | 新菜单 |
|--------|--------|
| 仪表盘 | 仪表盘 |
| 供应商 | **代理配置** → 快速配置、供应商、模型映射、API 密钥、重试规则 |
| 模型映射 | ↑ |
| 调度管理 | 保留（移动到代理配置下） |
| API 密钥 | ↑ |
| 重试规则 | ↑ |
| 代理增强（实验性） | 移除（兼容性设置合并到模型维度） |
| 实时监控 | 保留 |
| 请求日志 | 保留 |
| 系统设置 | 保留 |

### 快速配置页面（核心）

路径：`/quick-setup`，代理配置下的第一个子菜单，默认选中。

页面由 5 个步骤区域组成，用户从上到下依次配置：

---

#### Step 1: 选择客户端与供应商

**第一行 — 本地客户端选择（Chip 组）：**

| 客户端 | 请求格式 | 默认供应商 | 默认计划 |
|--------|----------|-----------|----------|
| Claude Code | Anthropic | DeepSeek | Anthropic |
| Pi | Anthropic | DeepSeek | Anthropic |
| Codex CLI | OpenAI | DeepSeek | OpenAI |
| OpenAI SDK | OpenAI | DeepSeek | OpenAI |
| Anthropic SDK | Anthropic | DeepSeek | Anthropic |

**第二行 — 三个下拉框联动：**
- **供应商**：数据来源 `recommended-providers.json` 的 group 列表
- **API 计划**：根据选中供应商展示其 presets 的 plan（如 Anthropic/OpenAI），选择计划决定 apiType 和 baseUrl
- **请求格式**：由计划决定，只读展示

**联动规则：**
1. 选择客户端 → 自动设置默认供应商 + 计划 + 格式
2. 切换供应商 → 自动匹配与客户端格式一致的计划
3. 切换计划 → 更新 apiType、baseUrl、模型列表、默认映射、默认补丁

---

#### Step 2: 连接配置

- **Base URL**：根据 Step 1 自动填充，可手动修改
- **API Key**：密码输入框，必填
- **测试连接**按钮：调用后端验证 Key 有效性

---

#### Step 3: 模型配置

每个模型一张卡片，支持独立编辑：

**第一行：** 模型名称 + DeepSeek 标签（如适用）+ 最大上下文输入框（右对齐）

**折叠区 — 兼容性补丁（按模型独立配置）：**

补丁分组：

| 分组 | 条件 | 补丁项 |
|------|------|--------|
| DeepSeek (Anthropic) | 模型名含 deepseek 且 apiType=anthropic | thinking-param, cache-control, thinking-blocks, orphan-tool-results |
| DeepSeek (OpenAI) | 模型名含 deepseek 且 apiType=openai | non-ds-tools, orphan-tool-results-oa |
| 通用 | apiType=openai 且非 openai.com | developer-role |

**默认选中规则：**
- 模型名包含 `deepseek` → 自动选中对应格式的所有 DeepSeek 补丁
- OpenAI 格式且非 OpenAI 官方端点 → 自动选中 developer-role

**架构变更：** 兼容性设置从全局维度开关（原 ProxyEnhancement 页面）调整为模型维度配置。每个 provider 的每个 model 独立存储启用的补丁列表。

---

#### Step 4: 模型映射

根据客户端类型自动生成默认映射：

| 客户端 | 默认映射 |
|--------|----------|
| Claude Code | claude-sonnet-4, claude-opus-4, claude-haiku-4, claude-sonnet-4-thinking → 按序映射到供应商模型 |
| Pi | 同 Claude Code |
| Codex CLI | gpt-4o, gpt-4o-mini, o3, o4-mini → 按序映射 |
| OpenAI SDK | 每个模型一一映射（from=to） |
| Anthropic SDK | 每个模型一一映射 |

用户可：
- 删除任意映射条目
- 添加自定义映射（输入 from 名称，to 取第一个模型）

---

#### Step 5: 重试规则

展示 `recommended-retry-rules.json` 中的所有规则，每行一条：

| 列 | 内容 |
|----|------|
| ✓ | 复选框 |
| 名称 | 如 "429 Too Many Requests" |
| 状态码 | HTTP status code |
| 响应体匹配 | body_pattern 正则 |
| 策略 | 指数退避 / 固定间隔 |
| 详情 | 延迟时间 · 重试次数 · 上限 |

**默认选中**前两条推荐规则（429、503），其余按需勾选。

---

#### 提交栏

底部固定，展示配置摘要：`供应商 · 客户端 · 格式 · N 模型 · N 映射 · N 补丁 · N 重试规则`

**校验配置**按钮：检查各步骤完整性，步骤图标变为 ✓ 或 !

**保存并启用**按钮：一次性创建供应商 + 模型映射 + 重试规则（API 密钥需用户另在 API 密钥页面生成）

---

## Mockup 参考

- `frontend/quick-setup-v4.html` — 最新交互原型
- `frontend/quick-setup-v3.html` — 上一版（含价格字段）
