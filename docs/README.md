# LLM Simple Router — 文档索引

LLM API 代理路由器的完整文档目录。

## 目录

| 目录 | 说明 | 文件数 |
|------|------|--------|
| [`changelog/`](changelog/) | 系统演进日志。按版本(v1–v5)组织，每个版本含 `architecture/`、`screenshot/`、`notes/`、`impr/` 等 | 36 |
| [`designs/`](designs/) | 管理后台 UI 交互原型。14 个可运行的 HTML demo + 抽离的组件库 (`components/`) | 23 |
| [`adr/`](adr/) | 架构决策记录 (Architecture Decision Records) | 5 |
| [`provider/`](provider/) | Provider 参考数据（`doc_url.json`） | 1 |
| [`.xyz-harness/specs/`](../.xyz-harness/specs/) | 独立的设计文档，按日期命名 | 13 |
| [`.xyz-harness/plans/`](../.xyz-harness/plans/) | 独立的实施计划，按日期命名 | 7 |

## 文档组织原则

- **`changelog/`** — 按版本记录系统演进，每个版本包含架构快照（`architecture/`）、界面截图（`screenshot/`）、分析笔记（`notes/`）和改进建议（`impr/`）
- **`designs/`** — 可直接在浏览器打开的 HTML 交互原型，用于前端页面重构时的视觉参考。`components/` 子目录是抽离的分层组件库（tokens → atoms → composites → patterns）
- **`adr/`** — 编号式架构决策记录，每条记录包含背景、决策、后果。编号递增，不可撤销（只能追加新的覆盖）
- **`.xyz-harness/`** — `specs/` 存放需求规格文档，`plans/` 存放实施计划。文件按日期命名（`YYYY-MM-DD-*.md`），与功能分支一一对应
