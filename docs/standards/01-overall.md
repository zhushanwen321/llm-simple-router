# 01 - 整体项目规范

> 本文档定义 llm-simple-router 项目的整体结构、分支策略、质量门禁、Git 规范、发布流程和 Dev-Flow 工作流。
> 前端/后端的具体编码规范分别参见 `02-frontend.md` 和 `03-backend.md`。

---

## 目录

- [1. 项目结构](#1-项目结构)
  - [1.1 Monorepo 布局](#11-monorepo-布局)
  - [1.2 为什么选择 Monorepo](#12-为什么选择-monorepo)
  - [1.3 Workspace 模式](#13-workspace-模式)
- [2. 分支策略](#2-分支策略)
  - [2.1 分支模型](#21-分支模型)
  - [2.2 为什么不用 develop 分支](#22-为什么不用-develop-分支)
  - [2.3 分支命名规范](#23-分支命名规范)
  - [2.4 分支生命周期](#24-分支生命周期)
- [3. 质量门禁](#3-质量门禁)
  - [3.1 四道防线概览](#31-四道防线概览)
  - [3.2 第一道：Git Pre-commit Hook](#32-第一道git-pre-commit-hook)
  - [3.3 第二道：taste-lint 自定义 ESLint 插件](#33-第二道taste-lint-自定义-eslint-插件)
  - [3.4 第三道：GitHub Actions CI](#34-第三道github-actions-ci)
  - [3.5 第四道：代码品味原则](#35-第四道代码品味原则)
  - [3.6 为什么需要四道防线](#36-为什么需要四道防线)
- [4. Git 规范](#4-git-规范)
  - [4.1 Pull 使用 Rebase](#41-pull-使用-rebase)
  - [4.2 Commit 信息规范](#42-commit-信息规范)
  - [4.3 禁止 eslint-disable](#43-禁止-eslint-disable)
  - [4.4 认证与推送](#44-认证与推送)
- [5. 发布流程](#5-发布流程)
  - [5.1 一键发布架构](#51-一键发布架构)
  - [5.2 触发方式](#52-触发方式)
  - [5.3 Workflow 执行步骤](#53-workflow-执行步骤)
  - [5.4 发布后验证](#54-发布后验证)
  - [5.5 版本规则](#55-版本规则)
  - [5.6 为什么选择 CI 发布而非本地发布](#56-为什么选择-ci-发布而非本地发布)
- [6. Worktree 规范](#6-worktree-规范)
  - [6.1 为什么使用 Bare Repo + Worktree](#61-为什么使用-bare-repo--worktree)
  - [6.2 创建 Worktree](#62-创建-worktree)
  - [6.3 合并前验证](#63-合并前验证)
  - [6.4 清理 Worktree](#64-清理-worktree)
- [7. 测试规范](#7-测试规范)
  - [7.1 测试框架与配置](#71-测试框架与配置)
  - [7.2 测试模式](#72-测试模式)
  - [7.3 测试覆盖率](#73-测试覆盖率)
  - [7.4 验收标准覆盖矩阵](#74-验收标准覆盖矩阵)
  - [7.5 为什么选择组件测试而非端到端测试](#75-为什么选择组件测试而非端到端测试)
- [8. Dev-Flow 工作流](#8-dev-flow-工作流)
  - [8.1 xyz-harness 阶段](#81-xyz-harness-阶段)
  - [8.2 评审不可跳过原则](#82-评审不可跳过原则)
  - [8.3 算法类需求行为表](#83-算法类需求行为表)
  - [8.4 评审修复走 PR](#84-评审修复走-pr)
  - [8.5 为什么强制评审](#85-为什么强制评审)
- [9. 常用命令速查](#9-常用命令速查)
- [10. 环境变量](#10-环境变量)

---

## 1. 项目结构

### 1.1 Monorepo 布局

```
llm-simple-router/
├── package.json              # 根 package.json（workspaces 配置）
├── router/                   # 后端：Fastify + SQLite + TypeScript
│   ├── src/                  #   源码
│   ├── dist/                 #   构建产物
│   ├── taste-lint/           #   自定义 ESLint 插件
│   ├── vitest.config.ts      #   测试配置
│   └── package.json          #   后端依赖
├── frontend/                 # 前端：Vue 3 + shadcn-vue + Tailwind
│   ├── src/                  #   源码
│   ├── dist/                 #   构建产物
│   └── package.json          #   前端依赖
├── pi-extension/             # Pi 编码代理扩展
│   └── package.json          #   扩展依赖
├── .githooks/                # Git hooks
│   ├── install-hooks.sh      #   Hook 安装脚本
│   └── vue_rules_checker.py  #   Vue 组件规范检查
├── .github/workflows/        # GitHub Actions
│   ├── ci.yml                #   CI 流水线
│   ├── publish.yml           #   发布流水线
│   └── release.yml           #   Release 流水线
├── scripts/                  # 工具脚本
│   ├── publish.sh            #   一键发布
│   ├── release.sh            #   手动发布（备用）
│   └── build.mjs             #   完整构建脚本
├── docs/                     # 文档
│   ├── designs/              #   HTML 交互原型
│   └── standards/            #   项目规范文档
└── config/                   # 运行时配置
    └── model-directory.json  #   模型元数据目录
```

### 1.2 为什么选择 Monorepo

| 考量 | Monorepo 的优势 |
|------|----------------|
| **API 契约同步** | 后端 Admin API 变更时，前端调用代码在同一仓库，能立即发现类型不匹配 |
| **统一版本管理** | 前后端在同一个 commit 中发布，不存在前后端版本不同步的问题 |
| **原子化变更** | 一个 PR 可以同时修改后端接口和前端页面，避免跨仓库协调 |
| **共享 CI/CD** | 一套 CI 配置覆盖全部子包，减少维护成本 |
| **taste-lint 共享** | 自定义 ESLint 插件放在仓库根目录，前后端都能引用 |

npm workspaces 配置：

```json
{
  "workspaces": ["router", "pi-extension", "frontend"]
}
```

这意味着 `npm install` 在根目录执行时，三个子包的依赖统一提升（hoisted）到根 `node_modules/`，同时保持各子包的 `package.json` 独立。

### 1.3 Workspace 模式

项目使用 **bare repo + git worktree** 模式。仓库结构如下：

```
llm-simple-router-workspace/       # Workspace 根目录
├── .bare/                         # Bare repository（Git 数据）
├── main/                          # main 分支的 worktree
├── feat-some-feature/             # 功能分支的 worktree
└── fix-some-bug/                  # 修复分支的 worktree
```

这种模式的优势：
- 多个分支可以**同时存在**于不同目录，无需 `git stash` 或 `git checkout`
- 每个分支有独立的 `node_modules/`，切换分支不需要重装依赖
- 编译产物互不干扰，可以同时运行不同分支的开发服务器

---

## 2. 分支策略

### 2.1 分支模型

项目采用 **trunk-based development**（主干开发）模型：

```
main ────────────────────────────────────────────── 始终稳定可发布
  │
  ├── feat/frontend-redesign ────── PR ───→ 合并到 main
  │
  ├── fix/semaphore-leak ────────── PR ───→ 合并到 main
  │
  └── refactor/proxy-layers ─────── PR ───→ 合并到 main
```

核心规则：
- **`main` 分支始终处于可发布状态** — 任何时间点 checkout main 都能构建通过、测试通过
- 功能分支基于 `main` 创建，完成后通过 **PR 直接合并到 main**
- 不存在 `develop`、`staging`、`release/*` 等中间分支

### 2.2 为什么不用 develop 分支

| develop 分支的问题 | trunk-based 的解决方式 |
|-------------------|----------------------|
| develop 和 main 长期分叉，合并冲突累积 | 功能分支生命周期短，冲突少且范围小 |
| "develop 上能跑但 main 上不能跑" | main 始终是唯一真相来源 |
| 需要 release 分支来冻结版本 | CI + feature flag 控制发布 |
| 多分支同步维护成本高 | 只维护一条主干 |

### 2.3 分支命名规范

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat/` | 新功能 | `feat/streaming-proxy` |
| `fix/` | Bug 修复 | `fix/semaphore-timeout` |
| `refactor/` | 重构（不改变外部行为） | `refactor/proxy-layers` |
| `chore/` | 杂项（依赖升级、配置调整等） | `chore/bump-deps` |

命名原则：
- 使用**小写英文**，单词间用 `-` 连接
- 名称应**概括功能**而非实现细节（`feat/image-redirect` 而非 `feat/add-if-check-in-routing`）
- 避免使用个人标识（不要 `feat/john-new-ui`）

### 2.4 分支生命周期

```
创建分支 → 编码 → 本地验证 → 推送 → 创建 PR → CI 通过 → Code Review → 合并 → 清理
   │                                                          │
   └── 理想情况下不超过 1 周 ──────────────────────────────────┘
```

长时间存活的分支风险：
- 与 main 的差异越来越大，合并冲突难以解决
- main 上的变更无法及时同步到功能分支
- 其他人的 PR 可能已经改变了你依赖的接口

---

## 3. 质量门禁

### 3.1 四道防线概览

```
代码提交         代码推送          PR 合并
   │                │                │
   ▼                ▼                ▼
┌──────────┐  ┌──────────┐  ┌──────────────┐
│ Pre-commit│  │  CI      │  │ Code Review  │
│ Hook      │  │ Pipeline │  │ (人工+品味)   │
├──────────┤  ├──────────┤  ├──────────────┤
│ Prettier  │  │ tsc      │  │ spec 合规     │
│ ESLint    │  │ vitest   │  │ 架构一致性    │
│ vue-tsc   │  │ eslint   │  │ 品味原则      │
│ 规范检查  │  │ Docker   │  │ 数据消费者    │
│ 品味规则  │  │          │  │ 完整性        │
└──────────┘  └──────────┘  └──────────────┘
    ↓              ↓              ↓
  拦截格式问题   拦截编译/测试   拦截设计/架构
  和显式违规     错误           级问题
```

四道防线各司其职：
1. **Pre-commit Hook** — 最快反馈（秒级），拦截格式、lint、类型错误
2. **taste-lint** — 运行时静态分析（毫秒级），拦截编码模式反模式
3. **CI Pipeline** — 独立环境验证，确保本地环境不影响结果
4. **代码品味原则** — 人工评审兜底，处理自动化工具无法覆盖的设计问题

### 3.2 第一道：Git Pre-commit Hook

**位置**：`.githooks/install-hooks.sh`（通过 `npm prepare` 自动安装）

**安装机制**：脚本将 pre-commit hook 写入 `$(git rev-parse --git-path hooks)/pre-commit`。在 bare repo + worktree 模式下，`--git-path hooks` 返回 bare repo 级共享目录，确保所有 worktree 共享同一份 hook。

#### 检查阶段

| 阶段 | 检查内容 | 失败处理 | 跳过方式 |
|------|---------|---------|---------|
| 0. Prettier 格式化 | `.vue`、`.ts`、`.css` 文件自动格式化 | 自动修复并 `git add` | `SKIP_FORMAT=1` |
| 1. 前端 ESLint | `frontend/` 下的 `.vue`、`.ts` 文件 | 先 `--fix` 再检查，仍失败则阻止提交 | `SKIP_FRONTEND_LINT=1` |
| 1.5. 后端 ESLint | `router/src/` 下的 `.ts` 文件 | 阻止提交 | `SKIP_BACKEND_LINT=1` |
| 2. vue-tsc 类型检查 | 前端全量类型检查（清除增量缓存） | 阻止提交 | `SKIP_TYPE_CHECK=1` |
| 3. 代码规范检查 | `vue_rules_checker.py` 四项硬性规范 | 阻止提交 | `SKIP_CODE_RULES_CHECK=1` |
| 4. 路径前缀检查 | `startsWith("/xxx")` 可能的路径匹配问题 | 警告（不阻止） | `SKIP_CODE_RULES_CHECK=1` |

**一键跳过**：`SKIP_ALL_CHECKS=1` 跳过所有检查（仅紧急情况使用）。

#### vue_rules_checker.py 四项硬性规范

| 规范 | 为什么 |
|------|-------|
| 禁止原生 HTML 元素（button/input/select 等） | 强制使用 shadcn-vue 组件，保证 UI 一致性和可维护性 |
| 禁止 Emoji | 使用 lucide-vue-next 图标库，跨平台渲染一致 |
| 禁止自定义 CSS 选择器 | `<style scoped>` 内只允许 `@apply`，强制使用 Tailwind 设计系统 |
| 行数上限（template 800 行、script 600 行） | 防止单文件组件膨胀，超出意味着需要拆分 |

#### 为什么 Pre-commit 而不是 CI-only

| 维度 | Pre-commit Hook | CI-only |
|------|----------------|---------|
| 反馈速度 | 秒级 | 分钟级 |
| 开发体验 | 提交前即时修正 | 提交后等 CI 结果，打断思路 |
| 网络依赖 | 无 | 需要 push 到 GitHub |
| 基本错误拦截率 | 高（格式、lint、类型） | 相同，但延迟发现 |

### 3.3 第二道：taste-lint 自定义 ESLint 插件

**位置**：`taste-lint/`（注册为 `eslint-plugin-taste`）

taste-lint 拦截的是**编码模式**层面的反模式——不是格式错误，不是类型错误，而是"这段代码写法将来大概率出 bug"的模式。

#### 12 条规则

| 规则 | 级别 | 拦截的问题 | 为什么需要 |
|------|------|-----------|-----------|
| `prefer-allsettled` | warn | 独立数据源使用 `Promise.all` | 一个请求失败会导致所有结果丢失，用 `allSettled` 保证部分失败不影响其他 |
| `no-silent-catch` | warn | 空的 `catch` 块或仅 `console.log` | 错误被静默吞掉，排查问题时无法定位原因 |
| `no-unsafe-object-entries` | warn | `Object.entries()` 后拼 SQL/配置 | 原型链属性或意外字段注入安全风险，必须白名单过滤 |
| `no-hardcoded-colors` | warn | Tailwind 原始色名如 `bg-red-500` | 强制使用 CSS 变量/语义 token，保证亮暗模式一致性 |
| `no-magic-spacing` | warn | 任意值间距如 `p-[17px]` | 强制使用标准 Tailwind scale，保证间距系统一致 |
| `no-deprecated-rule-format` | warn | 访问已废弃的 `rule.default`/`rule.windows` | 数据格式已迁移，旧字段访问会得到 undefined |
| `no-raw-json-parse-models` | error | 直接 `JSON.parse(provider.models)` | `models` 字段从 `string[]` 演进到 `ModelEntry[]`，裸解析会丢失新字段 |
| `no-unsafe-string-conversion` | warn | 对非原始类型使用 `String()` | `String({})` 输出 `[object Object]`，不是有意义的字符串 |
| `no-unbounded-while-true` | warn | `while(true)` 无迭代上限 | 无限循环风险，必须加计数器 + 上限检查 |
| `no-inline-import-type` | warn | 行内 `as import(...).Type` | 应在文件顶部统一 import 类型，提高可读性和可维护性 |
| `no-eslint-disable` | githook | 使用 `// eslint-disable` 跳过规则 | 所有问题必须正面解决（提取常量、拆分函数等），禁止绕过 |

#### 基础 ESLint 规则

| 规则 | 级别 | 说明 |
|------|------|------|
| `no-explicit-any` | error | 禁止 `any`，用 `unknown` 或具体类型替代 |
| `max-lines` | 1000 行 | 单文件行数上限 |
| `max-lines-per-function` | 300 行 | 单函数行数上限 |
| `no-magic-numbers` | warn | 魔法数字必须提取为命名常量 |
| `no-eval` | error | 禁止 `eval` |

#### 为什么自建 ESLint 插件而非用现成规则

现成的 ESLint 规则无法覆盖**项目特定的数据契约**（如 `providers.models` 的格式演进）和**项目特定的编码模式**（如独立请求必须用 `allSettled`）。这些规则来源于项目实际踩过的坑，每个规则背后至少有一次线上 bug 或严重调试困难的教训。

### 3.4 第三道：GitHub Actions CI

**位置**：`.github/workflows/ci.yml`

#### CI 流水线

```
push / PR (paths-ignore: *.md, docs/, .xyz-harness/, LICENSE)
  │
  ├── test job (ubuntu-latest)
  │   ├── npm ci
  │   ├── cd router && npm run build          # 后端 TypeScript 编译
  │   ├── cd router && npm run lint           # 后端 lint（零警告）
  │   ├── cd pi-extension && npx tsc --noEmit  # 扩展类型检查
  │   ├── cd frontend && npx vue-tsc -b --noEmit  # 前端类型检查
  │   ├── cd frontend && npx eslint . --max-warnings=0  # 前端 lint
  │   ├── npm run test -w router              # Vitest 后端全量测试
  │   └── cd frontend && npx vitest run       # 前端组件测试
  │
  └── docker job (ubuntu-latest, only on push)
      ├── Docker 登录 GHCR
      ├── 构建镜像
      └── 推送到 GHCR (仅 main 分支)
```

**关键设计决策**：

| 决策 | 原因 |
|------|------|
| `paths-ignore: *.md` | 文档变更不应触发 CI，节省资源 |
| pi-extension 的 `tsc --noEmit` | 跨子包类型错误会传播，必须检查所有子包 |
| frontend vue-tsc + eslint 在 CI | 本地 pre-commit 可跳过（`SKIP_TYPE_CHECK=1`），CI 做最终兜底 |
| 前端 vitest 在 CI | 目前覆盖不足（仅 1 个测试文件），CI 运行作为质量门禁起点 |
| Docker job 仅在 push 时运行 | PR 不需要构建 Docker 镜像 |
| Docker push 仅 main 分支 | 非主分支的镜像没有发布价值 |

### 3.5 第四道：代码品味原则

品味原则是自动化工具无法覆盖的编码规范。它们需要开发者在 Code Review 时自觉检查。

| 原则 | 反例 | 为什么 |
|------|------|-------|
| **兜底响应** | `failover-loop.ts` 缺少兜底响应 | 所有 catch/default 必须发送响应，否则客户端永远挂起 |
| **完整错误提取** | `transformError` 只取 message | 上游错误包含 message+code+type，丢失 code 导致无法区分错误类型 |
| **幂等注册** | `register()` 允许同一 hook 重复注册 | 重复注册导致同一逻辑执行多次，引发状态错误 |
| **structuredClone** | 用 `JSON.parse(JSON.stringify())` 深拷贝 | JSON roundtrip 丢失 undefined、Date、RegExp 等，Node 17+ 原生支持 |
| **SSE data 拼接** | 多行 data 直接拼接 | SSE 协议要求 `\n` 连接，直接拼接破坏事件边界 |
| **插件过滤一致性** | onError 缺少 provider 过滤 | beforeRequest 过滤了但 onError 没有，导致插件处理了不该处理的请求 |
| **headers 安全** | 日志中写入未脱敏的 authorization | 密钥泄露到日志文件中 |
| **Hook 降级** | Hook execute() 无 try-catch | Hook 异常传播到调用链，一个 Hook 崩溃导致整个请求失败 |
| **数据消费者完整性** | 新字段漏了 SSE 实时监控推送 | 新增字段时必须列出所有消费点（DB、SSE、API、前端），遗漏即 bug |
| **前端控件模式一致** | Switch 直调 API | 编辑→保存模式的页面禁止控件直调 API，保证用户可以撤销 |
| **Hook 注册验证** | Hook 仅注册到 hookRegistry | hookRegistry 只是查询表，必须同时注册到 proxyPipeline 并验证 emit 路径 |
| **Prepared Statement 缓存** | 函数内每次调用 `.prepare()` 重复编译 SQL | 高频路径（映射解析、请求日志入库）的 SQL 应缓存复用，见 `getCachedStmt()` 模式 |
| **SSE 流背压处理** | 无视 `socket.writableNeedDrain` | Node.js 官方强调 SSE 代理必须处理背压，否则高并发下内存暴涨 |
| **上游响应体大小限制** | 未限制上游响应读取量 | 恶意上游可发送无限大响应导致 OOM，必须有合理的 body size limit |
| **连接池隔离** | 多 Provider 共享同一 Agent 池 | 单 Provider 占满连接会影响其他 Provider 的请求，应按 Provider 维度隔离 |
| **日志清理分批** | `DELETE FROM request_logs WHERE created_at < ?` 一次删数万行 | 长事务持有 WAL 锁阻塞其他写入，必须加 LIMIT 分批 DELETE |

### 3.6 为什么需要四道防线

单一防线不足的原因：

| 维度 | Pre-commit Hook | taste-lint | CI | 品味原则 |
|------|----------------|------------|----|---------|
| 能否绕过 | 能（`SKIP_ALL_CHECKS`） | 能（`eslint-disable`，但我们禁止了） | 不能 | 主观判断 |
| 检查范围 | 变更文件 | 变更文件 | 全量 | 变更文件 |
| 设计/架构检查 | 否 | 否 | 否 | 是 |
| 环境一致性 | 依赖本地环境 | 依赖本地环境 | 独立环境 | 不涉及 |

四道防线层层递进：自动化工具处理可模式化的问题，人工评审处理需要设计判断的问题。任何一层都不足以独立保证质量。

> **交付一个 feature 时该检查什么？** 详见 `06-delivery.md` —— 从「我要交付了」视角的可执行 checklist（D1-D6 六维度），覆盖功能完整性、静态门禁、测试有效性、文档卫生、Git 卫生、门禁执行。本文档讲门禁机制怎么配，`06-delivery.md` 讲交付前怎么逐项验证。

---

## 4. Git 规范

### 4.1 Pull 使用 Rebase

```bash
# 正确
git pull --rebase origin main

# 错误（会产生 merge commit）
git pull origin main
```

**为什么禁止 merge commit**：

```
# merge 产生的噪音
*   abc123 Merge branch 'feat/xxx' into main
|\
| * def456 feat: add new feature
| * ghi789 fix: edge case
|/
* jkl012 previous commit

# rebase 产生的干净历史
* def456 feat: add new feature
* ghi789 fix: edge case
* jkl012 previous commit
```

merge commit 在 bisect、revert、blame 时都会造成干扰。rebase 保持线性历史，每个 commit 都是功能性的。

### 4.2 Commit 信息规范

- **语言**：英文（与代码保持一致）
- **格式**：Conventional Commits 风格，但**不强制**

```
# 推荐
feat: add image redirect for vision models
fix: resolve semaphore leak on abort signal
refactor: extract resilience layer from orchestrator
chore: bump dependencies

# 也可接受（简单描述）
add retry count to log metadata
```

- 前缀建议：`feat:`、`fix:`、`refactor:`、`chore:`、`docs:`、`test:`
- 描述应说明**做了什么**（what），而非**为什么做**（why 放在 PR 描述中）

### 4.3 禁止 eslint-disable

```typescript
// 禁止
// eslint-disable-next-line no-magic-numbers
const timeout = 5000;

// 正确：提取命名常量
const REQUEST_TIMEOUT_MS = 5000;
```

**双重保障**：
1. `taste/no-eslint-disable` ESLint 规则（注册但未完全启用，因历史代码中存在大量注释）
2. Pre-commit hook 中的 grep 检测

历史代码中的 eslint-disable 注释在 PR 合并时逐步清理。新代码中**绝对不允许**添加。

### 4.4 认证与推送

- GitHub 推送通过 `GITHUB_TOKEN` 认证
- 遇到认证问题时，可使用：
  ```bash
  git push https://oauth2:$(gh auth token)@github.com/<用户>/<仓库>.git HEAD:main
  ```
- `gh` CLI 优先于直接 `git` 操作（clone、PR、issue 等）

---

## 5. 发布流程

### 5.1 一键发布架构

```
本地触发                    GitHub Actions                     产物
────────                   ──────────────                    ──────
scripts/publish.sh  ──→  publish.yml workflow  ──→  npm publish
    │                        │                     Docker push to GHCR
    │                        │                     GitHub Release
    │                        │
    └── 监控进度              └── 自动执行
        验证产物                  版本升级 → commit → tag → 发布
```

### 5.2 触发方式

**方式一（推荐）：本地一键脚本**

```bash
bash scripts/publish.sh patch   # 或 minor / major
```

脚本自动完成：触发 workflow → 等待完成 → 验证 npm + release + docker。

**方式二：GitHub Actions UI**

1. 打开 `https://github.com/<owner>/llm-simple-router/actions/workflows/publish.yml`
2. 点击 **Run workflow**
3. 选择版本类型：`patch`（默认）、`minor`、`major`
4. 点击确认

### 5.3 Workflow 执行步骤

```
┌──────────────────────────────────────────────────────────┐
│ Publish Workflow                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. Bump Version                                         │
│     └── cd router && npm version <patch|minor|major>     │
│                                                          │
│  2. Commit + Tag                                         │
│     └── git commit + git tag v<version> + git push       │
│                                                          │
│  3. Build                                                │
│     └── npm ci + npm run build                           │
│                                                          │
│  4. npm Publish                                          │
│     └── npm publish (llm-simple-router)                  │
│                                                          │
│  5. GitHub Release                                       │
│     └── gh release create + 上传构建产物                  │
│                                                          │
│  6. Docker Push                                          │
│     └── docker build + push to ghcr.io                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 5.4 发布后验证

```bash
# 1. npm 包版本
npm info llm-simple-router version

# 2. GitHub Release
gh release view v$(jq -r '.version' router/package.json) --json tagName,url,assets

# 3. CI 状态
gh run list --workflow=Publish --limit 1 --json conclusion,status

# 4. Docker 镜像
# https://github.com/<owner>/llm-simple-router/pkgs/container/llm-simple-router
```

### 5.5 版本规则

- **合并 PR 到 main 不需要更新版本号**
- 多个 PR 可以积攒后统一发布
- 发布时 workflow 自动升级版本，无需手动修改 `package.json`
- npm 不允许重复发布同一版本号
- 只发布 `llm-simple-router` 一个 npm 包

### 5.6 为什么选择 CI 发布而非本地发布

| 维度 | 本地发布 | CI 发布 |
|------|---------|--------|
| 环境一致性 | 依赖本地 Node 版本、npm 配置 | 统一的 CI 环境 |
| 安全性 | npm token 存在本地 | npm token 存在 GitHub Secrets |
| 可重复性 | 不同人发布结果可能不同 | 完全一致 |
| 审计 | 难以追溯 | 每次 release 都有 CI log |
| 回滚 | 需要本地操作 | 重新触发 workflow |

---

## 6. Worktree 规范

### 6.1 为什么使用 Bare Repo + Worktree

| 维度 | 传统单工作目录 | Bare Repo + Worktree |
|------|--------------|---------------------|
| 多任务并行 | 需要 `git stash` 切换 | 多个 worktree 同时存在 |
| 依赖重装 | 切换分支可能需要 `npm ci` | 每个 worktree 独立 `node_modules` |
| 编译产物 | 需要清理 `dist/` | 互不干扰 |
| 上下文切换 | 需要关闭编辑器 | 不同 worktree 不同编辑器窗口 |

### 6.2 创建 Worktree

**必须使用 `git-cwt`**（定义在 `~/.shell/07-git-ws.sh`），不要手动 `git worktree add`。

```bash
# 正确
git-cwt feat/new-feature

# 错误（缺少依赖安装和 Electron 缓存复用）
git worktree add feat/new-feature
```

`git-cwt` 自动完成：
1. 调用 `.bare/custom-hooks/setup-worktree.sh`
2. 安装全部依赖（包括 `src-electron/` 的独立依赖）
3. Electron 二进制包（~242MB）从缓存 symlink 复用，无需重复下载
4. 安装 git hooks

手动创建的 worktree 会缺少 `node_modules` 中的关键依赖，导致开发服务器无法启动。

### 6.3 合并前验证

PR push 前和 merge 前必须通过验证：

```bash
# 一键验证（推荐）
bash ~/.pi/agent/skills/merge-worktree/pre-merge-check.sh
```

| 检查项 | 要求 |
|--------|------|
| 所有子包 tsc --noEmit | 0 error |
| lint | 0 error 0 warning |
| 单元测试 | 全部通过 |
| 构建 | router + frontend 成功 |
| Git 工作区 | 干净 + 已推送 |

**为什么验证所有子包**：类型错误会跨子包传播。`pi-extension` 中一个类型变更可能影响 `router`。只验证当前修改的子包会遗漏跨包问题。

### 6.4 清理 Worktree

```bash
# 正常清理（检查是否已合并）
bash ~/.claude/skills/merge-worktree/merge-worktree.sh <branch-name>

# 强制清理
bash ~/.claude/skills/remove-worktree/remove-worktree.sh --force <branch-name>
```

删除 worktree 不影响 Electron 缓存（存储在 workspace 级 `.electron-dist-cache/`），后续 `git-cwt` 创建新 worktree 时会自动从缓存链接。

---

## 7. 测试规范

### 7.1 测试框架与配置

**框架**：Vitest 3.1.2

**配置**（`router/vitest.config.ts`）：

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,        // 全局 API（describe/it/expect 无需 import）
    environment: "node",  // Node.js 环境（非浏览器）
  },
});
```

**运行命令**：

```bash
npm test                              # 全部测试
npx vitest run tests/auth.test.ts     # 单个测试文件
npm run test:watch                    # 监听模式
```

### 7.2 测试模式

#### 组件测试（核心模式）

不启动真实服务器，通过 Fastify 的 `.register()` + `.inject()` 模拟 HTTP 请求：

```typescript
const app = Fastify();
app.register(proxyPlugin);
const response = await app.inject({
  method: "POST",
  url: "/v1/chat/completions",
  payload: { model: "gpt-4", messages: [...] },
});
expect(response.statusCode).toBe(200);
```

**为什么选择组件测试**：
- 毫秒级执行（vs 真实服务器秒级启动）
- 可以精确控制中间件、数据库、后端响应
- 测试间完全隔离

#### 内存数据库

```typescript
const db = initDatabase(":memory:");
const app = await buildApp({ config, db });
```

- 每个测试创建独立的内存数据库
- 无需清理、无文件 I/O
- 测试结束后自动销毁

#### Mock 后端

```typescript
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end(JSON.stringify({ choices: [...] }));
});
server.listen(0); // 随机端口
```

- 模拟 OpenAI/Anthropic 的响应格式
- 可精确控制延迟、错误、流式行为

### 7.3 测试覆盖率

**40+ 测试文件**覆盖以下领域：

| 领域 | 覆盖范围 |
|------|---------|
| 加密 | AES-256-GCM 加解密 |
| 认证 | Bearer token、JWT、Admin 认证 |
| 数据库 | 所有 CRUD 操作、迁移 |
| 配置 | 配置加载、惰性缓存 |
| SSE 解析 | 行缓冲、事件切割 |
| 指标提取 | Token 统计、TTFT、TPS |
| 路由策略 | scheduled、round_robin、random、failover |
| Resilience | 重试、failover 决策 |
| 并发信号量 | 队列、超时、AbortSignal |
| 代理转发 | OpenAI、Anthropic 格式 |
| Admin API | 7 个领域的 CRUD |
| 监控 | 活跃请求、SSE 广播 |
| 日志清理 | 定期清理策略 |

### 7.4 验收标准覆盖矩阵

每个 spec 的验收标准（AC）必须有对应的测试用例：

```
AC1: 开关 OFF → 测试 test_proxy_enhancement_disabled
AC2: 开关 ON + 无 session_id → 测试 test_no_session_id
AC3: 开关 ON + 有 session_id → 测试 test_with_session_id
...
```

测试评审时以 AC 覆盖矩阵为依据，遗漏 AC 即为测试不足。

### 7.5 为什么选择组件测试而非端到端测试

| 维度 | 组件测试 | E2E 测试 |
|------|---------|---------|
| 执行速度 | 毫秒级 | 秒到分钟级 |
| 稳定性 | 高（不依赖外部服务） | 低（网络、端口、时序问题） |
| 定位精度 | 精确到函数/模块 | 只知道"页面没渲染" |
| 维护成本 | 低 | 高（UI 变更频繁导致测试失效） |
| 覆盖面 | 可覆盖所有分支 | 难以覆盖所有边界情况 |

---

## 8. Dev-Flow 工作流

### 8.1 xyz-harness 阶段

```
阶段 1: Spec（规格说明）
  │   头脑风暴 → 需求澄清 → spec.md → 独立评审
  │
  ▼
阶段 2: Plan（实施计划）
  │   任务拆分 → plan.md → E2E 测试计划 → 测试用例模板
  │
  ▼
阶段 3: Dev（编码实现）
  │   按 plan.md 逐任务实现 → spec 合规自检
  │
  ▼
阶段 4: Code Review（编码评审）  ← 不可跳过
  │   代码变更审查 → MUST FIX 清单 → 修复 → 通过
  │
  ▼
阶段 5: Test（测试执行）
  │   执行测试用例 → 测试评审 → MUST FIX 清单 → 修复 → 通过
  │
  ▼
阶段 6: PR（提交合并）
      创建 PR → CI 通过 → merge → 清理
```

### 8.2 评审不可跳过原则

**阶段 4（编码评审）和阶段 6（测试评审）标记为 MUST NOT SKIP**。

- 主 agent 必须拒绝跳过请求，并说明理由
- 如用户坚持跳过，需要书面确认（commit message 或 PR comment），且在合并前必须补跑
- 合并前必须同时满足：编码评审通过 + 测试评审通过 + CI 通过

### 8.3 算法类需求行为表

对于涉及算法、公式、状态机的需求，spec 阶段必须产出**完整的行为表**（输入 → 期望输出映射）：

```
| 输入 | 条件 | 期望输出 |
|------|------|---------|
| retry_count=1, strategy=fixed, delay=1000 | status=500 | delay=1000 |
| retry_count=2, strategy=exponential, base=1000 | status=500 | delay=2000 |
| retry_count=3, max_retries=3 | status=500 | 不重试 |
```

行为表的作用：
- **TDD 基准** — 测试用例直接从行为表生成
- **消除歧义** — 文字描述可能有多种理解，表格只有一种
- **回归保护** — 行为表是算法的"可执行规格"

### 8.4 评审修复走 PR

评审发现的 MUST FIX 修复应通过 PR 流程，禁止直接 push 到已合并的分支。如果分支已合并，应创建 hotfix 分支。

**为什么**：
- 评审修复本身也需要评审（修复可能引入新问题）
- 直接 push 绕过了 CI 验证
- PR 保留完整的修复上下文

### 8.5 为什么强制评审

| 不评审的风险 | 评审的收益 |
|-------------|----------|
| 潜在 bug 进入 main 分支 | 提前发现逻辑错误 |
| 架构腐化（每人各写各的） | 保持代码风格一致性 |
| 安全漏洞 | 安全审查 |
| 遗漏边界情况 | 第二双眼睛检查完整性 |
| 技术债累积 | 及时发现并标记 |

---

## 9. 常用命令速查

### 开发

```bash
# 后端开发（热重载，端口 9980）
npm run dev

# 前端开发（自动代理 /admin/api 到后端）
cd frontend && npm run dev

# 同时开发前后端（两个终端）
```

### 构建

```bash
# 后端构建
npm run build

# 前端构建
cd frontend && npm run build

# 完整构建（tsc + 复制资源 + 构建前端）
npm run build:full
```

### 测试

```bash
npm test                              # 全部测试
npx vitest run tests/auth.test.ts     # 单个测试文件
npm run test:watch                    # 监听模式
```

### 代码质量

```bash
npm run lint                          # 后端 ESLint（零警告容忍）
cd frontend && npx eslint . --max-warnings=0  # 前端 ESLint
cd frontend && npx vue-tsc -b --noEmit        # 前端类型检查
```

### Git

```bash
git pull --rebase origin main         # 更新本地 main
git-cwt feat/new-feature              # 创建功能分支 worktree
gh pr create --fill                   # 创建 PR
gh pr merge <num> --merge --auto      # 合并 PR
```

### 发布

```bash
bash scripts/publish.sh patch         # 一键发布（patch 版本）
bash scripts/publish.sh minor         # minor 版本
bash scripts/publish.sh major         # major 版本
```

### Docker

```bash
docker compose up -d                  # 启动
docker compose logs -f                # 查看日志
docker compose down                   # 停止
```

---

## 10. 环境变量

### 配置类

| 变量 | 默认值 | 说明 |
|------|-------|------|
| `PORT` | 9981 | 服务端口 |
| `DB_PATH` | `~/.llm-simple-router/router.db` | 数据库路径（目录取 dirname） |
| `LOG_LEVEL` | — | 日志级别 |
| `STREAM_TIMEOUT_MS` | 3000000 | 流式请求超时（毫秒） |
| `RETRY_BASE_DELAY_MS` | 1000 | 重试基础延迟（毫秒） |

### 运行时数据目录

默认 `~/.llm-simple-router/`，通过 `DB_PATH` 环境变量间接控制。

| 路径 | 用途 |
|------|------|
| `router.db` | SQLite 主库 |
| `logs/<logId>.json` | 请求详情日志文件 |

### 排查生产问题

```bash
# 定位请求日志
sqlite3 ~/.llm-simple-router/router.db \
  "SELECT * FROM request_logs WHERE id = '...'" -json

# 查看完整请求/响应内容
cat ~/.llm-simple-router/logs/<logId>.json
```

---

## 附录 A：质量门禁决策树

当你要提交代码时，按以下顺序自检：

```
代码写好了
  │
  ├── 格式正确吗？（Prettier 会自动修复，但要确认）
  ├── ESLint 有警告吗？（npm run lint）
  ├── 类型检查通过吗？（vue-tsc / tsc --noEmit）
  ├── 测试通过吗？（npm test）
  │
  ├── 评审检查点
  │   ├── 所有 catch 分支都有响应吗？
  │   ├── 新字段的所有消费点都更新了吗？（DB / SSE / API / 前端）
  │   ├── Hook 注册到 proxyPipeline 了吗？（不只是 hookRegistry）
  │   ├── headers 写入日志前脱敏了吗？
  │   └── 控件交互模式与页面一致吗？
  │
  ├── commit 信息清晰吗？
  └── git commit
```

## 附录 B：Pre-commit Hook 跳过场景指南

跳过检查是**应急手段**，不是日常操作。以下是合理的跳过场景：

| 场景 | 跳过方式 | 原因 |
|------|---------|------|
| 紧急 hotfix 需要立刻推送 | `SKIP_ALL_CHECKS=1` | 先修复，后补检 |
| 只改了文档（.md） | 不需要跳过，hook 自动检测 | — |
| WIP commit 保存进度 | `SKIP_ALL_CHECKS=1` | 代码未完成，检查无意义 |
| 前端样式微调 | `SKIP_TYPE_CHECK=1` | 纯样式变更，类型检查浪费时间 |
| 后端纯测试变更 | `SKIP_FRONTEND_LINT=1` | 不涉及前端 |

**注意**：跳过检查的 commit 最终 push 到 PR 时，CI 会全量检查。跳过的只是本地反馈，不是最终门禁。

## 附录 C：发布常见问题排查

| 失败步骤 | 可能原因 | 排查方式 |
|---------|---------|---------|
| Bump version | workflow 权限不足 | 确保 `GITHUB_TOKEN` 有 `contents: write` |
| npm publish | npm token 过期 | 更新 `NPM_TOKEN`（需 bypass 2FA 权限） |
| Build | TypeScript 编译错误 | 本地先 `npm run build` 确认 |
| Docker build | Dockerfile 问题 | 查看 CI 日志定位具体错误 |
| Release create | tag 已存在 | 检查是否重复发布同一版本 |

---

---

## 附录 D：借鉴与其他项目的增强方向

调研了 `~/Code/` 下其他项目（dag-executor、xyz-agent、stock-data-crawler、xyz-harness-engineering 等）的规范体系，以及业界 Fastify/Vue/SQLite 最佳实践，以下做法值得未来引入：

### D.1 架构分层 pre-commit 检查（来自 dag-executor）

dag-executor 用 `check_architecture.py` 在 pre-commit 中检查 import 依赖方向（api → service → core → db），比 ESLint 规则更强的架构约束。

**引入建议**：新增 `.githooks/check_proxy_layers.py`，检查代理四层依赖方向：handler → orchestration → routing → transport，禁止反向 import。结合 `dependency-cruiser`（marcoturi/fastify-boilerplate 在用）做双向验证。

### D.2 独立术语表 CONTEXT.md（来自 dag-executor、xyz-harness）

dag-executor 和 xyz-harness 都有独立的 `CONTEXT.md` 文件，定义核心领域术语的精确含义和"避免使用"的变体，确保团队和 AI 使用一致的术语。

**引入建议**：创建 `CONTEXT.md`，定义 Target、MappingGroup、ResilienceAttempt 等核心概念，减少文档和代码中的术语混乱。

### D.3 Claude Code Hooks（来自 stock-data-crawler）

stock-data-crawler 配置了 `.claude/hooks/` 检查（禁止 watch 模式、禁止修改 migration 文件、文件路径规则），在 AI 编码过程中实时拦截不合规操作。

**引入建议**：新增 `.claude/hooks/` 配置，禁止 AI 修改 `router/src/db/migrations/` 中的已发布迁移文件，禁止在 `dist/` 中写文件。

### D.4 功能地图（来自 xyz-agent）

xyz-agent 维护 `docs/feature-map/` 目录，记录长期功能规划、架构演进方向和关键决策点，保持全局视角。

**引入建议**：考虑创建 `docs/feature-map/` 追踪 proxy 增强、格式转换覆盖度等长期功能演进。

### D.5 OpenAPI / Swagger 自动生成（业界标准）

Fastify 官方推荐 `@fastify/swagger` 从 JSON Schema 自动生成 API 文档。当前项目 Admin API 的 76 个端点中 24 个已配有 Schema，可为所有端点补齐 Schema 后自动生成 API 文档。

**引入建议**：在 Admin API 补全 Schema 验证后，接入 `@fastify/swagger` + `@fastify/swagger-ui`。

### D.6 后端测试：性能基准回归（业界推荐）

Vitest 社区推荐用 `benchmark` 模式检测性能回归。当前项目代理延迟是核心指标，可建立端到端代理延迟基准（p50/p99）做回归检测。

**引入建议**：新增 `router/tests/benchmark/proxy-latency.bench.ts`，用 Vitest benchmark 模式定期运行。

### D.7 Design Token 自动同步（来自 xyz-agent 实践）

xyz-agent 的 `check_css_tokens.py` 在 pre-commit 中检查 CSS token 一致性。当前项目 `tokens.css` 和 demo 的 `tokens.css` 可能漂移。

**引入建议**：抽取设计令牌到独立的 JSON/TS 文件作为单一来源，运行时生成 CSS 变量文件，从源头消除漂移。

### D.8 Provider 主动健康检查（对标 LiteLLM/Portkey）

LiteLLM 和 Portkey 都支持定期向 Provider 发送轻量测试请求做主动健康检查。当前项目仅做被动健康检查（请求失败后 failover），切换延迟较高。

**引入建议**：新增可选的 Provider 健康检查功能，定期 `GET /v1/models` 验证连通性，提前禁用不可用 Provider。

### D.9 按 Provider 维度隔离连接池（Security + Resilience 最佳实践）

Node.js 官方 Agent 文档推荐为不同后端创建独立的 `http.Agent` 实例。当前项目虽已有 `ProxyAgentFactory`，但全局 keep-alive Agent 是共享的。

**引入建议**：`ProxyAgentFactory` 改为按 Provider ID 维度缓存 Agent，单 Provider 故障不影响其他 Provider。

---

> **文档维护**：当项目结构、分支策略、质量门禁发生重大变更时，同步更新本文档。小幅调整（如新增一条 ESLint 规则）在对应章节补充即可。
