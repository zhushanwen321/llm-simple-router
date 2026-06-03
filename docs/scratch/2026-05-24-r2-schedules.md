# Schedules.vue 页面复审

**日期**: 2026-05-25
**范围**: feat 分支 vs main 分支 Schedules.vue + WeekTimeline.vue + 后端 API

## 上一轮修复验证

### Bug 1: WeekTimeline 星期映射错误
- **状态**: 已正确修复
- **验证**: `DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]` + `DAY_KEYS = ["mon", ..., "sun"]` + `dayLabel(index)` 映射链路正确
- 数据约定 0=Sun, 1=Mon, ..., 6=Sat，DISPLAY_ORDER 将 Sun 排末尾、Mon 排首位，`result[DISPLAY_ORDER.indexOf(day)]` 正确将数据 day 映射到显示 slot

### Bug 2: smartWeekLabel 周末检测错误
- **状态**: 已正确修复
- **验证**: 周末检测 `arr.length === 2 && arr[0] === 0 && arr[1] === 6`，周日(0)+周六(6) 判断正确
- 工作日检测 `arr.length === 5 && arr[0] === 1 && arr[4] === 5`，周一(1)~周五(5) 判断正确
- 全周检测 `arr.length === 7` 正确

## 功能性审查结果

### CRUD 操作

| 操作 | feat | main | 状态 |
|------|------|------|------|
| 列表 | `api.getSchedules()` 全量加载 | 同 | OK |
| 创建 | `api.createSchedule(payload)` | 同 | OK |
| 编辑 | `api.updateSchedule(id, payload)` | 同 | OK |
| 删除 | `api.deleteSchedule(id)` + AlertDialog | 同 | OK |
| 切换 | `api.toggleSchedule(id)` + Switch | 同 | OK |

### 数据字段对比

| 字段 | feat 处理 | main 处理 | 状态 |
|------|----------|----------|------|
| mapping_rule | JSON.stringify({targets}) / JSON.parse | 同 | OK |
| concurrency_rule | mode !== "none" 才序列化 / JSON.parse | 同 | OK |
| transform_rule | buildTransformRule() 三段式 / JSON.parse | 同 | OK |
| week | JSON.stringify / JSON.parse | 同 | OK |
| start/end_hour | Select 0-23 / 1-24 | 同 | OK |
| enabled | `!!s.enabled` (number→boolean) | 同 | OK |

### API 调用路径

| 前端 API | 后端路由 | 匹配 |
|----------|---------|------|
| `api.getSchedules()` | `GET /admin/api/schedules` | OK |
| `api.createSchedule(payload)` | `POST /admin/api/schedules` | OK |
| `api.updateSchedule(id, payload)` | `PUT /admin/api/schedules/:id` | OK |
| `api.deleteSchedule(id)` | `DELETE /admin/api/schedules/:id` | OK |
| `api.toggleSchedule(id)` | `POST /admin/api/schedules/:id/toggle` | OK |

### Provider 数据转换

- main: 内联 `providers.value.map(p => ({ provider: {...}, models: (p.models ?? []).map(m => ({ name, contextWindow })) }))`
- feat: 提取为 `toProviderGroups(providers.value, { includeStreamTimeout: false })`
- `toProviderGroups` 的 `includeStreamTimeout: false` 跳过 `streamTimeoutMs` 字段，与 main 行为等价
- 两者都使用 `DEFAULT_CONTEXT_WINDOW` 作为 fallback

### 表单验证

| 规则 | feat | main | 状态 |
|------|------|------|------|
| name 非空 | `!form.value.name.trim()` | 同 | OK |
| week 非空 | `form.value.week.length === 0` | 同 | OK |
| time 合法 | `start_hour >= end_hour` | 同 | OK |
| targets 完整 | 每个 target 的 provider_id + backend_model | 同 | OK |
| transform JSON | buildTransformRule() 分别 try-catch | 同 | OK |

### 新增功能（feat 独有，main 无）

| 功能 | 实现位置 | 正确性 |
|------|---------|--------|
| WeekTimeline 时间线 | `WeekTimeline.vue` 组件 | 映射逻辑正确 |
| Secondary Strip 统计 | `activeRuleCount` / `disabledRuleCount` / `coveredDays` | 计算逻辑正确 |
| smartWeekLabel 智能标签 | 周一~周五 / 周六~周日 / 每天 | 已修复，正确 |
| parseTargets 显示 | provider name 查找 + backend_model | 正确 |
| groupAllActive / groupHasRules | 状态指示灯 | 正确 |

### 错误处理

| 场景 | console.error | toast.error | 状态 |
|------|--------------|-------------|------|
| loadGroups | 有 | 有 | OK |
| loadProviders | 有 | 有 | OK |
| loadAllSchedules | 有 | 有 | OK |
| handleToggle | 有 | 有 | OK |
| handleDelete | 有 | 有 | OK |
| handleSave | 无 | formError 显示 | 同 main，非回归 |
| openEdit 解析失败 | console.warn | toast.error | OK |
| buildTransformRule | 无 | toast.error | OK（纯 JSON 校验） |

## 结论

**无功能性 bug 或遗漏。**

feat 分支的 Schedules.vue 相比 main：
1. 功能完全对等：所有 CRUD 操作、数据字段映射、验证逻辑、API 调用路径均一致
2. 新增功能（WeekTimeline、统计条、智能星期标签）实现正确
3. 上一轮修复的 2 个 bug（星期映射 + 周末检测）已正确修复并验证
4. `toProviderGroups` 提取是正确的重构，行为等价
5. `handleSave` 缺少 `console.error` 是 main 的既有问题，非回归
