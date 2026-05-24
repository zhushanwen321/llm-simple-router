# 活跃请求消失问题 — 根因分析（pi 源码 + router 源码联合排查）

> 日期：2026-05-12 | 涉及代码：pi-mono + llm-simple-router

---

## 问题链路

```
pi (subagent 进程)
 ├─ streamSimple() → OpenAI SDK → fetch(url) → HTTP 请求 → llm-simple-router:9980
 │                                                                      │
 │   HTTP 流式响应 ←────────────────── SSE stream ─── StreamProxy ──────┘
 │      ↓                                                                       │
 └─ subagent 仍在执行（处理工具调用、生成后续消息、重试等）───── 最终完成
```

---

## 排查过程：pi 侧

### 1. pi 的超时配置

在 `packages/coding-agent/src/core/sdk.ts:331`：

```typescript
timeoutMs: options?.timeoutMs ?? providerRetrySettings.timeoutMs,
```

其中 `providerRetrySettings` 来自 `settings-manager.ts:731`：

```typescript
timeoutMs: this.settings.retry?.provider?.timeoutMs,
```

**默认值为 `undefined`**（无显式超时），因此默认走 OpenAI SDK 的默认超时（600s = 10 分钟）。

OpenAI SDK v6 (`ai/package.json` 中声明 `"openai": "6.26.0"`) 的 timeout 参数是**请求级超时**，超时后 SDK 会 abort 底层 fetch 请求 → TCP 连接断开 → router 侧触发 `reply.raw.on("close")` → StreamProxy `terminal("stream_abort")` → `tracker.complete()`。**但这只在请求时间超过 10 分钟时触发，不是日常场景。**

### 2. pi 的 subagent 逻辑

pi 的 `packages/ai/` 是 AI provider 适配层，`packages/coding-agent/` 是 agent 循环。subagent 功能是通过 `subagent` 工具实现的，属于 agent 循环的一部分：

- pi 启动 subagent 进程（子进程或子会话）
- subagent 通过 `streamSimple()` 发起独立 HTTP 请求（可能走 llm-simple-router）
- subagent 的 HTTP 请求完成（正常或异常）→ subagent 继续执行后续逻辑（如重试）
- **子请求完成 ≠ 整个 subagent 完成**——这解释了"请求消失了但 subagent 还在执行"

**结论：pi 侧没有提前 abort 或超时。** 请求正常完成，subagent 继续运行是正常行为。

---

## 排查过程：router 侧

### 核心发现：failover 场景下 tracker 生命周期分离

在 `router/src/proxy/handler/failover-loop.ts` 中，每轮 failover 迭代都创建**新的 tracker ID**：

```
failover-loop.ts
├─ 第 201 行: const logId = randomUUID();         ← 每轮迭代新 ID
├─ 第 388 行: trackerId: logId,                    ← 传递给 orchestrator
│
└─ orchestrator.handle()
   ├─ buildActiveRequest() → id = config.trackerId  ← 用新 logId 作为请求 ID
   ├─ trackerScope.track(req, fn)
   │   ├─ tracker.start(req)                        ← 进入 activeMap，广播 request_start
   │   ├─ fn() → transport → 失败
   │   └─ tracker.complete(id, "failed")            ← 从 activeMap 删除，广播 request_complete
   │                                                ← 请求从前端消失！
   └─ ProviderSwitchNeeded thrown → caught → continue
                                                        │
失败，继续迭代 ←─────────────────────────────────────────┘
                                                        │
第 2 轮: const logId = randomUUID();                   ← 又一个新 ID！
         trackerId: newLogId
         tracker.start()                               ← 新请求出现
         tracker.complete()                            ← 再次消失
```

**Monitor 展示效果：**

```
时间线：
iter 1:  [start(A)] ──────────→ [complete(A) failed]    请求 A 消失
iter 2:                        [start(B)] ───────→ [complete(B) success]  
                                        ↑ 短暂间隙
用户感知：请求消失了！
```

### 为什么 subagent 还在执行？

因为 failover 对 pi 是**透明**的——pi 的同一个 HTTP 请求在 llm-simple-router 内部经历了多次重试，pi 侧完全不知道：

```
pi 的一次 HTTP 请求
  └─ router 内部：iter 1 → fail → iter 2 → fail → iter 3 → success
                   ↑ HTTP 连接保持打开，pi 无感知
                   
subagent 状态：还在等待同一个 HTTP 请求的响应
```

**但 Monitor 上：请求 A 消失 → 请求 B 出现 → 请求 C 出现**。用户看到的是"活跃请求看不到了"。

---

## 结论

| 假设 | 判断 | 证据 |
|------|------|------|
| 前端展示 bug | ❌ **排除** | useMonitorData 逻辑正确，start/complete 事件正常 |
| 后端提前 complete | ❌ **排除** | complete 只在 transport resolve/throw 后调用 |
| pi 超时 abort | ❌ **排除** | timeoutMs 默认 undefined，10 分钟默认超时不触发 |
| **failover 每轮独立 tracker ID** | ✅ **是根因** | 每轮 new logId → 新的 start/complete 生命周期 |
| subagent 正常完成 + 继续执行 | ✅ **次级原因** | HTTP 正常完成 → tracker complete → subagent 继续后面的逻辑 |

---

## 修复方案

### 方案 A：failover 迭代统一 tracker ID（推荐，1 行改动）

在 `failover-loop.ts` 第 388 行，使用 `rootLogId`（首轮 ID）替代 `logId`（每轮新 ID）作为 `trackerId`：

```diff
- trackerId: logId,
+ trackerId: rootLogId,   // 所有 failover 迭代共享同一个 tracker ID
```

**效果**：Monitor 中所有 failover 迭代显示为**同一个请求**。首轮失败后短暂消失，然后以同一个 ID 重新出现。

**局限**：`tracker.complete()` 和 `tracker.start()` 之间仍有短暂间隙，但不那么明显。

### 方案 B：跳过 failover 时的 tracker.complete/start（更彻底）

在 `TrackerScope.track()` 中支持"更新而不 complete"的 failover 语义：

1. `failover-loop.ts` 额外传入 `isFailoverRoot: boolean`
2. 首轮创建 tracker，后续迭代只 `tracker.update()` 不 `tracker.complete/start`
3. 只有在全部 failover 耗尽前都不返回错误时才 final complete

**效果**：Monitor 上同一个请求持续可见，无任何消失。

**风险**：改动范围大，涉及 scope.ts/orchestrator.ts/failover-loop.ts/request-tracker.ts 四个文件。

---

### ! 额外发现：http.request 缺少 timeout 设置

在 `router/src/proxy/transport/http.ts` 中 `callNonStream()` 未设置 `req.setTimeout()`：

```typescript
// 缺失：req.setTimeout(timeoutMs, () => { req.destroy(); reject(...) });
```

这可能在高并发下导致连接挂起，但不是本问题的根因。

---

## 建议下一步

| # | 动作 | 文件 | 行数 |
|---|------|------|------|
| 1 | 应用方案 A 修复 | `failover-loop.ts:388` | 1 行 |
| 2 | 在 Monitor 中添加 failover 计数显示 | `request-tracker.ts` → SSE `request_update` | 少量 |
| 3 | `callNonStream` 添加超时 | `transport/http.ts` | 少量 |
