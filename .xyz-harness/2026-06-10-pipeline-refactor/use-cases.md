---
verdict: pass
---

# Use Cases — Pipeline Architecture Refactor

## UC-1: 拆分巨型函数为可维护单元

**Actor:** 开发者（维护者）

**Preconditions:**
- failover-loop.ts 843 行，buildApp() 575 行
- 维护者需要定位 bug 或添加功能

**Main Flow:**
1. 维护者打开 failover-loop.ts
2. 在 3 个独立模块（reject-helpers、iteration-setup、resilience-processor）中定位相关逻辑
3. 修改单个模块，无需理解全部 843 行

**Postconditions:**
- failover-loop.ts ≤ 500 行
- 每个提取的模块有独立的类型导出和测试

**Module Boundaries:**
- `reject-helpers.ts` — 无外部依赖（仅 FastifyReply + DB insert）
- `iteration-setup.ts` — 依赖 format-registry、plugin-registry、transport-fn
- `resilience-processor.ts` — 依赖 orchestrator、tracker、DB

## UC-2: 消除 hook 双注册反模式

**Actor:** 开发者（添加新 hook）

**Preconditions:**
- 当前需要同时注册到 hookRegistry 和 proxyPipeline
- 遗忘任一注册会导致 Admin API 或实际执行缺失

**Main Flow:**
1. 开发者创建新 PipelineHook
2. 在 register-hooks.ts 中调用 `proxyPipeline.register(hook)`
3. Admin API 自动通过 `proxyPipeline.getAllHooks()` 获取

**Postconditions:**
- 只需注册一次
- Admin API 和实际执行使用同一数据源

## UC-3: hook 异常隔离

**Actor:** 运行时系统

**Preconditions:**
- ProxyPipeline.emit() 执行多个 hook
- 某个 hook 可能抛出异常

**Main Flow:**
1. emit() 按优先级顺序执行 hook
2. core hook 抛异常 → 传播，中断当前请求
3. 非 core hook 抛异常 → catch + log + 继续执行后续 hook

**Alternative Paths:**
- 无 hook 异常 → 正常完成

**Postconditions:**
- core hook 异常不会静默吞掉
- 非 core hook 异常不影响请求处理

## UC-4: stream 转换映射表驱动

**Actor:** 开发者（修复转换 bug）

**Preconditions:**
- stream-oa2ant.ts 223 行 if-else 逻辑
- 需要添加新的状态转换或修复边界 case

**Main Flow:**
1. 开发者查看映射表（state × event → action）
2. 定位对应的转换规则
3. 修改映射表条目或添加新条目

**Postconditions:**
- 所有现有转换行为不变
- 新增转换通过行为表测试验证
