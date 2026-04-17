---
date: 2026-04-17
status: approved
related_issue: "#8"
---

# 剩余负载策略设计：Round-Robin / Random / Failover

## 背景

Issue #8 定义了四种负载策略，scheduled（定时切换）已完成。本文档覆盖剩余三种：轮询、随机、故障转移。

## 需求确认

| 策略 | rule 结构 | 顺序 | 状态需求 | 行为 |
|------|----------|------|---------|------|
| round-robin | `{targets:[...]}` | 有序 | 内存 index | 轮流选择 |
| random | `{targets:[...]}` | 无序 | 无 | 随机选择 |
| failover | `{targets:[...]}` | 有序 | 无 | 主失败→备选重试 |

- 健康检查不实现
- 故障转移：单次请求内，复用 retry_rules 触发条件
- 集成方式：exclude 模式（ResolveContext 增加 excludeTargets）

## 策略层设计

详见 [strategy-layer.md](strategy-layer.md)

## proxy-core 集成设计

详见 [failover-integration.md](failover-integration.md)

## Admin API 设计

详见 [admin-api-remaining.md](admin-api-remaining.md)

## 前端 UI 设计

详见 [frontend-remaining.md](frontend-remaining.md)
