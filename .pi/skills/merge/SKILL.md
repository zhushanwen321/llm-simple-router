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

- **构建产物**：`npm run build`（router + frontend，pi-extension 不构建）
- **发布方式**：GitHub Actions（`publish.yml`）
  - **stable 路径**：`workflow_dispatch` 触发（`gh workflow run publish.yml --ref main -f bump_type=patch|minor|major`），由 `scripts/publish.sh` 发起
  - **beta 路径**（由 `.pi/skills/beta-publish/` 覆盖）：`push: branches: ['beta-*']` 触发，详见末尾"Beta 发布"小节
- **交付物**（stable 路径）：npm registry（`llm-simple-router` tag=`latest`）+ Docker image（ghcr.io）+ GitHub Release + dist archive asset
- **版本管理**：workspace root `1.0.3`；子包独立版本（router `1.0.4` / pi-extension `0.1.0` / frontend `0.0.0`）
- **禁止本地发布**：必须走 GitHub Actions

## 调用方式

### ✅ 优先：workflow tool

本 skill 已注册为 workflow 脚本（`.pi/workflows/merge-worktree.js`），**AI 必须优先调用** `workflow_run` 工具来驱动整个流程：

```javascript
// 最常用形态（仅传 worktree，其他走默认）
workflow_run({
  name: 'merge-worktree',
  args: { worktreeDir: 'feat-import-export-config' }
})

// 完整形态
workflow_run({
  name: 'merge-worktree',
  mode: 'auto',                                       // 默认 auto，会让你确认
  args: {
    worktreeDir: 'feat-import-export-config',         // 必填
    versionType: 'patch',                             // 可选，默认 patch
    // draft: 'true',                                 // 可选，字符串 'true' 开启
  },
})
```

**优势**：
- `phase('0-init'..'7-cleanup')` 阶段进度可视化管理
- `$WORKSPACE` / `$ARGS` 自动注入，无需手动 `cd` 与拼参数
- 阶段 7 前有**硬门禁**（workflow 层 JS `throw` 阻断），对齐 `[MANDATORY]` 标记
- 失败时 prompt 里已写好"失败处理"段，AI 直接按指引走
- bash timeout / 重试 / checkpoint 读取由 agent prompt 统一管理

### ⚠️ 降级：直接跑 bash 阶段脚本

**仅在以下情况**使用 bash 路径：
- 单独重跑某个阶段（如阶段 1 失败、阶段 6 失败）
- workflow-run 工具不可用
- 调试某个 stage 脚本

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace

# 阶段 0 入口（带参数）
bash .pi/skills/merge/stages/0-init.sh <worktree-dir> [patch|minor|major] [--draft]

# 阶段 1-7（位置无关，按需调用）
bash .pi/skills/merge/stages/1-local-check.sh
bash .pi/skills/merge/stages/2-pr-merge.sh
bash .pi/skills/merge/stages/3-post-merge-ci.sh
bash .pi/skills/merge/stages/4-publish.sh
bash .pi/skills/merge/stages/5-release.sh
bash .pi/skills/merge/stages/6-verify.sh
bash .pi/skills/merge/stages/7-cleanup.sh
```

> **注意**：bash 路径不经过 workflow 层的硬门禁，阶段 7 的 `[MANDATORY]` 检查**仅依赖 stages/7-cleanup.sh 自身的 `is_checkpoint`**（软门禁）。优先用 workflow-run。

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

此阶段调用 skill 的 `stages/4-publish.sh`，由 GitHub Actions 执行实际发布：

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace
bash .pi/skills/merge/stages/4-publish.sh patch
```

脚本流程（`stages/4-publish.sh`）：
1. 检测仓库根是否有 `scripts/publish.sh`（项目级发布脚本）
2. 如果存在 → 调用它（通常用于 `gh workflow run` 触发 publish workflow）
3. 如果不存在 → 自行 bump 版本 + tag + push + 等待 Release CI
4. 同步主 worktree 版本号、写入 state

**版本类型参数**：`patch`（默认）/ `minor` / `major`

