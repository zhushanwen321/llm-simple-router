# Proxy 层重构设计

> 日期：2026-04-15 | 源自 ts-taste-check 审查 | 范围：src/proxy/ 全部 P0-P4

## 问题

openai.ts（521 行）和 anthropic.ts（433 行）存在 ~80% 重复代码，且与已有的 proxy-core.ts（259 行，未跟踪）功能重叠。两个文件混合了工具函数、代理逻辑、路由处理、日志构建多种职责。

品味检查发现：P0 × 11 | P1 × 9 | P2 × 5 | P3 × 4 | P4 × 6。

## 目标

- 消除三个文件间的所有重复
- openai.ts / anthropic.ts 降至 ~80 行，只保留路由逻辑和 API 格式差异
- 消除所有 `any`、补全类型安全
- 修复 socket 错误静默吞掉的问题
- 统一 header key 大小写、命名、日志构建模式

约束：API Key 日志保持现状不脱敏。

## 目标结构

```
src/proxy/
├── proxy-core.ts     ~280行  共享工具 + 代理函数
├── openai.ts         ~80行   Fastify 插件路由（OpenAI 格式）
└── anthropic.ts      ~80行   Fastify 插件路由（Anthropic 格式）
```

## 实现步骤

### Step 1: proxy-core.ts 补全

在现有 proxy-core.ts 基础上：

1. **修复类型错误** — `buildRequestOptions` 返回值中 `port` 类型应为 `number`（当前 `url.port || ...` 可能返回 string）
2. **新增 `proxyGetRequest()`** — 通用的 GET 代理函数，替代 openai.ts 中的 `proxyModelsRequest`
3. **导出所有类型** — 确认 `UpstreamRequestOptions`、`ProxyResult`、`StreamProxyResult` 已导出
4. **修复 `reply` 参数类型** — 已使用 `FastifyReply`（确认无 `any`）

### Step 2: openai.ts 迁移

1. **删除重复的工具函数** — `createUpstreamRequest`、`selectHeaders`、`SKIP_UPSTREAM`/`SKIP_DOWNSTREAM`，改为从 proxy-core 导入
2. **删除重复的代理函数** — `proxyNonStream`、`proxyStream`，改为调用 proxy-core 的版本，传入 `/v1/chat/completions` 作为 `upstreamPath`
3. **删除 `proxyModelsRequest`** — 改为调用 proxy-core 的 `proxyGetRequest`
4. **路由 handler 内修复**：
   - `reply: any` → 已通过使用 proxy-core 的函数消除
   - `catch (err: any)` → `catch (err: unknown)` + `err instanceof Error ? err.message : String(err)`
   - `request.body as Record<string, unknown>` — 保留类型断言但加注释说明 Fastify 已做 JSON 解析
   - `request.headers as Record<...>` — 同理
5. **socket 错误** — `socket.on("error", () => {})` → `socket.on("error", (err) => request.log.debug({ err }, "client socket error"))`
6. **日志构建提取** — 将 stream/non-stream 两个 `insertRequestLog` 调用的公共字段提取为 `buildLogFields()` 内联辅助函数
7. **命名统一** — `fwd` → 从 proxy-core 导入的函数已用 `upstreamHeaders`，路由 handler 中也统一
8. **Header key 大小写** — 统一使用 `"Authorization"`（大写 A），与 HTTP 规范一致
9. **import 整理** — 所有 import 移到文件顶部，删除不再需要的 `http`/`https`/`PassThrough` 导入

### Step 3: anthropic.ts 迁移

与 openai.ts 对称的改动：

1. 删除重复函数，改为从 proxy-core 导入
2. 调用 proxy-core 的 `proxyNonStream`/`proxyStream`，传入 `/v1/messages` 作为 `upstreamPath`
3. 类型修复、socket 错误、日志构建提取、命名统一
4. Header key 统一为 `"Authorization"`（注意：Anthropic API 也接受 `x-api-key`，但当前实现用 Bearer，保持不变）

### Step 4: 验证

1. `npm run build` — 编译通过
2. `npm test` — 全部测试通过
3. 手动检查三个文件的最终行数
4. 确认无 `any` 残留（grep `: any` 和 `as any`）

## 文件职责划分

| 文件 | 职责 | 导出 |
|------|------|------|
| proxy-core.ts | 底层代理工具和代理函数，不依赖 Fastify 路由层 | 类型、header 工具、request 工具、proxy 函数 |
| openai.ts | OpenAI 格式的 Fastify 插件，路由注册和错误格式化 | `openaiProxy` 插件 |
| anthropic.ts | Anthropic 格式的 Fastify 插件，路由注册和错误格式化 | `anthropicProxy` 插件 |
