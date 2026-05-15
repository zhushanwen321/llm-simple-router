# E2E Test Plan: 映射原因追踪 (Mapping Reason Tracking)

## 测试环境

- 使用现有 `buildApp({ config, db })` + `app.inject()` 集成测试模式
- Mock 后端：`http.createServer()` 模拟 OpenAI/Anthropic 响应
- 内存数据库：`initDatabase(":memory:")`
- 前端：手动验证（项目无 Playwright/Cypress 基础设施）

## 依赖图

```
TG1 (基础类型 + resolveMapping) ← 无依赖
  ↓
TG2 (pipeline_snapshot 写入) ← 依赖 TG1
  ↓
TG3 (SSE 推送) ← 依赖 TG2
  ↓
TG4 (前端展示) ← 依赖 TG3，手动验证
```

---

## TG1: resolveMapping 映射原因正确性（单元级集成）

**目标**: 验证 6 种映射原因在正确的路径下产生。

### TC1.1: direct_format

**前置**: 插入 provider（name=deepseek），其 models 包含 deepseek-chat
**操作**: 发送 `model: "deepseek/deepseek-chat"` 的请求
**验证**:
| 层 | 断言 |
|----|------|
| API | 响应 status=200，转发到 deepseek provider |
| DB | `SELECT pipeline_snapshot FROM request_logs WHERE id=?` → 解析 JSON → routing stage `mapping_reason = "direct_format"` |

### TC1.2: group_base_rule

**前置**: 插入 mapping_group（strategy=scheduled），rule 包含 base targets，**无 schedule 或 schedule 时间不匹配**
**操作**: 发送 `model: "gpt-4"` 的请求（匹配映射组）
**验证**:
| 层 | 断言 |
|----|------|
| API | 响应 status=200 |
| DB | pipeline_snapshot routing stage `mapping_reason = "group_base_rule"` |

### TC1.3: group_schedule

**前置**: 插入 mapping_group，配置 schedule（start_hour=0, end_hour=24，确保全天匹配），schedule 的 targets 与 base 不同。集成测试无法注入固定时间，使用全天窗口避免时间依赖
**操作**: 发送匹配映射组的请求
**验证**:
| 层 | 断言 |
|----|------|
| API | 响应 status=200，转发到 schedule 指定的 target |
| DB | pipeline_snapshot routing stage `mapping_reason = "group_schedule"` |

### TC1.4: fallback_provider

**前置**: 无映射组。插入 provider，其 models 包含 "claude-3-haiku"
**操作**: 发送 `model: "claude-3-haiku"` 的请求
**验证**:
| 层 | 断言 |
|----|------|
| API | 响应 status=200 |
| DB | pipeline_snapshot routing stage `mapping_reason = "fallback_provider"` |

### TC1.5: overflow_redirect（依赖 TC1.2 配置模式，扩展 overflow 字段）

**前置**: 映射组 target 配置了 `overflow_provider_id` 和 `overflow_model`，context_window=200（参照 `overflow-redirect.test.ts` 的 setup 模式，使用 `buildTestApp` + `insertProvider` + `insertMappingGroup` helper）
**操作**: 发送 `"A ".repeat(400)` 的消息内容触发 overflow
**验证**:
| 层 | 断言 |
|----|------|
| API | 响应 status=200，转发到 overflow target |
| DB | pipeline_snapshot overflow stage `triggered = true`；routing stage `mapping_reason` 为原始原因（如 group_base_rule） |
| Tracker | 请求完成后调用 `GET /admin/api/monitor/recent` API，返回的 ActiveRequest 中 `mappingReason = "overflow_redirect"` |

### TC1.6: failover_retry（依赖 TC1.2 配置模式，扩展为多 target）

**前置**: 映射组有 2+ targets，第一个 target 对应的 mock 后端返回 500
**操作**: 发送请求，触发 failover 到第二个 target
**验证**:
| 层 | 断言 |
|----|------|
| API | 最终响应 status=200（第二个 target 成功） |
| DB | `SELECT pipeline_snapshot FROM request_logs WHERE is_failover = 1 AND original_request_id = ? ORDER BY created_at DESC LIMIT 1` → routing stage `mapping_reason = "failover_retry"` |
| Tracker | 请求完成后 `GET /admin/api/monitor/recent` 返回的 ActiveRequest 中 `mappingReason = "failover_retry"` |

---

## TG2: pipeline_snapshot 完整性

**目标**: 验证 mapping_reason 写入 pipeline_snapshot 后的数据完整性。

### TC2.1: routing stage 包含 mapping_reason

**前置**: 任意映射配置
**操作**: 发送请求
**验证**:
| 层 | 断言 |
|----|------|
| DB | `pipeline_snapshot` JSON 解析后，routing stage 包含 `mapping_reason` 字段（string 类型） |
| DB | routing stage 同时包含 `client_model`、`backend_model`、`provider_id`、`strategy`（已有字段不受影响） |

