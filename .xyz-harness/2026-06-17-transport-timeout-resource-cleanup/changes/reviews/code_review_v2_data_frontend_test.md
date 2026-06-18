---
verdict: pass
must_fix: 0
round: 2
---

# Code Review v2 — 前端 0=禁用修复验证 + 数据层核对 + 测试有效性 + fallow

**分支**: fix-concurrency-reduct
**审查范围**: 前端 4 文件（0 透传修复验证） + 后端数据层 4 文件（一致性核对） + 5 个测试文件（有效性） + fallow 静态扫描
**审查日期**: 2026-06-17
**审查人**: code-review skill（round 2）

## 自动化基线

| 检查 | 命令 | 结果 |
|------|------|------|
| 前端类型检查 | `cd frontend && npx vue-tsc -b --noEmit` | ✅ 0 error |
| 前端 ESLint（4 文件） | `npx eslint <4 files> --max-warnings=0` | ✅ 0 error 0 warning |
| 后端测试（5 文件） | `npx vitest run <5 test files>` | ✅ 35/35 passed (642ms) |
| 后端 grep 对称性 | `non_stream_timeout_ms` / `nonStream` 全链路 | ✅ 12 节点对称 |
| 残留检测 | grep `ms \|\| undefined` / `ms && ms` / `$event ? Number` | ✅ 无残留 |
| fallow audit | `fallow audit`（v2.88.2，gate=new-only） | ⚠ fail（详见 D 节，非阻塞） |

---

## A. 前端 0=禁用修复完整性（核心）— ✅ PASS

### A.1 三个 parent handler 全部透传 0（无归一化残留）

| 文件 | 修复前（v1 MUST FIX） | 修复后（v2） | 结论 |
|------|----------------------|-------------|------|
| `quick-setup-actions.ts` `setModelTimeout` | `ms \|\| undefined`（0→undefined） | `{ [field]: ms }` 直接透传 | ✅ |
| `useProviderForm.ts` `updateModelTimeout` | `val > 0 ? val*1000 : null`（0→null） | `seconds === "" \|\| seconds === undefined ? null : val*MS_PER_SECOND` | ✅ |
| `useProviderForm.ts` `updateModelNonStreamTimeout` | （新增） | 同上对称实现 | ✅ |
| `ModelCapabilitiesEditor.vue` `updateModelStreamTimeout` | `ms && ms > 0 ? ms : null`（0→null） | `ms === undefined ? null : ms` | ✅ |
| `ModelCapabilitiesEditor.vue` `updateModelNonStreamTimeout` | （新增） | 同上对称实现 | ✅ |

grep 确认全前端无 `ms || undefined` / `ms && ms > 0` / `$event ? Number` 残留（唯一命中 `useDashboard.ts:98` 的 `val > 0 ?` 是正负号显示，与超时无关）。

### A.2 ModelCard.vue emit 显式判空

两个 Input 的 `@update:model-value` 均改为：

```vue
$event === '' || $event === null || $event === undefined
  ? undefined
  : Number($event) * MS_PER_SECOND
```

数值 `0` 不再走 undefined 分支（旧 `$event ? ...` 对数值 0 会误判）。stream 与 non_stream **对称修复**。

### A.3 死代码激活 + 数据流端到端

v1 指出 `isDisabledStreamTimeout` / `isDisabledNonStreamTimeout`（`=== 0`）在正常交互下不可达（死代码）。v2 验证数据流贯通：

```
输入 "0" → ModelCard emit 0 → parent 存 0（透传）
→ ModelCard :non-stream-timeout-ms="0" → isDisabledNonStreamTimeout === 0 → true
→ "禁用" Badge 激活 ✅（不再是死代码）
```

### A.4 副作用检查 — 无回归

修复前 `stream_timeout_ms=0` 会被 parent 归一化为 `null`（落库用默认值 300s）；修复后保留 `0`（落库禁用）。判断：

