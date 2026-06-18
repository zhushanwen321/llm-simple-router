# Tracing Round 2（收敛复核）

## 追踪范围

- spec 版本：FR-1~FR-9、AC-1~AC-13（含 signal 透传、resilience 短路、setTimeout+destroy 配套、cleanup 销毁 upstreamRes、释放幂等、callGet 超时、shutdown abort 等修复）
- clarification：消费者矩阵（9 处）、gap→spec 映射表（23 项）、实现要点（3 项）
- 追踪视角：User Journey、Data Lifecycle、API Contract、State Machine、Failure Path（完整重跑，无降级）

独立从零重跑 5 视角，验证 Round 1 修复未引入新问题，并搜索 spec/clarification 仍未覆盖的路径。

## 结论：**未收敛**（发现 3 个新 gap）

Round 1 的核心修复（signal 透传、resilience 短路、destroy 配套、cleanup 销毁 upstreamRes、shutdown abort、callGet 超时、释放幂等）在源码层面路径自洽，未发现修复引入的新矛盾。但在「新字段消费者完整性」「callGet 超时来源」「默认值存量影响」三个维度发现 spec 仍未覆盖的 gap。

---

## 追踪记录（按视角）

### P1: User Journey

- UC-1（运维 kill）→ controller.abort + reply.destroy（orchestrator.ts:108-112）+ tracker.complete（request-tracker.ts:killRequest）→ FR-1 signal destroy upstreamReq → resolve → finally release。路径自洽。
- UC-2（配置超时）→ FR-5 主行双输入框。**前端两个模型编辑入口**（quick-setup/ModelCard.vue + Providers/ModelCapabilitiesEditor.vue）矩阵已列，但 composable 链路遗漏（见 G2-R2-01）。
- UC-3（上游假死）→ FR-3 req.setTimeout + destroy → error → resolve → release。callNonStream 的 `req.on("error")` + `res.on("error")` 双兜底，destroy 后必有一处 resolve。AC-4 可行。

### P2: Data Lifecycle（non_stream_timeout_ms 字段）

- 后端消费者矩阵（9 处）经源码核对完整：model-context.ts（ModelEntry/ModelInfo/parseModels/buildModelInfoList）、db/providers.ts、admin/providers.ts、admin/quick-setup.ts、iteration-setup.ts、transport-fn.ts 均已列出。
- **前端消费者矩阵不完整**：spec 矩阵 #7/#8/#9 仅列 ModelCard.vue、ModelCapabilitiesEditor.vue、constants.ts，但 grep 实测前端有 **11 处** `stream_timeout_ms`/`streamTimeoutMs` 消费点，遗漏 8 个文件（见 G2-R2-01）。
- 环境变量 `STREAM_TIMEOUT_MS`（config/index.ts:32，默认 3000000）在 `router/src` 内**无任何消费点**（死代码）。不影响本次功能，但 spec 未提及是否清理。记录为信息项，不算 gap。

### P3: API Contract

- TypeBox schema：admin/providers.ts CreateProviderSchema（L173）+ UpdateProviderSchema（L196）各有**两处** `stream_timeout_ms`（完整 Object + 简化 `{id, stream_timeout_ms}` Object）。spec 矩阵 #3 说「L173/L196 两处」，但实际每处 schema 内有 2 个 Object 变体，共 4 个需加 non_stream_timeout_ms 的位置。实现细节，plan 阶段注意。
- callGet 超时来源未定义（见 G2-R2-02）。

### P4: State Machine（StreamProxy）

- 状态转换 VALID 矩阵：BUFFERING→{STREAMING,EARLY_ERROR,ABORTED}、STREAMING→{COMPLETED,ABORTED}。所有终止路径（terminal success/error/abort、onUpstreamError）均调 cleanup()。FR-6 要求 cleanup 持有并 destroy upstreamRes/upstreamReq。
- **当前 StreamProxy 构造不持有 upstreamRes/upstreamReq 引用**（stream.ts:71-92 构造参数无这两项）。FR-6 实现需改构造签名传入。spec FR-6 已暗示，属实现细节。
- loop_detection / STREAMING 阶段 stream_error（sseScanBuffer）/ idle_timeout / client_disconnect 四条内部终止路径，当前 cleanup 均不 destroy upstreamRes → 上游继续吐数据计费。FR-6 覆盖。AC-8 可行。
- **竞态验证**：req.setTimeout（FR-3）与 signal destroy（FR-1）共存时，socket.destroy 幂等 + Promise 单次 settle，无双重 resolve。流式响应头前 req.setTimeout 与响应头后 idleTimer 共存但同值同语义（300s 无活动），先触发者先 destroy，冗余无害。无新 gap。

### P5: Failure Path

