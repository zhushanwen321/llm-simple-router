# 05 — 文档管理规范

本文档定义 llm-simple-router 项目中各类文档的归属、命名、编写和维护规则。

---

## 1. 文档体系总览

```
llm-simple-router/
├── README.md                    # 项目说明（中文）
├── README.en.md                 # 项目说明（英文）
├── CLAUDE.md                    # AI 编码指南（非传统文档，是项目配置）
├── docs/
│   ├── README.md                # 文档导航索引
│   ├── adr/                     # 架构决策记录（ADR）
│   │   ├── 0001-responses-anthropic-primary-conversion.md
│   │   ├── 0002-native-http-request-for-proxy.md
│   │   ├── 0003-four-layer-proxy-architecture.md
│   │   ├── 0004-sqlite-as-sole-storage.md
│   │   └── 0005-retry-rule-body-matchers.md
│   ├── changelog/               # 版本演进日志
│   │   ├── README.md
│   │   ├── v1-core-proxy/
│   │   ├── v2-format-transform/
│   │   ├── v3-management-console/
│   │   ├── v4-plugin-resilience/
│   │   └── v5-model-mapping/
│   ├── designs/                 # UI 交互原型（HTML demo）
│   │   ├── index.html           # demo 目录索引
│   │   ├── components/          # 分层组件库 demo
│   │   ├── demo-dashboard.html
│   │   ├── demo-providers.html
│   │   └── ...
│   ├── provider/                # Provider 参考数据
│   ├── screenshot/              # 产品截图
│   └── standards/               # 项目规范
│       ├── 01-xxx.md
│       ├── ...
│       ├── 04-project-structure.md
│       └── 05-documentation.md
├── .xyz-harness/                # 工作流状态文档
│   └── YYYY-MM-DD-<feature>/
│       ├── spec.md
│       ├── plan.md
│       ├── reviews/
│       └── evidence/
└── router/
    └── src/
        └── db/
            └── migrations/      # SQL 迁移（也属于文档范畴）
```

---

## 2. 各类文档的职责与边界

### 2.1 文档分类

| 分类 | 目录 | 读者 | 生命周期 |
|------|------|------|---------|
| 架构决策记录 | `docs/adr/` | 开发者、AI | 永久（不删除，可废弃） |
| 版本演进日志 | `docs/changelog/` | 开发者、用户 | 随版本固化 |
| UI 交互原型 | `docs/designs/` | 前端开发者、设计审查者 | 页面重构时更新 |
| 项目规范 | `docs/standards/` | 开发者、AI | 持续维护 |
| 工作流状态 | `.xyz-harness/` | 开发者、AI | 随需求生命周期 |
| Provider 参考 | `docs/provider/` | 用户、开发者 | 随上游变化更新 |
| 产品截图 | `docs/screenshot/` | 用户、README 引用 | 版本发布时更新 |
| 项目说明 | `README.md` | 所有人员 | 版本发布时更新 |
| AI 编码指南 | `CLAUDE.md` | AI 助手 | 随项目演进持续更新 |

### 2.2 文档边界原则

1. **一份信息一个权威源**：同一内容不在多处重复。引用时用相对链接
2. **docs/ 下不放代码**：HTML demo 除外（它本身就是可执行的交互规格）
3. **CLAUDE.md 不是文档**：它是 AI 助手的配置文件，包含编码指南、架构说明和项目约定。开发者也应阅读，但不作为文档体系的组成部分
4. **.xyz-harness/ 不是传统文档**：它是工作流引擎的状态存储，格式由 xyz-harness 框架定义

---

## 3. ADR 编写规范

### 3.1 什么是 ADR

架构决策记录（Architecture Decision Record）记录项目中重要的技术决策：为什么选择某个方案，放弃了哪些替代方案，决策时的上下文是什么。

### 3.2 什么时候需要写 ADR

| 需要 ADR | 不需要 ADR |
|----------|-----------|
| 选择数据库方案 | 选择某个 npm 包的版本 |
| 确定系统分层架构 | 文件命名规范 |
| 引入新的设计模式 | 修复一个 bug 的方案 |
| 改变数据存储格式 | 添加一个 API 端点 |
| 代理层的四层架构划分 | 调整日志格式 |
| 选择 SSE 而非 WebSocket | 调整超时参数 |

