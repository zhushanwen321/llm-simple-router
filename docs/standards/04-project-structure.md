# 04 — 工程目录规范

本文档定义 llm-simple-router 项目的目录结构、文件放置规则和命名约定。所有新增文件和目录必须遵循本规范。

---

## 1. 顶层结构总览

```
llm-simple-router/                    # Monorepo 根目录
├── .github/workflows/                # CI/CD
├── .githooks/                        # Git hooks
├── .claude/hooks/                    # Claude Code hooks（AI 编码约束）
├── .xyz-harness/                     # 工作流状态
├── docs/                             # 文档
├── router/                           # 后端子包（npm workspace）
├── frontend/                         # 前端子包（npm workspace）
├── pi-extension/                     # Pi 扩展子包（npm workspace）
├── scripts/                          # 构建/发布脚本
├── CLAUDE.md                         # AI 编码指南
├── CONTEXT.md                        # 领域术语表（预留，待创建）
├── README.md / README.en.md          # 项目说明
├── package.json                      # 根配置（workspaces 声明）
├── eslint.config.mjs                 # ESLint 入口
├── docker-compose.yml                # Docker 编排
└── .gitignore                        # Git 忽略规则
```

### 1.1 根 package.json 的角色

根 `package.json` 仅用于：

- 声明 `workspaces`：`["router", "pi-extension", "frontend"]`
- 定义跨子包的快捷脚本（如 `npm run build` 同时构建 router 和 frontend）
- 管理根级 devDependencies（如 `eslint-plugin-vue`）

**禁止**在根目录放置业务代码。根目录只做编排。

### 1.2 Monorepo 拓扑关系

```
根 package.json（workspaces）
  ├── router/          → 独立 package.json，npm 包名 llm-simple-router
  ├── frontend/        → 独立 package.json，Vite 应用
  └── pi-extension/    → 独立 package.json，Pi 扩展
```

子包之间通过 npm workspaces 互相可见。router 和 frontend 之间无代码级依赖——它们通过 HTTP API 通信。

---

## 2. 后端子包（router/）

### 2.1 目录结构

```
router/
├── src/
│   ├── admin/              # 管理 API 路由（按领域拆分）
│   │   ├── routes.ts       # 统一注册入口
│   │   ├── providers.ts    # Provider CRUD
│   │   ├── mappings.ts     # 映射管理
│   │   ├── groups.ts       # 映射组管理
│   │   ├── retry-rules.ts  # 重试规则管理
│   │   ├── logs.ts         # 日志查询
│   │   ├── stats.ts        # 统计聚合
│   │   ├── metrics.ts      # 指标查询
│   │   ├── router-keys.ts  # 密钥管理
│   │   ├── proxy-enhancement.ts  # 代理增强设置
│   │   ├── monitor.ts      # 实时监控 SSE
│   │   └── settings.ts     # 系统设置
│   ├── cli.ts              # npm bin 入口
│   ├── index.ts            # 库入口（buildApp + main）
│   ├── config/             # 配置单例、模型元数据
│   │   ├── index.ts        # 配置模块入口
│   │   └── model-context.ts  # 模型能力白名单
│   ├── core/               # 共享核心：类型、常量、错误、DI
│   │   ├── types.ts        # 共享类型定义
│   │   ├── constants.ts    # 共享常量
│   │   ├── errors.ts       # 共享错误类
│   │   ├── registry.ts     # StateRegistry 接口
│   │   └── container.ts    # ServiceContainer DI 容器
│   ├── db/                 # 数据库层（SQLite）
│   │   ├── index.ts        # 初始化 + 迁移执行
│   │   ├── migrations/     # SQL 迁移文件（*.sql）
│   │   ├── providers.ts    # Provider 数据操作
│   │   ├── mappings.ts     # 映射数据操作
│   │   ├── logs.ts         # 日志数据操作
│   │   ├── metrics.ts      # 指标数据操作
│   │   ├── stats.ts        # 统计查询
│   │   ├── retry-rules.ts  # 重试规则数据操作
│   │   ├── router-keys.ts  # 密钥数据操作
│   │   ├── settings.ts     # 设置数据操作
│   │   ├── session-states.ts  # 会话状态数据操作
│   │   └── helpers.ts      # 通用查询工具
│   ├── metrics/            # 指标采集
│   │   ├── sse-parser.ts   # SSE 行缓冲解析
│   │   ├── metrics-extractor.ts  # 指标提取
│   │   └── sse-metrics-transform.ts  # Transform stream 旁路采集
│   ├── middleware/          # 认证中间件
│   │   ├── auth.ts         # 客户端 Bearer token 认证
│   │   └── admin-auth.ts   # 管理后台 JWT + Cookie 认证
│   ├── proxy/              # 代理层（四层架构，详见下文）
│   ├── monitor/            # 运行时监控
│   │   ├── request-tracker.ts    # 活跃请求追踪 + SSE 广播
│   │   ├── stats-aggregator.ts   # 延迟统计（p50/p99）
│   │   └── runtime-collector.ts  # 运行时资源采集
│   ├── storage/            # 日志存储
│   ├── upgrade/            # 数据升级迁移
│   └── utils/              # 工具函数
│       ├── crypto.ts       # AES-256-GCM 加解密
│       ├── password.ts     # scrypt 密码哈希
│       └── token-counter.ts  # 统一 token 计数
├── tests/                  # 测试目录（独立，与 src/ 平行）
├── config/                 # 运行时配置文件
│   └── model-directory.json  # 外部模型元数据
├── taste-lint/             # 自定义 ESLint 插件（eslint-plugin-taste）
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── eslint.config.mjs
```

