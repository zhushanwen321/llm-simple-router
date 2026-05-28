---
verdict: pass
---

# E2E Test Plan — modality-overflow-failover-filtering

## Test Scenarios

### TS-1: 部分支持过滤 + 正常代理
- **覆盖 AC:** AC-1
- **步骤:**
  1. 配置映射组：targets = [A(不支持image), B(支持image)]，scheduled 策略
  2. 发送含图片的 OpenAI 格式请求
  3. 验证请求被代理到 B（支持 image 的 target）
  4. 验证 A 不在 failover 链中

### TS-2: 全部不支持 + fallback 替换
- **覆盖 AC:** AC-2
- **步骤:**
  1. 配置映射组：targets = [A(不支持image)]，multimodal_fallback = B(支持image)
  2. 发送含图片请求
  3. 验证请求只路由到 B
  4. 验证 A 不出现在尝试列表

### TS-3: 全部不支持 + 无 fallback → 提前报错 (OpenAI)
- **覆盖 AC:** AC-3, AC-4
- **步骤:**
  1. 配置映射组：targets = [A(不支持image)]，无 multimodal_fallback
  2. 发送含图片的 OpenAI 格式请求 (POST /v1/chat/completions)
  3. 验证 HTTP 400
  4. 验证 body.error.code === "unsupported_modality"
  5. 验证 body.error.type === "invalid_request_error"

### TS-4: 全部不支持 + 无 fallback → 提前报错 (Anthropic)
- **覆盖 AC:** AC-3, AC-5
- **步骤:**
  1. 同 TS-3，但 apiType = anthropic
  2. 发送含图片的 Anthropic 格式请求 (POST /v1/messages)
  3. 验证 HTTP 400 + body.error.code === "unsupported_modality"

### TS-5: 无多模态内容 — 不触发过滤
- **覆盖 AC:** AC-6
- **步骤:**
  1. 配置映射组：targets = [A(不支持image)]
  2. 发送纯文本请求
  3. 验证正常代理到 A（不过滤）

### TS-6: Overflow 叠加过滤后列表
- **覆盖 AC:** AC-8
- **步骤:**
  1. 配置映射组：targets = [A(支持image, 4k窗口)], A 配置 overflow_model = B(8k窗口)
  2. 发送含图片 + 超长 token 的请求
  3. 验证 overflow 正常生效（尝试 B）

### TS-7: promptTooLong 行为不变
- **覆盖 AC:** AC-9
- **步骤:**
  1. 配置映射组：targets = [A(text-only, 4k窗口)]
  2. 发送纯文本 + 超长 token 的请求（无模态问题）
  3. 验证 promptTooLong 错误行为与改动前一致

## Test Environment

- **框架:** Vitest + Fastify inject（组件级集成测试，不启动真实服务器）
- **数据库:** SQLite in-memory (`initDatabase(":memory:")`)
- **Mock 上游:** `http.createServer()` 模拟 OpenAI/Anthropic 响应
- **App 构建:** `buildApp({ config, db })` 组装完整应用
