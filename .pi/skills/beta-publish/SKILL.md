---
name: beta-publish
description: >-
  Use when the user wants to publish a beta prerelease for llm-simple-router.
  Publishes both npm package (@beta dist-tag) and Docker image (:beta tag).
  Triggers: "beta 发布", "beta publish", "发beta包", "beta包", "docker beta".
  Not for official releases (use merge skill instead).
---

# Beta Prerelease 发布（llm-simple-router）

## 适用范围

- 项目：`llm-simple-router`
- **适用**：发布 prerelease 到 npm（`--tag beta`）和 Docker（`:beta` tag）
- **不适用**：正式发布（用 merge skill）、单文件调试、本地测试

## 执行

```bash
bash beta-publish.sh [-y] [目标版本号]
```

参数：
- `-y` / `--yes`：跳过交互确认（AI 调用时必带）
- `目标版本号`（可选）：如 `1.0.3`。不传则 patch bump 自动计算
- 必须在 worktree 根目录执行（需要 `router/package.json` 和 git）
- bash timeout >= 300s（CI 构建约 2-3 分钟）

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

## 失败处理

| 场景 | 排查 |
|------|------|
| CI 失败 | `gh run view <ID> --log-failed`，修复后重新执行脚本 |
| npm 版本冲突 | 通常不会发生（SHA 保证唯一），如发生检查 registry 已有版本 |
| 分支已存在 | 脚本自动清理旧 beta 分支后重建 |

## CI 触发

`publish.yml`：`beta-*` 分支 push → 自动计算版本号 → 同步发布：

1. `npm publish --tag beta`（prerelease 包）
2. Docker 镜像推送 GHCR + 阿里云 ACR（tag：精确版 `1.0.3-beta.sha` + 滚动 `beta`）

**不创建 GitHub Release、不升级正式版本号、不占用 `latest`**——这些仅在 main 正式发布时发生。

---

## 标记说明

| 标记 | 含义 | 修改约束 |
|------|------|----------|
| `[HISTORICAL]` | 历史经验总结的规则 | 不允许删除或削弱 |
| `[MANDATORY]` | 流程强制要求 | 必须严格遵守 |
| `[OPTIONAL]` | 可选步骤 | 可根据项目需求调整 |
