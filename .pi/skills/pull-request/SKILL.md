---
name: pull-request
description: >-
  提交 Pull Request。触发词："提交 PR"、"创建 PR"、"push"、"提交代码"、
  "pr-worktree"。仅用于 llm-simple-router 项目。
---

# Pull Request（llm-simple-router）

在当前 worktree 中完成提交、推送和创建 PR 的完整流程。

## 适用范围

- 项目：`llm-simple-router`（Node.js monorepo，npm workspaces）

## 前提条件

- 当前在 worktree 目录中，变更已 commit
- `gh` CLI 已安装并登录

## 操作步骤

### 1. 评估变更规模

```bash
git diff --stat HEAD~1 2>/dev/null || git diff --cached --stat
```

| 规模 | 策略 |
|------|------|
| <10 文件 | 直接执行 |
| 10-30 文件 | 按功能分组 commit |
| >30 文件 | 建议先 code-review |

### 2. 检查变更内容

确认无敏感信息（API key、密码、token 等）泄露。

### 3. Commit

用户提供 commit message，或按 conventional commits 格式编写：

```bash
git add -A && git commit -m "<type>(<scope>): <description>"
```

### 4. Pre-merge 验证（push 前必须执行）

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace/main
npm run lint && npm test && npm run build
```

**任何一项失败都必须修复后才能 push。** 无论是否本次改动引入，一律正面修复。

### 5. Push 并创建 PR

```bash
# Push 到远程
git push -u origin HEAD

# 检查是否有已有 PR
PR_INFO=$(gh pr list --head "$(git branch --show-current)" --json number,state,url --jq '.[0]')
if [ -n "$PR_INFO" ] && [ "$PR_INFO" != "null" ]; then
  echo "已有 PR，更新中..."
  gh pr edit --title "<title>" --body "<body>"
else
  gh pr create --base main --title "<title>" --body "<body>"
fi
```

### 6. 等待 CI 并确认结果 [MANDATORY]

PR 创建后必须等待 CI 全部完成并确认通过。使用轮询脚本：

```bash
# 用法: PR 编号作为参数，或省略则自动检测当前分支的 PR
bash .pi/skills/pull-request/wait-ci.sh [PR_NUMBER]
```

脚本行为：
- 每 30 秒轮询一次 CI 状态
- 所有 check 都达到终态（success/failure/cancelled/timed_out）后退出
- 全部 success → 退出码 0
- 任一失败 → 退出码 1，并打印失败项
- 超时 10 分钟 → 退出码 2

如有 check 失败，分析原因并修复后重新 push。

## Pre-merge 验证详情

llm-simple-router 的 pre-merge 是三步串行检查：

| 步骤 | 命令 | 检查内容 |
|------|------|---------|
| Lint | `npm run lint` | ESLint 零警告 |
| Test | `npm test` | vitest 全部测试通过 |
| Build | `npm run build` | router + frontend tsc 编译 |

**Monorepo 注意**：`npm run build` 构建 router 和 frontend 两个 workspace 子包。如果 router 是 frontend 的依赖（通过 `workspace:*`），router 必须先构建成功。

## 本地发布脚本

项目有 `scripts/publish.sh`，用于本地触发 GitHub Actions 发布（非 PR 流程的一部分）。PR 流程中不需要调用。

## 脚本位置

```
scripts/publish.sh   # 项目发布脚本（PR 后由 merge 流程调用）
```

## GitHub 合并策略

- 使用 **Create a merge commit**（`--no-ff`）
- 禁止 Squash merge 和 Rebase merge
- 确保 Settings → General → Pull Requests 中只开启 "Allow merge commits"

---

## 标记说明

| 标记 | 含义 | 修改约束 |
|------|------|----------|
| `[HISTORICAL]` | 历史经验总结的规则 | 不允许删除或削弱 |
| `[MANDATORY]` | 流程强制要求 | 必须严格遵守 |
| `[OPTIONAL]` | 可选步骤 | 可根据项目需求调整 |