- **后端一直支持 0**：`resolveTimeout(0) → Infinity`（`db/providers.ts:57`，`model-timeouts.test.ts` 两个用例验证 stream=0 / nonStream=0 → Infinity）
- **加载链路正确**：`useProviderForm.ts:336` `m.stream_timeout_ms ?? null`，`0 ?? null === 0`（0 非 nullish），DB 存 0 时加载回显正确
- **UI 此前 min="1" 不允许输入 0**，故正常交互下不会产生 0；修复后 `min="0"` 配合透传是**有意的能力新增**（大模型长推理场景关闭超时），非回归
- 既有 provider 若 DB 已存 `stream_timeout_ms=0`（历史数据），v1 前 UI 编辑会把它洗成 null，v2 后保留——这是**正向修复**，让存储与后端语义一致

**结论**：副作用为预期内的能力贯通，无破坏性变更。

---

## B. 后端数据层一致性核对（第 1 轮 pass 复核）— ✅ PASS

`grep non_stream_timeout_ms` 确认 12 个消费点全部对称（与第 1 轮 backend_data 报告一致）：

| 节点 | 位置 | 状态 |
|------|------|------|
| ModelEntry 类型 | `config/model-context.ts:19` | ✓ |
| ModelInfo 类型 | `config/model-context.ts:10` | ✓ |
| parseModels cast | `config/model-context.ts:269` | ✓ |
| parseModels 赋值 | `config/model-context.ts:281`（`!= null` 守卫） | ✓ |
| buildModelInfoList | `config/model-context.ts:304`（`!= null` 守卫） | ✓ |
| extractModelOverrides | `admin/providers.ts:105` | ✓ |
| Create/Update schema（4 分支） | `admin/providers.ts:174,175,197,198`（min:0 max:86400000） | ✓ |
| QuickSetup schema | `admin/quick-setup.ts:67` | ✓ |
| QuickSetup createAll | `admin/quick-setup.ts:153`（`!= null` 展开） | ✓ |
| getModelTimeouts | `db/providers.ts:57` → `resolveTimeout(entry.non_stream_timeout_ms, DEFAULT_NON_STREAM_TIMEOUT_MS)` | ✓ |
| transport 贯通 | `iteration-setup.ts:165` → `transport-fn.ts:141` → `http.ts callNonStream` | ✓ |

**关键复核**：前端 v2 现在会向 admin API 传 `0`（而非 undefined）。后端处理链路：
- TypeBox schema `minimum: 0` → `0` 通过校验 ✓
- `extractModelOverrides`：`m.non_stream_timeout_ms != null` → `0 != null === true` → 写入 `0` ✓
- `getModelTimeouts`：`resolveTimeout(0, 600_000)` → `Infinity` ✓（测试验证）

**第 1 轮 pass 结论在 0 透传修复后仍然成立**，且 0 语义现在端到端可用。

---

## C. 测试有效性审查（重点）— ✅ 全部有效

逐文件评估 assert 充分性、false positive 风险、边界覆盖、隔离性。**无空壳用例，无恒真断言**。

### C.1 `tests/config/model-timeouts.test.ts` — **有效** ⭐

- **assert 充分**：断言具体值（`{stream:12000, nonStream:34000}`、`Number.POSITIVE_INFINITY`、默认常量本身 `300_000`/`600_000`）
- **0 语义覆盖**：stream=0→Infinity、nonStream=0→Infinity 两个独立用例（与前端 0=禁用呼应）
- **边界**：模型不存在、空数组、非法 JSON、字符串形式模型、仅配 stream
- **隔离**：`beforeEach(clearModelsCache)` 清缓存
- **等价性守护**：`getModelStreamTimeout`（@deprecated 薄包装）与 `getModelTimeouts().stream` 一致

13 用例，质量高。

### C.2 `tests/core/monitor/kill-release.test.ts` — **有效** ⭐

- **三场景全覆盖**（审查重点要求的 acquired/race/queued）：
  - kill 已 acquire → `active` 递减到 0，`result.kind === "throw"`
  - kill + 自然完成竞态 → **幂等 release 验证**（`active` 不超减为负，仍为 0）—— 这是防资源泄漏的关键断言
  - kill 排队中（未 acquire）→ `releaseByReqId` noop，`.not.toThrow()`（防 TypeError 回归）