### 2.2 代理层四层架构（proxy/）

代理层是项目核心，按职责严格分层：

```
router/src/proxy/
├── handler/                # Handler 层：路由回调
│   ├── proxy-handler.ts    # 核心处理函数
│   ├── openai.ts           # OpenAI 路由注册
│   └── anthropic.ts        # Anthropic 路由注册
├── orchestration/          # Orchestration 层：信号量/追踪器/resilience 协调
│   ├── orchestrator.ts     # ProxyOrchestrator 主协调器
│   ├── resilience.ts       # 重试/failover 决策
│   ├── semaphore.ts        # Provider 级并发控制
│   ├── scope.ts            # 信号量/追踪器 scope 包装
│   └── retry-rules.ts      # 重试规则内存匹配
├── routing/                # Routing 层：模型解析与路由
│   ├── mapping-resolver.ts # client_model → { backend_model, provider_id }
│   ├── model-state.ts      # 模型状态双层缓存
│   ├── overflow.ts         # 上下文溢出重定向
│   └── ...                 # 其他路由相关
├── transport/              # Transport 层：底层 HTTP 调用
│   ├── http.ts             # 非流式调用
│   ├── stream.ts           # SSE 流式代理引擎
│   └── transport-fn.ts     # 传输函数闭包
├── enhancement/            # 代理增强（独立子系统）
├── format/                 # 格式适配器
├── hooks/                  # Pipeline hooks
├── patch/                  # 上游响应修补
├── pipeline/               # Pipeline 框架
├── transform/              # API 格式转换
│   ├── types.ts            # 共享类型定义
│   ├── types-responses.ts  # Responses API 类型
│   ├── request-*.ts        # 请求转换
│   ├── response-*.ts       # 响应转换
│   └── stream-*.ts         # 流式转换
└── strategy/               # 路由策略
    ├── scheduled.ts        # 定时
    ├── round-robin.ts      # 轮询
    ├── random.ts           # 随机
    └── failover.ts         # 故障转移
```

### 2.3 后端命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 文件名 | kebab-case，一个文件一个主模块 | `mapping-resolver.ts`、`retry-rules.ts` |
| 类名 | PascalCase | `ProxyOrchestrator`、`StreamProxy` |
| 函数名 | camelCase | `handleProxyRequest()`、`resolveMapping()` |
| 常量 | UPPER_SNAKE_CASE | `MAX_QUEUE_SIZE`、`DEFAULT_TIMEOUT` |
| 类型/接口 | PascalCase，接口不加 I 前缀 | `Target`、`MappingGroup`（不是 `ITarget`） |
| SQL 迁移文件 | 三位数字编号 + 描述 | `001_create_providers.sql` |
| 测试文件 | 源文件名 + `.test.ts` | `mapping-resolver.test.ts` |

### 2.4 新增后端文件放置规则

**决策树：新文件放哪里？**

