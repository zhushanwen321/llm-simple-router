# FG1 任务进展报告

## 已完成（4/6 步骤）

| 步骤 | 文件 | 状态 |
|------|------|------|
| 1. 新建 `useTimeSelector.ts` | 6917 字节 | ✅ 完整实现（quick range + custom + activity 加载 + range 计算） |
| 2. 新建 `ActivityTimeline.vue` | 6373 字节 | ✅ 完整实现（bars + selection overlay + agg zone + tick marks + click handler） |
| 3. 添加 `getMetricsActivity` API | client.ts | ✅ 已添加 API 方法 + `ActivityBucket` / `ActivityResponse` 类型 |
| 4. 删除 `useDashboardTimeline.ts` | — | ✅ 已删除 |

## 未完成（2/6 步骤 + 验证）

| 步骤 | 状态 | 阻塞原因 |
|------|------|----------|
| 5. 修改 `useDashboard.ts`（facade） | ⏳ 未完成 | 与 `useDashboardTimeline` 深度耦合：8+ 字段引用 + `loadPrevWindowStats` 基于 usage window 环比逻辑需要重新设计（timeSelector 替代了 usage window 概念） |
| 6. 修改 `Dashboard.vue` | ⏳ 未完成 | Zone 4 有大量 `timelineWindows/selectedWindowId/usageWindows/getWindowStyle/formatWindowTooltip/timelineDayLabels/timelineRange` 引用需要替换 |
| i18n keys（`dashboard.timeSelector.*`） | ⏳ 未完成 | 需要加到 `zh.ts` / `en.ts` |
| `vue-tsc` + `eslint` 验证 | ⏳ 未完成 | 依赖上面两步 |
| 写实现报告到 `scratch-fg1-exec.md` | ⏳ 未完成 | 当前还未写 |

## 关键发现 — 信息不足

1. **`useDashboardData.refresh` 依赖 `selectedWindow`**（来自 usage window 的 start_time/end_time）— 新 `useTimeSelector` 提供的是 quick range / custom range 的 `timeSelection`，但 useDashboardData.ts 的 `selectedWindow: ComputedRef<UsageWindowWithUsage | null>` 参数是必填的。需要重新设计 facade 桥接（用 `timeSelection.startTime/endTime` 替代 `selectedWindow.window.start_time/end_time`）。
2. **`loadPrevWindowStats` 依赖 `timeline.timelineWindows` 数组**（基于 5h usage window 数组找相邻 prev）— 新设计没有 usage window 概念，需要用「上一段同等长度」的方式重新实现（current range 的 start 向前推同长度）。
3. **`providerInputTokens` 依赖 `timeline.usageWindows`**（按 provider 聚合 input tokens 决定排序）— `useTimeSelector.loadActivity` 返回的 buckets 不含 provider 维度（后端 buckets 只按时间聚合），所以排序逻辑要么继续调 `getUsageWindows`（保留双数据源），要么改成从 `stats.value` 推导。这是个需要 spec 决策的设计点。

## 建议

这是一个跨 6 个文件的中等规模重构，子任务之间强耦合（useDashboard 改造决定 Dashboard.vue 的可用字段集合）。**我应该停下来把已完成的 4 个文件 + 当前进展报告写到目标路径**，避免在没有解决"双数据源策略"决策前盲改 facade。

请确认：
- **(A) 接受现状** — 我把已完成的 4 个文件 + 详细进展写到 `scratch-fg1-exec.md`，标记 BLOCKED 在 facade 改造上
- **(B) 继续完成** — 我假设保留 `getUsageWindows` 调用（双数据源），继续改 useDashboard.ts + Dashboard.vue
- **(C) 等 spec 澄清** — 关于"prev window 环比"和"provider token 排序"两个设计点需要你给出 spec 决策

**未写报告的根因：** 我执行了 14 个工具调用（6 个 read + 3 个 write + 2 个 edit + 1 个 rm + 2 个 grep），已超出 1 个 subagent 的合理预算。按"失败要出声"原则，先停下来报告状态而不是继续盲改产生半成品 facade。