**判断标准**：如果决策影响 3 个以上文件，且替代方案的取舍不是显而易见的，就需要 ADR。

### 3.3 ADR 文件命名

```
docs/adr/
└── NNNN-<short-description>.md
```

- `NNNN`：四位数字编号，从 `0001` 开始递增
- `<short-description>`：kebab-case 简短描述，不超过 5 个词
- 示例：`0003-four-layer-proxy-architecture.md`

### 3.4 ADR 内容模板

```markdown
# ADR NNNN: <标题>

## 状态

[提议 | 已接受 | 已废弃 | 已替代]

## 背景

<描述决策时的上下文、问题、约束条件>

## 决策

<描述做出的决策及理由>

## 替代方案

### 方案 A: <名称>
- 优点：...
- 缺点：...
- 不选择的原因：...

### 方案 B: <名称>
- 优点：...
- 缺点：...
- 不选择的原因：...

## 影响

<这个决策带来的后果，正面和负面>

## 后续

<决策后需要跟进的事项，如有>
```

### 3.5 ADR 维护规则

1. **ADR 编号不回收**：即使废弃也不删除，状态改为「已废弃」
2. **被替代时标注**：如果 ADR 0003 被 ADR 0007 替代，在 0003 中标注「已替代，参见 ADR 0007」
3. **新建 ADR 前先检索**：确认没有已有 ADR 覆盖相同主题。用关键词搜索 `docs/adr/` 目录
4. **ADR 内容不可修改决策本身**：只能修改笔误或补充遗漏的影响描述。如果要改变决策，写新的 ADR

---

## 4. Changelog 编写规范

### 4.1 版本结构

```
docs/changelog/
├── README.md            # changelog 导航
├── v1-core-proxy/       # 版本 1：核心代理功能
│   ├── README.md        # 版本概述
│   ├── architecture/    # 架构说明
│   ├── notes/           # 开发笔记
│   └── screenshot/      # 版本截图
├── v2-format-transform/ # 版本 2：格式转换
└── ...
```

### 4.2 版本命名规则

- 格式：`v<N>-<short-description>`
- `N`：主版本号，递增
- `<short-description>`：kebab-case，2-4 个词概括版本主题
- 示例：`v1-core-proxy`、`v2-format-transform`、`v3-management-console`

### 4.3 版本目录内容

每个版本目录可包含以下子目录（按需创建）：

| 子目录 | 内容 | 必须 |
|--------|------|------|
| `README.md` | 版本概述：目标、范围、关键变更 | 是 |
| `architecture/` | 架构说明、设计图 | 否 |
| `notes/` | 开发笔记、决策记录 | 否 |
| `screenshot/` | 版本对应的产品截图 | 否 |
| `impr/` | 改进计划和回顾 | 否 |

### 4.4 版本 README 模板

```markdown
# v<N>: <版本主题>

## 时间范围

<开始日期> — <结束日期>

## 目标

<本版本要达成什么>

## 关键变更

| 变更 | 描述 |
|------|------|
| <变更 1> | <描述> |
| <变更 2> | <描述> |

## 遗留问题

| 问题 | 状态 |
|------|------|
| <问题 1> | <待解决/已转移至 vN+1> |
```

### 4.5 Changelog 与 Git Tag 的关系

- Git tag（如 `v1.2.3`）对应 npm 语义版本，用于发布
- Changelog 版本（如 `v1-core-proxy`）对应功能阶段，粒度更大
- 两者是不同维度的版本追踪，不要求一一对应

---

## 5. UI Demo 维护规则

### 5.1 demo 文件规范

```
docs/designs/
├── index.html                 # demo 目录索引页
├── demo-dashboard.html        # 仪表盘原型
├── demo-providers.html        # Provider 管理原型
├── demo-providers-v2.html     # Provider v2 原型（重大改版时新建）
├── components/                # 分层组件库 demo
└── ...
```

### 5.2 命名规则

| 文件类型 | 命名格式 | 示例 |
|---------|---------|------|
| 页面 demo | `demo-<page-name>.html` | `demo-dashboard.html` |
| 页面 demo 重大改版 | `demo-<page-name>-v<N>.html` | `demo-providers-v2.html` |
| 页面 demo 变体方案 | `demo-<page-name>-<variant>.html` | `demo-mappings-A-pipeline-list.html` |
| 组件库 demo | `demo-components.html` | `demo-components.html` |
| 组件库子目录 | `components/` | `components/` |

