# Tracing Round 6

> **CONVERGED**

## 追踪范围

- spec 初稿版本：FR-1~FR-10、AC-1~AC-14（含 FR-10 adaptive 误降修复、消费者矩阵 17 行）
- clarification.md：5 轮决策记录（23+5+3+4+2 项 gap 全部映射）
- 追踪的视角：
  - **P1 User Journey**：kill / 客户端断连 / 超时 / shutdown 四类终止操作的全链路
  - **P2 Data Lifecycle**：`non_stream_timeout_ms` 字段全消费者矩阵（前后端）
  - **P3 API Contract**：transportFn 签名变更、callGet 超时接口
  - **P4 State Machine**：StreamProxy 状态机（BUFFERING/STREAMING/COMPLETED/ABORTED/EARLY_ERROR）+ semaphore token 生命周期 + adaptive 状态转换
  - **P5 Failure Path**：6 个已知泄漏场景 + retry/failover 循环 + shutdown + queue abort + statusCode 缺失
- 无降级视角（本需求同时涉及资源管理、状态机、数据模型、接口契约、失败路径，5 视角全适用）

## 独立验证结论（无新 gap）

### 验证 1：FR-10 adaptive 误降修复完整性（任务重点）

源码核验 `orchestrator.ts:191 extractTrackStatus` + `adaptive-controller.ts transitionFailure`：

| 终止场景 | transport 结果 | extractTrackStatus | signal.aborted | adaptive 行为 | 正确? |
|---------|---------------|-------------------|----------------|--------------|-------|
| TTFT 客户端断连 | `{kind:"throw"}`（upstreamReq.on error） | failed | true（FR-10 reply.raw close→abort） | FR-10 短路跳过 | ✓ |
| TTFT kill | `{kind:"throw"}` | failed | true（kill callback→abort） | 短路跳过 | ✓ |
| STREAMING 客户端断连 | `{kind:"stream_abort"}`（StreamProxy close handler 先于 destroy error） | completed | true（顺带） | completed，不误降 | ✓ |
| STREAMING kill | `{kind:"stream_abort"}`（reply.raw.destroy→close→terminal） | completed | true | completed，不误降 | ✓ |
| statusCode 缺失（destroy→throw 无 statusCode） | `{kind:"throw"}` 无 statusCode | failed（无 statusCode） | true | FR-10 短路在 transitionFailure 前，statusCode 缺失不进入 network-error 分支 | ✓ |
| 真实上游网络错误 | `{kind:"throw"}` | failed | false | transitionFailure：statusCode undefined → network-error → backoff | ✓（应降） |
| 非流式 FR-3/FR-4 超时 | `{kind:"throw"}`（req.setTimeout→destroy→error） | failed | false | backoff | ✓（设计决策） |

**FR-10 修复对 throw/stream_abort 两路径均完整**。signal.aborted 检查设计上与结果类型无关，对时序不敏感（无论 destroy→error 先于还是后于 reply.raw close，都安全）。G5-001 关闭。

### 验证 2：semaphore 双重 release 风险真实存在（FR-2/AC-13 前提）

`semaphore.ts:148 release` 当前逻辑：
```
if (entry.queue.length > 0) { shift + resolve（不改动 current） }
else { entry.current-- }
```
AcquireToken 无 `released` 标志。同 token 二次 release：
- 队列空 → `current--` 两次 → 信号量以为少占一个槽 → 下次 acquire 超放行
- 队列非空 → 把已交接过的槽再次 dequeue 给下一个 waiter → phantom slot

FR-2（"释放回调必须幂等"）+ FR-7（"release 对已释放 token 安全返回"）正是针对此。spec 已覆盖，实现需在 token 加 released 标志或用 request id 去重。G-020/G-016 关闭。

### 验证 3：消费者矩阵完整性（grep 全量比对）

grep `stream_timeout_ms|streamTimeoutMs|DEFAULT_STREAM_TIMEOUT` 覆盖：

**前端 11 文件**（全部在矩阵 #7-#17）：constants.ts、types/mapping.ts、quick-setup/types.ts、cascading-types.ts、ModelCard.vue、ModelCapabilitiesEditor.vue、useProviderForm.ts（4 处）、useProviderGroups.ts、quick-setup-actions.ts（2 处）、quick-setup-helpers.ts（2 处）、QuickSetup.vue。✓

