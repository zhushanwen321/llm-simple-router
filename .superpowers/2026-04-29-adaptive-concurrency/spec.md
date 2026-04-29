# 自适应并发控制

## 问题

当前并发控制是静态的：用户手动配置每个 Provider 的 `max_concurrency`。找到最优值需要反复试错，且无法适应上游条件变化（速率限制、负载波动）。

## 方案

Per-provider 自适应并发控制器。启用后，基于观察到的成功/失败模式动态调整信号量的 `maxConcurrency`。

## 核心算法

### 状态（per provider，纯内存）

| 字段 | 类型 | 说明 |
|------|------|------|
| currentLimit | number | 当前生效的并发限制 N |
| probeActive | boolean | 试探窗口是否开放 |
| consecutiveSuccesses | number | 连续成功计数（遇失败清零） |
| consecutiveFailures | number | 连续失败计数（遇成功清零） |
| cooldownUntil | number | 冷却期截止时间戳（ms） |

### 状态转换

**请求成功**（最终结果，含重试成功）：
1. `consecutiveSuccesses++`，`consecutiveFailures = 0`
2. 冷却期内 → 仅计数，不触发调整
3. `consecutiveSuccesses == 3` 且 `!probeActive` → 打开试探窗口
4. `consecutiveSuccesses == 3` 且 `probeActive` → `N = min(N + 1, hardMax)`，重置计数

**请求失败**（所有重试耗尽的最终结果）：
1. `consecutiveFailures++`，`consecutiveSuccesses = 0`
2. `statusCode == 429`：
   - `N = max(floor(N / 2), hardMin)`（乘法减少）
   - 关闭试探窗口，进入冷却期（30s），重置计数
3. 其他失败，`consecutiveFailures == 3`：
   - `N = max(N - 2, hardMin)`（加法减少）
   - 关闭试探窗口，重置计数

### 信号量集成

控制器设置 semaphore 的 `maxConcurrency = N + (probeActive ? 1 : 0)`。试探窗口通过临时增加限制自然实现，信号量代码无需修改。

## 集成架构

### 新增文件
- `src/proxy/adaptive-controller.ts` — AdaptiveConcurrencyController 类

### 钩子点
- `src/proxy/orchestrator.ts` — `withSlot()` 完成后通知控制器
  - 正常完成：报告成功/失败
  - `ProviderSwitchNeeded`：为原始 Provider 报告失败（即使 failover 成功）

### 初始化
- `src/index.ts` — `buildApp()` 中，对 `adaptive_enabled` 的 Provider 初始化控制器
  - 范围：`[adaptive_min, max_concurrency]`
  - 初始值：`adaptive_min`

### Admin API 联动
- `src/admin/providers.ts` — 开关切换、参数更新时同步控制器
- 新端点：`GET /admin/api/providers/:id/adaptive-status` — 返回当前自适应状态

## 数据模型

```sql
ALTER TABLE providers ADD COLUMN adaptive_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN adaptive_min INTEGER NOT NULL DEFAULT 1;
```

启用自适应时：
- `max_concurrency` = 硬上限（信号量永远不会超过此值）
- `adaptive_min` = 硬下限 + 初始值
- 控制器在 `[adaptive_min, max_concurrency]` 范围内调整

## 前端

- Provider 编辑弹窗：自适应开关 + `adaptive_min` 输入框
- 启用时 `max_concurrency` 标签变为"自适应上限"
- Monitor 页面：显示当前自适应并发值

## 参数默认值

| 参数 | 默认值 | 说明 |
|------|--------|------|
| successThreshold | 3 | 连续成功次数阈值 |
| failureThreshold | 3 | 连续失败次数阈值 |
| decreaseStep | 2 | 连续失败时的减少量 |
| cooldownMs | 30000 | 429 后的冷却期（ms） |
