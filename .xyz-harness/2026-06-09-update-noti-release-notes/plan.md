---
verdict: pass
complexity: L1
---

# 更新通知增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task.

**Goal:** 在版本更新通知中展示 release notes，并为 Docker 部署增加国内镜像提示。

**Architecture:** 后端在 `checker.ts` 中新增 release notes 获取（复用已有 `fetchJson`），随 `/upgrade/status` API 返回。前端在 Sidebar Popover 中渲染 markdown + 新增阿里云镜像命令。i18n 新增 key。

**Tech Stack:** Fastify (后端), Vue 3 + shadcn-vue (前端), vue-i18n (i18n)

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/upgrade/checker.ts` | modify | BG1 | 新增 `releaseNotes` 字段和获取逻辑 |
| `router/src/admin/upgrade.ts` | modify | BG1 | status 接口传递 syncSource 给 checker |
| `frontend/src/api/settings-api.ts` | modify | FG1 | UpgradeStatus 接口增加 `releaseNotes` |
| `frontend/src/components/layout/Sidebar.vue` | modify | FG1 | 展示 release notes + 国内镜像命令 |
| `frontend/src/i18n/locales/zh-CN/sidebar.json` | modify | FG1 | 新增 i18n key |
| `frontend/src/i18n/locales/en/sidebar.json` | modify | FG1 | 新增 i18n key |
| `router/tests/upgrade.test.ts` | modify | BG1 | release notes 获取测试 |

---

## Interface Contracts

### Module: upgrade/checker

#### UpgradeStatus (扩展)

| Field | Type | Description |
|-------|------|-------------|
| `releaseNotes` | `string \| null` | 最新版本的 release notes markdown，获取失败为 null |
| `releaseVersion` | `string \| null` | release notes 对应的版本号 |

#### Function: fetchReleaseNotes

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| fetchReleaseNotes | (version: string, source: 'github' \| 'gitee') → Promise\<string \| null\> | markdown string or null | API 404 → null; network error → null | AC-2, AC-3 |

## Spec Coverage Matrix

| Spec AC | Interface Method | Data Flow | Task |
|---------|-----------------|-----------|------|
| AC-1 | checker.getStatus → admin/upgrade status API → Sidebar | checker → API → frontend | Task 1, Task 2 |
| AC-2 | fetchReleaseNotes returns null on failure | checker → API → frontend | Task 1 |
| AC-3 | fetchReleaseNotes uses source param | admin/upgrade passes syncSource | Task 1 |
| AC-4 | Sidebar template renders both commands | — | Task 2 |
| AC-5 | i18n keys in zh-CN/en | — | Task 2 |

## Spec Metrics Traceability

| Spec 指标 | 采纳状态 | 对应 Task |
|-----------|---------|----------|
| AC-1 release notes 展示 | adopted | Task 1, Task 2 |
| AC-2 release notes 降级 | adopted | Task 1 |
| AC-3 来源跟随 syncSource | adopted | Task 1 |
| AC-4 Docker 国内镜像 | adopted | Task 2 |
| AC-5 i18n | adopted | Task 2 |

---

## Task List

### Task 1: 后端 — release notes 获取与 API 返回

**Type:** backend

**Files:**
- Modify: `router/src/upgrade/checker.ts`
- Modify: `router/src/admin/upgrade.ts`
- Modify: `router/tests/upgrade.test.ts`

**Steps:**

- [ ] **Step 1: 扩展 checker.ts 的 UpgradeStatus 接口**

在 `checker.ts` 中：
1. `UpgradeStatus` 接口增加 `releaseNotes: string | null` 和 `releaseVersion: string | null`
2. 新增 `GITHUB_RELEASES_API` 和 `GITEE_RELEASES_API` 常量
3. 新增 `fetchReleaseNotes(version: string, source: 'github' | 'gitee'): Promise<string | null>` 函数
   - GitHub: `GET https://api.github.com/repos/zhushanwen321/llm-simple-router/releases/tags/${version}`
   - Gitee: `GET https://gitee.com/api/v5/repos/zzzzswszzzz/llm-simple-router/releases/tags/${version}`
   - 复用已有 `fetchJson()`，catch 错误返回 null
   - 从响应中提取 `body` 字段（GitHub 和 Gitee 格式一致）
4. `check()` 方法增加 `sourceOverride` 参数，在 `checkNpm()` 完成后（有 latestVersion 时）并行调用 `fetchReleaseNotes`
5. `getStatus()` 返回新增字段

- [ ] **Step 2: 修改 admin/upgrade.ts 传递 syncSource**

`/admin/api/upgrade/status` 接口中：
1. 调用 `c.check()` 前获取 `syncSource`（已有逻辑）
2. 在 `checker.check()` 调用时传入 source，确保 release notes 按用户偏好来源获取