```
新文件涉及 HTTP 路由回调？
  └─ 是 → proxy/handler/ 或 admin/
  └─ 否 → 继续

新文件涉及代理请求处理流程（重试、路由、传输）？
  └─ 是 → proxy/ 下按层级放置
  └─ 否 → 继续

新文件涉及数据库操作？
  └─ 是 → db/ 下按领域拆分
  └─ 否 → 继续

新文件是共享类型/常量/错误？
  └─ 是 → core/
  └─ 否 → 继续

新文件是通用工具函数？
  └─ 是 → utils/
  └─ 否 → 根据职责在最近的模块目录下创建
```

**特殊规则：**

- 禁止在 `proxy/` 根目录新增文件。代理层的共享文件放在已有的 `proxy-core.ts`、`types.ts`、`proxy-logging.ts`、`log-helpers.ts` 中，或者新建子目录
- 禁止创建 `src/utils/` 下的子目录。工具函数保持扁平结构，一个文件一个职责
- `admin/` 下的文件按领域拆分，每个文件对应一组 CRUD 端点，`routes.ts` 统一注册

---

## 3. 前端子包（frontend/）

### 3.1 目录结构

```
frontend/
├── src/
│   ├── api/                # API 客户端
│   │   └── client.ts       # axios 封装（Cookie 认证、401 跳转）
│   ├── components/         # 业务组件 + UI 组件
│   │   ├── ui/             # shadcn-vue 基础组件（禁止手动修改）
│   │   ├── providers/      # Provider 管理相关组件
│   │   ├── mappings/       # 映射管理相关组件
│   │   ├── logs/           # 日志相关组件
│   │   └── ...             # 按页面/功能分组
│   ├── composables/        # 组合式函数
│   │   ├── useMetrics.ts   # 指标数据
│   │   ├── useClipboard.ts # 剪贴板
│   │   ├── useLogs.ts      # 日志数据
│   │   └── useMonitorSSE.ts # SSE 实时数据
│   ├── constants.ts        # 前端常量
│   ├── i18n/               # 国际化
│   │   ├── index.ts        # i18n 配置
│   │   └── locales/        # 语言文件（zh-CN.ts、en.ts）
│   ├── lib/                # 第三方库适配
│   ├── router/             # 路由配置
│   │   └── index.ts        # 路由定义
│   ├── styles/             # 全局样式
│   │   └── tokens.css      # 设计令牌（oklch 色彩空间）
│   ├── types/              # TypeScript 类型定义
│   ├── utils/              # 工具函数
│   ├── views/              # 页面视图（与路由一一对应）
│   │   ├── Dashboard.vue
│   │   ├── Providers.vue
│   │   ├── ModelMappings.vue
│   │   ├── Logs.vue
│   │   ├── Monitor.vue
│   │   └── ...
│   ├── App.vue             # 根组件
│   └── main.ts             # 入口
├── public/                 # 静态资源
├── index.html              # HTML 模板
├── vite.config.ts          # Vite 配置（base: '/admin/'）
├── components.json         # shadcn-vue 配置
├── tailwind.config.ts      # Tailwind 配置
├── tsconfig.json
└── package.json
```

### 3.2 前端组件组织规则

#### views/ — 页面视图

每个路由对应一个 view 文件。View 文件的职责：

- 页面级布局和组合
- 数据获取（调用 API 客户端）
- 页面级状态管理

**行数限制**：`<template>` ≤ 400 行，`<script setup>` ≤ 300 行。超出时必须抽取子组件。

#### components/ — 业务组件

按功能域分目录：

```
components/
├── ui/               # shadcn-vue 基础组件
├── providers/        # Provider 管理页的子组件
├── mappings/         # 映射管理页的子组件
├── logs/             # 日志页的子组件
├── monitor/          # 监控页的子组件
├── common/           # 跨页面复用组件
└── layout/           # 布局组件（Sidebar、Header 等）
```

**组件命名**：PascalCase，多个单词（Vue 要求），如 `ProviderCard.vue`、`MappingGroupList.vue`。

#### components/ui/ — shadcn-vue 组件

- 通过 `npx shadcn-vue@latest add <component>` 安装
- **禁止手动修改** `ui/` 下的文件。需要定制时，在使用处包装一层
- 如需全局定制样式，修改 `components.json` 或 `tailwind.config.ts`

#### composables/ — 组合式函数

- 命名：`use` 前缀 + PascalCase 功能名，如 `useMetrics.ts`、`useMonitorSSE.ts`
- 每个 composable 一个文件
- composable 之间可以互相调用，但禁止循环依赖

