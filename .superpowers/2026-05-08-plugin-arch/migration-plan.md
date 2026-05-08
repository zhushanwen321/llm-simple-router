# 迁移计划

> 主文档：[spec.md](./spec.md)

## 依赖关系

```
Phase 1 (FormatAdapter) ──→ Phase 3 (Handler 工厂)
                                ↑
Phase 2 (Pipeline)      ──→ Phase 3
                              ↓
                           Phase 4 (插件增强)
                              ↓
                           Phase 5 (清理)
```

Phase 1 和 Phase 2 可并行开发。Phase 3 依赖两者完成。Phase 4、5 串行。

## Phase 1：FormatAdapter + FormatConverter 注册表

**目标**：用适配器模式替换 TransformCoordinator 的硬编码逻辑。

- 新建 `format/registry.ts`、`format/types.ts`
- 实现 3 个 adapter（各 ~30 行）
- 实现 6 个 converter（从现有 `transform/` 代码重组）
- 替换 TransformCoordinator 所有调用点
- **验证**：所有 transform 相关测试通过
- **风险**：低 — 纯替换，不改请求流程

## Phase 2：Pipeline + Hooks 基础设施

**目标**：构建可扩展的请求处理管道。

- 新建 `pipeline/pipeline.ts`、`pipeline/context.ts`、`pipeline/types.ts`
- 实现 7 个内置 hook（从 `proxy-handler.ts` 提取）
- 实现 `failover-loop.ts`
- **验证**：pipeline 单元测试通过
- **风险**：低 — 新代码，不影响现有流程

## Phase 3：统一 Handler 工厂 + 切换 Pipeline

**目标**：统一三个代理入口为单一工厂函数。

- 实现 `create-proxy-handler.ts`
- `buildApp()` 中用新工厂替换 3 个旧入口
- 删除 `proxy-handler.ts` 旧代码
- **验证**：全量集成测试通过
- **风险**：中 — 改变请求入口，需重点测试

## Phase 4：插件 API 增强 + plugin-bridge

**目标**：扩展插件接口，支持格式转换和 SSE 事件拦截。

- 增强 TransformPlugin 接口
- 实现 `plugin-bridge.ts`、`SSEEventTransform`
- Admin API 增加 pipeline hooks 查询端点
- **验证**：插件相关测试通过
- **风险**：低 — 增量添加

## Phase 5：清理 + 简化

**目标**：删除已迁移的旧代码，简化传输层接口。

- 删除 `transform-coordinator.ts`、`stream-*.ts`（已迁移到 converter）
- 简化 `buildTransportFn` 参数
- 更新文档
- **验证**：lint + 全量测试
- **风险**：低 — 收尾清理

## 工作量预估

| Phase | 新建 | 修改 | 删除 | 行数变化 |
|-------|------|------|------|---------|
| 1 | ~12 | ~5 | 1 | +1,200 / -800 |
| 2 | ~10 | 0 | 0 | +800 / -0 |
| 3 | 1 | ~3 | 4 | +150 / -250 |
| 4 | ~3 | ~3 | 0 | +300 / -50 |
| 5 | 0 | ~5 | ~8 | +0 / -600 |
| **合计** | ~26 | ~16 | ~14 | **+2,450 / -1,700** |