### 5.3 Demo 技术要求

1. **自包含**：每个 HTML 文件内联所有 CSS + JS，可直接浏览器打开
2. **使用项目设计令牌**：颜色、间距、字体与 `frontend/src/styles/tokens.css` 保持一致
3. **不依赖后端**：纯前端交互，数据硬编码在 demo 中
4. **不依赖构建工具**：不使用 Vite、Webpack 等，直接 `<script>` 引入 CDN 资源

### 5.4 Demo 与实际页面的关系

```
docs/designs/demo-providers.html    →  frontend/src/views/Providers.vue
                                        frontend/src/components/providers/

docs/designs/demo-dashboard.html    →  frontend/src/views/Dashboard.vue
```

- Demo 是**设计参考和交互规格**，不是代码模板
- 前端实现时参考 demo 的布局和交互，但使用 shadcn-vue 组件重写
- Demo 不需要与实际页面 100% 一致，允许实现时微调

### 5.5 Demo 更新时机

| 场景 | 操作 |
|------|------|
| 新增页面 | 新建 `demo-<page>.html` |
| 页面布局重大变更 | 新建 `demo-<page>-v<N>.html`，保留旧版 |
| 小幅样式调整 | **不更新** demo |
| 页面删除 | 保留 demo，不删除（历史参考） |
| Demo 与实际页面差异过大 | 评估是否需要更新 demo |

---

## 6. 文档与代码同步规则

### 6.1 必须同步的场景

以下代码变更**必须**同步更新相关文档：

| 代码变更 | 需要更新的文档 |
|---------|---------------|
| 新增 API 端点 | `CLAUDE.md` 架构说明（如有架构影响） |
| 新增数据库表 | `CLAUDE.md` 数据表列表 |
| 改变代理层架构 | 新建 `docs/adr/` + 更新 `CLAUDE.md` |
| 新增 ESLint 规则 | `CLAUDE.md` 规则列表 |
| 页面布局重大变更 | `docs/designs/` 对应 demo |
| 新增运行时外部文件 | `CLAUDE.md` postbuild 清单 |
| 版本发布 | `docs/changelog/` + `README.md` |

### 6.2 不需要同步的场景

| 代码变更 | 不需要更新文档 |
|---------|---------------|
| 修复 bug | 无需文档（除非修复揭示了一个需要记录的设计缺陷） |
| 重命名变量/函数 | 无需文档 |
| 小幅样式调整 | 无需更新 demo |
| 添加测试 | 无需文档（除非引入新的测试模式） |
| 依赖版本升级 | 无需文档（除非是破坏性变更） |

### 6.3 文档同步的 PR 检查

提交 PR 时，如果涉及以下文件，需要在 PR 描述中说明文档同步情况：

- `router/src/proxy/` 下的架构性变更
- `router/src/db/migrations/` 下的新增迁移
- `frontend/src/views/` 下的布局变更
- `router/taste-lint/` 下的规则变更

---

## 7. 什么时候需要写文档

### 7.1 必须写文档

1. **架构决策**：影响多个模块的技术选型（ADR）
2. **API 契约变更**：新增/修改 API 端点的行为
3. **数据模型变更**：新增/修改数据库表结构
4. **发布说明**：版本发布时的变更摘要
5. **项目规范**：团队约定的编码标准、流程规范
6. **故障复盘**：生产事故的根本原因和修复方案

### 7.2 建议写文档

1. **复杂算法说明**：非直觉可理解的逻辑（如溢出重定向算法）
2. **集成指南**：第三方服务接入的配置步骤
3. **性能优化记录**：优化前后对比数据
4. **已知限制**：当前方案无法解决的技术约束

### 7.3 不需要写文档

1. **自解释的代码**：命名清晰、逻辑简单的函数
2. **标准模式的使用**：如标准的 CRUD 实现
3. **临时的调试代码**：开发过程中的调试辅助
4. **自动生成的代码**：如 shadcn-vue 组件、SQL 迁移模板
5. **已有的文档已覆盖**：不重复

### 7.4 判断流程图

