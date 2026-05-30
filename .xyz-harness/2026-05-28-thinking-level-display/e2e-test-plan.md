---
verdict: pass
---

# E2E Test Plan — thinking-level-display

## Test Scenarios

### TS-A: Thinking Level Display

| ID | 场景 | 覆盖 AC | 前置条件 | 验证方式 |
|----|------|---------|---------|---------|
| TS-A1 | OpenAI 请求带 reasoning_effort | AC-A1 | Provider 配置 OpenAI 类型 | Monitor + Logs 显示 "high" |
| TS-A2 | Anthropic 请求带 thinking.type | AC-A2 | Provider 配置 Anthropic 类型 | Monitor + Logs 显示 "enabled" |
| TS-A3 | Responses API 请求带 reasoning.effort | AC-A3 | Provider 配置 OpenAI 类型，客户端发 Responses API 格式 | Monitor + Logs 显示 "low" |
| TS-A4 | 普通请求无 thinking 参数 | AC-A4 | 任意模型 | 显示 "off" |
| TS-A5 | Anthropic 显式 thinking.type: "disabled" | AC-A5 | Provider 配置 Anthropic 类型 | 显示 "disabled" |
| TS-A6 | 历史日志 client_request 为 null | AC-A6 | 存在旧日志 | 详情页显示 "off" |
| TS-A7 | OpenAI 同时有 reasoning 和 reasoning_effort | AC-A7 | 客户端同时发送两个字段 | reasoning.effort 优先 |

### TS-B: Model Filter

| ID | 场景 | 覆盖 AC | 前置条件 | 验证方式 |
|----|------|---------|---------|---------|
| TS-B1 | 客户端模型过滤 | AC-B1 | 存在 mapping: ds-flash → deepseek-v4-flash | 过滤 ds-flash 返回正确日志 |
| TS-B2 | 目标模型过滤 | AC-B2 | 同上 | 过滤 deepseek-v4-flash 返回正确日志 |
| TS-B3 | 组合过滤 | AC-B3 | 同上 | 同时过滤两个条件返回交集 |
| TS-B4 | Provider 过滤不影响模型选项 | AC-B4 | 多个 provider | 选择 provider 后模型选项独立 |
| TS-B5 | 原 model 参数兼容 | AC-B5 | 后端 API | GET /admin/api/logs?model=xxx 仍工作 |

### TS-C: Latency Column

| ID | 场景 | 覆盖 AC | 前置条件 | 验证方式 |
|----|------|---------|---------|---------|
| TS-C1 | 耗时列展示 | AC-C1 | 有已完成请求 | 日志行显示格式化耗时 |
| TS-C2 | 耗时格式化 | AC-C2 | 有不同耗时的请求 | <1s 显示 Xms，>=1s 显示 X.Xs |

## Test Environment

- 本地开发环境 `npm run dev`（后端 :9980）+ `cd frontend && npm run dev`（前端代理到后端）
- 配置至少一个 OpenAI provider 和一个 Anthropic provider
- 使用 curl 或 httpie 发送测试请求
