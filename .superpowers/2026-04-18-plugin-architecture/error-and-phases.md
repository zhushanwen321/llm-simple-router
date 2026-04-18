# 错误处理与实施阶段

## 错误处理

**核心原则：插件错误不影响主流程。**

### 后端

- `init()` 失败 → status=`error`，记录 error_message，不影响其他插件
- `beforeProxy` 抛异常 → log.error，跳过该插件，继续执行
- `intercept` 抛异常 → log.error，跳过，继续后续插件和正常代理
- `afterResponse` 抛异常 → log.error，返回原始响应

每个 hook 调用都包裹在 try-catch 中。

### 前端

- 动态 import 失败 → fallback 到默认内置解析器
- parseRequest/parseResponse 返回 null → 尝试下一个插件
- renderComponent 渲染异常 → Vue errorBoundary 捕获，显示错误 + 原始 JSON

## 实施阶段

| 阶段 | 内容 | 交付物 |
|------|------|--------|
| P0 | Plugin Engine 核心 + DB 表 + Admin API | 后端骨架 |
| P1 | enhancement-handler → 内置插件 `@internal/claude-code-enhancer` | 代理增强插件化 |
| P2 | 前端插件加载 + useSSEParsing → 内置插件 `@internal/sse-log-parser` | 日志解析插件化 |
| P3 | Plugins 管理页面 UI | 管理界面 |
| P4 | 示例插件模板 + 开发文档 | 生态基础 |

## 内置插件迁移兼容性（P1）

### `@internal/claude-code-enhancer`

将现有的 `applyEnhancement()` 逻辑迁移为内置插件，兼容性策略：

- **行为不变**：默认启用，用户无需任何操作即可保持现有功能
- **自动注册**：`buildApp()` 启动时检查 plugins 表，若不存在则自动插入内置插件记录（status='enabled'）
- **init 失败策略**：内置插件 init 失败不阻止启动，但 log.error 并降级（使用旧逻辑路径作为兜底）
- **可禁用**：用户可在管理后台禁用，禁用后 enhancement-handler 逻辑不执行

### `@internal/sse-log-parser`

将 `useSSEParsing.ts` 迁移为内置插件，策略同上。前端默认加载，禁用后 fallback 到原始 JSON 展示。

## 实施顺序

每阶段独立可交付。P0-P1 后端优先，P2-P3 前端跟进，P4 收尾。
