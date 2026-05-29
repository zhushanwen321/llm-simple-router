---
verdict: pass
---

# Business Use Cases — Provider Multi-API-Type

## UC-1: 双协议供应商配置
- **Actor**: 管理员
- **Preconditions**: 系统已初始化，管理员已登录
- **Main Flow**:
  1. 管理员打开 Provider 编辑页
  2. 填写 Provider name + Shared API Key
  3. 系统默认生成 1 个空 endpoint
  4. 管理员配置 endpoint 1: api_type=openai, base_url=xxx
  5. 管理员点击 "Add Endpoint"，选择 anthropic
  6. 配置 endpoint 2: api_type=anthropic, base_url=yyy
  7. 点击 Save
  8. 系统校验 api_type 唯一性、base_url 非空，加密 api_key
  9. 创建成功
- **Alternative Paths**:
  - 4a. endpoint api_key 为空 → 使用 shared key
  - 5a. anthropic 已存在 → 按钮灰色不可选
  - 8a. api_type 重复 → 返回 400
- **Postconditions**: Provider 包含 2 个 endpoint，客户端请求按 api_type 自动匹配
- **Module Boundaries**: Admin API → DB → resolveEndpoint() → Transport
- **AC Coverage**: AC-2, AC-4, AC-5, AC-6

## UC-2: 单协议供应商迁移不变
- **Actor**: 系统（自动迁移）
- **Preconditions**: 现有 Provider 有 api_type=openai, base_url=xxx, api_key=yyy
- **Main Flow**:
  1. 系统启动，执行 migration 051
  2. ADD COLUMN endpoints TEXT DEFAULT NULL
  3. 遍历 provider，endpoints IS NULL 的行执行数据转换
  4. 将旧字段组装为 [{api_type, base_url, api_key, upstream_path}]
  5. api_key 密文原样搬入
  6. 迁移完成
- **Alternative Paths**:
  - 3a. endpoints 已有值 → 跳过（幂等）
- **Postconditions**: endpoints 字段非空，所有请求行为不变
- **Module Boundaries**: DB Migration → resolveEndpoint() → 代理层
- **AC Coverage**: AC-1, AC-5

## UC-3: 跨协议降级
- **Actor**: 客户端
- **Preconditions**: Provider 只配了 [{api_type: "anthropic", ...}]
- **Main Flow**:
  1. 客户端发送 OpenAI 格式请求 (POST /v1/chat/completions)
  2. Handler 识别 clientApiType = "openai"
  3. resolveEndpoint() 查找 api_type=openai → 未找到
  4. 返回第一个 endpoint (anthropic)，needs_transform = true
  5. Handler 调用 FormatRegistry 转换请求格式 (openai → anthropic)
  6. Transport 发送到 anthropic endpoint
  7. 响应通过 FormatRegistry 转回 openai 格式
  8. 日志记录 api_type=openai, upstream_api_type=anthropic
- **Alternative Paths**:
  - 3a. 精确匹配 → needs_transform = false，跳过格式转换
- **Postconditions**: 客户端收到正确格式的响应，日志记录完整路由链
- **Module Boundaries**: Handler → resolveEndpoint() → FormatRegistry → Transport → Log
- **AC Coverage**: AC-3, AC-3b, AC-7

## UC-4: 管理员通过预设模板快速创建多 endpoint Provider
- **Actor**: 管理员
- **Preconditions**: 系统有推荐 Provider 模板（含 openai + anthropic 配置）
- **Main Flow**:
  1. 管理员打开 QuickSetup 或 Provider 创建页
  2. 选择推荐 Provider 模板（如 "智谱 GLM"）
  3. 系统自动填充：name + endpoints(openai + anthropic) + models + concurrency
  4. 管理员只需填写 Shared API Key
  5. 点击 Save
  6. 系统创建 Provider，endpoints 包含 2 个 endpoint
- **Alternative Paths**:
  - 2a. 自定义模式 → 手动添加 endpoint
- **Postconditions**: Provider 包含 openai + anthropic endpoint，共享一个 API Key
- **Module Boundaries**: Frontend Form → Admin API → DB
- **AC Coverage**: AC-5, AC-9
