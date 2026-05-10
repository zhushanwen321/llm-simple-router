# 后端热路径性能优化方案比较

> 分析日期：2025-05-10

---

## BP-C1: 无 HTTP Agent 连接复用

### 当前实现

`http.ts` 和 `stream.ts` 中的请求未配置 keep-alive Agent。只有配置了 proxy 的 provider 才通过 `ProxyAgentFactory` 获得 agent 复用，直接连接上游的 provider 没有任何连接池。

### 方案 A: 全局 keep-alive Agent 池
- 在 `ProxyAgentFactory` 中增加全局 `http.Agent`/`https.Agent`（`keepAlive: true, maxSockets: 50`）
- 无代理 provider 使用全局 agent，有代理的用现有 `HttpsProxyAgent`/`SocksProxyAgent`
- 改动范围：`proxy-agent.ts` + `transport-fn.ts`，约 20 行
- 收益：每个 provider 节省 50-200ms TCP/TLS 握手

### 方案 B: Per-host Agent 池
- 按 `(protocol, hostname, port)` 三元组创建独立 Agent，Map 缓存
- 改动范围：`proxy-agent.ts` + `transport-fn.ts`，约 40 行
- 收益：同 A + host 隔离

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 性能收益 | 高 | 高 |
| 实现复杂度 | 低 | 中 |
| 可回退性 | 高 | 高 |

### 风险评估
- 影响的功能：所有 HTTP 代理转发（`callNonStream`、`callStream`、`callGet`）
- 边界 case：上游不支持 keep-alive → Agent 自动降级；长时间空闲连接被关闭 → Node `keepAliveMsecs` 探测
- 风险等级：**低**
- 缓解：设置 `maxSockets`（默认 Infinity 应限制为 50），`fastify.close()` 时 `agent.destroy()`

### 推荐：方案 A
理由：实现最简单，Node `http.Agent` keep-alive 是成熟方案。per-host 隔离在实际场景收益不大。

---

## BP-C2: CacheEstimator 重复 tokenize

### 当前实现

同一请求 body 的 BPE 编码在多处重复调用：`cache-estimation` hook → `estimateHit()` → `tokenize(body)`，`collectTransportMetrics()` → 又调 `estimateHit()` → 又 tokenize。同一请求最多 4-6 次。

### 方案 A: PipelineContext 缓存 tokenize 结果
- 在 `PipelineContext.metadata` 中缓存首次 tokenize 结果
- `cache-estimation` hook 计算后存入 metadata，`collectTransportMetrics` 直接读取
- 改动范围：`cache-estimation.ts` + `proxy-logging.ts`
- 收益：减少 1-2 次完整 BPE 编码

### 方案 B: CacheEstimator 接受预计算 token
- 给 `estimateHit()` 增加重载，接受 `number[]` 而非 body
- 改动范围：`cache-estimator.ts` + `cache-estimation.ts` + `proxy-logging.ts`
- 收益：同 A，但从源头消除重复

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 性能收益 | 中 | 中 |
| 实现复杂度 | 低 | 中（API 变更） |
| 可回退性 | 高 | 中 |

### 风险评估
- 影响的功能：缓存命中率估算、metrics 写入
- 边界 case：非流式请求的 hook 执行顺序（cache-estimation p200 先于 collectTransportMetrics p900）；无 session_id 时跳过
- 风险等级：**低**

### 推荐：方案 A
理由：利用现有 pipeline metadata 机制，不改变公共 API。

---

## BP-C3: failover 循环每次 structuredClone(body)

### 当前实现

`failover-loop.ts:193` 每次迭代 `let currentBody = structuredClone(ctx.body)` 对整个请求体做深拷贝。绝大多数请求不触发 failover，这次深拷贝完全浪费。

### 方案 A: 延迟拷贝 — 仅在溢出重定向时拷贝
- 初始不拷贝，`applyOverflowRedirect` 确实修改时才深拷贝
- 改动范围：`failover-loop.ts`

### 方案 B: 浅拷贝 + 按需深拷贝子对象
- `{ ...ctx.body }` 浅拷贝，仅修改嵌套对象时局部深拷贝
- 改动范围：`failover-loop.ts`

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 性能收益 | 中 | 中（首次也优化） |
| 实现复杂度 | 低 | 低 |

### 风险评估
- 影响的功能：failover 中 body 修改（overflow redirect、format transform、provider patches）
- 边界 case：`transformRequest` 返回新对象不修改原对象（安全）；`applyProviderPatches` 操作 currentBody 浅层
- 风险等级：**中**（需逐一确认所有 body 变更点不修改原始对象）

### 推荐：方案 B
理由：浅拷贝对请求体顶层结构足够安全（messages 等嵌套数组只读不修改）。需确认 `transformRequest` 和 `applyProviderPatches` 都返回新对象。

---

## BP-H1: loadEnhancementConfig 每次查 DB

### 当前实现

`loadEnhancementConfig(db)` 每次请求调用 `getSetting(db, "proxy_enhancement")`。加上 `getTokenEstimationEnabled`，每请求 2-3 次 settings 查询。

### 方案 A: 简易 TTL 内存缓存
- 模块内维护 30s TTL 缓存
- 改动范围：`enhancement-config.ts`