### TC2.2: overflow 双记录

**前置**: TC1.5 的配置
**操作**: 发送触发 overflow 的请求
**验证**:
| 层 | 断言 |
|----|------|
| DB | pipeline_snapshot 包含两个 stage：routing（含原始 mapping_reason）和 overflow（triggered=true, redirect_to, redirect_provider） |
| DB | 两个 stage 的数据一致性：overflow.redirect_to 等于实际转发的 backend_model |

### TC2.3: 历史数据兼容

**前置**: 插入一条无 mapping_reason 的旧格式 pipeline_snapshot（模拟历史数据）
**操作**: 通过 API 查询该日志详情
**验证**:
| 层 | 断言 |
|----|------|
| API | 响应 status=200，正常返回 pipeline_snapshot JSON |
| 前端 | 请求详情中不显示映射原因 Badge（手动验证） |

---

## TG3: ActiveRequest mappingReason 验证（通过 API）

**目标**: 验证 mappingReason 写入 ActiveRequest 并可通过 `/admin/api/monitor/recent` API 读取。

**说明**: 不使用独立 SSE 监听，而是在 TG1 的集成测试中，发送代理请求后调用 `GET /admin/api/monitor/recent` 验证 ActiveRequest.mappingReason。与 TG1 合并到同一测试文件中执行。

### TC3.1: request_complete 后 ActiveRequest 携带 mappingReason

**前置**: 任意 TG1 测试完成后，DB 和 tracker 中有已完成请求
**操作**: 调用 `GET /admin/api/monitor/recent` API
**验证**:
| 层 | 断言 |
|----|------|
| API | 响应 JSON 中对应的 ActiveRequest 包含 `mappingReason`（非 undefined） |
| 一致性 | `mappingReason` 值与该请求 DB 中 pipeline_snapshot routing stage 的 `mapping_reason` 一致 |

### TC3.2: request_start 时 mappingReason 为 undefined

**前置**: 构造一个长时间运行的请求（mock 后端延迟响应）
**操作**: 请求进行中时调用 `GET /admin/api/monitor/recent`
**验证**:
| 层 | 断言 |
|----|------|
| API | 活跃请求的 ActiveRequest 中 `mappingReason` 为 undefined（映射在 orchestrator 内部完成，start 时未填充） |

---

## TG4: 前端展示（手动验证）

**目标**: 验证请求详情中映射原因 Badge 正确展示。

### TC4.1: Logs 页面映射原因展示

**前置**: 完成后端所有 TG1-TG3 测试，确保 DB 中有带 mapping_reason 的日志
**操作**: Logs 页面打开请求详情
**验证**:
| 层 | 断言 |
|----|------|
| DOM | model@provider 行下方存在 Badge 元素 |
| DOM | Badge 文本为映射原因的中文标签（如"分时段规则"） |
| Visual | Badge 使用 variant="secondary" 样式，灰色背景，不抢夺视觉焦点 |

### TC4.2: Monitor 页面映射原因展示

**前置**: 同上，Monitor 页面有已完成请求
**操作**: Monitor 页面打开请求详情
**验证**:
| 层 | 断言 |
|----|------|
| DOM | 与 TC4.1 相同的 Badge 展示 |
| 一致性 | Logs 和 Monitor 打开同一请求，映射原因 Badge 文本完全一致 |

### TC4.3: 历史数据无 Badge

**前置**: 打开 TC2.3 中创建的历史日志详情
**操作**: 查看请求详情
**验证**:
| 层 | 断言 |
|----|------|
| DOM | model@provider 行下方**无** Badge 元素 |
| Console | 无报错信息 |

---

## 自动化测试文件

| 文件 | 覆盖 TC | 说明 |
|------|--------|------|
| `tests/mapping-reason.test.ts`（新建） | TC1.1-1.4, TC2.1, TC2.3, TC3.1, TC3.2 | resolveMapping 4 种原因 + 历史兼容 + ActiveRequest 验证。复用 `tests/helpers/` 下的 `createMockBackend`、`seedSettings` 等 helper |
| `tests/mapping-reason-overflow.test.ts`（新建） | TC1.5, TC2.2 | overflow 双记录。参照 `overflow-redirect.test.ts` 的 `buildTestApp` + `insertProvider` + `insertMappingGroup` 模式 |
| `tests/mapping-reason-failover.test.ts`（新建） | TC1.6 | failover 重试。参照现有 failover 测试的 setup 模式 |
| 前端 `parseMappingReason` 单元测试 | TC2.3 解析逻辑 | 防御性解析 6 种场景 |
| 手动验证 | TC4.1-4.3 | 前端 Badge 展示 |
