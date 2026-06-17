# Tracing Round 4（收敛复核）

> **状态：NOT CONVERGED** — 发现 1 个 AC 阻断级新 gap（G4-001）+ 1 个强耦合 gap（G4-002）+ 2 个次要观察。

## 追踪范围

- spec 初稿版本：FR-1~FR-10、AC-1~AC-13（含 Round 3 新增 FR-10 客户端断连检测修复）
- clarification：含 3 轮决策记录（23 项 Gap→spec 映射 + G3 三项）
- 追踪的视角：
  - **P1 User Journey**（运维 kill / 客户端断连 / 管理员配超时）
  - **P3 API Contract**（transportFn / resilience.execute / callStream/callNonStream/callGet 接口）
  - **P4 State Machine**（StreamProxy BUFFERING/STREAMING/.../ABORTED + semaphore token 生命周期）
  - **P5 Failure Path**（重点：所有终止路径的资源销毁完整性、signal destroy 的事件链）
- 降级视角：
  - **P2 Data Lifecycle**：本需求不改数据模型语义，`non_stream_timeout_ms` 走现有 `providers.models` JSON 路径（已声明不需 SQL 迁移），消费者矩阵已在 clarification 列出。降级依据：spec Constraints + 矩阵已枚举。仍对矩阵做了行级抽查（见 G4-004）。

## 代码核实（关键路径）

| 文件 | 核实点 | 结论 |
|------|--------|------|
| `orchestration/orchestrator.ts:99-103` | 现 `request.raw.on("close")` + `readableEnded` 守卫 | 确认 FR-10 所述 bug：POST body 已解析时 `readableEnded` 恒 true → abort 永不触发 |
| `orchestration/orchestrator.ts:115-119` | kill callback：`controller.abort()` + `reply.raw.destroy()` | 确认；signal 当前未传入 transport（FR-1 要修） |
| `transport/stream.ts:411-417` | callStream `statusCode !== 200` 早分支 | **仅有 `data`/`end`，无 `upstreamRes.on("error")`**（G4-001） |
| `transport/stream.ts:444-446` | callStream 成功分支 | 有 `upstreamRes.on("error", proxy.onUpstreamError)` ✅ |
| `transport/http.ts:85/113/116` | callNonStream | `res.on("error")` + `req.on("error")` 齐全 ✅ |
| `transport/http.ts:146/156/158` | callGet | `res.on("error")` + `req.on("error")` 齐全 ✅ |
| `core/concurrency/semaphore.ts:release` | 无「已释放 token」标记 | 双 release 会 `entry.current--` 两次（FR-2/FR-7 要修，已声明） |
| `proxy/proxy-core.ts:194 proxyGetRequest` | dead code（无调用方） | callGet 仅 `provider-connectivity.ts` 在用，G3-003 描述正确 |

## Gap 列表

| ID | Type | Perspective | Source | Question / 问题 |
|----|------|------------|--------|-----------------|
| **G4-001** | F | Failure Path | `transport/stream.ts:411-417` + FR-1 | **callStream 非 200 早分支缺 `upstreamRes.on("error")`，FR-1 signal→destroy 在该路径必然产生 bug**（详见下） |
| **G4-002** | D | Failure Path | FR-1 vs FR-3 措辞 | FR-1 只写「`upstreamReq.destroy()`」未指定 error 参数；FR-3 明确「`destroy(timeoutError)`」。Node 语义下两者事件链不同，直接决定 G4-001 的失败模式 |
| G4-003 | F | Failure Path | `orchestrator.ts:99` + `failover-loop.ts:316` | FR-10 在每次 `handle()` 注册 `reply.raw.on("close")`；failover 循环对同一 reply 调 N 次 `handle()` → N 个 close listener 堆积，spec 未提清理 |
| G4-004 | F | Data Lifecycle | `admin/providers.ts:104`、`admin/quick-setup.ts:151` | 矩阵 #3/#4 是文件级，未显式列出这两处 `stream_timeout_ms → entry` 的赋值镜像点（CLAUDE.md「任何消费者遗漏即 MUST FIX」要求行级穷举） |

### G4-001（核心，AC 阻断）详述

**位置**：`router/src/proxy/transport/stream.ts:411-417`

```typescript
upstreamReq.on("response", (upstreamRes) => {
  const statusCode = upstreamRes.statusCode || UPSTREAM_BAD_GATEWAY;
  if (statusCode !== UPSTREAM_SUCCESS) {
    const chunks: Buffer[] = [];
    upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
    upstreamRes.on("end", () => { effectiveResolve({ kind: "stream_error", ... }); });
    return;   // ← 无 upstreamRes.on("error")
  }
  // 成功分支才有 upstreamRes.on("error", proxy.onUpstreamError)
});
```

**对比**：callNonStream（http.ts:113）、callGet（http.ts:156）、callStream 成功分支（stream.ts:446）**均**注册了 `res.on("error")`。唯独此早分支缺失。

**为何是 FR-1 引入的新问题**：

该分支处理上游非 200 响应（429/500/auth 错误等，常见）。上游开始吐错误 body 时若客户端断连/kill：

1. FR-10 → `controller.abort()` → signal
2. FR-1 signal listener → `upstreamReq.destroy(...)`
3. upstreamReq 销毁 → socket 销毁 → upstreamRes 被连带动销毁

此时 upstreamRes 的事件取决于 destroy 是否带 error 参数（与 G4-002 强耦合）：

