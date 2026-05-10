# Transform Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为格式转换器添加 4 项健壮性增强：消息自愈、错误语义分类、JSON Mode 处理、Provider Specific Fields 保留。

**Architecture:** 新增独立模块（sanitize.ts、error-classifier.ts、provider-meta.ts），作为现有 transform pipeline 的前/后处理钩子。现有 mapper 核心逻辑不变，仅在调用点添加集成代码。

**Tech Stack:** TypeScript, Vitest

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/proxy/transform/sanitize.ts` | tool_use_id 清洗 + 空 content 补占位符 |
| `src/proxy/transform/error-classifier.ts` | 错误响应语义分类（12 类别） |
| `src/proxy/transform/provider-meta.ts` | PSF 提取/注入/还原 |
| `tests/proxy/transform/sanitize.test.ts` | sanitize 单元测试 |
| `tests/proxy/transform/error-classifier.test.ts` | classifier 单元测试 |
| `tests/proxy/transform/provider-meta.test.ts` | PSF 单元测试 |

### Modified Files
| File | Change |
|------|--------|
| `src/proxy/transform/message-mapper.ts` | convertMessagesOA2Ant 入口调用 ensureNonEmptyContent，tool/assistant 处理调用 sanitizeToolUseId |
| `src/proxy/transform/request-transform.ts` | OA_KNOWN_FIELDS 新增 response_format + provider_meta，openaiToAnthropicRequest 添加 response_format warn 和 provider_meta 还原 |
| `src/proxy/transform/response-transform.ts` | anthropicResponseToOpenAI 提取 PSF，transformErrorResponse 调用 classifyError |
| `src/proxy/transform/stream-ant2oa.ts` | 流式 PSF 采集，message_stop 前输出 message_meta 事件 |
| `tests/proxy/transform/request-transform.test.ts` | JSON mode + PSF 还原测试 |
| `tests/proxy/transform/response-transform.test.ts` | PSF 提取 + classifier 集成测试 |
| `tests/proxy/transform/message-mapper.test.ts` | sanitize 集成测试 |

## Task Dependency

```
T1 (sanitize) ──── independent
T2 (error-classifier) ──── independent
T3 (JSON mode) ──── independent
T4 (provider-meta) ──── after T1 (message-mapper 已修改)
```

T1-T3 可并行，T4 需在 T1 之后执行。

## Tasks

- [ ] Task 1: Message Self-Healing — [plan-t1-sanitize.md](plan-t1-sanitize.md)
- [ ] Task 2: Error Response Classification — [plan-t2-error-classifier.md](plan-t2-error-classifier.md)
- [ ] Task 3: JSON Mode Handling — [plan-t3-json-mode.md](plan-t3-json-mode.md)
- [ ] Task 4: Provider Specific Fields — [plan-t4-provider-meta.md](plan-t4-provider-meta.md)
