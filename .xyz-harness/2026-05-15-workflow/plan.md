# Plan: 图片模型自动切换（分层路由模型）

> 子计划：[plan-backend.md](./plan-backend.md) | [plan-frontend.md](./plan-frontend.md)

## 复杂度评估：L2

后端 7 个 task（含 failover-loop.ts 重构）+ 前端 2 个 task。核心架构变更：循环外分层预计算替代循环内逐次决策。

## 依赖图

```
T1 (capabilities) ──┬── T2 (computeImageRedirect) ──┬── T3 (failover-loop重构) ── T7 (测试)
          │                               │
T4 (expandOverflow) ─┘                               │
                          │
T5 (StageRecord) ───────────────────────────────────┘
T6 (validateRule) ── TF2 (前端 image_fallback)
T1 ──────────────── TF1 (前端 capabilities)
```

## Task 列表

### 后端（详见 [plan-backend.md](./plan-backend.md)）

| Task | 描述 | 文件数 | 风险 |
|------|------|--------|------|
| T1 | Model capabilities 基础设施 | 1 | 低 |
| T2 | computeImageRedirectTargets() 工具函数 | 1 新建 | 中 |
| T3 | failover-loop.ts 循环重构 | 1 | **高**（557 行文件，结构重写） |
| T4 | expandOverflowTargets() 包装函数 | 1 | 低 |
| T5 | StageRecord union 扩展 | 1 | 低 |
| T6 | Admin API validateRule 扩展 | 1 | 低 |
| T7 | 测试 | 5 新建 | 中 |

### 前端（详见 [plan-frontend.md](./plan-frontend.md)）

| Task | 描述 | 文件数 | 风险 |
|------|------|--------|------|
| TF1 | Provider 模型能力编辑 | 1 | 低 |
| TF2 | 映射组 image_fallback 配置 | 1 | 低 |

## 执行顺序

1. T1 + T4 + T5 + T6（并行，无依赖）
2. T2（依赖 T1 + T4）
3. T3（依赖 T2 + T4，**最关键的变更**）
4. TF1 + TF2（并行，依赖 T1 + T6）
5. T7（依赖全部）

## 核心架构决策

**ADR-1：分层预计算模型**

```
resolveMapping → computeImageRedirectTargets → expandOverflowTargets → while(true): 纯执行
```

所有路由决策在循环外完成，每层只扩展 target 列表。循环简化为 filterExcluded → provider lookup → transport → orchestrator → exclude/continue。

## AC 覆盖矩阵

| AC | 覆盖 Task | 测试 |
|----|----------|------|
| AC1-AC4 | T2 (IR 层) | T7 单元测试 |
| AC5-AC6 | T1 (capabilities) | T7 单元测试 |
| AC7-AC8 | T2 (fallback 校验) | T7 单元测试 |
| AC9 | T5 (StageRecord) | T7 验证 |
| AC10 | T2/T4 (降级) | T7 异常测试 |
| AC11 | TF1 (前端) | 手动验证 |
| AC12 | TF2 (前端) | 手动验证 |
| AC13-AC16 | T2 (图片检测) | T7 单元测试 |
| AC17 | T6 (validateRule) | T7 API 测试 |
| AC18-AC20 | T3 (分层路由) | T7 集成测试 |

## 风险点

1. **T3 failover-loop.ts 重构**：557 行核心文件，循环结构从"内部路由+执行"改为"外部预计算+内部纯执行"。需要精确保留 semaphore、tracker、日志、plugin adjustments、provider patches、格式转换、stream timeout 等现有逻辑。
2. **数据流变化**：原来 `currentBody` 在循环内通过浅拷贝每次重置，现在循环外分配一次后各层只修改 `resolved`，需确保 `currentBody` 的 model 字段与 `resolved.backend_model` 同步。
3. **cachedTargets 语义变化**：原来存 `resolveMapping` 返回的 targets，现在存三层预计算后的完整 targets。
4. **MappingEntryEditor.vue 行数**：新增 image_fallback 区域后约 210 行，未超 400 上限。
