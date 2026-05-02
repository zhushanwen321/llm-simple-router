# 变更记录：前端菜单和页面优化

## 2026-05-01 快速配置 + 模型维度补丁

### 为什么做这件事

新用户配置 LLM Router 需要经历：供应商（填 API Key）→ 模型映射 → API 密钥 → 重试规则，分散在 4 个不同页面，没有引导，操作顺序不清晰。

同时，兼容性补丁（DeepSeek patch、developer_role 转换）是全局自动检测的，用户无法感知哪些补丁在生效，也无法按模型控制。

### 做了什么

1. **侧边栏重构**：仪表盘 + 代理配置（二级菜单：快速配置/供应商/模型映射/API密钥/重试规则）+ 监控 + 系统设置
2. **新增快速配置页面**：5 步引导（选客户端+供应商 → 填 Key → 配模型+补丁 → 确认映射 → 选重试规则），一键提交
3. **补丁从自动检测改为模型维度配置**：patches 存储在 providers 表的 models JSON 中，每条补丁可按模型独立开关
4. **供应商编辑改为卡片式模型编辑**：每个模型一行，含名称、最大上下文、补丁多选

### 数据格式变更

providers.models 从 `"["model-a", "model-b"]"` 扩展为：
```json
[
  { "name": "deepseek-chat", "context_window": 64000, "patches": ["thinking-param", "cache-control", "thinking-blocks", "orphan-tool-results"] },
  { "name": "some-model", "patches": [] }
]
```

### 向后兼容

- 旧格式（纯字符串数组）继续支持，`parseModels()` 兼容两种格式
- 无 patches 字段的模型，后端 fallback 到现有自动检测逻辑
- 已有供应商不受影响，直到用户主动编辑时才写入新格式
