---
phase: dev
verdict: pass
---

# Dev Phase Retrospective — stream-db-streamts-terminal-extra

## 1. Phase Execution Review

### Summary

Phase 3 实现了 8 个诊断列持久化 + 前端 ModelCard 超时 UI 修复，共修改 11 个文件，新增 13 个端到端测试。

**执行路径：** 复杂路径（5 tasks，跨前后端），使用 subagent-driven-development 模式。

**Wave 1 并行：** BG1-code（Tasks 1-3）+ FG1（Task 5）同时 dispatch。

| 指标 | 值 |
|------|---|
| Commits（含 harness 文件） | 9 |
| 修改/新增源码文件 | 11 |
| 新增测试 | 13 |
| 测试通过 | 1487/1487 |
| Code Review 轮次 | 2（v1: 3 MUST FIX → v2: 0） |
| 总耗时 | ~40 分钟 |

### Problems Encountered

**P1: 后端 subagent 耗时 21 分钟**
后端 subagent 承担了 Tasks 1-3（migration + 类型扩展 + 全链路数据流串联），由于 skill 文件读取 + 多文件编辑 + 逐 task commit，耗时远超预期。前端 subagent 仅 2 分钟就完成了。

**P2: Code Review v1 发现 3 条 MUST FIX**
1. `resilience.ts` else 分支未填充 `headers_sent`（stream_error 类型遗漏）
2. 缺 `transport_kind='stream_error'` 测试
3. 缺 failover 路径测试

这三条暴露了 subagent 实现时的两个盲区：
- 对 `TransportResult` discriminated union 的所有变体没有逐一检查
- 对 failover 的两条触发路径（内层 resilience vs 外层 failover-loop）理解不完整

**P3: 外层 failover 路径未记录 failover_trigger**
P2 修复过程中发现：failover 不仅通过 `ProviderSwitchNeeded` 异常触发，还通过外层 failover-loop 的 `excludeTargets.push + continue` 触发。后者的日志记录路径完全缺失 `failover_trigger`。需要新增 `lastFailoverTrigger` 变量跨迭代传递。

### What Would You Do Differently

1. **拆分后端 subagent**：Tasks 1-3 不应合并到一个 subagent。应拆为 Task 1-2（类型/DB 变更，低风险）和 Task 3（数据流串联，高风险），减少单次 subagent 上下文压力和耗时。
2. **Plan 中标注 failover 双路径**：plan.md 只描述了 `ProviderSwitchNeeded` 路径的 `failover_trigger` 提取，遗漏了外层 failover 路径。spec/plan 阶段如果更深入分析 `failover-loop.ts` 的 while 循环逻辑，就能提前发现。
3. **减少 skill 注入开销**：subagent 加载 TDD + backend-dev 两个 skill 文件消耗了大量 token 和时间。对于 Task 1（纯 migration + 类型）这类机械性任务，skill 加载的收益不值得其成本。

### Key Risks for Later Phases

- `resilience_action` 的 "done" 值偏离了 spec（spec 期望 NULL，实际记录 "done"）。这是 resilience 层的正确行为（无重试时 finalDecision 就是 done），但前端/监控消费者需要适配这个值。
- `client_disconnect` 和 `loop_detection` 两种 abort_reason 没有程序化测试（难以在单元测试中模拟）。

---

## 2. Harness Usability Review

### Flow Friction

- **subagent 轮询等待**：background subagent 完成后自动注入机制有效，但后端 subagent 耗时 21 分钟导致大量轮询 `collect_subagent`。应该在 dispatch 时设置更合理的超时预期，或考虑 foreground 模式处理长时间任务。
- **Code review diff 传递**：diff 内容通过 task prompt 直接传递，977 行 diff 加上 spec/plan 的全文，token 开销很大。应考虑仅传文件列表 + diff stat，让 review subagent 自行读取。

### Gate Quality

- Gate check 工作正常。Stage 3 gate 一次性通过。
- Code review subagent 有效发现了实现遗漏（3 条 MUST FIX），证明独立审查的价值。
- YAML frontmatter 问题反复出现（subagent 不在顶层放 verdict/must_fix，需要主 agent 手动修复）。这是 subagent 的系统性问题。

### Prompt Clarity

- Plan.md 的 Task 3 描述了数据流路径，但对 failover 双路径的区分不够清晰。建议 plan 阶段对 failover-loop.ts 的 while 循环做更细致的路径分析。
- "禁码铁律"在复杂路径下执行良好——主 agent 确实没有写任何实现代码。

### Automation Gaps

- YAML frontmatter 格式应该是 gate 脚本自动检查和修复的，而不是靠主 agent 手动添加顶层字段。
- Test subagent 应该能自动运行测试并报告结果，而不是主 agent 在 subagent 完成后再运行 `npm test` 验证。

### Time Sinks

| 环节 | 耗时 | 原因 |
|------|------|------|
| 后端 subagent | 21 分钟 | 单 subagent 承担 3 个 tasks + skill 加载开销 |
| MUST FIX 修复 | 10 分钟 | failover 双路径理解 + TC13 调试 |
| collect_subagent 轮询 | 持续 | background 模式下无法预估完成时间 |