```
变更是否影响他人（其他开发者、用户、AI 助手）？
  └─ 否 → 不需要文档
  └─ 是 → 变更是否改变了架构或设计决策？
       └─ 是 → 写 ADR + 更新相关文档
       └─ 否 → 变更是否改变了 API 或数据模型？
            └─ 是 → 更新 API 文档 + 数据模型文档
            └─ 否 → 变更是否引入了新的约定或规范？
                 └─ 是 → 写/更新项目规范文档
                 └─ 否 → 在 PR 描述中说明即可
```

---

## 8. 文档质量标准

### 8.1 格式标准

| 项目 | 标准 |
|------|------|
| 文件格式 | Markdown（`.md`），HTML demo 除外 |
| 编码 | UTF-8 |
| 换行 | LF（Unix 风格） |
| 标题层级 | 从 H1 开始，不跳级 |
| 代码块 | 标注语言（` ```typescript ` 而不是 ` ``` `） |
| 表格 | 使用 Markdown 表格，列对齐 |
| 链接 | 优先使用相对路径链接 |

### 8.2 内容标准

| 维度 | 标准 | 反例 |
|------|------|------|
| **准确性** | 描述与代码实际行为一致 | "这个函数返回 string" 但实际可能返回 null |
| **时效性** | 反映当前代码状态，不包含已过时信息 | 文档描述三年代理层，实际已是四层 |
| **完整性** | 覆盖决策的关键方面（为什么、选了什么、放弃了什么） | 只写"选择了 SQLite"不解释原因 |
| **简洁性** | 不重复代码中已有的信息 | 复制完整函数签名到文档 |
| **可操作性** | 读者知道接下来要做什么 | "注意性能"但没有具体指标或阈值 |
| **可搜索** | 使用项目统一的术语，方便 grep | 同一概念用三种不同叫法 |

### 8.3 文档评审清单

在 PR 中更新文档时，自查以下项目：

- [ ] 文档放在正确的目录（对照本文档分类表）
- [ ] 文件命名符合规范
- [ ] 链接有效（相对路径指向正确文件）
- [ ] 无错别字和语法错误
- [ ] 代码示例可运行（如有）
- [ ] 不与其他文档重复
- [ ] 术语与项目现有文档一致

---

## 9. 特殊文档类型的管理

### 9.1 CLAUDE.md

**定位**：AI 编码助手的配置文件，非传统文档。

**维护规则**：

1. **持续更新**：每次影响编码约定的变更都应更新
2. **结构固定**：保持 CLAUDE.md 中的章节结构，新增内容放在合适的章节
3. **不删除**：已过时的信息标注 `[已废弃]`，不直接删除（AI 可能在旧分支上工作）
4. **精简优先**：CLAUDE.md 是 AI 上下文的一部分，过长会占用 token 预算。重复信息合并，冗余描述删除

**与 docs/standards/ 的关系**：

- `CLAUDE.md` 中的编码规范是 AI 助手的速查版，关注"怎么做"
- `docs/standards/` 是完整的项目规范，关注"为什么"和"完整规则"
- 两者内容允许适度重叠，但 `CLAUDE.md` 不应与 `docs/standards/` 矛盾

### 9.2 .xyz-harness/ 工作流文档

**定位**：工作流引擎的状态存储，非手工维护的文档。

**维护规则**：

1. **不手动创建/修改**：所有内容由 xyz-harness 工作流自动生成
2. **目录命名**：`YYYY-MM-DD-<feature-slug>/`，按需创建时间命名
3. **内容完整性**：每个需求目录应包含 spec → plan → reviews → evidence 的完整链路
4. **历史保留**：已完成的目录不删除，供复盘和参考
5. **不跨目录引用**：`.xyz-harness/` 下的文档不作为其他文档的权威引用源

### 9.3 SQL 迁移文件

**定位**：数据库结构文档 + 运行时执行文件。

**维护规则**：

1. **只增不改**：已发布的迁移文件不修改。结构变更通过新迁移文件实现
2. **编号递增**：新迁移文件编号必须大于所有已有编号
3. **命名描述性**：文件名描述变更内容，如 `019_add_session_model_history.sql`
4. **每个迁移独立**：迁移文件不依赖执行顺序之外的逻辑

### 9.4 README.md

**定位**：项目入口文档，对外展示。

**维护规则**：