**后端镜像点**（矩阵 #1-#6）：model-context.ts（L267/L278/L300）、db/providers.ts（L33/L42-47）、admin/providers.ts（L83/L104/L173-174/L196-197 含 extractModelOverrides）、admin/quick-setup.ts（L66/L151 createAll）、iteration-setup.ts:165、transport-fn.ts:58。✓

**额外发现**：`orchestrator.ts:56 HandleContext.streamTimeoutMs` 是**死字段**（grep 确认全仓无人 set/read，timeout 经 buildTransportFn 直接注入 transport）。不需加 nonStreamTimeoutMs sibling，亦不影响矩阵。非 gap。

### 验证 4：6 个泄漏场景 + 内部终止路径全覆盖

| 场景 | 修复 | 状态 |
|------|------|------|
| 流式 TTFT 客户端断连/kill | FR-10 检测 + FR-1 destroy + FR-2 同步释放 | ✓ |
| 非流式客户端断连/kill | FR-1（callNonStream 加 signal）+ FR-2 | ✓ |
| 流式上游真 hang（无响应头） | FR-3 req.setTimeout+destroy | ✓ |
| 非流式上游 hang | FR-3 + FR-4 non_stream_timeout_ms | ✓ |
| 流式 STREAMING 客户端断连 | FR-1 destroy upstreamRes（AC-8） | ✓ |
| 流式 idle_timeout / loop_detection | FR-6 cleanup 持有+destroy upstreamRes/upstreamReq（AC-8 扩展） | ✓ |
| callStream 非200早分支 signal destroy | FR-7 补 upstreamRes.on("error") | ✓ |
| graceful shutdown inflight | FR-8 遍历 killCallbacks | ✓ |
| callGet 无超时 | FR-9 setTimeout+destroy | ✓ |
| queue 中 abort TypeError | FR-7 withSlot release(undefined) 防护（AC-10） | ✓ |

### 验证 5：状态机收敛性

StreamProxy 状态转换（stream.ts VALID 表）：
- BUFFERING → {STREAMING, EARLY_ERROR, ABORTED}
- STREAMING → {COMPLETED, ABORTED}
- COMPLETED/EARLY_ERROR/ABORTED 终态

所有终止路径（idle_timeout→ABORTED、client_disconnect→ABORTED、loop_detection→ABORTED、early_error→EARLY_ERROR、normal→COMPLETED）均经 `terminal()` 入口，`resolved` 标志保证单次 resolve。FR-6 增强 cleanup 持有 upstreamRes/upstreamReq 引用后，所有终态均销毁上游资源。无僵尸状态。

## 次要观察（非阻塞，记录供参考）

这两项是**设计决策或预存行为**，不构成 spec 未覆盖的 gap：

1. **stream `idle_timeout` 与 non-stream timeout 的 adaptive 语义不对称**（预存 + 本轮引入不对称）：
   - stream idle_timeout → `stream_abort` → extractTrackStatus "completed" → adaptive 视为 success（可能 climb）
   - non-stream timeout（FR-3/FR-4）→ `throw` → "failed" → adaptive backoff
   - 这是**预存行为**（stream_abort→completed 早于本 spec），spec 未改变该路径。spec 哲学（clarification Round 2 G2-R2-03：stream idle = "多久没动静"，300s 宽松，思考期靠上游心跳）支撑此不对称的合理性。若上线后发现上游 mid-stream hang 频繁却未触发退避，可另开需求区分 `abortReason` 喂给 adaptive。**不在本轮 scope**。

2. **`HandleContext.streamTimeoutMs`（orchestrator.ts:56）死字段**：无人读写，可在实现阶段顺手删除。不影响功能，不影响矩阵。

## 结论

**CONVERGED**。5 视角独立重跑未发现 spec 未覆盖的新 gap。FR-10 adaptive 修复经源码核验对 throw/stream_abort 两路径、statusCode 缺失场景均完整。消费者矩阵 grep 全量命中。semaphore 双重 release、6 泄漏场景、状态机收敛性、shutdown/queue/callGet 边界路径均有对应 FR/AC。spec 可进入 plan 阶段。
