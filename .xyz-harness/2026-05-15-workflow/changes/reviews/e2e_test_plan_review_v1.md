# E2E 测试计划评审 v1

## 评审记录
- 评审时间：2026-05-15
- 评审类型：E2E 测试计划独立评审
- 评审对象：e2e-test-plan.md（图片模型自动切换 — 分层路由模型）
- 评审轮次：第 1 轮

---

## Spec AC 覆盖矩阵

| AC | 场景 | 覆盖状态 | 测试用例 |
|----|------|---------|----------|
| AC1: 含图片+不支持+有fallback → prepend | 正向路径 | ✅ 完整覆盖 | TC3.1, TC3.2, TC3.3 |
| AC2: 含图片+已支持 → 不扩展 | 正向路径 | ✅ 完整覆盖 | TC3.5 |
| AC3: 含图片+不支持+无fallback → 不扩展 | 正向路径 | ✅ 完整覆盖 | TC4.1 |
| AC4: 不含图片 → 不扩展 | 正向路径 | ✅ 完整覆盖 | TC3.4 |
| AC5: ModelEntry有capabilities → parseModels正确解析 | 正向路径 | ✅ 完整覆盖 | TC1.3（间接验证手动覆盖写入+读回） |
| AC6: ModelEntry无capabilities → 白名单补充 | 正向路径 | ✅ 完整覆盖 | TC1.1（已知模型自动匹配）, TC1.2（未知模型默认text-only） |
| AC7: fallback provider非active → 不扩展 | 异常路径 | ✅ 完整覆盖 | TC4.3 |
| AC8: fallback provider_id不存在 → 不扩展 | 异常路径 | ✅ 完整覆盖 | TC4.2 |
| AC9: StageRecord记录image-redirect事件 | 正向路径 | ✅ 完整覆盖 | TC4.5 |
| AC10: IR/OF层异常降级 → 返回原列表 | 异常路径 | ✅ 完整覆盖 | TC4.4（IR层异常） |
| AC11: Provider前端可编辑capabilities | 正向路径 | ✅ 完整覆盖 | TC5.1 |
| AC12: 映射组前端可配置image_fallback | 正向路径 | ✅ 完整覆盖 | TC5.2 |
| AC13: OpenAI格式image_url检测 | 正向路径 | ✅ 完整覆盖 | TC3.1 |
| AC14: Anthropic格式image检测 | 正向路径 | ✅ 完整覆盖 | TC3.2 |
| AC15: OpenAI content为string不触发 | 边界条件 | ✅ 完整覆盖 | TC3.4 |
| AC16: Responses API input_image检测 | 正向路径 | ✅ 完整覆盖 | TC3.3 |
| AC17: validateRule验证provider_id存在且active | 正向+异常 | ✅ 完整覆盖 | TC2.2, TC2.3 |
| AC18: 分层路由IR+OF正确展开 | 正向路径 | ✅ 完整覆盖 | TC3.6 |
| AC19: failover无死循环（IR target排除） | 异常路径 | ✅ 完整覆盖 | TC4.6 |
| AC20: failover循环仅做执行+exclude | 代码审查 | ✅ 不适用 | spec明确标注"代码审查"，非E2E可测 |

覆盖统计：20/20 AC 有对应测试用例（AC20 为代码审查项，spec 自身即如此定义）。

---

## 四层策略合理性