| FR-1 destroy 调用 | upstreamReq `error` 事件 | upstreamRes `error` 事件 | 早分支结果 |
|---|---|---|---|
| `destroy()`（无 arg） | ❌ 不触发（外层 `upstreamReq.on("error")` 不 fire） | ❌ 不触发 | `end` 永不 fire → **Promise 永挂 → 槽位泄漏**（正是本需求要修的 bug） |
| `destroy(abortErr)`（带 arg，与 FR-3 一致） | ✅ 触发 → 外层 listener → resolve | ✅ 触发 → **无 listener → uncaughtException → 进程崩溃** |

**两种实现都坏**。AC-3（"客户端流式 TTFT 阶段断连 → 并发度下降，upstreamReq 被销毁"）覆盖 TTFT 阶段，而非 200 响应正处于 TTFT（尚无 token 输出），故 **AC-3 在非 200 断连场景下不可实现**。

**修复方向**（供 plan 阶段）：早分支补 `upstreamRes.on("error", err => effectiveResolve({ kind: "stream_error", statusCode, body: Buffer.concat(chunks).toString(), headers, sentHeaders }))`，与 callNonStream 对称；同时 FR-1 须明确 destroy 带error 参数（G4-002）。

**未覆盖确认**：clarification「已知泄漏场景表」6 项、「实现要点」G-022（仅提 callNonStream 的 req/res error）、AC-8（"upstream_error"指 StreamProxy.onUpstreamError，非此早分支）均未触及此路径。

### G4-002（与 G4-001 强耦合）

FR-1 措辞「signal abort 时 `upstreamReq.destroy()`」与 FR-3「必须配套 `req.on("timeout", () => req.destroy(timeoutError))`」不一致。Node.js `request.destroy([error])`：仅当传入 error 才 emit `error` 事件。FR-1 必须显式要求 `destroy(abortError)`，否则：

- callNonStream：`req.on("error")` 不 fire → **Promise 永挂 → 槽位泄漏**（AC-3b/AC-4 不可实现）
- callStream 早分支：见 G4-001

G-022（"需确保 destroy 后必有一处 resolve"）作为 plan 阶段实现要点部分触及，但 (a) 未把「destroy 必须带 error」提升为 spec 级硬要求，(b) 未连接到 G4-001 的早分支 listener 缺失。建议 FR-1 正文补一句与 FR-3 对称的 destroy-with-error 约束。

### G4-003（次要）

`executeFailoverLoop`（failover-loop.ts:316）跨 provider 时对同一 `request`/`reply` 多次调 `orchestrator.handle()`。每次 handle() 都执行 `reply.raw.on("close", ...)`（FR-10 改动后）。N 次 failover → N 个 close listener 累积在 reply.raw 上。虽 bounded（iterationCap），但 spec 未提「前一轮 handle 结束时移除旧 listener」或改用 `{ once: true }`。pre-existing（当前 `request.raw.on("close")` 也有此问题），FR-10 改 reply.raw 时顺带说明更稳妥。

### G4-004（次要，矩阵精度）

CLAUDE.md「新字段数据消费者检查」要求穷举。clarification 矩阵 #3（admin/providers.ts）列了 `ModelInput 类型 + L173/L196 schema`，但漏列 `extractModelOverrides`（L104 `if (m.stream_timeout_ms != null) entry.stream_timeout_ms = ...`）需镜像 `non_stream_timeout_ms`；矩阵 #4（admin/quick-setup.ts）列了 Schema（L66），漏列 `createAll` 事务中的映射（L151 `...(m.stream_timeout_ms != null ? { stream_timeout_ms } : {})`）。文件级覆盖但行级未穷举，建议补全以通过「任何消费者遗漏即 MUST FIX」。

## 已追踪且确认覆盖的视角（无新 gap）

- **FR-2 幂等释放 / 双 release**：semaphore.release 现无「已释放」标记，FR-2+FR-7 已声明要加；generation 机制仅覆盖 config-reset，不覆盖同 token 双 release → 已被 AC-13 覆盖。
- **FR-10 reply.raw close + StreamProxy reply.raw close 协同**：双 listener 触发，resolved 标志 + Promise resolve 幂等保护，G-023 已声明。
- **kill + 自然完成竞态**：`tracker.complete` 第二次为 no-op（`activeMap.get` 返回 undefined）；正常。
- **callGet signal**：FR-9 只加超时，不加 signal；GET 为 admin 探测请求，30s 超时兜底，signal 属 YAGNI。
- **resilience signal 短路 + retry sleep**：sleep 期间无上游计费，顶部检查即可，sleep 不需可中断（FR-2 已强制释放槽位）。
- **前端矩阵 11 文件**：grep 核实 `streamTimeoutMs|stream_timeout_ms|DEFAULT_STREAM_TIMEOUT_MS` 恰好命中 11 个前端文件，与矩阵一致。
- **backend `getModelStreamTimeout` 消费者**：仅 iteration-setup.ts:165，重构为 `getModelTimeouts` 影响面已控。

## 结论

**NOT CONVERGED**。G4-001 是 AC-3/AC-3b 在非 200 断连场景下的实现阻断，且属 FR-1 直接引入的新失败面，必须在 spec 层处理（FR-7 健壮性清单或 FR-1 补充条款）。G4-002 与之强耦合，需一并明确。G4-003/G4-004 为精度问题，建议顺带处理。
