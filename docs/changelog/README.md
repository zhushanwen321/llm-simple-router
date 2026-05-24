# 系统演进日志

记录 LLM Simple Router 每个重要阶段的架构决策、性能分析、UI 变化。

## 版本时间线

| 版本 | 版本范围 | 日期 | 主题 |
|------|---------|------|------|
| v1-core-proxy | v0.3 ~ v0.5 | 2026-04-14 ~ 04-27 | 核心代理转发、Provider CRUD、密钥管理 |
| v2-format-transform | v0.6 ~ v0.7 | 2026-04-28 ~ 04-30 | OpenAI/Anthropic 格式转换、DeepSeek patch |
| v3-management-console | v0.8 ~ v0.9 | 2026-05-01 ~ 05-08 | 暗色主题、i18n、Responses API、编码代理调研 |
| v4-plugin-resilience | v0.10 | 2026-05-09 ~ 05-12 | 插件架构、并发控制、性能分析、架构债务清理 |
| v5-model-mapping | v0.11 | 2026-05-15 ~ 至今 | 模型映射优化、Codex 客户端、流式增强 |

## 目录结构

每个版本目录下包含以下子目录：

| 目录 | 说明 |
|------|------|
| `architecture/` | 架构参考文档 |
| `screenshot/` | 该时期的 UI 截图 |
| `notes/` | 调研笔记、分析记录 |
| `impr/` | 性能/架构改进分析（仅 v4） |

---

更细粒度的设计/实施计划见 `.xyz-harness/specs/` 和 `.xyz-harness/plans/`。