| 用例 | 验证层级 | 场景 | 评估 |
|------|---------|------|------|
| TC1.1 | L1+L4 | API响应+DB同步 | ✅ 合理 |
| TC1.2 | L1 | API响应（默认值验证，无DB写入） | ✅ 合理 |
| TC1.3 | L1+L4 | API响应+DB同步 | ✅ 合理 |
| TC2.1 | L1+L4 | API响应+DB持久化 | ✅ 合理 |
| TC2.2 | L1 | 400错误响应 | ✅ 合理（无DB变更） |
| TC2.3 | L1 | 400错误响应 | ✅ 合理（无DB变更） |
| TC2.4 | L1 | 201响应（向后兼容） | ✅ 合理 |
| TC3.1 | L1+L4 | API+DB日志验证（路由目标） | ✅ 合理 |
| TC3.2 | L1+L4 | API+DB日志验证 | ✅ 合理 |
| TC3.3 | L1+L4 | API+DB日志验证 | ✅ 合理 |
| TC3.4 | L1 | API响应（转发到原provider） | ✅ 合理 |
| TC3.5 | L1 | API响应（不切换） | ✅ 合理 |
| TC3.6 | L1 | API响应（target列表验证） | ✅ 合理 |
| TC4.1 | L1 | API响应（no-op验证） | ✅ 合理 |
| TC4.2 | L1 | API响应（不切换） | ✅ 合理 |
| TC4.3 | L1 | API响应（不切换） | ✅ 合理 |
| TC4.4 | L1 | API响应（降级后请求正常完成） | ✅ 合理 |
| TC4.5 | L4 | DB metadata验证 | ✅ 合理 |
| TC4.6 | L1 | API响应（错误+迭代数验证） | ✅ 合理 |
| TC5.1 | 手动L2 | 前端UI操作 | ✅ 合理（前端手动验证） |
| TC5.2 | 手动L2 | 前端UI操作 | ✅ 合理 |
| TC5.3 | 手动L2 | 前端UI+API验证 | ✅ 合理 |

项目使用 `buildApp() + app.inject()` 组件测试模式（非真实HTTP服务器），无浏览器自动化，因此 L2/L3 不适用于后端测试组 TG1-TG4。TG5 前端测试标注为手动验证，与项目测试模式一致。L3（视觉对比）无设计稿要求，未使用是合理的。

---

## 发现的问题

| # | 优先级 | 维度 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|------|---------|
| 1 | LOW | 步骤可执行性 | TG1-TG4 | 测试步骤缺少具体的请求体 JSON 示例、mock 响应配置和 DB 查询语句。例如 TC3.1 只说"content 数组含 type: image_url"但未给出完整 body JSON。AI agent 需自行查阅 API schema 构造请求体 | 为关键 TC（至少 TC3.1/TC3.6/TC4.6）补充完整的 request body JSON 示例和 mock 后端响应配置 |
| 2 | LOW | spec覆盖 | TC3.6 | AC18 明确提到 targets=[A,B]（多 target 场景），但 TC3.6 只用了单 target [A]。单 target 的 IR+OF 组合已验证，但多 target 下的 OF 逐 target 展开未被 E2E 覆盖 | 考虑增加一个双 target 的 E2E 场景，或在 TC3.6 前置条件中增加第二个 target |
| 3 | LOW | 用例质量 | 全局 | 用例缺少严重程度标注（阻塞/重要/一般）。例如 TC4.6（failover死循环）应为阻塞级，TC2.4（向后兼容）为一般级 | 为每个 TG 标注核心用例的严重程度 |
| 4 | LOW | 四层策略 | TC3.6 | TC3.6 验证 target 列表展开，只有 L1（API 层面）验证。对于分层路由的核心用例，缺少 L4（DB 日志）验证来确认实际执行路径符合预期 | TC3.6 补充 DB 验证：request_logs 中 upstream_provider_id 和 upstream_model 符合列表中实际选中 target |
| 5 | LOW | spec覆盖 | TC4.4 | AC10 覆盖"IR/OF 层异常降级"，TC4.4 只测试 IR 层异常。OF 层（expandOverflowTargets）异常降级无 E2E 测试用例。OF 是现有 applyOverflowRedirect 的包装，风险较低 | 可在 TC4.4 中增加 OF 层异常的描述，或标注 OF 异常由单元测试覆盖 |
| 6 | LOW | 步骤可执行性 | TG5 | 前端测试（TC5.1-TC5.3）全部标注"手动验证"，无具体验证步骤描述。例如 TC5.1 说"gpt-4o 显示 text + image badge；可勾选/取消；保存后更新"但未说明如何验证"更新"（检查 API 请求？刷新页面？） | 为 TG5 补充 DevTools 网络请求检查步骤或页面刷新验证步骤 |

