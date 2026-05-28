---
verdict: "pass"
must_fix: 0
reviewer: robustness-reviewer
date: 2026-05-28
scope:
  - router/src/proxy/routing/modality-redirect.ts
  - router/src/proxy/handler/failover-loop.ts (L219-L232)
---

# 健壮性审查报告 v1

## 审查范围

| 文件 | 变更摘要 |
|------|---------|
| `modality-redirect.ts` | 新增 MRL 预计算层：模态检测 → target 过滤 → fallback 替换 |
| `failover-loop.ts` L219-L232 | modality-redirect 返回空列表时的 fail-fast 拒绝分支 |

---

## 六维度评估

### 1. 错误处理 — PASS

**modality-redirect.ts:**

| 场景 | 处理方式 | 判定 |
|------|---------|------|
| targets 为空 | L82 直接返回 `targets`（不进入后续逻辑） | 正确 |
| 无多模态内容 | 返回原始 targets + snapshot | 正确 |
| provider 不存在（getProviderById 返回 null） | L98 保留该 target（安全行为，不过滤） | 正确 |
| 映射组不存在 | 返回 `[]` + snapshot | 正确 |
| rule JSON.parse 失败 | 内嵌 try-catch，返回 `[]` + snapshot | 正确 |
| fallback provider 不存在或 inactive | 返回 `[]` + snapshot | 正确 |
| fallback 不覆盖所需模态 | 返回 `[]` + snapshot | 正确 |
| 任何未预见异常 | 外层 try-catch 返回原始 targets | 正确 |

**failover-loop.ts L219-L232:**

| 场景 | 处理方式 | 判定 |
|------|---------|------|
| allTargets 为空 | 构造完整 RejectParams → `rejectAndReply(errors.unsupportedModality())` | 正确 |

`rejectAndReply` 执行 DB 日志写入 + `reply.code().send()`，保证客户端收到响应，不会挂起。

**结论：** 所有分支都有完整的错误响应路径，无遗漏。

### 2. 异常安全 — PASS

- **外层 try-catch**（`computeModalityRedirectTargets` L152-L178）覆盖全部逻辑，异常时返回原始 targets，不做静默丢弃。
- **内嵌 try-catch**（L131-L140）单独处理 `JSON.parse(group.rule)` 的解析失败，不会因格式错误导致整个函数降级。
- **catch 块内 `snapshot.add`**：理论上若 snapshot 自身异常会逃逸，但这是极低概率的框架级故障，且 snapshot 是简单数组 push 操作，风险可忽略。
- **failover-loop.ts 的空列表分支**：所有变量（`rawBody`、`cliHdrs`、`matcher` 等）在上文已初始化，不存在未定义风险。

**结论：** 异常安全链路完整。

### 3. 日志与诊断 — PASS

| 诊断机制 | 位置 | 覆盖 |
|----------|------|------|
| `console.error` + 完整 error 对象 | catch 块 L153 | 内部异常有堆栈记录 |
| `PipelineSnapshot.add()` | 每个分支 | 8 种不同 reason，记录 stage/triggered/original_model/redirect 信息 |
| `insertRejectedLog` | `rejectAndReply` 内 | 空列表拒绝写入 DB 日志，含 pipelineSnapshot |
| 拒绝日志文件 | `logFileWriter` 通过 rCtx 传入 | 详细请求/响应可追溯 |

`detectModalities` 返回的 modalities 信息在关键 snapshot 中通过 `detected_modalities` 字段传递（`filtered-ineligible-targets`、`replaced-with-fallback` 等），便于排查为什么某些 target 被过滤。

**结论：** 诊断信息充分。

### 4. Fail-fast — PASS

| 检查点 | 位置 | 行为 |
|--------|------|------|
| targets 为空 | L82 | 直接返回，不执行后续检测 |
| 无多模态内容 | L86-L94 | 直接返回，不执行过滤 |
| 全部 target 支持 | L110-L119 | 直接返回，不执行 fallback |
| **调用侧空列表** | failover-loop.ts L219 | **立即 rejectAndReply，不进入 overflow/signal 阶段** |
| allowed_models 过滤 | failover-loop.ts L240+ | MRL 产出的 targets 也要受约束 |