注意：`check()` 已有 `sourceOverride` 参数用于 config 检查，release notes 应复用同一个 source 参数。

- [ ] **Step 3: 编写测试**

在 `router/tests/upgrade.test.ts` 中新增：
1. 测试 `fetchReleaseNotes` 成功获取（mock fetchJson 返回 `{ body: "## v1.0.18\n- fix xxx" }`）
2. 测试 `fetchReleaseNotes` API 失败返回 null
3. 测试 `getStatus()` 包含 `releaseNotes` 字段

- [ ] **Step 4: 运行测试验证**

```bash
cd router && npx vitest run tests/upgrade.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add router/src/upgrade/checker.ts router/src/admin/upgrade.ts router/tests/upgrade.test.ts
git commit -m "feat: fetch release notes from GitHub/Gitee in upgrade checker"
```

---

### Task 2: 前端 — release notes 展示 + Docker 国内镜像 + i18n

**Type:** frontend

**Files:**
- Modify: `frontend/src/api/settings-api.ts`
- Modify: `frontend/src/components/layout/Sidebar.vue`
- Modify: `frontend/src/i18n/locales/zh-CN/sidebar.json`
- Modify: `frontend/src/i18n/locales/en/sidebar.json`

**Steps:**

- [ ] **Step 1: 扩展 UpgradeStatus 类型**

在 `frontend/src/api/settings-api.ts` 的 `UpgradeStatus` 接口中增加：
```typescript
releaseNotes: string | null;
releaseVersion: string | null;
```

- [ ] **Step 2: 新增 i18n key**

`zh-CN/sidebar.json` 的 `upgrade` 对象中新增：
```json
"releaseNotes": "更新说明",
"chinaMirror": "国内网络可使用阿里云镜像："
```

`en/sidebar.json` 的 `upgrade` 对象中新增：
```json
"releaseNotes": "Release Notes",
"chinaMirror": "For China network, use Alibaba Cloud mirror:"
```

- [ ] **Step 3: 修改 Sidebar.vue — release notes 展示**

在版本号对比区域（`v{{ current }} → v{{ latest }}`）下方，新增 release notes 展示区：
1. 条件渲染：`v-if="upgradeStatus?.releaseNotes"`
2. 标题：`{{ t('sidebar.upgrade.releaseNotes') }}`
3. 内容：用 `v-html` 渲染 markdown。由于 release notes 内容来自自己的 GitHub 仓库（可信源），且只有管理员能看到，安全风险可控。用简单的 markdown → HTML 转换：
   - 将 `\n` 转为 `<br>`
   - 将 `## ` 开头的行转为 `<h3>`
   - 将 `- ` 开头的行转为 `<li>`
   - 或者直接引入轻量 `marked` 库（如果项目已有则复用）
4. 限制最大高度 + `overflow-y: auto`，避免超长 notes 撑爆 Popover

- [ ] **Step 4: 修改 Sidebar.vue — Docker 国内镜像提示**

在现有 `ghcr.io` 的 `<code>` 块下方，新增阿里云镜像命令：
1. 新增提示文案：`{{ t('sidebar.upgrade.chinaMirror') }}`
2. 新增 `<code>` 块：`docker pull crpi-x8jmi4kluhnn27nd.cn-shanghai.personal.cr.aliyuncs.com/zhushanwen321/llm-simple-router:latest`

- [ ] **Step 5: 运行前端验证**

```bash
cd frontend && npx vue-tsc -b --noEmit && npx eslint src/components/layout/Sidebar.vue src/api/settings-api.ts --max-warnings=0
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/settings-api.ts frontend/src/components/layout/Sidebar.vue frontend/src/i18n/locales/zh-CN/sidebar.json frontend/src/i18n/locales/en/sidebar.json
git commit -m "feat: display release notes and China Docker mirror in update notification"
```

---

## Execution Groups

#### BG1: 后端 — release notes 获取

**Description:** 后端 checker 扩展 + API 修改 + 测试

**Tasks:** Task 1

**Files (预估):** 3 个文件（0 create + 3 modify）

**Dependencies:** 无

#### FG1: 前端 — release notes 展示 + 镜像提示

**Description:** 前端类型 + UI + i18n

**Tasks:** Task 2

**Files (预估):** 4 个文件（0 create + 4 modify）

**Dependencies:** BG1（需要 API 接口定义确定后才改前端）

## Dependency Graph & Wave Schedule

```
BG1 (后端) → FG1 (前端)

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1 | 后端 checker 扩展 |
| Wave 2 | FG1 | 前端 UI，依赖 BG1 接口定义 |
```
