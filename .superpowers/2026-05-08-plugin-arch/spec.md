# 插件化架构重构设计规格

> 日期：2026-05-08 | 状态：草案 | 分支：refactor-plugin-arch-update

## 目标

将 llm-simple-router 的请求处理流程从单体函数重构为插件化管道架构。解决两个核心问题：

1. **架构内聚**：内部模块（format/patch/strategy/enhancement）通过统一注册机制组装
2. **外部可扩展**：用户/开发者通过写插件扩展行为（请求拦截、SSE 事件处理、错误处理）

同时精简代码——proxy-handler.ts 从 556 行降到 ~50 行入口 + 独立 hook 文件。

## 子文档索引

| 文档 | 核心内容 |
|------|---------|
| [format-adapter.md](./format-adapter.md) | FormatAdapter（元数据）+ FormatConverter（方向转换）+ FormatRegistry（注册表） |
| [pipeline-hooks.md](./pipeline-hooks.md) | ProxyPipeline 编排器 + PipelineHook 统一接口 + 6 个 HookPhase |
| [handler-factory.md](./handler-factory.md) | createProxyHandler 工厂 + buildTransportFn 简化 |
| [plugin-enhancement.md](./plugin-enhancement.md) | 增强版 TransformPlugin + SSE Layer 1 + plugin-bridge 适配 |
| [migration-plan.md](./migration-plan.md) | 5 个 Phase 的实施顺序、依赖、工作量 |

## 架构概览

### 管道骨架

请求处理的必要流程只有 3 步：

```
Route → Transform → Transport
```

围绕这 3 步，6 个 HookPhase 提供扩展点：

```
[pre_route] → ROUTE → [post_route] → TRANSFORM → [pre_transport] → TRANSPORT → [post_response]

任何阶段出错 → [on_error]
流式响应期间 → [on_stream_event]
```

### 内置 hook 和外部插件共用 PipelineHook 接口

| 优先级范围 | 使用者 |
|-----------|--------|
| 0-99 | 内部基础设施 |
| 100-199 | 内置功能（enhancement、patches、overflow） |
| 200-299 | 外部插件（默认 250） |
| 900-999 | 后置观察者（logging、metrics、usage） |

### FormatAdapter + FormatConverter 分离

- **FormatAdapter**（~30 行/个）：格式元数据（路径、错误格式、beforeSendProxy）
- **FormatConverter**（~120 行/个）：方向转换逻辑（request + response + stream）
- **FormatRegistry**：注册表查表分发，替代 TransformCoordinator 的 if-else

### 统一 Handler 工厂

3 个入口文件（openai.ts / anthropic.ts / responses.ts）合并为 1 个 createProxyHandler 工厂，差异由 FormatAdapter 驱动。

### 目录结构

```
proxy/
├── handler/
│   ├── create-proxy-handler.ts   ← 统一工厂
│   └── failover-loop.ts          ← failover 循环
├── pipeline/
│   ├── pipeline.ts               ← 编排器
│   ├── context.ts                ← PipelineContext
│   └── types.ts                  ← HookPhase + PipelineHook
├── hooks/
│   ├── builtin/                  ← 内置 hook（7 个文件）
│   ├── plugin-bridge.ts          ← TransformPlugin → PipelineHook 适配
│   └── plugin-loader.ts          ← 从 DB/plugins/ 加载
├── format/
│   ├── registry.ts               ← 格式注册表
│   ├── types.ts                  ← FormatAdapter + FormatConverter 接口
│   ├── adapters/                 ← 3 个 adapter（各 ~30 行）
│   ├── converters/               ← 6 个 converter（各 ~120 行）
│   └── mappers/                  ← 共享映射器（从 transform/ 迁入）
├── orchestration/                 ← 保持不变
├── transport/                     ← 微调参数传递
├── routing/                       ← 保持不变
└── patch/                         ← 保持不变
```

## 实施顺序

Phase 1（FormatAdapter）和 Phase 2（Pipeline）可并行 → Phase 3（合并切换）→ Phase 4（插件增强）→ Phase 5（清理）。详见 [migration-plan.md](./migration-plan.md)。

## 预期效果

| 指标 | 当前 | 重构后 |
|------|------|--------|
| proxy-handler.ts | 556 行 | ~50 行入口 |
| Handler 入口文件 | 3 个（204 行） | 1 个工厂（~80 行） |
| TransformCoordinator | 193 行 if-else | FormatRegistry 查表 |
| 新增 API 格式工作量 | 改 3 个方法 + 2 个 stream 文件 | 写 adapter(30行) + converter(120行) |
| 插件钩子数 | 4 个 | 7 个（含 SSE + error） |
| 外部插件位置感知 | 无 | 优先级范围 + 启动日志 + Admin API |