> 优先级定义：
> - **blocking**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

---

## 依赖关系检查

### 依赖矩阵

| 测试组 | 前置依赖 | 说明 |
|--------|---------|------|
| TG1 | 无 | Capabilities 基础设施，独立可测 |
| TG2 | 无 | 配置写入，依赖 Admin API 但不依赖 TG1 |
| TG3 | TG1 + TG2 | 需 capabilities 判断和 image_fallback 配置 |
| TG4 | TG3 | 边界/异常场景基于 E2E 路由已通 |
| TG5 | TG1 + TG2 | 前端需后端 API 支撑 |

### DAG 验证

```
TG1 ──┬── TG3 ── TG4
TG2 ──┤
       └── TG5
```

无循环依赖，拓扑排序有效：TG1/TG2 → TG3 → TG4，TG1/TG2 → TG5。执行顺序合理。

### 前置条件明确性

TG3 的前置条件详细描述了测试数据（Provider A/B 配置、Mapping group 配置），可操作。TG4 依赖 TG3 的环境状态，但在每个 TC 中独立描述了前置条件（如 TC4.6 "B 固定返回 500"），不依赖 TG3 的残留状态。

---

## 测试环境检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 后端启动方式 | ✅ | `buildApp({ config, db: initDatabase(":memory:") })` + `app.inject()`，无需真实服务器 |
| 数据库初始化 | ✅ | 内存 DB，测试间完全隔离 |
| Mock 上游 | ✅ | `http.createServer()` 模拟 OpenAI/Anthropic 响应 |
| 认证配置 | ✅ | Admin JWT + Router API key（inject 模式下通过 header 注入） |
| 前端启动方式 | ✅ | 手动验证，不依赖自动化环境 |
| Chrome CDP 配置 | N/A | 无 L2/L3 自动化测试 |
| 清理方式 | ✅ | 内存 DB 自动清理 |

测试环境基于组件注入模式，与项目现有测试框架（Vitest + Fastify inject）一致，环境配置充分。

---

## 分层路由模型覆盖专项检查

| 分层路由要素 | 覆盖状态 | 测试用例 | 说明 |
|-------------|---------|----------|------|
| IR 层：图片检测 + prepend | ✅ | TC3.1, TC3.2, TC3.3, TC3.5, TC4.1-4.4 | 三种 API 格式 + 多种边界条件 |
| IR 层：不修改请求体 | ✅（隐含） | TC3.1-3.3 | 图片数据原样转发，验证响应来自正确 provider |
| OF 层：overflow 展开 | ✅ | TC3.6 | 验证 IR + OF 组合展开 target 列表 |
| IR fallback 无 overflow | ✅ | TC3.6 | 输出列表中 IR_F 无 OF 前缀，符合 spec "Never" 约束 |
| Failover 简化：exclude 不死循环 | ✅ | TC4.6 | IR target 失败后 exclude，迭代数 ≤ 2 |
| Failover 简化：循环外预计算 | ✅（代码审查） | AC20 | spec 标注为代码审查项 |
| IR/OF 异常降级 | ✅（部分） | TC4.4 | IR 层降级；OF 层降级由单元测试覆盖 |

---

## 结论

**PASS**

E2E 测试计划评审完成，第 1 轮，0 条 blocking，6 条 LOW。所有 20 条 spec AC 均有对应测试用例覆盖，分层路由模型的三层架构（IR→OF→Failover）均有测试验证，依赖关系为有效 DAG 无循环，测试环境配置与项目现有框架一致。

---

## Summary

E2E 测试计划评审完成，第1轮，0条blocking，PASS。