### 3.3 前端命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| Vue 组件文件 | PascalCase，至少两个单词 | `ProviderCard.vue` |
| composable 文件 | camelCase，use 前缀 | `useMonitorSSE.ts` |
| 类型文件 | kebab-case 或 PascalCase | `types/index.ts` |
| 样式文件 | kebab-case | `tokens.css` |
| i18n 语言文件 | 语言代码 | `zh-CN.ts`、`en.ts` |

---

## 4. 测试文件组织

### 4.1 后端测试（router/tests/）

采用**独立 `tests/` 目录**模式，与 `src/` 平行：

```
router/
├── src/
│   ├── admin/
│   ├── proxy/
│   └── ...
└── tests/
    ├── admin/                   # 按模块分目录
    │   ├── admin-groups-crud.test.ts
    │   └── transform-rules.test.ts
    ├── core/                    # 核心模块测试
    │   ├── concurrency/
    │   ├── loop-prevention/
    │   └── monitor/
    ├── auth.test.ts             # 顶层测试文件
    ├── config.test.ts
    ├── crypto.test.ts
    └── ...
```

**组织规则：**

1. 测试文件放在 `tests/` 下与 `src/` 对应的目录结构中
2. 当某模块的测试文件超过 3 个时，创建子目录分组
3. 测试文件名 = 源模块名 + `.test.ts`
4. 辅助函数放在 `tests/helpers/` 下（如果需要）

**为什么不用与源码平行的 `__tests__/` 模式？**

- 后端 `src/` 目录是编译产物源，保持干净有利于代码审查
- 测试有独立的 `vitest.config.ts` 配置
- 项目从初始就采用 `tests/` 独立目录，保持一致

### 4.2 前端测试（暂无）

前端目前无自动化测试。UI 交互通过 `docs/designs/` 下的 HTML demo 原型验证。如果后续引入前端测试，遵循以下规则：

- 单元测试：`frontend/src/__tests__/` 下，与源码平行
- 组件测试：与组件同目录，`ComponentName.spec.ts`
- E2E 测试：`frontend/e2e/` 独立目录

### 4.3 测试辅助函数模式

项目中有几个高频使用的辅助函数，跨多个测试文件复用：

| 函数 | 用途 | 使用位置 |
|------|------|---------|
| `createMockBackend()` | 启动 mock HTTP 服务器 | 代理测试 |
| `closeServer()` | 安全关闭 mock 服务器 | 代理测试 |
| `buildTestApp()` | 组装测试用 Fastify 应用 | 集成测试 |
| `insertMockBackend()` | 插入 mock Provider 到 DB | Admin API 测试 |
| `insertModelMapping()` | 插入测试映射 | 路由测试 |

新增辅助函数时，如果被 3 个以上测试文件使用，提取到 `tests/helpers/` 下。否则在测试文件内定义。

---

## 5. 配置文件归置

### 5.1 配置文件分类

| 配置文件 | 位置 | 说明 |
|---------|------|------|
| 根 ESLint | `eslint.config.mjs` | 引用 taste-lint，全项目共享 |
| 后端 TypeScript | `router/tsconfig.json` | 后端编译配置 |
| 前端 TypeScript | `frontend/tsconfig.json` | 前端编译配置 |
| 后端 Vitest | `router/vitest.config.ts` | 测试框架配置 |
| 前端 Vite | `frontend/vite.config.ts` | 构建配置（base: '/admin/'） |
| 前端 Tailwind | `frontend/tailwind.config.ts` | 样式配置 |
| 前端 shadcn | `frontend/components.json` | 组件库配置 |
| Docker | `docker-compose.yml` | 容器编排 |
| Git Hooks | `.githooks/` | pre-commit 等 |
| 运行时模型数据 | `router/config/model-directory.json` | 外部模型元数据 |

### 5.2 配置放置规则

1. **子包级配置**放在子包根目录（如 `router/vitest.config.ts`）
2. **项目级配置**放在 Monorepo 根目录（如 `eslint.config.mjs`、`docker-compose.yml`）
3. **运行时需要的外部文件**放在 `router/config/` 下，并在 `package.json` 的 `postbuild`、`scripts/prepublish.mjs`、`scripts/build.mjs` 三处同步更新复制规则
4. **禁止**在 `src/` 下放置配置文件。`src/config/` 是配置模块代码（TypeScript），不是配置文件

