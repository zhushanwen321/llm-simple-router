# LLM Simple Router — 文档索引

LLM API 代理路由器的完整文档目录。

## 目录

| 目录 | 说明 | 文件数 |
|------|------|--------|
| [`standards/`](standards/) | 项目规范文档。5 份规范覆盖整体、前端、后端、工程目录、文档管理 | 5 |
| [`changelog/`](changelog/) | 系统演进日志。按版本(v1–v5)组织，每个版本含 `architecture/`、`screenshot/`、`notes/`、`impr/` 等 | 36 |
| [`designs/`](designs/) | 管理后台 UI 交互原型。14 个可运行的 HTML demo + 抽离的组件库 (`components/`) | 23 |
| [`adr/`](adr/) | 架构决策记录 (Architecture Decision Records) | 5 |
| [`provider/`](provider/) | Provider 参考数据（`doc_url.json`） | 1 |
| [`scratch/`](scratch/) | **临时文档**。开发过程中产生的临时分析/草稿，PR 前审查清空 | — |
| [`.xyz-harness/specs/`](../.xyz-harness/specs/) | 独立的设计文档，按日期命名 | 13 |
| [`.xyz-harness/plans/`](../.xyz-harness/plans/) | 独立的实施计划，按日期命名 | 7 |

## 项目规范文档（standards/）

| 文件 | 规范 | 行数 | 核心内容 |
|------|------|------|----------|
| [`01-overall.md`](standards/01-overall.md) | 整体项目规范 | ~1000 | Monorepo 结构、分支策略、四道防线质量门禁、Git 规范、发布流程、Worktree 规范、测试规范、Dev-Flow 工作流 |
| [`02-frontend.md`](standards/02-frontend.md) | 前端规范 | ~1200 | Vue 3 + shadcn-vue 技术栈、设计系统（oklch）、硬性规范（8 条）、组件开发、状态管理、API 调用、SSE、i18n |
| [`03-backend.md`](standards/03-backend.md) | 后端规范 | ~940 | Fastify + SQLite 四层代理架构、数据库层、管理 API、认证、监控、转换层类型安全、插件 Hook 规范 |
| [`04-project-structure.md`](standards/04-project-structure.md) | 工程目录规范 | ~590 | Monorepo 目录结构、文件放置决策树、命名规范、测试组织、Worktree 特殊规则 |
| [`05-documentation.md`](standards/05-documentation.md) | 文档管理规范 | ~600 | ADR/Changelog/Demo 编写规范、文档同步规则、文档质量标准、术语一致性 |

## 文档组织原则

- **`standards/`** — 项目规范的权威来源。`CLAUDE.md` 是 AI 速查版，`standards/` 是完整版，关注"为什么"
- **`changelog/`** — 按版本记录系统演进，每个版本包含架构快照（`architecture/`）、界面截图（`screenshot/`）、分析笔记（`notes/`）和改进建议（`impr/`）
- **`designs/`** — 可直接在浏览器打开的 HTML 交互原型，用于前端页面重构时的视觉参考。`components/` 子目录是抽离的分层组件库（tokens → atoms → composites → patterns）
- **`adr/`** — 编号式架构决策记录，每条记录包含背景、决策、后果。编号递增，不可撤销（只能追加新的覆盖）
- **`scratch/`** — 临时文档目录。开发过程中的分析笔记、草稿、中间产物。**PR 合入前必须审查清空**，有价值的提升为正式文档，无价值的删除。详见 [`scratch/README.md`](scratch/README.md)
- **`.xyz-harness/`** — `specs/` 存放需求规格文档，`plans/` 存放实施计划。文件按日期命名（`YYYY-MM-DD-*.md`），与功能分支一一对应
