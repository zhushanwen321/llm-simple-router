---
verdict: pass
---

# E2E Test Plan — AI Retry Rule Generation

## Test Scenarios

### Scenario 1: AI Config Setup → Generate Rule → Preview → Save

**覆盖 AC:** AC1, AC2, AC3, AC4

1. 打开代理增强页面 `/admin/proxy-enhancement`
2. 验证页面显示"AI 重试规则生成"配置卡片
3. 选择 Provider 和 Model（CascadingModelSelect）
4. 点击"保存"按钮
5. 刷新页面，验证配置保留
6. 导航到请求日志页面 `/admin/logs`
7. 打开一条错误日志（如 503 响应）的详情 Dialog
8. 点击左侧面板底部的"生成重试规则"按钮（带 sparkle 图标）
9. 验证按钮进入 loading 状态（spinner + "分析中..."）
10. 等待 AI 返回（5-15s）
11. 验证弹出规则预览编辑 Dialog
12. 验证 Dialog 顶部显示 AI 分析摘要（绿色边框区域）
13. 验证所有字段已预填（name, status_code, body_pattern, strategy, delays, retries）
14. 修改 body_pattern 为自定义值
15. 点击"保存规则"
16. 验证 toast 提示保存成功
17. 导航到重试规则页面 `/admin/retry-rules`
18. 验证新规则出现在列表中
19. 验证规则字段与预览时一致（含修改后的 body_pattern）

### Scenario 2: Unconfigured AI → Config Prompt

**覆盖 AC:** AC2

1. 在数据库中清除 `ai_retry_config` 设置（或使用全新实例）
2. 打开请求日志页面
3. 打开一条日志的详情 Dialog
4. 点击"生成重试规则"按钮
5. 验证弹出提示 Dialog（"需要配置 AI 模型"）
6. 验证 Dialog 包含配置路径说明
7. 点击"前往配置"按钮
8. 验证在新标签页打开 `/admin/proxy-enhancement`
9. 验证原日志详情 Dialog 仍然打开

### Scenario 3: AI Exit — Normal Response

**覆盖 AC:** AC3

1. 配置 AI 模型
2. 打开一条 200 响应且无错误的日志详情
3. 点击"生成重试规则"按钮
4. 验证返回"该请求响应正常，无需生成重试规则"的 toast 错误提示
5. 验证不弹出预览 Dialog

### Scenario 4: AI Call Failure

**覆盖 AC:** AC2

1. 配置一个不可用的 Provider（错误 base_url 或无效 API key）
2. 打开一条错误日志详情
3. 点击"生成重试规则"按钮
4. 验证显示 AI 调用失败的 toast 错误提示

### Scenario 5: Streaming Log with stream_text_content

**覆盖 AC:** AC3

1. 配置 AI 模型
2. 打开一条流式请求的日志详情（upstream_response 为 null）
3. 点击"生成重试规则"按钮
4. 验证 AI 成功分析并返回规则建议（基于 stream_text_content）

### Scenario 6: Validation — Invalid Regex

**覆盖 AC:** AC3

1. 通过 mock/手动方式让 AI 返回无效正则的 body_pattern
2. 验证后端返回校验失败错误
3. 验证前端显示错误 toast

### Scenario 7: Edit Generated Rule Before Save

**覆盖 AC:** AC4

1. 生成一条规则
2. 在预览 Dialog 中修改 name、retry_strategy（从 exponential 改为 fixed）、retry_delay_ms
3. 保存
4. 在重试规则列表中验证保存的是修改后的值

## Test Environment

- **Backend:** `npm run dev`（开发模式，端口 9980）
- **Frontend:** `cd frontend && npm run dev`（开发模式，自动代理 API）
- **Database:** 开发数据库（`~/.llm-simple-router/router.db`）
- **AI Provider:** 需要至少一个已配置的 Provider 和模型用于 AI 调用
- **Test Data:** 需要存在至少一条错误日志（503/429 等）和一条正常日志（200）

## Prerequisites

1. 系统已完成初始 setup（admin 密码已设置）
2. 至少一个 Provider 已配置（含有效的 base_url 和 api_key）
3. 数据库中存在可用的错误日志记录（可手动插入或通过代理产生）