- **跨 provider**：`abortAllInflight` 两个 provider 同时终止
- **assert 精确**：`getStatus("p1")` 对象断言 `{active, queued}`，非仅"不抛错"
- **隔离**：`beforeEach` 新建 SemaphoreManager/Tracker

4 用例，覆盖竞态与边界，assert 强。

### C.3 `tests/core/proxy/orchestrator-client-disconnect.test.ts` — **有效** ⭐

- **TTFT 断连**：`raw.destroy()` → controller.abort → transport throw → 槽位释放（`active` 0→1→0）
- **不重试验证**：`callCount === 1` + `attempts.length === 1` + `finalDecision.action === "abort"`（防客户端断连触发无谓重试）
- **不计失败统计**：`vi.spyOn(adaptiveController, "onRequestComplete")` → `.not.toHaveBeenCalled()`（防污染自适应并发决策）
- **ResilienceLayer signal 短路**：retry sleep 期间 abort → 短路返回 `client_aborted`，不再重试
- **MF-1 regression**：failover 多迭代复用同一 reply，iteration 2 controller 被 abort（`iter2Aborted === true`，针对旧 WeakSet 实现 Promise 永挂 bug）

5 用例，含 regression 守护，assert 精准。

### C.4 `tests/core/proxy/stream-cleanup.test.ts` — **有效** ⭐

- **资源销毁**：`onUpstreamError` / loop_detection terminal → `upstream.res.destroyed === true` 且 `req.destroyed === true`，destroy 调用次数断言（`toHaveBeenCalledTimes(1)`）
- **幂等性**：重复 `onUpstreamError` 不 double-destroy、不抛错（resolved guard 守护）
- **uncaughtException 防护**：passThrough emit error 不冒泡到 process（`uncaught === false`，先 `process.once` 监听再移除，无泄漏）—— 防 stream 管道错误崩溃进程
- **W-1 regression**：passThrough error 后 Promise 被 resolve 为 `stream_abort/pipe_error`（旧实现只 cleanup 不 resolve，致 Promise 永挂）—— 关键资源泄漏守护
- 白盒访问 `passThrough`（注释标明仅测试用），合理

7 用例，含两条 regression 守护。

### C.5 `tests/core/proxy/transport-signal-timeout.test.ts` — **有效** ⭐

- **真实集成**：`createMockBackend()`（真实 HTTP server）而非纯 mock，可信度高
- **callNonStream 四场景**：inactivity timeout（`timeoutMs=100`，断言 `elapsed ∈ [80,1500)`）、signal abort、**`timeoutMs=0` 跳过 setTimeout**（与前端 0=禁用语义呼应）、already-aborted signal
- **callStream 两场景**：TTFT 阶段 signal abort、`connectTimeoutMs` pre-response 超时（断言 error message 含 "pre-response" + 时间范围）
- **时间断言容忍抖动**：`elapsed >= 80 && < 1500`，避免 CI flaky
- **隔离**：`try/finally close()` 保证 mock backend 清理

6 用例，覆盖 timeout/abort/0 三种 signal 语义。

### C.6 测试有效性汇总

| 文件 | 用例数 | 评级 | 理由 |
|------|:------:|:----:|------|
| model-timeouts | 13 | 有效 | 0→Infinity + 默认值 + 边界全覆盖，assert 具体值 |
| kill-release | 4 | 有效 | 三场景 + 幂等 release 防泄漏，assert 精确 |
| orchestrator-client-disconnect | 5 | 有效 | 不重试/不计失败/signal 短路 + MF-1 regression |
| stream-cleanup | 7 | 有效 | 资源销毁 + 幂等 + uncaughtException 防护 + W-1 regression |
| transport-signal-timeout | 6 | 有效 | 真实 backend，timeout/abort/0 语义 + 时间断言 |

