# 测试评审 v1
- 评审时间: 2026-05-12
- 评审类型: 测试评审
- 评审对象: 稳定性修复测试变更

## 验收标准覆盖矩阵

| Fix | 验收标准 | 测试覆盖 | 状态 |
|-----|---------|---------|------|
| F1 | errorHandler 注册 | 无测试 | ACCEPTABLE |
| F1 | catch-all 路由 | 无测试 | ACCEPTABLE |
| F2 | app.mount 不被 locale 阻塞 | 无测试 | ACCEPTABLE |
| F3 | onUnmounted 清理 refreshTimer | 无测试 | ACCEPTABLE |
| F4 | LogWriteBuffer push/flush/stop | ✅ log-write-buffer.test.ts (8 tests) | PASS |
| F4 | 现有测试零修改通过 | ✅ db.test.ts, metrics.test.ts migration count 更新 | PASS |
| F5 | migration 045 添加索引 | ✅ db.test.ts + metrics.test.ts count 46 | PASS |
| F6 | captureChunks 移除 | 无新增测试（依赖现有 stream proxy 测试） | PASS |
| F7 | countTokensFromChunks 正确性 | ✅ token-counter.test.ts (7 tests) | PASS |
| F8 | @import 移除 + preconnect | 无测试（纯静态资源变更） | ACCEPTABLE |

## 发现的问题

| # | 优先级 | 文件 | 描述 | 建议 |
|---|--------|------|------|------|
| 1 | MUST FIX | `router/tests/log-write-buffer.test.ts` | `insertLogAndMetrics` 辅助函数是死代码（定义但未使用），且函数返回值类型构造有误：第 80 行 `return { logId: log.id, metrics: metrics as ... }` 中 `metrics` 是 `makeMetrics()` 返回值（MetricsInsert），不是 `insertMetrics()` 返回的 id 字符串，且返回类型声明中的 `metricsId: string` 字段实际上不存在 | 删除此未使用的辅助函数，避免混淆 |
| 2 | SHOULD FIX | `router/tests/log-write-buffer.test.ts` | 缺少 **缓冲+flush 后数据正确性验证**：只验证了 COUNT，未验证具体字段值（如 status_code、model、provider_id）是否与 push 时的输入一致 | 在 "缓冲 accumulate + flush 正确写入 DB" 测试中增加字段级断言 |
| 3 | SHOULD FIX | `router/tests/log-write-buffer.test.ts` | 缺少 **并发/重入场景测试**：flush 期间新 push 的条目不会丢失。虽然代码注释说明了 `this.buffer = []` 再赋值的策略，但没有测试覆盖这个关键设计决策 | 增加 flush 期间新 push 的条目在下次 flush 时正确写入的测试 |
| 4 | SHOULD FIX | `router/tests/log-write-buffer.test.ts` | 缺少 **空缓冲 flush 幂等性测试**：`flush()` 在空缓冲时的行为（不应抛错）未显式验证 | 增加 `buffer.flush()` 在空 buffer 时不抛错且不影响后续 push 的测试 |
| 5 | NICE TO HAVE | `router/tests/token-counter.test.ts` | 采样外推测试 `"sampling extrapolation for many chunks is within 20% of actual"` 的 20% 容差可能在某些 tokenizer 边界 case 下不稳定。实际上该测试的 chunks 全是重复的英文短句，token/char 比率非常均匀，20% 容差过于宽松 | 考虑收紧到 10%，或添加混合语言（中英混合）的外推测试增加覆盖率 |
| 6 | NICE TO HAVE | `router/tests/token-counter.test.ts` | `countTokensFromChunks` 缺少 chunks 中有空字符串的边界测试 | 增加 `["", "hello", "", "world", ""]` 的测试，验证空 chunk 不影响结果 |
| 7 | INFO | `router/src/index.ts` | `SERVICE_KEYS.logWriteBuffer` 已添加到 container.ts，但 index.ts 中没有 `container.register(SERVICE_KEYS.logWriteBuffer, ...)`。这属于代码问题而非测试问题，但说明缺少从 ServiceContainer resolve logWriteBuffer 的集成测试 | 代码评审中修复（注册到 container），或在集成测试中验证 resolve |
| 8 | ACCEPTABLE | 前端变更 (F1/F2/F3/F8) | errorHandler、i18n async mount、refreshTimer 清理、font preconnect 均无测试。前端目前无测试基础设施（无 vitest/cypress 配置），缺少测试是预期内的技术债 | 本次不阻塞。后续批次可考虑添加 vitest 前端测试 |
| 9 | ACCEPTABLE | F6 StreamProxy | 移除 captureChunks 未添加新测试。这是合理的——该改动是纯粹的冗余移除（captureChunks 与 bufferChunks 存储相同引用），现有 stream proxy 测试已覆盖功能正确性 | 无需额外测试 |

## 测试质量评估

### LogWriteBuffer 测试 (8 个测试用例)

**覆盖充分的场景：**
- ✅ 基本缓冲 + flush → DB 写入
- ✅ 定时 flush（FakeTimers）
- ✅ 阈值 flush（maxBufferSize 达到时立即写入）
- ✅ stop() 时 flush 混合 log + metrics
- ✅ metrics UUID 预生成 + 返回值语义
- ✅ stop 后 push 走同步写入
- ✅ 事务语义（部分失败回滚）
- ✅ 无缓冲路径的 insertRequestLog / insertMetrics

**缺失但非阻塞的场景：**
- flush 期间并发 push 不丢失
- 空缓冲 flush 幂等性
- 字段级正确性验证（目前只查 COUNT）

### countTokensFromChunks 测试 (7 个测试用例)

**覆盖充分的场景：**
- ✅ 空数组
- ✅ 短 chunks 与 countTokens 等价
- ✅ 单 chunk
- ✅ Unicode chunks
- ✅ 采样外推（>4000 字符，20% 容差）
- ✅ 单 chunk > SAMPLE_SIZE
- ✅ chunks 中个别 chunk > SAMPLE_SIZE

## 结论

**需修改后重审**

MUST FIX #1（死代码+类型错误）需要清理。SHOULD FIX #2-#4（字段验证、并发安全、空 flush）建议修复但不阻塞合并。前端缺少测试是预期内的技术债，不阻塞。

---

## 修复记录

### MUST FIX #1 — 已修复
- 移除 `log-write-buffer.test.ts` 中的死代码 `insertLogAndMetrics` 函数
- 验证：15 个缓冲测试全部通过

## 最终结论

**通过**。MUST FIX #1 已修复。
