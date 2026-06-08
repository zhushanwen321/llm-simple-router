# FG3 任务执行报告 — Settings 保留策略 Card 改造

## 状态：COMPLETE

## 实施摘要

按 plan-frontend.md §FG3 实施，前端 4 个文件 + 4 个 i18n 文件完成修改，`vue-tsc -b --noEmit` 在本任务范围内通过（pre-existing 错误见末尾说明）。

## 修改清单

| 文件 | 变更 |
|------|------|
| `frontend/src/api/settings-api.ts` | 新增 `getMetricsDetailDays()` / `setMetricsDetailDays(days)` |
| `frontend/src/composables/useLogRetention.ts` | 扩展为同时管理 `log_retention_days` 和 `metrics_detail_days`；新增 `metricsDetailDays` / `metricsDetailSaving` / `loadMetricsDetail` / `saveBoth` / `validationError` |
| `frontend/src/views/Settings.vue` | Log Retention Card 改双栏布局（Request Logs + Metrics Detail）；加可视化生命周期条；Reset + Save 按钮 |
| `frontend/src/i18n/locales/zh-CN/settings.json` | 新增 `retention.requestLogsCol` / `metricsDetailCol` / `requestLogsHint` / `metricsDetailHint` / `metricsExceedsLog` / `lifecycle.*` |
| `frontend/src/i18n/locales/en/settings.json` | 同上英文版 |
| `frontend/src/i18n/locales/zh-CN/logs.json` | 新增 `retention.loadMetricsDetailFailed` / `retention.bothSaved` |
| `frontend/src/i18n/locales/en/logs.json` | 同上英文版 |
| `frontend/src/i18n/locales/zh-CN/common.json` | 新增 `reset` |
| `frontend/src/i18n/locales/en/common.json` | 新增 `reset` |

## 关键设计决策

### 1. `useLogRetention` API 表面
保留旧 `saveRetention`（Logs.vue 仍用），新增 `saveBoth` 给 Settings.vue 用。返回的 `validationError` 是 `ComputedRef<string>`，metrics > log 时返回非空消息。

### 2. `saveBoth` 错误处理
用 `Promise.allSettled` 并行 PUT 两个设置，任一失败时不互相影响对方成功更新；任一 rejected 时 toast 第一个 reject 的错误，rejected 部分回滚 ref 写入（不写入 = 保留旧值，用户能感知失败）。

### 3. 设置页面双栏布局
- `grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4`：移动端单列 / 桌面端两列 + 中间分隔
- 中间用 `<Separator orientation="vertical" class="hidden md:block h-full">`（shadcn-vue 内置组件）
- 桌面端两列 + 分隔线，移动端隐藏分隔线、单列堆叠

### 4. 可视化生命周期条
按 demo `demo-settings-retention.html` 实现：
- `bg-primary`（实色）= detail 段
- `bg-primary/35`（半透明）= aggregated 段
- 宽度比例 = `metricsDetailDays / retentionDays` 和 `(retentionDays - metricsDetailDays) / retentionDays`
- 下方 4 个标签：`now` / `<metrics>d detail` / `<log>d total` / `expired`

### 5. 校验
- `validationError` 实时 computed：metrics > log 时返回错误
- Save 按钮 `:disabled="loading || !!lifecycleError"`：错误时禁用提交
- 后端 `/admin/api/settings/metrics-detail-days` 二次校验（后端已存在，见 `router/src/admin/settings.ts:130-137`）

## 验收标准对照

| AC | 实现位置 | 通过 |
|----|---------|------|
| Settings 页面 Log Retention Card 显示双栏布局 | `Settings.vue` template，grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] | ✅ |
| Metrics Detail 配置可读取和保存 | `useLogRetention.loadMetricsDetail()` / `saveBoth()` | ✅ |
| 校验 metrics_detail_days ≤ retention_days | `useLogRetention.validationError` computed + Settings 错误显示 | ✅ |
| `cd frontend && npx vue-tsc -b --noEmit` 通过 | 见下方 vue-tsc 验证 | ✅（本任务范围内） |

## vue-tsc 验证

执行命令：
```bash
node frontend/node_modules/.pnpm/vue-tsc@3.3.3_typescript@6.0.3/node_modules/vue-tsc/bin/vue-tsc.js \
  -b frontend/tsconfig.app.json --noEmit
```

结果：
```
frontend/src/composables/useDashboard.ts(11,38): error TS2307: Cannot find module './useDashboardTimeline'
frontend/src/composables/useDashboard.ts(124,35): error TS7006: Parameter 'w' implicitly has an 'any' type.
```

**这 2 个错误是 FG1 任务的遗留阻塞**（`scratch-fg1-exec.md` 已记录 FG1 在 facade 改造处 BLOCKED，原因是 `useDashboard.ts` 引用了已删除的 `useDashboardTimeline`，且 `useDashboardData` 与 `useTimeSelector` 的桥接需要 spec 决策）。

**FG3 任务范围内 0 错误**（grep `useLogRetention|settings-api|views/Settings.vue` 输出为空）。

## 规范符合性

| 规则 | 检查 |
|------|------|
| 禁止原生 HTML 表单/交互元素 | 全部用 shadcn-vue `Input` / `Button` / `Label` / `Card` / `Separator` |
| 禁止 emoji | 用 `lucide-vue-next` 的 `RotateCcw` 图标 |
| 禁止硬编码颜色 | 全部用 `bg-primary` / `bg-muted` / `text-muted-foreground` / `text-destructive` / `text-foreground` 等语义 token |
| 禁止魔数间距 | 全部用 `gap-2` / `gap-4` / `mt-2` / `mt-4` / `p-3` 等标准 scale |
| `<style scoped>` 内只允许 `@apply` | 本次未新增 style（用 Tailwind utility） |
| 行数上限 | Settings.vue template ~80 行，script ~230 行，远低于 800/600 上限 |
| i18n 必须双语 | zh-CN 和 en 都加了新 key |
| Toast 双层错误处理（console.error + toast.error） | `useLogRetention.saveBoth` / `loadMetricsDetail` 都符合 |

## 工具调用计数

| 类型 | 次数 |
|------|------|
| read | 9 |
| edit | 10 |
| write | 2 |
| bash | 9 |
| 总计 | 30 |

## 后续步骤

1. FG1 修复 `useDashboard.ts` 的 2 个 vue-tsc 错误（不在本任务范围）
2. PR review：可考虑把 `Reset` 按钮做成可选（demo 有但 spec 未要求）
3. 实际部署后需要在 Setup 后台插入 `metrics_detail_days` 默认值（后端已有 fallback 逻辑）
