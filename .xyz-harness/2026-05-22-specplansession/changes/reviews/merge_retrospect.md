---
phase: merge
verdict: partial
---

# Merge 流程复盘

## 背景

PR #165 合并 + patch 版本发布。使用 `merge-and-publish.sh` 脚本执行。
实际功能发布在 v0.11.18，v0.11.19 为错误触发的空版本。

---

## 时间线

| 步骤 | 结果 | 耗时 |
|------|------|------|
| `git pull origin main --rebase` | 冲突（failover-loop.ts），手动解决 | ~3min |
| rebase 后 `git push --force-with-lease` | 成功，commit `cad21d2` | ~10s |
| CI 等待（rebase 后重新跑） | test ✅ docker ✅ | ~2min |
| merge-and-publish.sh 第 1 次运行 | **FAIL**：upstream 误判 | ~8min |
| `git branch --set-upstream-to` 修复 | 修正 tracking branch | ~1min |
| merge-and-publish.sh 第 2 次运行 | 阶段 1-4 通过，阶段 4 等 Publish workflow 时**超时**（600s） | ~10min |
| 手动 `gh run watch` | v0.11.18 发布成功 | ~3min |
| merge-and-publish.sh 第 3 次运行 | **重新触发 Publish workflow**（v0.11.19 空版本），再次超时 | ~5min |
| 手动 `gh run watch` 第 2 次 | 超时（300s），v0.11.19 仍在构建 | 未完成 |

**总耗时：约 32 分钟**，其中脚本运行 ~23 分钟，手动干预 ~9 分钟。

---

## 3 个问题

### 问题 1：`git pull --rebase` 破坏 upstream 设置

**现象**：pre-merge-check.sh 报 "有未推送的 commits"，列出 20 个 feature commits。

**根因**：`git pull --rebase origin main` 将分支的 `@{upstream}` 从 `origin/fix-usage-limit-return` 改为 `origin/main`。pre-merge-check.sh 用 `@{upstream}..HEAD` 检测未推送 commits，导致 20 个 feature commits 全部误报。

**修复**：`git branch --set-upstream-to=origin/fix-usage-limit-return fix-usage-limit-return`

**预防**：`git pull --rebase origin main` 后应自动恢复 upstream，或在 pre-merge-check.sh 中用 `origin/$BRANCH_NAME..HEAD` 替代 `@{upstream}..HEAD`。

### 问题 2：Publish workflow 超时（两次）

**现象**：merge-and-publish.sh 在阶段 4 等待 Publish workflow 完成时超时。

**根因**（已修正）：不是脚本内部超时不够。脚本阶段 4 的 `wait-for-ci.sh --timeout 900`（15 分钟）是充分的。**真正原因是 AI 调用 bash 命令时设的 `timeout` 参数（600s / 300s）小于脚本内部超时（900s），导致脚本被外部 kill。**

**Publish workflow 实际耗时统计**（最近 6 次成功运行）：
| 统计 | 值 |
|------|---|
| 最快 | 5.3 分钟 |
| 最慢 | 11.6 分钟 |
| 平均 | 7.1 分钟 |
| P90 | 11.6 分钟 |

脚本内部超时 900s（15 分钟）有 3.4 分钟余量，本身够用。问题出在 AI 的 bash timeout 参数。

**影响**：超时后脚本中断，阶段 5（Release Notes）和阶段 6（清理）未执行。

### 问题 3：幂等重跑触发空版本发布

**现象**：第 3 次运行 merge-and-publish.sh 时，阶段 4 重新触发了 Publish workflow，导致 v0.11.19 被创建（无功能变更的空版本）。

**根因**：脚本的幂等逻辑在阶段 4 没有检测 "目标版本 Release 是否已存在"。它只检查 "main 上是否有需要发布的 commit"，而 v0.11.18 的 version bump commit 看起来就像"需要发布的新 commit"。

**影响**：npm 上出现 v0.11.19 空版本，GitHub Release v0.11.18 和 v0.11.19 的 release notes 都为空。

---

## 后果

| 项目 | 状态 |
|------|------|
| PR #165 | 已合并 ✅ |
| v0.11.18 | 已发布到 npm + GitHub Release（release notes 为空） |
| v0.11.19 | 被**错误触发**的空版本，已发布到 npm + GitHub Release |
| Release Notes | 两个版本都为空（只有标题） |
| Worktree 清理 | 未执行 |

---

## 3 个预想之外的结果

### 1. `git pull --rebase origin main` 把 upstream 改成了 `origin/main`

我知道 rebase 会重写 commit，但没想到它会改变分支的 `@{upstream}` 追踪引用。导致 pre-merge-check.sh 用 `@{upstream}..HEAD` 比对时，把 20 个 feature commits 全部误报为"未推送"。浪费了一整轮脚本运行（8 分钟全量验证）。

### 2. 脚本重跑时触发了 v0.11.19 空版本发布

