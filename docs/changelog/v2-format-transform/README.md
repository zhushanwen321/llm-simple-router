# v2: Format Transform (v0.6~v0.7)

> 2026-04-28 ~ 2026-04-30

## 概要

API 格式转换层建设。完成 OpenAI/Anthropic 双向转换、DeepSeek 兼容 patch、日志管线优化。

## 关键里程碑

- v0.6.0 — OpenAI/Anthropic 格式转换器
- v0.6.4 — 请求日志管线重构
- v0.7.0 — DeepSeek Anthropic API 兼容 patch

## 目录内容

| 文件 | 说明 |
|------|------|
| `architecture/field-mapping.md` | 三格式字段映射参考 |
| `notes/deepseek-patch.md` | DeepSeek 兼容性调研 + 优化设计 |
| `notes/api-research.md` | LLM API 格式转换调研报告 |

## 设计决策

见 `adr/0001-responses-anthropic-primary-conversion.md`