### 5.3 环境变量

环境变量不在代码仓库中管理。所有 secrets 通过首次启动的 Setup 页面设置，存入 DB settings 表。可选环境变量在 CLAUDE.md 中列出。

---

## 6. Git 与 CI/CD 相关目录

### 6.1 .github/workflows/

```
.github/workflows/
├── ci.yml              # PR 检查（tsc + vitest + eslint）
└── publish.yml         # 发布流程（版本升级 → npm publish → Docker → Release）
```

**规则：**

- CI 配置变更需要在本机验证后再提交
- 新增 workflow 文件需在 CLAUDE.md 中补充说明

### 6.2 .githooks/

```
.githooks/
├── install-hooks.sh        # hook 安装脚本（npm prepare 调用）
├── pre-commit              # 四阶段检查
└── vue_rules_checker.py    # 前端代码规范检查
```

- 通过 `npm prepare` 自动安装到 `.git/hooks/`
- pre-commit 四阶段：Prettier + ESLint → vue-tsc → 代码规范 → 全部跳过开关

### 6.3 .claude/hooks/

```
.claude/hooks/
├── check-migration-file.sh     # 禁止 AI 修改已发布的 SQL 迁移文件
└── check-dist-write.sh         # 禁止 AI 在 dist/ 中写文件
```

**用途**：在 AI 编码过程中实时拦截不合规操作，是 pre-commit hook 的补充（stock-data-crawler 项目类似实践）。

**规则**：
- 已发布的 SQL 迁移文件（`router/src/db/migrations/*.sql`）禁止修改，只能新增
- `dist/` 目录是构建产物，禁止 AI 直接编辑
- 新增 AI 约束时编辑对应 hook 脚本

### 6.4 .xyz-harness/

工作流状态目录，按日期+功能命名：

```
.xyz-harness/
├── 2025-05-10-monitor-recent-perf/
│   ├── spec.md
│   ├── plan.md
│   ├── reviews/
│   └── evidence/
└── 2026-04-28-format-transformer/
    └── ...
```

- 格式：`YYYY-MM-DD-<feature-slug>/`
- 每个需求一个目录，内含 spec → plan → reviews → evidence
- 已完成的目录保留，供后续参考

---

## 7. Worktree Workspace 模式特殊考虑

### 7.1 项目使用 bare repo + worktree 模式

项目根目录结构：

```
llm-simple-router-workspace/
├── .bare/                    # bare repository
├── main/                     # main 分支 worktree
├── feat-xxx/                 # 功能分支 worktree
└── .electron-dist-cache/     # 共享缓存（如有 Electron 依赖）
```

### 7.2 Worktree 下的目录特殊规则

1. **创建 worktree 必须用 `git-cwt`**：它会执行 `.bare/custom-hooks/setup-worktree.sh`，安装所有依赖
2. **每个 worktree 有独立的 `node_modules/`**：依赖变更需在各自 worktree 中 `npm install`
3. **构建产物不跨 worktree 共享**：`dist/` 目录是 worktree 本地的
4. **数据库文件不共享**：每个 worktree 的运行时数据独立（`~/.llm-simple-router/router.db` 默认共享，生产环境通过 `DB_PATH` 环境变量隔离）
5. **Git 配置共享**：`.githooks/`、`.gitignore` 在 bare repo 中，所有 worktree 共享

### 7.3 Worktree 间协作规则

- 不同 worktree 可能同时修改相同的文件，合并时注意冲突
- `docs/` 目录在 worktree 间独立，文档变更随分支合并
- `taste-lint/` 的变更影响所有 worktree，需谨慎修改

---

## 8. 脚本目录（scripts/）

```
scripts/
├── build.mjs            # 完整构建（tsc + 复制 + 前端构建）
├── prepublish.mjs       # npm publish 前准备
├── publish.sh           # 一键发布脚本
├── release.sh           # 旧版手动发布（备用）
└── sync-model-directory.sh  # 同步外部模型目录
```

**规则：**

- 脚本使用 `.mjs`（Node.js ESM）或 `.sh`（shell）
- 构建相关脚本必须同时更新三处（见第 5.2 节）
- 发布脚本只操作当前 worktree，不跨分支

---

## 9. 新增目录/文件的审批清单