### 方案 B: 全局 Settings 缓存服务
- 通过 `ServiceContainer` 管理，admin 更新时刷新
- 改动范围：新增 `settings-cache.ts`，影响所有 `getSetting` 调用方

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 性能收益 | 中 | 高 |
| 实现复杂度 | 低 | 中 |
| 风险 | 低 | 中（影响面大） |

### 推荐：方案 A
理由：30s TTL 在配置变更场景可接受。方案 B 涉及 `encryption_key` 等安全敏感数据，需区分可缓存/不可缓存 key，改动面大。

---

## BP-H2: resolveMapping 每次迭代查 DB

### 当前实现

`failover-loop.ts` 每次 while 迭代调用 `resolveMapping(db, clientModel, ...)`，执行 2-5 次 SQLite 查询。同一次请求内 clientModel 不变，结果不变。

### 方案 A: 拆分 resolveMapping（查 DB + 过滤分离）
- 改动范围：`mapping-resolver.ts` + `failover-loop.ts`

### 方案 B: 首次缓存 resolveResult，循环内只过滤 excludedTargets
- 在 failover-loop 循环外缓存首次结果
- 改动范围：仅 `failover-loop.ts`

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 性能收益 | 高 | 高 |
| 实现复杂度 | 中（API 变更） | 低 |

### 推荐：方案 B
理由：不改 `resolveMapping` 公共 API，只缓存首次结果。excludeTargets 过滤逻辑不变。

---

## BP-H3: API Key 每次迭代重复 AES 解密

### 当前实现

每次迭代 `decrypt(provider.api_key, encryptionKey)` + `getSetting(db, "encryption_key")`。

### 方案 A: 请求级缓存（Map<provider_id, apiKey>）
- 循环外缓存，同一 provider 只解密一次
- 改动范围：`failover-loop.ts`

### 方案 B: 应用级 API Key 缓存
- 全局缓存 + admin 更新时刷新
- 改动范围：新增缓存模块

### 推荐：方案 A
理由：零风险，不需要管理缓存生命周期。方案 B 涉及明文 API Key 安全考量。

---

## BP-H4: 日志 JSON.stringify 重复

### 当前实现

循环内 3 次 `JSON.stringify`：`reqBodyStr`、`clientReq`（每次一样！）、`upstreamReqBase`。

### 方案 B（推荐）: 预计算循环外不变量
- 将 `clientReq` 和 `sanitizeHeadersForLog(cliHdrs)` 移到循环外
- 改动范围：`failover-loop.ts`
- 风险：**极低**（纯代码移动）

---

## BP-H5: excludedTargets O(N×M) 过滤

### 方案 A: 用 Set 替代线性查找
- `new Set(excludedTargets.map(t => `${provider_id}:${backend_model}`))`
- 风险：**低**（key 构造函数统一提取）

---

## BP-M2: SSE \r\n 每个 chunk 正则替换

### 方案 A: 仅在包含 \r 时替换
- `if (chunk.includes('\r'))` 条件判断
- 风险：**低**（保留对已有 CRLF 测试用例的兼容）

---

## BP-M3: Buffer.concat 每 chunk 调用

### 方案 A: 累积长度检查 + 延迟 concat
- 维护 `totalBuffered` 计数器，只在达到阈值或检测到 `\n\n` 时做 concat
- 风险：**低**

### 方案 B: 用字符串缓冲代替 Buffer
- 风险：**中**（多字节 UTF-8 跨 chunk 边界可能产生 replacement character）

### 推荐：方案 A

---

## BP-M5: parseModels 无缓存

### 方案 A: Map<string, ModelEntry[]> 缓存
- 在 `parseModels` 内部加缓存，key 为 raw 字符串
- admin 更新 provider models 时 raw 变化，自动失效
- 风险：**低**

---

## BP-M6: collectTransportMetrics 重复 cache estimation

### 方案 A: 从 metadata 读取 hook 已计算的结果
- `collectTransportMetrics` 增加 cache metadata 参数
- 保留 fallback（metadata 无结果时仍做估算）
- 风险：**低**

---

## 实施优先级

| 优先级 | 编号 | 推荐 | 预估改动 | 风险 |
|--------|------|------|---------|------|
| P0 | BP-C1 | 方案 A：全局 keep-alive Agent | ~20 行 | 低 |
| P0 | BP-H4 | 方案 B：预计算循环外不变量 | ~10 行 | 极低 |
| P0 | BP-M5 | 方案 A：parseModels 缓存 | ~10 行 | 低 |
| P1 | BP-H3 | 方案 A：请求级 API Key 缓存 | ~10 行 | 低 |
| P1 | BP-H1 | 方案 A：TTL 缓存 | ~15 行 | 低 |
| P1 | BP-H2 | 方案 B：缓存 resolveResult | ~15 行 | 低 |
| P1 | BP-C2 | 方案 A：metadata 缓存 tokenize | ~20 行 | 低 |
| P1 | BP-M6 | 方案 A：metadata 透传 | ~15 行 | 低 |
| P2 | BP-C3 | 方案 B：浅拷贝 | ~20 行 | 中 |
| P2 | BP-M2 | 方案 A：条件替换 | ~3 行 | 低 |
| P2 | BP-H5 | 方案 A：Set 替代 | ~10 行 | 低 |
| P2 | BP-M3 | 方案 A：累积长度 | ~15 行 | 低 |
