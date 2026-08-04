# 06 — 交付标准

> 本文档定义一个 feature / PR 合并到 main 前必须通过的交付检查清单。
> 质量门禁的机制配置见 `01-overall.md §3`，本文档是从「我要交付了」视角的可执行 checklist。

---

## 与其他文档的关系

| 文档 | 视角 | 回答的问题 |
|------|------|-----------|
| `01-overall.md §3` | 门禁机制 | pre-commit hook 怎么配、CI 流水线长啥样 |
| **`06-delivery.md`（本文档）** | 交付 checklist | 我这个 feature 是否过完了所有门禁 |
| 各 spec 文档 | 验收标准 | 功能行为是否对齐设计文档 |

**交付标准 ≠ 验收标准**：验收标准回答"功能对不对"（源自 spec），交付标准回答"能不能合并发布"（源自门禁）。两者独立，都须通过。

---

## 交付前 Checklist（6 维度）

每条必须是**可验证的**（命令 / 检查能给出 yes/no），不可验证的（如"代码质量好"）必须拆成可验证子项。

### D1 功能完整性

| 检查项 | 验证方式 |
|--------|---------|
| D1.1 设计文档 §9 落点清单 100% 实现 | 逐文件 `[ -f path ]` 核对 |
| D1.2 设计文档 §10 测试计划场景全覆盖 | AC 覆盖矩阵；降级场景需注明理由 |
| D1.3 reviewer 审查无 CRITICAL / MAJOR 差异 | review 报告 |

### D2 代码质量（静态门禁）

| 检查项 | 命令 |
|--------|------|
| D2.1 后端 tsc | `cd router && npx tsc --noEmit` → 0 error |
| D2.2 后端 eslint | `cd router && npx eslint <changed>` → 0 error 0 warning |
| D2.3 前端 vue-tsc | `cd frontend && npx vue-tsc -b --noEmit` → 0 error |
| D2.4 前端 eslint | `cd frontend && npx eslint <changed> --max-warnings=0` |
| D2.5 禁 eslint-disable / any / 硬编码颜色 / 魔法间距 | 代码审查 |

### D3 测试有效性

> 详见 `test-quality` skill。覆盖率不等于有效性。

| 检查项 | 验证方式 |
|--------|---------|
| D3.1 全量回归通过 | 后端 `npx vitest run` + 前端 `npx vitest run`，无新增失败 |
| D3.2 新增测试无弱断言 | `grep -rE 'toBeDefined\|toBeTruthy\|toBeFalsy' <new tests>` → 0 |
| D3.3 新增测试过 mutation 自检 | 每个测试标注"改坏什么会红" |
| D3.4 层归属正确 | 纯逻辑不误放集成层（详见 test-quality skill） |

### D4 文档卫生

| 检查项 | 验证方式 |
|--------|---------|
| D4.1 `.cw/` 等中间产物未跟踪 | `git ls-files .cw/` → 空 |
| D4.2 `docs/scratch/` 无本次临时文档 | `git diff --name-only main..HEAD -- docs/scratch/` → 空 |
| D4.3 代码注释无失效引用 | 审查注释引用的文件是否存在 |

### D5 Git 卫生

| 检查项 | 验证方式 |
|--------|---------|
| D5.1 工作区状态明确 | 认知外改动已与用户确认处理方式 |
| D5.2 commit 语义清晰 | feat/fix/test/perf/refactor 前缀 |
| D5.3 无调试残留 | `git diff main..HEAD \| grep -E 'console.log\|debugger\|TODO'` 审查 |

### D6 门禁执行（流程合规）

| 检查项 | 验证方式 |
|--------|---------|
| D6.1 pre-commit hook 实际执行 | commit 时可见 hook 输出；或手动补跑所有检查项 |
| D6.2 包管理器纪律 | 无 lock 双轨（详见 `01-overall.md §4`） |
| D6.3 向后兼容验证 | 无配置 = 无行为（门控验证） |

---

## 常见阻塞项

按发生频率排序：

### 1. Pre-commit hook 未执行（D6.1）

**症状**：commit 时无 `━━━` 分隔线、无检查日志。

**根因**：bare repo + worktree 模式下，worktree 的 `git config core.hooksPath` 未配置，`.bare/hooks/pre-commit` 不被调用。

**临时处理**（交付前补跑）：
```bash
# 手动执行 hook 的各检查项
cd router && npx prettier --check $(git diff --name-only main..HEAD -- router/src/ | grep '\.ts$')
cd frontend && npx prettier --check $(git diff --name-only main..HEAD -- frontend/src/ | grep -E '\.(vue|ts)$')
python3 .githooks/vue_rules_checker.py --batch <absolute paths>
```

**根治**：运行 `.githooks/install-hooks.sh` 或 `git config core.hooksPath .githooks`（worktree 级）。

### 2. Prettier 格式不一致（D2）

**注意区分**：本次新增文件格式不合规 = 本次责任（必须修）；既有文件历史遗留格式问题（main 也不合规）= **不混入本次 commit**，否则功能 diff 被格式噪音淹没。

区分方法：
```bash
# 本次纯新增文件
git diff --name-only --diff-filter=A main..HEAD
```

### 3. 认知外改动（D5.1）

**规则**：非本次会话产生的文件变更，**不提交、不修改、不删除、不撤销**。在交付报告中明确标注，由用户决定处理方式。详见全局 `CLAUDE.md` 最优先规则 §0。

---

## 交付报告模板

```
## 交付审查报告：<feature-name>

### 检查结果
| 维度 | 检查项 | 状态 | 证据/备注 |
|------|--------|------|----------|
| D1.x | ... | ✅/⚠️/🔴 | ... |

### 阻塞项
- [ ] ...（必须解决才能交付）

### 已知项（非阻塞）
- ...（已与用户确认 / 历史遗留 / 后续改进）

### 结论
[可交付 / 需修复后交付 / 阻塞]
```
