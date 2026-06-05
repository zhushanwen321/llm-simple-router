---
name: merge
description: >-
  合并分支并发布。触发词："合并"、"merge"、"发布"、"release"、
  "上线"。仅用于 llm-simple-router 项目。
---

# Merge & Release（llm-simple-router）

执行 8 阶段合并发布流程，项目通过 GitHub Actions 自动发布到 npm registry + Docker。

## 适用范围

- 项目：`llm-simple-router`（Node.js monorepo，npm workspaces）

## 发布机制

- **构建产物**：`npm run build`（router + frontend）
- **发布方式**：GitHub Actions（`publish.yml`），tag `v*` 触发
- **交付物**：npm registry（`llm-simple-router`）+ Docker image + GitHub Release
- **版本管理**：workspace root `1.0.0`，子包独立版本（router `1.0.1`）
- **禁止本地发布**：必须走 GitHub Actions

## 8 阶段流程

### 阶段 0: 初始化

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace
bash .pi/skills/merge/stages/0-init.sh <worktree-dir> [patch|minor|major]
```

参数：
- `<worktree-dir>` — feature worktree 目录
- `[patch|minor|major]` — 版本类型，默认 `patch`

### 阶段 1-3: 标准 global 脚本

使用 merge-worktree 的标准阶段脚本：

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace
bash .pi/skills/merge/stages/1-local-check.sh
bash .pi/skills/merge/stages/2-pr-merge.sh
bash .pi/skills/merge/stages/3-post-merge-ci.sh
```

| 阶段 | 功能 | 幂等条件 |
|------|------|---------|
| 1 | 本地验证（lint + test + build） | checkpoint `phase1-passed` 存在 |
| 2 | PR CI 检查 + 合并 | PR state = MERGED |
| 3 | Post-merge CI 等待 | CI 已通过 |

### 阶段 4: GitHub Actions 发布（项目特化）

此阶段调用项目的 `scripts/publish.sh`，由 GitHub Actions 执行实际发布：

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace
bash scripts/publish.sh patch
```

脚本流程：
1. 检查本地代码状态
2. 通过 GitHub Actions 触发 publish workflow
3. 等待并监控 CI 进度
4. 自动验证 npm/Docker/Release

**版本类型参数**：`patch`（默认）/ `minor` / `major`

### 阶段 5: Release

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace
bash .pi/skills/merge/stages/5-release.sh
```

生成 commit 清单 → release notes → 创建/更新 GitHub Release。

### 阶段 6: 交付物验证——npm + Docker

验证发布产物完整性：

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace

# 1. 获取版本号
VERSION=$(node -p "require('./router/package.json').version")
echo "验证版本: $VERSION"

# 2. npm registry 验证
npm info llm-simple-router version
# 预期输出: $VERSION

# 3. GitHub Release 验证
gh release view "v$VERSION" --json tagName,url
# 预期: Release 存在，有 tagName 和 url

# 4. Docker 镜像验证
docker images llm-simple-router:latest --format "{{.Repository}}:{{.Tag}}" 2>/dev/null || echo "Docker 镜像需在 CI 检查"
```

**交付物清单**：

| 交付物 | 验证方式 | 失败处理 |
|--------|---------|---------|
| npm 包 | `npm info llm-simple-router version` 等于目标版本 | 检查 publish workflow 日志，重新触发 |
| GitHub Release | `gh release view v$VERSION` 存在 | 检查 release.yml 是否被 tag push 触发 |
| Docker 镜像 | `docker images` 或 CI 中检查 | 检查 Docker build 是否在 workflow 中 |

**不可跳过**：阶段 6 是阶段 7 的硬性前置条件。

### 阶段 7: 清理

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace
bash .pi/skills/merge/stages/7-cleanup.sh
```

删除 feature worktree + 同步其他 worktree + 清理临时文件。

**门禁**：阶段 7 启动时检查 `deliverables-verified` checkpoint，不存在则拒绝执行。

## AI 操作要点

### 1. 创建 todo 清单

收到合并指令后立即创建 todo：

| # | 文本 | 阶段 |
|---|------|------|
| 1 | 初始化环境（0-init） | `stages/0-init.sh` |
| 2 | 本地验证（1-local-check） | `stages/1-local-check.sh` |
| 3 | PR CI + 合并（2-pr-merge） | `stages/2-pr-merge.sh` |
| 4 | Post-merge CI（3-post-merge-ci） | `stages/3-post-merge-ci.sh` |
| 5 | GitHub Actions 发布（4-publish） | `scripts/publish.sh` |
| 6 | 创建 Release（5-release） | `stages/5-release.sh` |
| 7 | 确认交付物（6-verify） | 阶段 6 手动验证 |
| 8 | 清理 worktree（7-cleanup） | `stages/7-cleanup.sh` |

### 2. 执行约束

- 所有阶段脚本必须在 workspace root 或其子目录（非目标 worktree）内执行
- 阶段 1 和阶段 6 的检查**零容忍**，所有错误必须正面修复
- 禁止以"不是本次改动引起的"为由跳过检查
- bash timeout >= 1200s（CI 含 Docker build 可能耗时 10 分钟以上）

### 3. 故障恢复

每个阶段独立执行。失败后修复重跑同一阶段即可。

```bash
# 阶段失败时
# 1. 查看错误信息
# 2. 在 feature worktree 中修复
# 3. 重跑同一阶段
cd /Users/zhushanwen/Code/llm-simple-router-workspace
bash .pi/skills/merge/stages/N-name.sh
```

## 文件结构

```
merge/
  SKILL.md                    # 本文件
  scripts/
    publish.sh                # 项目发布脚本（本地触发 GitHub Actions）
    release.sh                # 旧发布方式（参考用）
```

## 退出码

| 退出码 | 含义 | AI 行为 |
|--------|------|--------|
| 0 | 成功 | 标记 todo completed，继续下一阶段 |
| 1 | 失败 | 查看错误信息，修复后重跑同一阶段 |

---

## 标记说明

| 标记 | 含义 | 修改约束 |
|------|------|----------|
| `[HISTORICAL]` | 历史经验总结的规则 | 不允许删除或削弱 |
| `[MANDATORY]` | 流程强制要求 | 必须严格遵守 |
| `[OPTIONAL]` | 可选步骤 | 可根据项目需求调整 |
