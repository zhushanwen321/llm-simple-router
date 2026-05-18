---
verdict: pass
---

# E2E Test Plan — 前后端代码审查改进

## 测试策略

本项目无前端 E2E 自动化测试框架（无 Cypress/Playwright），验证方式为：

- **后端**: 现有 vitest 集成测试（`buildApp` + `app.inject`）覆盖请求全链路
- **前端**: 类型检查 + ESLint + 手动功能验证

## 测试场景

### R1: Monitor clipboard 独立状态

**验证方式**: 手动

1. 启动 `npm run dev`，登录后进入 Monitor 页面
2. 等待至少 2 个活跃请求出现
3. 点击第一个请求的复制按钮 → 只有第一行显示 CheckIcon
4. 点击第二个请求的复制按钮 → 只有第二行显示 CheckIcon，第一行已恢复
5. 2 秒后 CheckIcon 全部恢复为 CopyIcon

### R2: 认证单一来源

**验证方式**: 手动 + 现有测试

1. 未登录状态访问 `/` → 重定向到 `/login`
2. 登录后 → 跳转到 dashboard，Sidebar 正常显示（无闪烁）
3. 刷新页面 → Sidebar 正常显示
4. 从 Dashboard 切到 Providers → Sidebar 不闪烁
5. 访问 `/setup`（已初始化）→ 重定向到 `/login`
6. 清除数据库重新启动 → 自动跳到 `/setup`

**自动化覆盖**: `tests/auth.test.ts` 已覆盖认证中间件的基本场景。

### R3: PatchChips 使用 shadcn Button

**验证方式**: 自动化（pre-commit hook）+ 手动

1. 修改 PatchChips.vue 后运行 `python3 .githooks/vue_rules_checker.py frontend/src/components/quick-setup/PatchChips.vue`
2. 确认无 `<button>` 原生元素报错
3. 启动 `cd frontend && npm run dev`，进入 QuickSetup 页面
4. PatchChips toggle 按钮样式与项目其他 Button 一致
5. 点击 toggle 正常工作（选中/取消选中）

### R4: 重复函数提取

**验证方式**: 自动化（类型检查 + build）

1. `cd frontend && npx vue-tsc -b --noEmit` — 无类型错误
2. `cd frontend && npx eslint . --max-warnings=0` — 无 lint 错误
3. `cd frontend && npm run build` — 构建成功
4. 各页面功能不变（Dashboard 图表、Logs 日志查看、QuickSetup 模型选择等）

### R5: errMsg 三元表达式

**验证方式**: 现有测试

1. `npx vitest run tests/` — resilience 相关测试通过
2. 触发 upstream 错误时，日志中 `errMsg` 正确显示（非 undefined）

### R6: enhancement-preprocess Hook 执行

**验证方式**: 现有测试 + 手动

1. `npx vitest run tests/` — 代理相关测试通过
2. 启用 enhancement 的 tool_call_loop_enabled
3. 发送连续重复工具调用的请求 → 触发循环检测，请求被中断
4. 确认日志中 `tool_guard` snapshot 存在（证明 hook 执行了）
5. 确认不出现重复执行（同一请求只触发一次循环检测）

## 测试环境

```bash
# 后端
npm run dev  # 端口 9980

# 前端
cd frontend && npm run dev  # 自动代理到 9980

# 测试
npm test
```