新增文件或目录时，自查以下项目：

| 检查项 | 通过标准 |
|--------|---------|
| 文件放在正确的目录层级 | 对照本文档的决策树 |
| 文件命名符合规范 | kebab-case（后端）、PascalCase（Vue 组件） |
| 不违反 Monorepo 边界 | 子包间无代码级依赖（router ↔ frontend） |
| 测试文件在正确位置 | `router/tests/` 下对应目录 |
| 配置文件三处同步 | postbuild + prepublish + build.mjs |
| 不引入新的根级文件 | 根目录只放编排文件 |
| worktree 兼容 | 文件不依赖 worktree 外部状态 |

---

## 10. 反模式：禁止的目录结构

| 反模式 | 正确做法 |
|--------|---------|
| `src/utils/helpers/math.ts` | `src/utils/math.ts`（utils 不建子目录） |
| `proxy/utils.ts` | `proxy/proxy-core.ts` 或按功能归类 |
| `src/shared/` | `src/core/`（项目已确立的共享模块目录） |
| `frontend/src/components/MyWidget.vue` | `frontend/src/components/common/MyWidget.vue`（按域分组） |
| `tests/integration/` + `tests/unit/` | 按模块分目录（`tests/admin/`、`tests/core/`） |
| 根目录下的 `test/` | `router/tests/`（测试归子包） |
| `src/config.json` | `src/config/index.ts`（配置是代码，不是文件） |

---

## 附录 A：目录职责速查表

| 目录 | 一句话职责 | 放什么 | 不放什么 |
|------|-----------|--------|---------|
| `router/src/admin/` | 管理 API 端点 | Fastify 路由处理 | 业务逻辑（放 proxy/） |
| `router/src/core/` | 共享基础模块 | 类型、常量、错误、DI | 具体业务实现 |
| `router/src/db/` | 数据库操作 | SQL 查询、迁移 | 路由逻辑 |
| `router/src/proxy/handler/` | HTTP 路由回调 | 请求解析、日志记录 | 重试逻辑（放 orchestration/） |
| `router/src/proxy/orchestration/` | 请求编排协调 | 信号量、重试、追踪 | HTTP 调用（放 transport/） |
| `router/src/proxy/routing/` | 模型路由决策 | 映射解析、溢出检测 | 网络请求 |
| `router/src/proxy/transport/` | 底层网络调用 | HTTP 请求、SSE 流 | 业务决策 |
| `router/src/proxy/transform/` | API 格式转换 | 请求/响应结构映射 | 路由逻辑 |
| `frontend/src/views/` | 页面视图 | 页面级组件 | 可复用子组件（放 components/） |
| `frontend/src/composables/` | 组合式函数 | 状态逻辑复用 | 组件定义 |
| `frontend/src/components/ui/` | shadcn-vue 组件 | 自动生成的 UI 基础组件 | 手动修改的组件 |

---

## 附录 B：文件添加操作手册

### B.1 新增后端 API 端点

```
1. 在 router/src/admin/ 下新建或修改领域文件（如 providers.ts）
2. 在 router/src/admin/routes.ts 中注册路由
3. 如需新数据表，在 router/src/db/migrations/ 添加 SQL 迁移
4. 在 router/src/db/ 下添加对应的数据操作函数
5. 在 router/tests/admin/ 下添加测试
```

### B.2 新增代理处理阶段

```
1. 确定属于哪一层（Handler / Orchestration / Routing / Transport）
2. 在 router/src/proxy/<layer>/ 下创建文件
3. 如果涉及新类型，在 router/src/core/types.ts 定义
4. 更新 proxy/types.ts 的 re-export（如需要）
5. 在 router/tests/ 下添加测试
```

### B.3 新增前端页面

```
1. 在 frontend/src/views/ 下创建页面组件
2. 在 frontend/src/router/index.ts 添加路由
3. 在 frontend/src/components/ 下按功能域创建子组件
4. 在 frontend/src/api/client.ts 添加 API 调用（如需要）
5. 在 frontend/src/i18n/locales/ 添加翻译文本
```

### B.4 新增 ESLint 自定义规则

```
1. 在 router/taste-lint/ 下添加规则文件
2. 在 taste-lint 的 index.ts 中注册
3. 在 router/eslint.config.mjs 中启用
4. 添加规则测试
5. 更新 CLAUDE.md 中的规则列表
```
