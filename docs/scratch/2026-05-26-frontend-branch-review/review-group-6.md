# 分组 6: Logs Page

## 审查结论

**有差异** — feat 分支对 Logs 页面进行了功能增强，涉及表格列 schema 变更、加载状态、空状态优化、详情数据增强和 UI 重构。

## 差异详情

### 文件: Logs.vue

- **差异类型**: 功能变更 + 新增功能
- **详细说明**:
  1. **表格列 schema 变更（TABLE_COL_COUNT 8→9）**：
     - main: 列头为 `[展开按钮], ID, Time, Model, Actual Forward, Tags, Error, Actions`（8 列）
     - feat: 列头为 `[展开按钮], ID, Time, Client Model, Target Model, Latency, Tags, Error, Actions`（9 列）
     - Model 列拆分为 Client Model（请求端模型）和 Target Model（实际转发目标）
     - 新增 Latency（延迟）独立列，原 main 中延迟信息未在表格直接展示
     - Tags 列移除 `api_type` badge（移至 Client Model/Target Model 列），保留 status_code/SSE/Retry/Failover badge
  2. **新增加载状态覆盖层**：feat 在表格区域增加 `loading` 状态时显示全宽 Skeleton 占位符，main 无此功能。`loading` ref 由 useLogs composable 新增暴露。
  3. **新增富态空状态**：feat 无数据时显示筛选提示 `logs.noLogsFilterHint` + "清除所有筛选" 按钮；main 仅显示 `logs.noLogs` 文本。
  4. **新增 `hasActiveFilters` 计算属性 + `clearAllFilters()` 函数**：feat 支持一键清除所有筛选条件；main 无此能力。
  5. **日志保留设置位置变更**：main 在清理对话框内（`Separator` 分隔 + `autoCleanup` 区域），feat 移至页面底部独立行。功能完全一致，仅 UI 布局不同。
  6. **清理对话框简化**：feat 移除了 main 中清理对话框里的 `Separator` 和自动清理配置区域（因已移至页面底部）。
  7. **外层面包屑容器**：feat 使用语义类 `.page`，main 使用裸 `p-6`。功能等效，仅样式规范化。
  8. **main 分支分页区域存在语法错误**：`</Button> > >` 多了一个 `>`，feat 已修复。
- **影响评估**: 中 — 表格列 schema 变更需同步后端 API 返回字段和 i18n key；空状态增强和加载状态为用户体验改进。

### 文件: useLogs.ts

- **差异类型**: 功能变更
- **详细说明**:
  1. **新增 `loading` 状态管理**：feat 在 `loadLogs()` 中添加 `loading.value = true`/`finally { loading.value = false }` 控制流，并暴露 `loading` ref 供 Logs.vue 使用。main 无 loading 状态。
  2. **`openLogDetail()` 日志详情增强**：
     - main: 直接调用 `selectedLogEntry.value = await api.getLogDetail(id)`，返回原始 LogEntry
     - feat: 额外获取 `child_count > 0` 时的子日志 (`api.getLogChildren(id)`)，通过 `fromLogEntry(entry, children)` 转换为 `UnifiedRequestOverview` 类型
     - 新增导入 `fromLogEntry` 和 `UnifiedRequestOverview` 类型
  3. **`selectedLogEntry` 类型变更**：`ref<LogEntry | null>` → `ref<LogEntry | UnifiedRequestOverview | null>`
- **影响评估**: 中 — `openLogDetail` 的行为变更直接决定日志详情弹窗展示的数据完整度（是否包含子请求）；loading 状态是纯新增不影响兼容性。

### 文件: useLogFilters.ts

- **差异类型**: 代码重构（无效功能差异）
- **详细说明**:
  - feat 在 `loadModelOptions()` 的 catch 块中增加了 `console.error("useLogFilters.loadModelOptions:", e)` 调试日志，main 的 catch 块为空。其余所有逻辑、API 调用、计算属性、返回值完全一致。
- **影响评估**: 低 — 仅增加错误日志，不影响任何功能行为。

### 文件: useLogRetention.ts

- **差异类型**: 无功能差异
- **详细说明**: 两个分支文件完全一致。API 调用 (`api.setLogRetention`/`api.getLogRetention`)、状态管理 (`retentionDays`/`retentionSaving`)、错误处理、返回值均相同。
- **影响评估**: 无。

### 文件: LogTableRow.vue

- **差异类型**: 功能变更
- **详细说明**:
  1. **时间格式化函数变更**：main 使用 `formatTime`，feat 使用 `formatTimeHMS`。功能差异取决于这两个工具函数的实现（需单独确认 `@/utils/format` 在两个分支中的变化）。LogTableRow.vue 自身不定义这两个函数，仅调用。
  2. **Client Model 列内容变更**：
     - main: 显示 `log.model` + 当 `log.original_model` 存在时显示 "replaced" Badge
     - feat: 显示 `log.model` + 始终显示 `log.api_type` Badge（secondary variant, compact 尺寸），移除 "replaced" Badge
  3. **Tags 列内容变更**：main 的 Tags 列首项显示 `log.api_type` Badge，feat 移除此项（因 api_type 已移至 Client Model/Target Model 列），保留 status_code、SSE、Retry、Failover 四项。
  4. **Target Model 列的 provider 显示样式**：main 将 provider 名称包裹在 `Badge variant="outline"` 内，feat 用纯文本 `<span class="text-muted-foreground">`。视觉差异，数据内容不变。
  5. **复制图标悬停可见**：feat 为复制按钮添加 `group` + `opacity-0 group-hover:opacity-100` 交互（仅 hover 行时显示），main 中始终可见。UX 优化，功能不变。
  6. **展开图标**：main 使用 Unicode 字符 `&#9660;`，feat 使用 lucide-vue-next `ChevronDown` 组件。视觉效果不同，交互逻辑相同。
  7. **增强标签错误日志**：feat 在 `enhancementLabel()` 的 catch 块中增加 `console.error("LogTableRow.formatLog:", e)`，main 无日志。错误处理行为不变。
- **影响评估**: 中 — api_type 和 "replaced" badge 的位置/显示逻辑变更属于业务规则变化；时间格式化函数变更需确认 `formatTimeHMS` 的实现。

## 新增文件说明

本分组无新增文件。

## 移除文件说明

本分组无移除文件。

## 附注

### api_type Badge 迁移汇总

main 中 `api_type` 在 LogTableRow Tags 列以 Badge 展示（区分 openai/default 和 secondary variant）。feat 将 api_type 移到 Client Model 列和 Target Model 列作为紧凑 secondary Badge，Tags 列不再包含 api_type。此变更与 Logs.vue 的列 schema 重构（Model → Client Model + Target Model + Latency）联动。

### 需要进一步确认的跨文件依赖

1. **`formatTime` vs `formatTimeHMS`**：需对比 `main/frontend/src/utils/format.ts` 和 `feat-frontend-design/frontend/src/utils/format.ts`，确认两个函数的差异和是否存在。
2. **`fromLogEntry()`**：feat 新增引用自 `@/components/request-detail/types`，需确认该文件和函数在两个分支中的存在性。
3. **`getLogChildren()` API**：feat 在 `openLogDetail` 中新增调用，需确认后端 API 行为一致。
4. **i18n keys**：feat 新增 `logs.noLogsFilterHint`、`logs.clearAllFilters`、`logs.table.clientModel`、`logs.table.targetModel`、`logs.table.latency` 等翻译 key，需确认对应的语言包文件已更新。
