---
phase: dev
verdict: pass
---

# Dev Phase Retrospective — Provider Multi-API-Type

## 1. Phase Execution Review

### Summary

Dev 阶段实现了 Provider 多 API 类型支持，包括：`ProviderEndpoint`/`ResolvedEndpoint` 类型定义、`resolveEndpoint()` 核心解析函数、Admin API 的 endpoints CRUD（含加密/解密/双写兼容）、`failover-loop.ts` 集成、2 条 DB 迁移（051 endpoints 列 + 052 日志字段）、前端 `EndpointEditor.vue` 组件及日志展示。

测试全绿：140 个后端测试文件、1730 个测试用例全部通过，前端 build/lint/type-check 零错误。

### Problems Encountered

**5 维度评审中 2 维 FAIL（TS Taste + Robustness），共 5 项 MUST FIX：**

| 来源 | ID | 问题 | 根因 |
|------|----|------|------|
| TS Taste | M1 | `ApiType` 在 3 个文件中重复定义 | 新增类型时未查现有定义，直接 copy-paste |
| TS Taste | M2 | `failover-loop.ts` 659 行超 500 行硬限 | 已有代码的历史债务，本次变更加剧 |
| TS Taste | M3 | `admin/providers.ts` 使用 eslint-disable 绕过 `taste/no-deprecated-rule-format` | 历史代码，但本次变更未清理 |
| Robustness | MF-1 | `resolveEndpoint` 在 failover 循环内无 try-catch，异常导致 failover 中断 | 编码时遗漏异常边界 |
| Robustness | MF-2 | `parseEndpoints` 不校验 `api_type`/`base_url` 必填字段 | 解析层防御不充分 |

其余 3 个维度（Business Logic / Integration / Standards）均 PASS，0 MUST FIX，仅有 LOW/INFO 级建议。

**重叠问题**：Robustness MF-1 与 TS Taste M2 同根 — `failover-loop.ts` 过大导致遗漏异常处理。BLR LOW-1（legacy 路径空 key）和 Robustness LOW-1 也是同一个问题。说明"防御性编码"在核心路径上覆盖不足。

### What Would You Do Differently

1. **编码前查重类型定义**：新增 `ApiType` 时应先在 `core/types.ts` 中搜索是否已存在同名类型，避免 3 处重复定义。这是 CLAUDE.md "写之前先读" 的直接违反。
2. **核心路径异常防护先行**：`resolveEndpoint` 是 failover 循环的咽喉点，应在实现时就加入 try-catch，而不是留给评审发现。建议在编码 checklist 中加入"循环内调用点是否有异常保护"的检查项。
3. **先修再扩**：`failover-loop.ts` 已超过 500 行，在向其中添加功能前应先拆分。本次直接在里面加 `resolveEndpoint` 调用，导致文件进一步膨胀。

### Key Risks

- **M1（ApiType 重复）风险低但长期维护成本高**：如果未来新增 API 类型（如 `google-genai`），容易漏改某处定义。
- **M2（failover-loop 超限）是持续风险**：文件已 659 行，后续功能扩展（如新的路由策略）会继续膨胀。
- **MF-1 是生产风险**：如果某个 provider 的 endpoints JSON 损坏或密钥损坏，当前代码会让整个 failover 循环崩溃而不是跳过该 target。

---

## 2. Harness Usability Review

### Flow Friction

dev 阶段的 5 维度评审流程运转顺畅，无明显摩擦。评审 subagent 按预期并行执行，输出格式统一（YAML frontmatter + Markdown），便于交叉比较。

### Gate Quality

Gate 正确识别了所有问题：
- 测试全绿 → test_results verdict: pass
- 5 维度评审中 2 维 FAIL → 总体 gate 要求修复 MUST FIX 后重新提交
- 评审间的 issue 重叠（BLR LOW-1 ≈ Robustness LOW-1）是正常的，不同维度从不同角度发现同一问题

无 false positive。

### Prompt Clarity

Stage 描述足够清晰。5 维度（BLR / Standards / TS Taste / Robustness / Integration）的评审 prompt 定义了明确的检查范围和严重度分级标准，subagent 能准确执行。

### Automation Gaps

- **MUST FIX 修复后缺乏自动 re-review 机制**：修复后需要人工判断是否足够，无法自动触发受影响维度的 re-review
- **issue 去重**：不同评审维度发现同一问题（如 legacy 路径空 key 在 BLR 和 Robustness 中都出现），缺少跨维度去重和合并机制

### Time Sinks

无明显时间瓶颈。140 个测试文件 22.87 秒完成，评审 subagent 并行执行，整体 dev 阶段效率可接受。