**35/35 通过，0 空壳，0 恒真断言**。timer 相关用例用真实 setTimeout + `tick(20)` 而非 `vi.useFakeTimers`——因被测逻辑含真实 HTTP/AbortSignal 异步语义，fake timer 反而会破坏时序，此处选择合理（非违规）。

---

## D. fallow 静态扫描（维度 7）

**工具**: fallow 2.88.2（命令 `fallow audit`，SKILL.md 的 `fallow scan` 为旧版命令，2.x 已改为 `audit`/`health`/`dead-code` 等子命令）。

### D.1 verdict 与归因

```
verdict: fail   gate: new-only（仅 introduced findings 影响判定）
audit scope: 61 changed files vs main (af15dd83..HEAD)
```

| 维度 | total | **introduced** | inherited |
|------|:-----:|:--------------:|:---------:|
| dead_code | 18 | **0** | 18 |
| complexity | 21 | **5** | 16 |
| duplication | 58 | **11** | 47 |

`audit gate excluded 81 inherited findings`。

### D.2 dead_code（introduced=0）— ✅

本次 PR **未引入任何死代码**。18 个 unused 全部为既有（`git diff -S` 确认符号出现次数未变）：
- `PROXY_API_TYPES`、`SECONDS_PER_DAY`、`MODEL_CAPABILITIES`、`getActiveProviders`（既有导出）
- `RequestTracker.removeClient/closeAllClients/removeProviderConfig`、`FixedIntervalStrategy.getDelay`（既有方法）
- circular deps（`proxy-core ↔ transport`，既有架构）
本次新增符号（`getModelTimeouts`、`DEFAULT_NON_STREAM_TIMEOUT_MS`、`updateModelNonStreamTimeout`、`displayNonStreamTimeoutSeconds` 等）**均被引用，无 unused**。

### D.3 complexity（introduced=5）— ⚠ 全 moderate，非阻塞

| 函数 | cyc | cog | lines | 评估 |
|------|:---:|:---:|:-----:|------|
| `semaphore.ts:170 release` | 13 | 10 | 31 | 资源释放核心，幂等/竞态处理，moderate |
| `stream.ts:146 cleanup` | 13 | 10 | 11 | 流清理状态机，本次改造重点 |
| `providers.ts:90 extractModelOverrides` | 12 | 17 | 24 | +1 字段提取分支（non_stream） |
| `orchestrator.ts:89 handle` | 11 | 17 | 90 | 编排主循环，moderate |
| `model-context.ts:263 result`(parseModels) | 10 | 10 | 23 | +1 字段解析分支 |

均 **moderate 级（cyc 10-13）**，无 critical/high。复杂度上升源于：① 资源清理/并发控制改造（本 PR 核心目的）；② `non_stream_timeout_ms` 字段贯通（+1 分支/函数）。属改造的必然结果，且都低于 SKILL.md 阈值（函数 >80 行 / 圈复杂度 >15 才告警；仅 `handle` 90 行略超行数，但该函数既有规模，本次 +少量分支）。**非 MUST FIX**。

### D.4 duplication（introduced=11）— ⚠ 多为测试样板，非阻塞

| clone | 性质 | 评估 |
|-------|------|------|
| `providers.ts:154 EndpointSchema` ↔ `quick-setup.ts:49 QuickSetupEndpointSchema`（33L） | **源码** | 既有模式（两 schema 文件分维护），本次未改 endpoint 定义，long-term 重构机会 |
| `kill-release.test ↔ orchestrator-client-disconnect.test`（5 组，8-15L） | 测试 | MockReplyRaw/makeRequest/makeReply/tick 共享 mock 工厂，符合 CLAUDE.md「辅助函数多文件重复定义」既有约定 |
| `stream-cleanup.test ↔ transport-signal-timeout.test` createMockReply（11L） | 测试 | 同上 |
| `transport-signal-timeout.test` 内部 callStream 长参数样板（3 组，12-18L） | 测试 | 被测函数 `callStream` 签名臃肿（17 个参数）导致测试样板重复，根因在被测代码 |

