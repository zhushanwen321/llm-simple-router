# 测试评审报告 — 监控 recent 接口性能优化

**评审模式**: 测试评审（阶段⑥）
**评审轮次**: 第 1 轮
**评审对象**:
- 单元测试: `router/tests/core/monitor/request-tracker-details.test.ts`（新增 404 行）
- 集成测试: `router/tests/admin-monitor.test.ts`（新增 ~100 行）
- 生产代码接口变更: `router/src/index.ts`（暴露 tracker）

**日期**: 2026-05-10

---

## AC 覆盖矩阵

| AC | 条件 | 单元测试 | 集成测试 | 覆盖状态 |
|----|------|---------|---------|---------|
| AC1 | `getRecent()` 返回无 clientRequest/upstreamRequest | ✅ `test_complete_recentCompleted_noClientRequest_字段被剥离` | ✅ `completed 请求不包含 clientRequest 和 upstreamRequest` | 完整 |
| AC2 | `getRequestById()` completed 请求返回完整数据（TTL 内） | ✅ `test_getRequestById_completed_合并clientRequest和upstreamRequest` + `test_getRequestById_completed_返回完整摘要加详情` | ✅ `completed 请求仍返回 clientRequest 和 upstreamRequest` | 完整 |
| AC3 | detailsMap TTL 过期后同步清理 | ✅ `test_cleanupRecent_清理过期的completedDetails条目` + `test_cleanupRecent_未过期条目保留在completedDetails中` | — | 充分（见 LOW-1） |
| AC4 | broadcast strip upstreamRequest | ✅ 三个事件类型均有覆盖 | — | 完整 |
| AC5 | 响应体 < 1MB | —（spec 标注手动验证） | — | 按设计不测 |
| AC6 | pending 请求 getRequestById 行为不变 | ✅ `test_getRequestById_pending_返回完整数据` | ✅ `pending 请求保留 clientRequest 和 upstreamRequest` | 完整 |

**结论**: AC1-AC4、AC6 均有单元测试覆盖，AC1/AC2/AC6 额外有集成测试验证 API 端点级行为。AC5 按 spec 标注为手动验证。覆盖度充分。

---

## 评审结果

### MUST FIX: 0 条

无阻断性问题。

### LOW: 3 条

#### LOW-1: cleanup TTL 测试仅验证内部状态，未验证 getRequestById() 的外部行为

**文件**: `router/tests/core/monitor/request-tracker-details.test.ts`，`test_cleanupRecent_清理过期的completedDetails条目`

**现状**: 测试通过 `(tracker as any).completedDetails` 直接访问内部 Map，断言 `completedDetails.has("r-expired")` 为 false。

**问题**: 测试验证了内部实现细节（completedDetails Map 的状态），而非用户可观察的行为（`getRequestById()` 在 TTL 过期后返回什么）。如果实现重构了 detailsMap 的存储方式，此测试会误报。

**建议**: 在现有断言之后，补充 `getRequestById("r-expired")` 的断言，验证其返回 undefined 或返回的对象不含 clientRequest/upstreamRequest。这使测试面向行为而非面向实现。

#### LOW-2: 淘汰测试对最旧条目的断言过于宽松

**文件**: `router/tests/core/monitor/request-tracker-details.test.ts`，`test_completedDetails_淘汰最旧条目后getRequestById仍能返回较新的`

**现状**:
```typescript
const oldest = tracker.getRequestById("req-evict-0");
if (oldest) {
  expect(oldest.clientRequest).toBeUndefined();
}
```

**问题**: 创建了 205 个请求，`recentCompleted` 上限为 200，所以 `req-evict-0` 应已从 `recentCompleted` 和 `completedDetails` 中被淘汰。`getRequestById` 应返回 undefined。但 `if (oldest)` 使断言变成条件性的——当 `oldest` 确实为 undefined 时，整个 `if` 块被跳过，等于没有对淘汰行为做任何断言。

**建议**: 将 `if` 改为显式断言：
```typescript
const oldest = tracker.getRequestById("req-evict-0");
expect(oldest).toBeUndefined();  // 最旧条目应被完全淘汰
```
或者如果意图是测试"recent 中还可能存在但详情丢失"的中间状态，需要构造不同的数据量（如恰好 201 条），并添加注释说明期望。

#### LOW-3: 无 clientRequest 的测试通过 delete 操作绕过正常路径

**文件**: `router/tests/core/monitor/request-tracker-details.test.ts`，`test_getRequestById_completed_无clientRequest时返回undefined字段`

**现状**: 测试先调用 `createActiveRequest()` 创建带默认 clientRequest/upstreamRequest 的对象，然后通过 `delete` 删除属性，再调用 `complete()`。

**问题**: `createActiveRequest` helper 始终设置 clientRequest/upstreamRequest（默认值 `{"model":"gpt-4","messages":[...]}`），测试通过手动 delete 绕过。生产中更可能的场景是 start() 时就不携带这些字段（如某些 API 请求体为空）。当前测试路径偏离了生产路径。

**建议**: 在 `createActiveRequest` helper 中支持 `clientRequest: undefined` 不设置该属性（而不是设置后再删除），或者在 helper 之外直接构造不含这些字段的 ActiveRequest 对象。

---

## 测试质量总结

| 维度 | 评价 |
|------|------|
| 覆盖度 | 充分。6 个 AC 中 5 个有自动化测试，1 个为手动验证。单元测试 + 集成测试双层覆盖 |
| 断言充分性 | 良好。核心场景（字段剥离、合并返回、TTL 清理、SSE 脱敏）均有明确断言 |
| 数据构造 | 合理。使用 factory helper 构造测试数据，集成测试使用 JSON.stringify 构造真实请求体 |
| 可维护性 | 良好。测试按 describe 分组，命名描述性强（中文），helper 函数复用合理 |
| 脆弱性 | LOW-1 中的 `(tracker as any).completedDetails` 直接访问私有属性，重构时可能需同步修改 |

---

## 结论

**通过**。无 MUST FIX 问题。3 条 LOW 问题均为测试质量改进建议，不影响测试对核心行为的验证正确性。