1. **版本发布时更新**：新功能、重大变更同步到 README
2. **中英文双语**：`README.md`（中文）和 `README.en.md`（英文）保持同步
3. **保持精简**：README 是概览，不是详尽文档。详细内容链接到 `docs/`
4. **截图引用**：产品截图放在 `docs/screenshot/`，README 中使用相对路径引用

### 9.5 OpenAPI / Swagger 文档

**定位**：Admin API 的自动化接口文档。

**生成方式**：从 Fastify JSON Schema 自动生成（`@fastify/swagger` + `@fastify/swagger-ui`）。不需要手写。

**前置依赖**：Admin API 端点的 Schema 需要补全（当前 76 个端点仅 24 个有 Schema，见 `03-backend.md` 第 6.2 节）。

### 9.6 Design Token 文档

**定位**：前端设计令牌的权威来源。

**维护规则**：
1. 设计令牌从 `frontend/src/styles/tokens.ts`（TS 常量）作为单一来源生成 CSS 变量文件
2. `docs/designs/components/tokens.css` 通过脚本从源文件同步，禁止手动编辑
3. 新增 token 时：改 `tokens.ts` → 运行生成脚本 → 验证两处 tokens.css 一致

### 9.7 临时文档（docs/scratch/）

**定位**：开发过程中产生的临时文档，不属于项目正式文档体系。

**适用场景**：
- AI 编码过程中生成的分析报告、调研笔记
- 临时的问题排查记录（diagnosis notes）
- spec/plan 阶段的草稿或中间产物
- 一次性的数据对比、性能测试结果

**命名规范**：`YYYY-MM-DD-<简短描述>.md`

**生命周期**：

| 阶段 | 动作 |
|------|------|
| 创建 | 开发过程中按需创建，命名含日期 |
| PR 前 | 逐一审查：有价值的提升为正式文档，无价值的删除 |
| 合并前 | 目录应为空或仅保留有明确保留理由的文件 |

**PR 审查规则（强制）**：

| 判断 | 处理方式 |
|------|--------|
| 内容有长期参考价值 | 提升为正式文档（迁移到 `docs/adr/`、`docs/standards/` 等），删除 scratch 原文件 |
| 仅用于当前 PR 的上下文说明 | 在 PR description 中提炼要点后删除 |
| 纯 AI 中间产物，无参考价值 | 直接删除 |
| 调试/排查记录，问题已解决 | 直接删除 |

**核心原则**：scratch 文件不应随 PR 合入 main。合并前目录应清空。

**禁止事项**：
- 不存放敏感信息（API key、密码、token）
- 不存放大段代码（用代码文件代替）
- 不用 scratch 替代 `.xyz-harness/` 的 spec/plan（它们有各自的规范）

---

## 10. 文档操作规范

### 10.1 新增文档步骤

```
1. 确定文档类型（ADR / changelog / design / standard / 其他）
2. 确定放置目录（对照本文档分类表）
3. 确定命名（对照本文档命名规则）
4. 使用对应的内容模板（如有）
5. 编写文档内容
6. 更新上级索引（如 docs/README.md）
7. 在 PR 中说明新增了什么文档
8. 检查 `docs/scratch/` 中是否有相关的临时文件需要提升或清理
```

### 10.2 更新文档步骤

```
1. 确认文档是否仍然有效（可能已废弃）
2. 标注更新日期或版本（如适用）
3. 保持与文档其他部分的一致性
4. 检查是否有其他文档引用了被修改的内容
5. 在 PR 中说明更新了什么文档的什么内容
```

### 10.3 废弃文档处理

| 文档类型 | 废弃处理 |
|---------|---------|
| ADR | 不删除，状态改为「已废弃」，注明原因和替代方案 |
| Changelog | 不废弃，历史版本永久保留 |
| Demo | 不删除，保留作为历史参考 |
| Standard | 不删除，标注「已废弃」，指向新规范（如有） |
| 其他文档 | 评估是否有人引用。无引用可删除，有引用则标注废弃 |

---

## 11. 文档搜索与引用

### 11.1 文档内引用格式

```markdown
<!-- 引用同级目录文件 -->
参见 [0003-four-layer-proxy-architecture](0003-four-layer-proxy-architecture.md)

<!-- 引用上级目录 -->
参见 [项目结构规范](../standards/04-project-structure.md)

<!-- 引用代码文件 -->
参见 `router/src/proxy/orchestration/orchestrator.ts`
```