脚本文档明确说"幂等，任何步骤失败后修复重跑即可（已完成步骤自动跳过）"。但阶段 4 的幂等逻辑只检查了"是否有未完成的 publish run"，没有检查"release 是否已存在"。v0.11.18 已经发布成功，重跑时脚本看到 main 上有新的 commit（version bump），又触发了一次 Publish workflow，导致 npm 上出现了一个无功能变更的 v0.11.19。

### 3. 两个版本的 Release Notes 都为空

Publish workflow 创建 Release 时只写了 `## v0.11.18`，没有自动生成 release notes。我原以为脚本阶段 5 会补上，但因为阶段 4 超时中断，阶段 5 从未执行。重跑时阶段 4 又触发了新 workflow，再次超时，阶段 5 仍未到达。最终两个版本都是空 notes。

---

## 3 个希望 SKILL/脚本说明的点

### 1. 脚本的幂等边界在哪

SKILL 说了"幂等，任何步骤失败后修复重跑即可（已完成步骤自动跳过）"，但没有说明幂等的检测粒度。实际跑下来发现：
- 阶段 1-3 检测到位（跳过了已完成的验证和合并）
- 阶段 4 **没有检测到位**：没有检查"release 是否已存在"，导致重复触发 Publish workflow

如果 SKILL 明确写"阶段 4 的幂等条件是：目标版本 Release 不存在。如果已存在，跳过发布直接进入阶段 5"，我就不会在超时后盲目重跑，而是先 `gh release view` 确认。

### 2. `git pull --rebase` 后需要手动修复 upstream

这是 worktree + rebase 场景下的已知陷阱，但 SKILL 和脚本都没有提及。如果在 SKILL 的"故障恢复"或"注意事项"中加一条：

> `git pull --rebase origin main` 会改变 `@{upstream}` 指向。重跑脚本前需执行 `git branch --set-upstream-to=origin/$BRANCH $BRANCH`。

我就能在 1 分钟内修复，而不是浪费 8 分钟跑完一整轮验证才发现。

### 3. Publish workflow 的预期耗时和超时配置

SKILL 没有提到 Publish workflow 通常需要多久，脚本内部超时 900s（15 分钟）是充分的。但 AI 调用 bash 命令时设的 timeout 参数（600s / 300s）小于脚本内部超时，导致脚本被外部 kill。

如果 SKILL 写明"Publish workflow 通常需要 6-12 分钟，AI 调用 bash 时 timeout 应 >= 1200s"，就能避免超时中断。

---

## 哪些不是通用 skill 能解决的

### `git pull --rebase` 冲突解决 — 不是 skill 问题

failover-loop.ts 的冲突涉及业务逻辑（`lastFailoverTrigger` 诊断字段 + `continue` vs `return` 的行为语义），脚本不可能自动判断应该保留还是删除。这属于"dev 阶段代码变更"的范畴，应该在 merge 前由 AI 或人工解决。

但 SKILL 可以补充一条：**`git pull --rebase` 可能产生冲突，冲突需要人工解决后才能继续 merge 流程。**

### Release Notes 内容衔接 — 是脚本问题，不是 skill 问题

merge-and-publish.sh 能从 conventional commits 自动生成结构化 notes（按 feat/fix/perf 分组），这是通用能力。但这次两个版本的 notes 都为空，说明 Publish workflow（GitHub Actions）创建 Release 时没有调用这个自动生成逻辑——它是直接用 `gh release create` 创建的空 notes。

真正的 gap 是：**Publish workflow 和 merge-and-publish.sh 之间缺少 Release Notes 的衔接**。merge-and-publish.sh 生成了 notes 但没机会写入（超时中断），Publish workflow 能创建 Release 但不知道 notes 在哪。

**修复方案**：merge-and-publish.sh 的阶段 5 增加回退逻辑——检测到 Release 已存在但 notes 为空时，自动回填 notes（`gh release edit $TAG --notes-file notes.md`）。

---

## 改进建议汇总

### 脚本层面（merge-and-publish.sh）

| 优先级 | 改进 | 说明 |
|--------|------|------|
| P0 | 阶段 4 幂等检查 | 触发 Publish 前检查 `gh release view v$VERSION`，已存在则跳过 |
| P0 | 阶段 5 回填 Release Notes | Release 已存在但 notes 为空时，自动 `gh release edit` |
| P1 | 脚本超时设置不需要调整 | 脚本内部 900s 已充分。AI 调用 bash 时应确保 timeout >= 1200s |
| P1 | pre-merge-check.sh 未推送检测 | 用 `origin/$BRANCH_NAME..HEAD` 替代 `@{upstream}..HEAD` |

### SKILL 层面（SKILL.md）

| 优先级 | 补充内容 | 说明 |
|--------|---------|------|
| P0 | 幂等边界说明 | 明确每个阶段的幂等检测条件 |
| P1 | rebase 后 upstream 修复提示 | 故障恢复章节加注意事项 |
| P1 | Publish workflow 预期耗时 | 帮助 AI 合理设置超时预期 |
| P2 | rebase 冲突处理指引 | 冲突需要人工解决，不是脚本问题 |