- **kill 排队中请求（AC-10）**：controller.abort → semaphore.acquire 的 signal listener reject(AbortError) → acquire 抛错。scope.ts 中 `acquire` 在 try 块**外**，finally 不执行，不调 release(undefined)。FR-7 的 release(undefined) 防护是为 **FR-2 注入强制释放**服务（kill 时若请求在排队、token 未生成，强制释放会传 undefined）。逻辑自洽。
- **signal 仅排队阶段生效**（semaphore.ts:acquire 直接返回路径不注册 signal listener）：已 acquire 槽位不主动响应 signal，靠 FR-1 transport destroy → resolve → finally release 自然释放。若 transport resolve 延迟，并发度不立即下降 → FR-2 强制释放兜底。FR-2 注入机制需暴露 token/release 给 kill callback，架构调整属 plan 阶段实现，spec FR-2 + G-020 已识别。
- **resilience retry 间 sleep 不响应 signal**（resilience.ts:`await sleep(decision.delayMs)`）：signal abort 后仍需等 delayMs（通常 1s）才进下一轮，由 FR-1 短路跳出。延迟可接受，YAGNI，不算 gap。
- **graceful shutdown 顺序**：close 当前 `semaphoreManager.removeAll()` → `proxyAgentFactory.invalidateAll()`。FR-8 abort inflight 插入点未明确（应在 removeAll 前），且 invalidateAll 销毁 keep-alive sockets 与 inflight 的交互未述。属实现细节，plan 可定。

---

## 新 Gap 列表

| ID | Type | Perspective | Source | Question |
|----|------|------------|--------|----------|
| G2-R2-01 | F | Data Lifecycle | P2 | `non_stream_timeout_ms` 前端消费者矩阵不完整。spec 矩阵 #7/#8/#9 仅列 `ModelCard.vue`、`ModelCapabilitiesEditor.vue`、`constants.ts`，但 grep 实测前端还有 8 个文件消费 `stream_timeout_ms`/`streamTimeoutMs`，新增 `non_stream_timeout_ms` 时必须同步修改：`frontend/src/types/mapping.ts`（ModelInfo 类型）、`frontend/src/components/quick-setup/types.ts`（ModelConfig 类型）、`frontend/src/components/mappings/cascading-types.ts`、`frontend/src/composables/useProviderForm.ts`（buildProviderPayload L202 / addModel L237 / updateModelTimeout L266 / 表单回填 L324）、`frontend/src/composables/quick-setup-actions.ts`（L280/L294）、`frontend/src/composables/quick-setup-helpers.ts`（L151/L374）、`frontend/src/composables/useProviderGroups.ts`（L43）、`frontend/src/views/QuickSetup.vue`（L272/L275 props）。违反 CLAUDE.md「新字段数据消费者检查 MUST FIX」。 |
| G2-R2-02 | D | API Contract | P3 | FR-9 说 `callGet`「接受 timeout 参数」，但两个调用方各自传什么超时值未定义：(1) `proxy-core.ts:200 proxyGetRequest`（GET /v1/models 客户端代理）；(2) `provider-connectivity.ts:19 ProxyConnectivityChecker.fetchModels`（admin 连通性检查）。这两类是元数据/探测请求，用 `non_stream_timeout_ms`（600s）明显过长，应独立短超时（如 5-10s）或新常量。spec 未给决策。 |
| G2-R2-03 | D | Data Lifecycle | P2 | 后端 `db/providers.ts:33 DEFAULT_STREAM_TIMEOUT_MS = 600_000`（运行时兜底），spec FR-4 决策改为 300_000。这是**运行时默认值收紧**（600s→300s），影响所有**未显式配置 stream_timeout_ms 的存量 model**——这些请求的流式无活动超时将从 10 分钟降到 5 分钟，长 thinking 模型可能在思考期被误杀。clarification 决策表理由「宽松安全，兼顾 thinking 模型思考期」与实际收紧方向矛盾（300s < 600s）。spec 未评估此存量行为变更影响，也未说明是否应「只统一前端默认、后端保持 600s」或「接受收紧」。 |

## 降级视角记录

无降级。5 视角均完整追踪（本需求涉及资源生命周期/状态机/失败路径/数据模型/接口，全部适用）。

## 备注（非 gap，供 plan 参考）

- AC-13 释放幂等机制可行：semaphore.release 当前无「已释放」标志，需扩展 AcquireToken 加 `released` 标志或 RequestTracker 记 request id 去重。generation 机制已防 provider 配置更新后的 stale token，方向自洽。
- FR-2 强制释放的注入路径：token 在 `SemaphoreScope.withSlot` 内部闭包，kill callback 在 `trackerScope.track` 内注册（withSlot 外），架构上需暴露 release 闭包。属 plan 实现细节，spec 已识别（G-020）。
- TypeBox schema 每处内有 2 个 Object 变体（完整 + `{id, stream_timeout_ms}` 简化），CreateProviderSchema + UpdateProviderSchema 共 4 个位置需加 `non_stream_timeout_ms`，不止矩阵说的「L173/L196 两处」。
- 环境变量 `STREAM_TIMEOUT_MS`（config/index.ts）在 src 内无消费点（死代码），与本次 per-model `non_stream_timeout_ms` 无关，spec 可不处理。
