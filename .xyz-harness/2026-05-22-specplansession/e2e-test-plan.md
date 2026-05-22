---
verdict: pass
---

# E2E Test Plan — Retry Rule Upgrade

## Test Scenarios

### Scenario 1: Provider 隔离
**覆盖 AC1**
- 配置规则 R1: 绑定 Provider A, status_code=429, body_matchers=`[{"path":"error.type","operator":"contains","value":"rate_limit_error"}]`
- 配置规则 R2: provider_id=NULL (通用), status_code=429, body_pattern=`"error"`
- 请求 Provider A 返回 429 `{"error":{"type":"rate_limit_error"}}` → 应匹配 R1
- 请求 Provider B 返回 429 `{"error":{"type":"rate_limit_error"}}` → 不应匹配 R1, 应匹配 R2 (通用规则 fallback)
- 请求 Provider C 返回 429 `{"error":{"type":"insufficient_quota"}}` → R1/R2 都不匹配, resilience 走 failover

### Scenario 2: JSON 字段匹配
**覆盖 AC2**
- `equals` 测试: matchers=`[{"path":"error.code","operator":"equals","value":"429"}]` → body `{"error":{"code":"429"}}` 匹配
- `contains` 测试: matchers=`[{"path":"error.type","operator":"contains","value":"rate_limit"}]` → body `{"error":{"type":"rate_limit_error"}}` 匹配
- `exists` 测试: matchers=`[{"path":"error","operator":"exists"}]` → body `{"error":{"type":"x"}}` 匹配, `{"ok":true}` 不匹配
- AND 逻辑: 两个 matcher 都匹配才匹配
- 非 JSON body → fallback 到 body_pattern 正则

### Scenario 3: stream_error 响应返回
**覆盖 AC4**
- 上游在 SSE 流开始前返回 429
- resilience 重试耗尽后, 客户端收到格式化的 JSON 错误响应
- client_status_code 正确记录
- 错误格式与请求 API 类型匹配 (openai 或 anthropic 格式)

### Scenario 4: upstream_error_logs 写入
**覆盖 AC5**
- 最终失败请求 (resilience done/abort, status >= 400) 写入 upstream_error_logs
- error_type 和 error_message 正确提取
- retry_count 记录实际重试次数
- 可通过 provider_id / status_code / created_at 查询

### Scenario 5: 前端 Provider 选择
**覆盖 AC6**
- Dialog 中可选择已配置 provider 或 "通用"
- 绑定规则在表格显示 provider 名称
- 通用规则在表格显示 "通用" Badge

### Scenario 6: 前端 JSON 匹配编辑
**覆盖 AC7**
- 可切换正则/JSON 匹配 Tab
- JSON 模式可添加/删除匹配条件行
- exists 操作符隐藏 value 输入
- 保存后 body_matchers 正确序列化

### Scenario 7: 向后兼容
**覆盖 AC8**
- 现有规则 (无 provider_id, 无 body_matchers) 行为不变
- 不传新字段的 API 调用正常工作
- 现有规则匹配正常

## Test Environment

```bash
# 1. 启动测试服务 (内存数据库)
npm run dev

# 2. 运行单元测试
npx vitest run tests/unit/body-matcher.test.ts
npx vitest run tests/unit/retry-rule-matcher.test.ts

# 3. 运行集成测试
npx vitest run tests/integration/retry-rule-provider.test.ts

# 4. 前端组件测试
cd frontend && npx vitest run src/__tests__/RetryRules.test.ts

# 5. 完整测试套件
npm test

# 6. 启动前端开发服务器手动验证
cd frontend && npm run dev
# 访问 http://localhost:5173/admin/retry-rules
```

## Non-Functional Verification

- JSON 字段匹配性能 benchmark: 固定 200B 响应体 + 3 条 matchers, 执行 10000 次, 耗时 < 2x 同等正则
- 迁移 049 执行时间 < 50ms (少量数据)
- 前端 Dialog 组件渲染时间 < 200ms
