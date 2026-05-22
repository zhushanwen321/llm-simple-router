---
verdict: pass
---

# E2E Test Plan — AI 生成重试规则 Provider 维度

## Test Scenarios

### Scenario 1: 后端返回 provider_id（AC1）
1. 创建一个 provider（如 "TestProvider"）
2. 创建一条请求日志，绑定该 provider_id
3. 配置 AI retry config（mock 或真实 LLM）
4. 调用 `POST /admin/api/retry-rules/ai-generate` 传入该 log_id
5. 验证返回的 `rule.provider_id` === 该 provider 的 id

### Scenario 2: 后端返回 provider_id 为 null（AC1 补充）
1. 创建一条请求日志，provider_id 为 null
2. 调用 AI generate
3. 验证返回的 `rule.provider_id` 为 null

### Scenario 3: 弹窗 provider 下拉默认通用（AC3+AC4）
1. 手动测试：打开请求详情 → 点"AI 生成规则" → 弹窗打开
2. 验证 provider 下拉默认选中"通用（所有供应商）"
3. 验证下拉选项包含所有已配置的 provider

### Scenario 4: 选择 provider 保存（AC5）
1. 在 AI 预览弹窗中选择某个 provider
2. 点击保存
3. 在 RetryRules 页面验证新规则的 provider 列显示该 provider 名称

### Scenario 5: 保持通用保存（AC6）
1. 在 AI 预览弹窗中不修改 provider（保持"通用"）
2. 点击保存
3. 在 RetryRules 页面验证新规则的 provider 列显示"通用"徽章

### Scenario 6: providers 加载失败降级（AC8）
1. mock `api.getProviders()` 抛出错误
2. 打开 AI 预览弹窗
3. 验证弹窗正常打开、只有"通用"选项、显示 toast 错误提示
4. 保存通用规则成功

## Test Environment
- 后端：`buildApp({ config, db })` 内存数据库 + mock HTTP server
- 前端：手动测试或 Vitest 组件测试（`vue-tsc` 类型检查覆盖类型正确性）
