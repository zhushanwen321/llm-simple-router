# BG2 执行记录

## 变更文件

`router/src/db/log-cleaner.ts` — 1 个文件

## 变更内容

1. **新增 import**：从 `./metrics.js` 导入 `deleteMetricsBefore`，从 `./settings.js` 追加导入 `getMetricsDetailDays`（与已有的 `getLogRetentionDays` 合并为单条 import）
2. **`runLogCleanup()` 追加 metrics 清理逻辑**：在 `deleteToolErrorLogsBefore` 之后、`return` 之前，调用 `getMetricsDetailDays(db)` 获取保留天数，若 > 0 则计算 cutoff 并调用 `deleteMetricsBefore`
3. **返回值扩展**：`return logDeleted + toolErrorDeleted + metricsDeleted`

## 验收标准检查

| AC | 结果 |
|----|------|
| `runLogCleanup` 返回值包含 metricsDeleted | 通过 — `return logDeleted + toolErrorDeleted + metricsDeleted` |
| `getMetricsDetailDays` 被调用 | 通过 — 从 settings 读取 metrics_detail_days（默认 7 天） |
| `deleteMetricsBefore` 在 detailDays > 0 时被调用 | 通过 — if 守卫 + 独立 cutoff 计算 |
| `npx tsc --noEmit` 通过 | 通过 — 零错误 |

## 禁止事项检查

- 无 unsafe cast
- 接口签名未变更（`runLogCleanup(db: Database.Database): number` 不变）
- 无 TODO/FIXME/placeholder
- 无新依赖引入

## 额外清理

合并了两个来自 `./settings.js` 的 import 语句为一条，避免重复导入。
