---
name: beta-publish
description: >-
  Use when the user wants to publish a beta prerelease npm package for
  llm-simple-router. Triggers: "beta 发布", "beta publish", "发beta包",
  "beta包". Not for official releases (use merge skill instead).
---

# Beta Prerelease 发布（llm-simple-router）

## 适用范围

- 项目：`llm-simple-router`
- **适用**：发布 `--tag beta` 的 prerelease 包到 npm
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
当前正式版 1.0.2 → beta 目标 1.0.3 → CI 发布 1.0.3-beta.{SHA}
```

| 规则 | 说明 |
|------|------|
| 格式 | `{next}-beta.{shortSha}`（合法 semver prerelease） |
| next | 当前 version 的 patch bump，或用户指定 |
| 排序 | `1.0.3-beta.a1b < 1.0.3-beta.f4e < 1.0.3`（正式版始终大于 beta） |
| @beta | npm dist-tag 自动指向最新 beta |
| @latest | 不受影响，始终指向最后一个正式版 |

同一目标版本可多次发布（每次 SHA 不同）。正式版发布后 `@latest` 覆盖。

## 失败处理

| 场景 | 排查 |
|------|------|
| CI 失败 | `gh run view <ID> --log-failed`，修复后重新执行脚本 |
| npm 版本冲突 | 通常不会发生（SHA 保证唯一），如发生检查 registry 已有版本 |
| 分支已存在 | 脚本自动清理旧 beta 分支后重建 |

## CI 触发

`publish.yml`：`beta-*` 分支 push → 自动计算版本号 → `npm publish --tag beta`。
不创建 GitHub Release、不推送 Docker 镜像（仅 main 正式发布）。

---

## 标记说明

| 标记 | 含义 | 修改约束 |
|------|------|----------|
| `[HISTORICAL]` | 历史经验总结的规则 | 不允许删除或削弱 |
| `[MANDATORY]` | 流程强制要求 | 必须严格遵守 |
| `[OPTIONAL]` | 可选步骤 | 可根据项目需求调整 |
