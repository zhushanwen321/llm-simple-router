---
phase: spec
verdict: pass
---

# Spec Phase Retrospect

## 1. Phase Execution Review

### Summary

Spec 阶段产出了一份完整的 Pipeline 全量接管代理请求执行的规格说明。核心设计是将 failover-loop.ts（~612 行 god function）拆为三层架构（L1 路由预计算 / L2 pipeline 单次执行 / L3 循环控制），将 6 个核心步骤提取为内置 hook。Spec 包含 7 条 FR、8 条 AC、8 条 Constraint、8 项 Out of Scope，复杂度评估为高（~15 文件修改）。

### Problems Encountered

**评审迭代 3 轮才通过。** 主要问题：

1. **MUST FIX #1（职责重叠）**：初版 FR1（L1 预计算）和 FR3（builtin:route-resolve）之间的职责边界模糊——L1 的 resolveMapping 和 L2 的 route-resolve 都涉及 target 选择，评审无法判断哪个阶段负责"选 target"。v2 通过在 FR1 中增加"L1 与 L2 的边界"段落彻底消解。

2. **MUST FIX #2（异常传播缺失）**：初版完全没有定义 hook 异常处理机制——PipelineAbort 如何传播、非核心 hook 失败是否阻塞、核心 hook 失败怎么办，全部留空。这在 proxy 层是致命的，因为任何 hook 抛异常都会导致请求挂起或静默跳过。v2 补充了 Constraint 8 的三级异常处理策略。

3. **MUST FIX #3（on_stream_event 自相矛盾）**：FR7 说"接入 on_stream_event"，Constraint 7 说"暂不激活"，两者直接冲突。v2 将 FR7 降级为"基础设施就绪"，在 AC1 中明确排除，三方文档对齐。

4. **第 3 轮新发现（Issue #13）**：pre_route phase 不再被 emit，但未在 Constraints 中说明处理方式。这说明前两轮审查都遗漏了向后兼容性检查——当 pipeline 的 emit 序列发生变化时，外部插件已注册的 hook 可能静默失效。

### What Would You Do Differently

1. **初稿就该包含异常传播机制**。hook 系统的错误处理是骨架级设计，不是细节。初版把 6 个 hook 的正常路径描述得很完整，但完全忽略了异常路径——这反映了"只考虑 happy path"的思维盲区。

2. **L1/L2 职责边界应该从第一个 FR 开始就用显式段落标注**。FR1 和 FR3 分别描述两个层次的行为时，没有"两者之间的边界"这个显式声明，导致读者需要自己推断。这种隐式假设是 spec 中最常见的歧义来源。

3. **向后兼容性检查应该是评审的固定检查项**。Issue #13 在第 3 轮才被发现，说明前两轮评审都聚焦于"新设计是否正确"，而忽略了"旧路径是否被正确处理"。对 pipeline 这种核心执行路径的重构，backward compatibility 应该是第一轮就检查的维度。

### Key Risks

1. **迁移策略未定义**（Issue #8）：~15 文件 + 612 行重写的风险下，一次性提交回滚困难。Plan 阶段必须明确分阶段迁移策略。
2. **AC5 功能等价验证方法缺失**（Issue #9）：10 种场景的等价性如何验证——录制回放、快照对比、还是断言——plan 阶段必须定义，否则测试阶段无法执行。
3. **性能无阈值**（Issue #6）："可测量的延迟增加"缺乏具体数字。pipeline emit 的 Map lookup + 顺序执行开销需要基线数据。
4. **pre_route 向后兼容**（Issue #13）：外部插件 hook 可能静默失效，需要在 Constraints 中明确处理方式，否则部署后问题难以排查。

---

## 2. Harness Usability Review

### Flow Friction

评审迭代 3 轮属于正常范围，但存在两个效率问题：

1. **MUST FIX 在 v1 就可以避免**。3 条 MUST FIX 都是"遗漏"而非"设计选择争议"——异常传播缺失是骨架级设计遗漏，职责重叠是文档表述问题，on_stream_event 矛盾是自检就能发现的。如果 spec 完成后有一个轻量的自检清单（如"是否覆盖了错误路径？FR 之间是否有职责重叠？是否存在互相矛盾的 Constraint？"），这些在第 0 轮就能被捕获。

2. **Issue #13 到第 3 轮才被发现**，说明评审缺乏固定的"向后兼容性"检查维度。建议在评审方法论中增加兼容性检查项。

### Gate Quality

Gate 检查有效。评审准确识别了 3 条 MUST FIX 和多条 LOW/INFO，最终通过时所有 MUST FIX 已解决。没有发现误判（false positive）——3 条 MUST FIX 确实是 spec 缺陷。

### Prompt Clarity

Spec 阶段的 prompt 引导充分。spec.md 的模板结构（Background → FR → AC → Constraint → Out of Scope）提供了清晰的产出框架，产出质量高。评审方法论（计划评审模式）的检查维度覆盖了核心方面。

### Automation Gaps

无明显自动化缺口。spec 阶段主要是设计文档产出和评审，当前流程已足够。

### Time Sinks

3 轮评审（v1 → v2 → v3）是主要时间消耗。其中 v1 的 3 条 MUST FIX 如果通过自检清单可以在提交前避免，可以减少到 1-2 轮。v2 → v3 的增量审查（1 条新 LOW 发现）是合理的评审深化。