**10/11 为测试 mock/样板重复**（符合既有约定，INFO）；**1/11 为既有 EndpointSchema 重复**（long-term 重构，INFO）。无本次引入的实质业务逻辑重复。

### D.5 fallow 结论

`fail` verdict 由 5 个 moderate 复杂度 + 11 个测试样板/既有 schema 重复驱动，**无 critical/high，无死代码，无循环依赖新增**。与本次 PR 的核心改造（资源清理 + 字段贯通）相符，非代码质量问题。可在后续迭代中：① 提取测试 mock 工厂到 `tests/helpers/`；② 统一 EndpointSchema。**不阻塞合并**。

---

## WARNING / INFO（非阻塞）

### W1 [warning] 测试 mock 工厂跨文件重复

`kill-release.test.ts` 与 `orchestrator-client-disconnect.test.ts` 共享 `MockReplyRaw`/`makeReply`/`makeRequest`/`tick`/`hangUntilAbort`（5 个 clone group）。`stream-cleanup.test.ts` 与 `transport-signal-timeout.test.ts` 共享 `createMockReply`。

**建议**（long-term）：提取到 `tests/helpers/mock-reply.ts` / `tests/helpers/mock-transport.ts`。
**现状**：符合 CLAUDE.md「辅助函数模式（多文件重复定义）」既有约定，且测试代码重复风险低。非本次必须处理。

### I1 [info] `callStream` 参数臃肿致测试样板重复

`transport/http.ts` 的 `callStream` 有 17 个位置参数，导致测试中 3 处 12-18 行的调用样板重复。根因在被测函数签名。本次不涉及重构，记录备查。

### I2 [info] EndpointSchema / QuickSetupEndpointSchema 重复

`admin/providers.ts` 与 `admin/quick-setup.ts` 各自定义近乎相同的 endpoint schema（33 行 clone）。既有模式，提取共享 schema 是 long-term 重构机会，非本次责任。

### I3 [info] timer 测试未用 fake timer

5 个测试文件均用真实 `setTimeout` + `tick(20)` 而非 `vi.useFakeTimers`。因被测逻辑含真实 HTTP/AbortSignal/EventEmitter 异步时序，fake timer 会破坏语义。`transport-signal-timeout.test.ts` 的时间断言用容忍区间（`[80, 1500)`）规避 flaky。合理选择，非违规。

---

## 通过项汇总

- ✅ **A. 前端 0=禁用修复完整**：3 parent handler + ModelCard emit 全部透传 0，stream/non-stream 对称，死代码激活，副作用为预期内能力贯通
- ✅ **B. 后端数据层一致**：12 节点对称，resolveTimeout(0)→Infinity，第 1 轮 pass 结论在 0 透传后仍成立
- ✅ **C. 测试全部有效**：5 文件 35 用例，0 空壳，0 恒真断言，含多条 regression 守护（MF-1、W-1、幂等 release）
- ✅ **自动化基线**：vue-tsc 0 error、eslint 0 error/0 warning、vitest 35/35
- ✅ **fallow**：dead_code introduced=0；complexity/duplication 的 introduced 均为 moderate/测试样板，非阻塞

## 结论

**verdict: pass**，**must_fix: 0**。

第 1 轮前端 MUST FIX（"0=禁用"UI 死代码）已按方案 A 完整修复：parent handler 透传 0、ModelCard emit 显式判空、`isDisabledXxxTimeout` 死代码激活、stream 与 non-stream 对称。副作用分析确认无回归（后端 resolveTimeout 一直支持 0，加载链路 `0 ?? null === 0` 正确）。后端数据层第 1 轮 pass 结论在 0 透传修复后仍然成立。5 个测试文件全部有效（含资源泄漏/竞态/regression 守护），35/35 通过。fallow 扫描未发现本次引入的死代码、循环依赖或 critical 复杂度，fail verdict 由 moderate 复杂度与测试样板重复驱动，不阻塞合并。

**可合并。**
