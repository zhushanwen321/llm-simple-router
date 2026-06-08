---
name: merge
description: PR 合并 + 版本发布一体化流程（阶段 0-6），含本地验证、PR 合并、CI 等待、版本 bump、Release 创建、交付物验证。
---

# Merge & Release（llm-simple-router）

执行 6+1 阶段合并发布流程。阶段 0-6 由 `merge.sh` 一体化完成，阶段 7（清理）由独立 `cleanup.sh` 执行，需 AI/用户确认。

## 适用范围

- 项目：`llm-simple-router`（Node.js monorepo，npm workspaces）

## 发布机制

- **构建产物**：`npm run build`（router + frontend，pi-extension 不构建）
- **发布方式**：GitHub Actions（`publish.yml`）
  - **stable 路径**：`workflow_dispatch` 触发（`gh workflow run publish.yml --ref main -f bump_type=patch|minor|major`），由 `scripts/publish.sh` 发起
  - **beta 路径**（由 `.pi/skills/beta-publish/` 覆盖）：`push: branches: ['beta-*']` 触发，详见末尾"Beta 发布"小节
- **交付物**（stable 路径）：npm registry（`llm-simple-router` tag=`latest`）+ Docker image（ghcr.io）+ GitHub Release + dist archive asset
- **版本管理**：workspace root `1.0.3`；子包独立版本（router `1.0.4` / pi-extension `0.1.0` / frontend `0.0.0`）
- **禁止本地发布**：必须走 GitHub Actions

## 调用方式

### 主流程（阶段 0-6）

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace

# 完整流程
bash .pi/skills/merge/merge.sh <worktree-dir> [patch|minor|major]

# 指定 release notes 文件
bash .pi/skills/merge/merge.sh <worktree-dir> patch --notes release-notes.md

# 创建 Draft Release（不自动发布）
bash .pi/skills/merge/merge.sh <worktree-dir> patch --draft
```

### 失败恢复（--from）

```bash
# 阶段 3 失败，修复后从阶段 3 继续（跳过已完成的 0-2）
bash .pi/skills/merge/merge.sh <worktree-dir> patch --from 3

# 阶段 5 失败，从阶段 5 重试
bash .pi/skills/merge/merge.sh <worktree-dir> patch --from 5
```

> `--from` 参数值 0-6，对应阶段号。阶段 0（初始化）总是会执行（很快且幂等）。

### 清理 worktree（阶段 7）

```bash
# 确认交付物无误后，清理 feature worktree
bash .pi/skills/merge/cleanup.sh <worktree-dir>

# 跳过同步其他 worktree
bash .pi/skills/merge/cleanup.sh <worktree-dir> --skip-sync
```

> ⚠️ **破坏性操作**，需 AI/用户明确确认后再执行。

## 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `<worktree-dir>` | ✅ | feature worktree 目录路径 |
| `[patch\|minor\|major]` | 否 | 版本类型，默认 `patch` |
| `--notes <file>` | 否 | 指定 release notes 文件 |
| `--draft` | 否 | 创建 Draft Release |
| `--from <N>` | 否 | 从阶段 N 继续执行（1-6），阶段 0 始终执行 |

## 7 阶段流程

### 阶段 0: 初始化

解析参数、检测环境（gh CLI、workspace root、main worktree、GitHub repo）、查找 PR、初始化日志。

**幂等**：总是执行（很快）。

### 阶段 1: 本地验证

调用 `pre-merge-check.sh` 执行完整验证：依赖检查 → TypeScript 类型检查 → Lint → 单元测试 → 构建 → Git 状态检查。

**不可跳过**：任何失败必须正面修复。

**失败恢复**：
```bash
# 修复后重跑
bash .pi/skills/merge/merge.sh <worktree-dir> patch --from 1
```

### 阶段 2: PR CI + 合并

等待 PR CI 通过（最多 10 分钟），然后合并 PR。

**幂等**：PR 已合并则跳过。

### 阶段 3: Post-merge CI 等待

等待 main 分支上的 CI workflow 通过。

**特殊**：如果项目无 CI workflow，自动跳过。

### 阶段 4: 发布

- 如果项目有 `scripts/publish.sh` → 调用它（通常是 `gh workflow run publish.yml`）
- 如果没有 → 自行 bump 版本 + tag + push + 等待 Release CI

**幂等**：当前版本 Release 已存在则跳过发布脚本。

### 阶段 5: Release

从 conventional commits 自动生成 release notes，创建/更新 GitHub Release。

- 优先等待 CI 创建的 Draft Release，回填 notes
- 如果 CI 未创建，则手动创建 Release

### 阶段 6: 交付物验证（门禁）

验证发布产物完整性：Release 存在 → 构建产物/npm 包 → 发布状态。

**不可跳过**：只有通过验证才能执行清理。

### 阶段 7: 清理（独立脚本）

由 `cleanup.sh` 独立执行，不在 `merge.sh` 中：

1. 删除 feature worktree
2. 同步其他 worktree（`git merge --no-ff main`）
3. 清理临时文件（release notes、commits、state）
4. 日志轮转（保留最近 30 个）

## AI 操作要点

### 1. 执行约束

- 所有阶段检查**零容忍**，失败必须正面修复
- 禁止以"不是本次改动引起的"为由跳过检查
- bash timeout >= 1200s（CI 含 Docker build 可能耗时 10 分钟以上）
- 阶段 6 通过后，**展示结果并询问用户**是否执行 `cleanup.sh`

### 2. 失败处理

每个阶段独立，失败后修复 + `--from N` 重跑即可：

```bash
# 查看错误信息，定位问题
# 在 feature worktree 或 main worktree 中修复
# 从失败阶段继续
bash .pi/skills/merge/merge.sh <worktree-dir> patch --from <N>
```

### 3. 典型执行模式

```
AI: 我来帮你执行合并发布流程。
    → bash merge.sh feat-xxx patch
    → 阶段 0-6 顺序执行
    
    如果失败：
    → AI 分析错误，修复代码
    → bash merge.sh feat-xxx patch --from <N>
    
    阶段 6 通过后：
    AI: 交付物验证通过！v1.0.5 已发布。
        要清理 feat-xxx worktree 吗？
    用户: 确认
    AI: → bash cleanup.sh feat-xxx
```

## 文件结构

```
.pi/skills/merge/
  SKILL.md                    # 本文件
  merge.sh                    # 主流程脚本（阶段 0-6）
  cleanup.sh                  # 清理脚本（阶段 7，独立执行）
  pre-merge-check.sh          # 阶段 1 调用的本地验证脚本
  wait-for-ci.sh              # 阶段 3/4 调用的 CI 等待脚本
```

## 退出码

| 退出码 | 含义 | AI 行为 |
|--------|------|--------|
| 0 | 成功 | 继续下一步 |
| 1 | 失败 | 查看错误信息，修复后 `--from N` 重跑 |

## Beta 发布（独立 skill）

本 skill **不**覆盖 beta 发布。AI 收到 "发 beta" / "beta publish" 类指令时，应直接调用：

```bash
bash .pi/skills/beta-publish/beta-publish.sh -y
```

详见 `.pi/skills/beta-publish/SKILL.md`。

## 标记说明

| 标记 | 含义 | 修改约束 |
|------|------|----------|
| `[HISTORICAL]` | 历史经验总结的规则 | 不允许删除或削弱 |
| `[MANDATORY]` | 流程强制要求 | 必须严格遵守 |
| `[OPTIONAL]` | 可选步骤 | 可根据项目需求调整 |
