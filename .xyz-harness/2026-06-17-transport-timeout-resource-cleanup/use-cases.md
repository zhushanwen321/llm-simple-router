---
verdict: pass
---

# 业务用例 — Transport 超时与资源泄漏修复

## UC-1: 运维终止异常请求

- **Actor**: 运维人员
- **Preconditions**: 服务运行中，监控页面有活跃请求；某请求上游假死（长时间无响应）
- **Main Flow**:
  1. 运维打开监控页面，看到活跃请求列表中有长时间无响应项
  2. 点击该请求的"关闭"按钮
  3. 系统立即终止请求，并发度数字下降 [AC-1]
  4. 上游连接被切断，不再产生计费 [AC-8]
  5. 槽位可被新请求复用
- **Alternative/Exception Paths**:
  - 请求已完成：kill 返回 false，前端提示"请求不存在或已完成"
  - 请求在排队中（未 acquire）：终止成功，不抛异常 [AC-10]
- **Postconditions**: 信号量槽位准确释放，无泄漏；upstreamReq/upstreamRes 已销毁
- **Module Boundaries**: admin/monitor.ts → RequestTracker.killRequest → releaseSlotProvider → SemaphoreManager.release
- **覆盖 AC**: AC-1, AC-2, AC-8, AC-10, AC-13

## UC-2: 按模型配置超时

- **Actor**: 管理员
- **Preconditions**: 已登录管理后台；provider 配置页可访问
- **Main Flow**:
  1. 进入 Provider 编辑页，找到目标模型行
  2. 在主行直接看到流式(300s)/非流式(600s)超时输入框 [AC-6]
  3. 调整非流式超时为更大值（如 900s，适配慢推理模型）
  4. 保存配置，重载页面验证值保留
- **Alternative/Exception Paths**:
  - 输入 0：表示禁用该路径超时，旁标显示"禁用" [AC-7]
- **Postconditions**: DB models JSON 含 stream_timeout_ms + non_stream_timeout_ms；getModelTimeouts 返回正确值
- **Module Boundaries**: ModelCard.vue → useProviderForm → admin API → db/providers → getModelTimeouts
- **覆盖 AC**: AC-6, AC-7

## UC-3: 上游假死自动恢复

- **Actor**: 系统（自动）
- **Preconditions**: 客户端请求到达，上游 accept 连接但假死（不返回任何数据）
- **Main Flow**:
  1. transport 发起 upstreamReq，等待响应
  2. 达到无活动超时阈值（流式 stream_timeout_ms / 非流式 non_stream_timeout_ms）[AC-4]
  3. req.on timeout → destroy(timeoutError) → resolve throw
  4. 信号量槽位释放，可服务新请求
- **Alternative/Exception Paths**:
  - 客户端在等待期间主动断连：controller.abort 立即销毁 upstreamReq，不等超时 [AC-3]
- **Postconditions**: 请求以失败结束（throw），槽位释放，无永久挂起
- **Module Boundaries**: transport(stream/http) → resilience → scope.withSlot → semaphore.release
- **覆盖 AC**: AC-3, AC-4

## 覆盖映射表

| UC | 覆盖 AC |
|----|---------|
| UC-1 | AC-1, AC-2, AC-8, AC-10, AC-13 |
| UC-2 | AC-6, AC-7 |
| UC-3 | AC-3, AC-4 |
| （系统/健壮性） | AC-3b, AC-5, AC-9, AC-11, AC-12 |

> AC-3b/AC-9/AC-11/AC-12 属系统健壮性场景，由 TC 用例覆盖（见 e2e-test-plan.md），无独立业务 UC。
