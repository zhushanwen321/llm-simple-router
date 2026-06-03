# 分组 5: Concurrency Types & Utils

## 审查结论
一致（类型定义）+ 新增功能（工具函数）

## 差异详情

### 文件: frontend/src/types/concurrency.ts
无功能差异。两个分支完全一致。

```typescript
export type ConcurrencyMode = "auto" | "manual" | "none";
```

### 文件: frontend/src/utils/concurrency.ts
feat 分支新增文件，main 分支不存在。

- 差异类型: 新增功能
- 详细说明:
  1. 新增两个阈值常量 `CONCURRENCY_WARNING_THRESHOLD (0.5)` 和 `CONCURRENCY_DANGER_THRESHOLD (0.8)`，用于并发负载率分级。
  2. 新增 `effectiveLimit(provider)` — 取 `adaptiveLimit ?? maxConcurrency` 作为有效并发上限，支持自适应并发模式。
  3. 新增 `concurrencyBarClass(active, max)` — 根据活跃数/上限的比率返回对应 CSS 类名（`bg-danger` / `bg-warning` / `bg-primary`）。
  4. 新增 `concurrencyRatioClass(active, max)` — 当比率 >= DANGER 阈值时返回 `text-danger`。
  5. 依赖类型 `ProviderConcurrencySnapshot` 来自 `@/types/monitor`，该类型在 feat 分支的 monitor 类型定义中同步新增（需在对应分组验证）。
- 影响评估: 低 — 新增工具函数，不影响已有代码。属于 feat 分支的自适应并发控制功能的前端配套设施。

## 新增文件说明

| 文件 | 功能 |
|------|------|
| `frontend/src/utils/concurrency.ts` | 并发控制工具函数：自适应有效上限计算、负载率阈值常量、进度条/比率的 CSS 类名映射。服务于新的 Provider 自适应并发控制 UI 展示。 |

## 移除文件说明
无。