关键设计：`computeModalityRedirectTargets` 返回 `[]` 而非抛异常，调用方在 L219 检测空列表后立即终止，避免进入信号量获取、transport 调用等昂贵操作。

**结论：** Fail-fast 策略正确，无无效计算。

### 5. 测试友好 — PASS

| 组件 | 可测试性 |
|------|---------|
| `detectModalities` | 纯函数，输入 body 输出 Set，零依赖 |
| `computeModalityRedirectTargets` | 接受 db 参数，可用 `:memory:` SQLite 注入 |
| `supportsModality` | 纯函数 |
| failover-loop 空列表分支 | 通过 `buildTestApp()` + mock 后端端到端测试 |

`detectModalities` 独立导出，可以单独写单元测试覆盖 OpenAI/Anthropic/Responses API 三种格式。`computeModalityRedirectTargets` 的 snapshot 参数是 `PipelineSnapshot` 实例，可检查 `.toJSON()` 验证各分支的 stage 记录。

**结论：** 架构对测试友好。

### 6. 调试友好（Snapshot Reason 可区分性）— PASS

所有 snapshot reason 清单：

| Reason | 语义 | triggered |
|--------|------|-----------|
| `no-multimodal-detected` | 请求无多模态内容，未触发过滤 | false |
| `all-targets-support-modalities` | 所有 target 都支持，无需过滤 | false |
| `filtered-ineligible-targets` | 部分过滤，返回 eligible 子集 | true |
| `no-mapping-group` | 映射组不存在，无法查 fallback | false |
| `rule-parse-error` | mapping group rule JSON 解析失败 | false |
| `no-eligible-targets` | 无 fallback 配置 / fallback 无效 / fallback 不支持模态 | false |
| `replaced-with-fallback` | 成功用 fallback 替换 | true |
| `internal-error` | 未预见异常 | false |

**可区分性分析：**

- `triggered=true` 的只有 `filtered-ineligible-targets` 和 `replaced-with-fallback`，一眼区分"部分过滤"和"全部替换"。
- `no-eligible-targets` 出现在 4 个不同位置（无 fallback 配置、字段类型错误、provider 不存在/inactive、模态不匹配），但通过 `redirect_to` / `redirect_provider` 字段是否非空可进一步区分：空值表示"根本没找到 fallback"，非空表示"fallback 存在但不合格"。
- `detected_modalities` 字段在 `filtered-ineligible-targets` 和 `replaced-with-fallback` 中记录，便于回溯具体是哪些模态触发了过滤。

**结论：** Reason 设计充分可区分，结合辅助字段可定位所有分支。

---

## 观察项（非阻塞）

### S1. `no-eligible-targets` 语义过载 [Severity: Low]

4 个不同失败路径都使用 `no-eligible-targets` reason，仅靠 `redirect_to`/`redirect_provider` 是否为空来区分。建议未来拆分为：
- `no-fallback-configured`（无 fallback 对象）
- `fallback-provider-inactive`（provider 不存在或 inactive）
- `fallback-modality-mismatch`（fallback 不覆盖所需模态）

当前不影响线上排查（辅助字段足够区分），但增加了日志分析脚本的复杂度。

### S2. catch 块中 snapshot.add 的理论风险 [Severity: Negligible]

catch 块内调用 `snapshot.add()`，若 snapshot 自身异常（如内存 OOM）会导致异常逃逸，跳过 `return targets` 降级路径。实际风险极低（snapshot.add 是简单 Array.push），不构成修复需求。

---

## 总结

| 维度 | 结果 |
|------|------|
| 错误处理 | PASS — 所有分支有完整错误响应 |
| 异常安全 | PASS — 双层 try-catch，降级到原始 targets |
| 日志诊断 | PASS — console.error + snapshot + DB 日志三重覆盖 |
| Fail-fast | PASS — 空列表立即拒绝，不进入昂贵操作 |
| 测试友好 | PASS — 纯函数抽离 + db 注入 + snapshot 可验证 |
| 调试友好 | PASS — 8 种 distinct reason + 辅助字段可区分 |

**Verdict: PASS**（0 MUST FIX）
