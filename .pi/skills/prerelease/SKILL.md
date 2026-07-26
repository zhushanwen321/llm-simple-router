---
name: prerelease
description: >-
  发布 llm-simple-router 预发布版本（beta dist-tag）用于测试。
  创建 beta-* 分支，自动计算 prerelease 版本号，push 触发 CI 发布到
  npm @beta tag + Docker :beta tag，轮询验证后还原代码。
  触发词："预发布"、"prerelease"、"发beta包"、"测试发布"。
  仅用于 llm-simple-router 项目。不用于正式发布——那个用 merge skill。
---

# prerelease

## 概述

发布 llm-simple-router 的预发布版本（`-beta.*` 后缀），发布到 npm `beta` dist-tag 和 Docker `:beta` tag。
消费者通过 `npm install -g llm-simple-router@beta` 或 `docker pull ghcr.io/.../llm-simple-router:beta` 安装测试版本。

**与 beta-publish skill 的区别**：

| 维度 | prerelease（本 skill） | beta-publish |
|------|------------------------|--------------|
| 版本号 | 自动 patch bump（1.0.2 → 1.0.3-beta.N） | 需手动指定目标版本号 |
| 交互模式 | 全自动（-y flag） | 需确认 |
| 还原机制 | CI 成功后询问是否还原 | 不还原 |
| 触发词 | "预发布"、"prerelease" | "beta 发布"、"发 beta 包" |

**核心流程**：

1. 确认工作区干净（当前分支，非 main 也可）
2. 创建 `beta-*` 分支
3. push 触发 `publish.yml` CI
4. 轮询 CI 直到 npm 版本可见
5. 验证：`npm view llm-simple-router@beta` 版本号更新
6. 用户确认测试通过后，还原代码（切回原分支，删 beta 分支）

## AI 操作步骤

### [MANDATORY] 1. 执行预发布脚本

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace/fix-deepseek-string
bash .pi/skills/prerelease/prerelease.sh -y
```

参数说明：
- `-y` / `--yes`：跳过交互确认（AI 调用时必带）
- `目标版本号`（可选）：如 `1.0.3`。不传则 patch bump 自动计算
- 必须在 worktree 根目录执行（需要 `router/package.json` 和 git）
- bash timeout >= 300s（CI 构建约 2-3 分钟）

脚本自动执行所有阶段。AI 只需执行这一步，等待脚本完成。

**脚本 exit 0 前不得宣布"已完成"。** 脚本内部已包含 CI 轮询和 npm 版本验证。

### [MANDATORY] 2. 通知测试安装方式

脚本完成后输出安装命令：

```bash
# 消费者安装 beta 版（npm）
npm install -g llm-simple-router@beta
# 或精确版本
npm install -g llm-simple-router@1.0.3-beta.2

# Docker（GHCR）
docker pull ghcr.io/zhushanwen321/llm-simple-router:beta

# Docker（阿里云 ACR，国内更快）
docker pull <ACR_REGISTRY>/zhushanwen321/llm-simple-router:beta
```

### [MANDATORY] 3. 确认还原

脚本最后会询问"测试通过？输入 yes 还原版本"。
AI 必须等待用户明确确认后再输入 `yes`。

## 版本号规则

```
当前正式版 1.0.2 → beta 目标 1.0.3
首次发布 → CI 查 registry → 1.0.3-beta.1
重复跑   → CI 查到 beta.1 存在 → 1.0.3-beta.2
```

| 规则 | 说明 |
|------|------|
| 格式 | `{next}-beta.{N}`（N 为递增整数，semver prerelease 标准） |
| next | 当前 version 的 patch bump，或用户指定 |
| N | CI 查询 npm registry 该系列已发布最大编号 +1，首次为 beta.1 |
| 重复跑 | 同分支重跑自动递增 N，npm publish 不冲突（registry 无重复版本） |
| 排序 | `1.0.3-beta.1 < 1.0.3-beta.2 < 1.0.3`（semver 标准排序，正式版始终大于 beta） |
| @beta | npm dist-tag 滚动指向最新 beta（如 beta.2 发布后 @beta 指向 beta.2） |
| @latest | 不受影响，始终指向最后一个正式版 |

## 发布产物

### npm

| dist-tag | 指向 | 拉取 |
|----------|------|------|
| `@beta` | 最新 beta 版本（滚动覆盖） | `npm i -g llm-simple-router@beta` |
| `@latest` | 最后一个正式版（不受 beta 影响） | `npm i -g llm-simple-router` |

精确拉某次 beta：`npm i -g llm-simple-router@1.0.3-beta.2`

### Docker（GHCR + 阿里云 ACR）

| tag | 指向 | GHCR 拉取 |
|-----|------|-----------|
| `:beta` | 最新 beta（滚动覆盖） | `docker pull ghcr.io/zhushanwen321/llm-simple-router:beta` |
| `:1.0.3-beta.sha` | 精确 beta（每次不同） | `docker pull ghcr.io/.../llm-simple-router:1.0.3-beta.a1b2c3d` |
| `:latest` / `:v1.0.2` | 正式版（不受 beta 影响） | `docker pull ghcr.io/.../llm-simple-router:latest` |

阿里云 ACR 同步推送相同 tag（`beta` 滚动 + 精确版），`latest` 仅正式发布时更新。

**关键保证**：beta 发布**永远不会**覆盖 `latest`——`latest` 仅在 main 分支正式发布（workflow_dispatch）时产生。

## 前置条件

| 条件 | 检查方式 |
|------|---------|
| GitHub repo 有 `NPM_TOKEN` secret | `gh secret list --repo zhushanwen321/llm-simple-router` 含 NPM_TOKEN |
| gh CLI 已登录 | `gh auth status` |
| 工作区干净或可自动提交 | `git status --porcelain` |

## 常见错误

| 错误做法 | 正确做法 |
|---------|---------|
| 手动 `npm version` + `npm publish` | 运行 `bash .pi/skills/prerelease/prerelease.sh -y`，走 CI 流程 |
| 脚本还在跑 CI 轮询就说"已完成" | 必须等脚本 exit 0 |
| 跳过 npm 版本验证直接说"应该发布了" | 脚本自动 `npm view` 验证，等它输出结果 |
| 在 main 分支直接操作 | 脚本自动创建 beta-* 分支 |

## 故障恢复

脚本失败后，检查 beta-* 分支状态：

```bash
# 查看 CI 日志
gh run list --workflow=publish.yml --branch=beta-1.0.3 --limit 3

# 手动验证 npm 版本
npm view llm-simple-router@beta version

# 手动还原（如果脚本中途失败）
git checkout main
git branch -D beta-*
git push origin --delete beta-* 2>/dev/null || true
```

---

## 标记说明

| 标记 | 含义 | 修改约束 |
|------|------|----------|
| `[HISTORICAL]` | 历史经验总结的规则 | 不允许删除或削弱 |
| `[MANDATORY]` | 流程强制要求 | 必须严格遵守 |
| `[OPTIONAL]` | 可选步骤 | 可根据项目需求调整 |
