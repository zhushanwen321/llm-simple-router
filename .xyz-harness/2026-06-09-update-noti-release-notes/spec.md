---
verdict: pass
---

# 更新通知增强：Release Notes 展示 + Docker 国内镜像提示

## Background

当前更新通知只显示版本号对比（v1.0.17 → v1.0.18），不展示更新内容（release notes）。用户需要手动去 GitHub 查看更新了什么。同时，Docker 部署场景只提示 `ghcr.io` 拉取命令，国内网络环境下用户不知道有阿里云镜像可用。

## Functional Requirements

### FR-1: 展示 Release Notes

当检测到新版本时，从 GitHub 或 Gitee API 获取对应版本的 release notes 并展示在版本升级 Popover 中。

- 后端在 `checker.ts` 中新增 release notes 获取逻辑
- GitHub API: `GET https://api.github.com/repos/zhushanwen321/llm-simple-router/releases/tags/{version}`
- Gitee API: `GET https://gitee.com/api/v5/repos/zzzzswszzzz/llm-simple-router/releases/tags/{version}`
- 根据 `syncSource`（用户已配置的来源偏好）决定从哪个 API 获取
- API 失败时静默降级，不阻断版本检查流程
- 前端用 Markdown 渲染展示 release notes

### FR-2: Docker 部署增加国内镜像提示

Docker 部署场景下，在现有 `ghcr.io` 拉取命令下方增加阿里云镜像拉取命令。

- 增加提示文案："国内网络可使用阿里云镜像"
- 展示命令：`docker pull crpi-x8jmi4kluhnn27nd.cn-shanghai.personal.cr.aliyuncs.com/zhushanwen321/llm-simple-router:latest`

### FR-3: i18n 支持

所有新增文案支持中英文。

- Release notes 内容本身是开发者写的 markdown，不做翻译
- UI 标签、提示语需要翻译

## Acceptance Criteria

### AC-1: Release Notes 展示

- **Given** 后端检测到新版本（`npm.hasUpdate === true`）
- **When** 前端请求 `/admin/api/upgrade/status`
- **Then** 响应中包含 `releaseNotes` 字段（markdown 字符串，可为 null）
- **And** 前端 Popover 中在版本号下方渲染 release notes（Markdown → HTML）

### AC-2: Release Notes 降级

- **Given** GitHub/Gitee API 请求失败或返回空
- **When** 前端请求 status
- **Then** `releaseNotes` 为 null，Popover 正常显示（不展示 notes 区域，不报错）

### AC-3: Release Notes 来源跟随 syncSource

- **Given** 用户 syncSource 设置为 `gitee`
- **When** 后端获取 release notes
- **Then** 从 Gitee API 获取（而非 GitHub）

### AC-4: Docker 国内镜像提示

- **Given** 部署方式为 Docker
- **When** Popover 显示更新提示
- **Then** 同时展示 `ghcr.io` 和阿里云镜像两条拉取命令
- **And** 阿里云镜像前有"国内网络"提示文案

### AC-5: i18n

- **Given** 用户语言设置为中文/英文
- **When** Popover 展示
- **Then** 所有新增 UI 文案正确显示对应语言
- **And** release notes 内容（markdown）不翻译，原样展示

## Constraints

- 不引入新的 markdown 渲染库。前端已有依赖的话复用，否则用简单的 `v-html` + 基础安全处理（sanitize）
- Release notes 获取不能阻塞版本检查流程。`checkNpm` 和 release notes 获取并行执行，任一失败不影响另一
- 后端缓存的 release notes 随版本检查周期刷新（每小时），不额外增加 API 请求频率
- Gitee 当前无 release 数据，API 返回 404 时应优雅降级

## 业务用例

### UC-1: 用户查看新版本更新内容
- **Actor**: 系统管理员
- **场景**: 系统检测到新版本，管理员点击 Sidebar 版本号查看详情
- **预期结果**: Popover 中展示版本号对比 + release notes + 升级/拉取命令

### UC-2: Docker 用户使用国内镜像更新
- **Actor**: 使用 Docker 部署的系统管理员
- **场景**: 检测到新版本，管理员查看更新提示
- **预期结果**: 看到两条 docker pull 命令（ghcr + 阿里云），明确标注"国内网络"适用场景

## Complexity Assessment

**L1** — 扩展现有模型和 UI，无新概念、无新表、无跨服务协调。改动集中在 3 个后端文件 + 1 个前端文件 + 2 个 i18n JSON。