### 阶段 5: Release

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace
bash .pi/skills/merge/stages/5-release.sh
```

生成 commit 清单 → release notes → **创建/更新 GitHub Release**（stage 4-publish 之后做这一步是为了给 release 提供 commit 列表）。

> **副作用**：`gh release create` 会触发 `.github/workflows/release.yml`（`on: release` 事件）。该 workflow 在 stage 4 已经把 dist archive 上传为 release asset（见 publish.yml "Release Asset" 步骤），所以 release.yml 会把同一批产物重新打包/处理；**不阻塞**阶段 6 验证。
>
> ⚠️ 容易混淆：`release.yml` 不是「4-publish 阶段等待的 CI」——4-publish 阶段等待的是 `publish.yml`（workflow_dispatch 触发）；`release.yml` 是 release 创建后**才**触发的后续 workflow（`on: release` 事件类型）。

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
| 5 | GitHub Actions 发布（4-publish） | `stages/4-publish.sh` |
| 6 | 创建 Release（5-release） | `stages/5-release.sh` |
| 7 | 确认交付物（6-verify） | 阶段 6 手动验证 |
| 8 | 清理 worktree（7-cleanup） | `stages/7-cleanup.sh` |

### 2. 执行约束

- **必须优先调用 `workflow-run` 工具**（`name: 'merge-worktree'`），不要手跑 bash 拼 8 个阶段命令
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
.pi/skills/merge/
  SKILL.md                    # 本文件
  lib/common.sh               # 共享 bash 函数（checkpoint / state / log）
  stages/
    0-init.sh                 # 阶段 0：解析参数、检测环境、写 state
    1-local-check.sh          # 阶段 1：lint + test + build
    2-pr-merge.sh             # 阶段 2：等 PR CI + merge
    3-post-merge-ci.sh        # 阶段 3：等 main 分支 CI
    4-publish.sh              # 阶段 4：bump + tag + push + 等 Release CI
    5-release.sh              # 阶段 5：生成 release notes + 创建/更新 Release
    6-verify.sh               # 阶段 6：⚠️ 交付物门禁（不可跳过）
    7-cleanup.sh              # 阶段 7：删除 worktree + 同步其他 worktree
  scripts/
    publish.sh                # 旧发布方式（参考用，stage 4 优先调用项目级脚本）
    release.sh                # 旧发布方式（参考用）

# 仓库根下的项目级发布脚本（可选，stage 4 会优先调用）：
scripts/publish.sh           # 项目发布脚本（本地触发 GitHub Actions）
```

## 退出码

| 退出码 | 含义 | AI 行为 |
|--------|------|--------|
| 0 | 成功 | 标记 todo completed，继续下一阶段 |
| 1 | 失败 | 查看错误信息，修复后重跑同一阶段 |

---

## Beta 发布（已通过独立 skill 覆盖）

> **重要**：本 skill（`merge-worktree`）**不**覆盖 beta 发布，但项目已有专门 skill 在做这件事——**`.pi/skills/beta-publish/`**。
> AI 收到 "发 beta" / "beta publish" 类指令时，应直接调 `bash .pi/skills/beta-publish/beta-publish.sh`，**不要**走 `merge-worktree`。

### 调用方式

```bash
# 自动 patch bump（推荐给 AI/CI）
bash .pi/skills/beta-publish/beta-publish.sh -y

# 指定版本号
bash .pi/skills/beta-publish/beta-publish.sh -y 0.5.0

# 交互式（带 y/N 确认，给人工用）
bash .pi/skills/beta-publish/beta-publish.sh 0.5.0
```

完整 9 步流程见 `.pi/skills/beta-publish/SKILL.md`。

### 能力对比（merge-worktree vs beta-publish）

| 维度 | `merge-worktree`（stable） | `beta-publish.sh`（beta） |
|------|----------------------------|----------------------------|
| **触发方式** | PR merge main → `gh workflow run publish.yml --ref main` | `git push origin beta-X.Y.Z`（`on: push: branches: ['beta-*']`） |
| **路径** | workflow_dispatch | push |
| **版本号** | patch / minor / major | 显式指定 `X.Y.Z` 或自动 patch bump |
| **npm tag** | `latest` | `beta` |
| **commit + tag + Release** | ✅ | ❌ 跳过 |
| **npm dist-tag** | ✅ latest | ✅ beta |
| **Docker 镜像** | ✅ ghcr.io 多 tag | ❌ 跳过 |
| **dist archive asset** | ✅ | ❌ |
| **本地前置检查** | lint + test + build | gh CLI / 仓库状态 / 当前分支 |
| **所属 skill** | `.pi/skills/merge/`（本 skill） | `.pi/skills/beta-publish/` |

### 为什么 merge-worktree 自身不覆盖 beta

`merge-worktree` 流程的设计假设是 **"PR → merge main → publish"**，这是 stable 路径的天然设计。但 beta 路径在 `publish.yml` 里是**分支级**机制（`on: push: branches: ['beta-*']`），有 4 条拦截：

1. **`merge-worktree` 假设**：PR → merge main → publish 走 `scripts/publish.sh` → `gh workflow run publish.yml --ref main`（永远走 stable 路径）
2. **`publish.yml` beta 触发器**：`on: push: branches: ['beta-*']`——**只能**通过 push 触发，不能通过 `workflow_dispatch`
3. **`scripts/publish.sh` 锁死 main**：`--ref main -f bump_type=patch`——**永远**走 stable 路径
4. **0-init.sh 拒绝 `beta`**：`VERSION_TYPE` 正则 `^(patch|minor|major)$` 白名单，传入 `beta` 会被 exit 1

这 4 条拦截让 "把 beta 塞进 merge-worktree" 成本高（需重写 0/2/3/4/5/6 全部阶段），所以拆为独立 skill 是更经济的设计。

### 未来 TODO

`beta-publish.sh` 升级为 `beta-publish.js` workflow 形式（与 `merge-worktree.js` 同构），提供 `phase()` / `agent()` / 硬门禁 / checkpoint。**当前 scope 不做**。

## 标记说明

| 标记 | 含义 | 修改约束 |
|------|------|----------|
| `[HISTORICAL]` | 历史经验总结的规则 | 不允许删除或削弱 |
| `[MANDATORY]` | 流程强制要求 | 必须严格遵守 |
| `[OPTIONAL]` | 可选步骤 | 可根据项目需求调整 |