### 11.2 术语一致性

以下术语在所有文档中保持一致：

| 统一术语 | 禁止使用的变体 |
|---------|---------------|
| Provider | 供应商、provider、上游服务 |
| Mapping | 映射、mapping、路由规则 |
| Target | 目标、target、后端目标 |
| Resilience | 韧性层、resilience、重试层 |
| Handler | 处理器、handler、路由回调 |
| Transport | 传输层、transport、HTTP 调用层 |
| Orchestration | 编排层、orchestration、协调层 |
| Pipeline | 管道、pipeline、处理链 |
| Semaphore | 信号量、semaphore、并发控制 |

### 11.3 文档索引

`docs/README.md` 作为文档导航索引，必须保持更新。每当新增文档目录或重要文档时，更新索引。

---

## 12. 文档与 AI 协作

### 12.1 AI 可读文档

以下文档是 AI 编码助手的输入：

| 文档 | AI 如何使用 |
|------|-----------|
| `CLAUDE.md` | 作为系统提示词的一部分，指导编码行为 |
| `docs/adr/` | AI 需要理解架构决策时阅读 |
| `docs/standards/` | AI 编码时遵循的规范 |
| `.xyz-harness/spec.md` | AI 实现 feature 时的需求来源 |
| `.xyz-harness/plan.md` | AI 实现时的任务拆分和步骤 |

### 12.2 AI 生成的文档

AI 生成的文档需要人类审查后才能提交：

| 场景 | 要求 |
|------|------|
| ADR | 人类审查技术准确性和决策合理性 |
| Changelog | 人类审查变更描述的准确性 |
| Standard | 人类审查规则的适用性 |
| Demo | 人类审查交互设计的合理性 |
| 代码注释 | AI 可直接生成，遵循注释规范 |

### 12.3 文档 Token 预算意识

`CLAUDE.md` 是 AI 上下文的一部分，过长的文档会挤占代码上下文空间：

- `CLAUDE.md` 目标控制在合理范围内（当前约 500 行，已是较大文档）
- `docs/standards/` 不自动加载到 AI 上下文，按需读取
- ADR 和 changelog 按需引用，不全量加载

---

## 附录 A：文档类型速查表

| 我要... | 应该放在 | 命名规则 | 模板 |
|---------|---------|---------|------|
| 记录架构决策 | `docs/adr/` | `NNNN-<desc>.md` | 第 3.4 节 |
| 记录版本演进 | `docs/changelog/v<N>-<desc>/` | 目录名 | 第 4.4 节 |
| 创建 UI 原型 | `docs/designs/` | `demo-<page>.html` | 无固定模板 |
| 编写项目规范 | `docs/standards/` | `NN-<desc>.md` | 无固定模板 |
| 记录需求规格 | `.xyz-harness/YYYY-MM-DD-<feat>/` | 目录名 | xyz-harness 框架 |
| 更新项目说明 | 根目录 `README.md` | 固定名称 | 无固定模板 |
| 添加产品截图 | `docs/screenshot/` | `<描述>.png` | N/A |

---

## 附录 B：文档维护检查清单

### 版本发布时

- [ ] `README.md` 和 `README.en.md` 已更新
- [ ] `docs/changelog/` 新增版本目录
- [ ] `docs/screenshot/` 截图已更新（如有 UI 变更）
- [ ] `CLAUDE.md` 中的版本相关信息已更新
- [ ] 所有新增文档已添加到 `docs/README.md` 索引

### 架构变更时

- [ ] 新增 ADR 记录决策
- [ ] `CLAUDE.md` 架构章节已更新
- [ ] 受影响的 demo 已评估是否需要更新
- [ ] 受影响的规范文档已更新

### 日常开发时

- [ ] PR 涉及文档变更时在描述中说明
- 不提交空的文档文件（占位符至少包含标题和目的）
- 删除代码时不遗留仅被删除代码引用的文档
- [ ] `docs/scratch/` 中的临时文件已逐一审查：有价值的提升为正式文档，无价值的已删除
- [ ] PR 合入前 `docs/scratch/` 目录已清空（仅 `README.md` 保留）
