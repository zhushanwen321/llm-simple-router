# ts-taste-check 发现问题 & 修复记录

## 已修复

### P0: 结构

| 文件 | 问题 | 修复 |
|------|------|------|
| src/proxy/transport.ts | 超 500 行，混合 StreamProxy + callNonStream + callGet + compat wrapper | 拆分出 src/proxy/stream-proxy.ts（StreamProxy class + callStream），transport.ts 降至 ~247 行 |

### P0: Bug（taste-check 过程中发现）

| 文件 | 位置 | 问题 | 修复 |
|------|------|------|------|
| src/proxy/resilience.ts | L227 | throw kind 的 attempt 不记录到 allAttempts。当 `fn` 返回 `{ kind: "throw" }` 时，L227 条件 `kind !== "throw"` 为 false 跳过 push，而 catch 块只处理抛异常的情况 | 改为 if/else 双分支，throw kind 也 push 到 allAttempts |
| src/proxy/proxy-handler.ts | L220 | throw kind 不发送错误响应。orchestrator.sendResponse 对 throw 直接 return，proxy-handler 也直接 return reply，Fastify 无响应直到超时 | 在 failover check 之后、return reply 之前，检查 `!reply.raw.headersSent && (throw \|\| error>=400)` 时发送 upstreamConnectionFailed |
| src/proxy/stream-proxy.ts | onEnd() | 流式响应时序问题：`reply.raw.end()` 在 `resolveFn()` 之前或同步执行，导致 `light-my-request` (inject) 在 logResilienceResult 执行前就返回 | 1) 去掉 passThrough end 事件中的 `reply.raw.end()` 2) onEnd 中先 resolveFn，再 setImmediate 中 pipeEntry.end + reply.raw.end，确保 microtask（日志写入）先于 macrotask（reply end）执行 |

### P1: 偏好

| 文件 | 位置 | 问题 | 修复 |
|------|------|------|------|
| src/proxy/proxy-handler.ts | L187 | 空 catch 块（注入 model-info tag 失败时无日志） | 改为 `catch { request.log.debug("Failed to inject model-info tag into non-JSON response"); }` |
| src/proxy/proxy-handler.ts | L114, L215, L226 | magic number 80, 400 | L114 添加 eslint-disable-line；400 提取为 HTTP_ERROR_THRESHOLD 常量 |
| src/proxy/proxy-handler.ts | L155 | _target 未使用 | 添加 eslint-disable-next-line 注释说明是接口契约要求 |

### P2: 安全/数据

| 文件 | 位置 | 问题 | 修复 |
|------|------|------|------|
| src/proxy/proxy-logging.ts | collectTransportMetrics | fallback `insertMetrics(db, base)` 缺少 `is_complete: 0`，导致 `m.is_complete ?? 1` 默认为 1（已完成） | 改为 `insertMetrics(db, { ...base, is_complete: 0 })` |

## 待修复（lint 警告）

| 文件 | 位置 | 问题 |
|------|------|------|
| src/proxy/proxy-handler.ts | L215, L226 | magic number 400 警告，需替换为 HTTP_ERROR_THRESHOLD 常量 |
| src/proxy/proxy-handler.ts | L198 | TypeScript 诊断: `ruleMatcher` 不在 HandleContext 类型中（可能是 IDE 缓存问题，tsc --noEmit 通过） |
