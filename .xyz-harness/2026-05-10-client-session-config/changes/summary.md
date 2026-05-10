# 客户端 Session 识别配置化 + Core 包合并 + Pi 插件精简 - 全流程追溯

## 基本信息
- 需求描述: 将客户端 session header 识别改为可配置，合并 core 包到 router，精简 pi 插件
- 开始时间: 2026-05-10
- 当前阶段: 1 需求分析

## 阶段状态

| 阶段 | 状态 | 评审轮次 | 备注 |
|------|------|---------|------|
| 1 需求分析 | done | - | spec.md + plan.md 已产出 |
| 2 需求评审 | done | - | - |
| 3 编码实现 | done | - | Task 2+3 后端实现 |
| 4 编码评审 | ⬜ 未开始 | - | - |
| 5 测试编写 | done | - | 14 测试全部通过 |
| 6 测试评审 | ⬜ 未开始 | - | - |
| 7 代码推送 | ⬜ 未开始 | - | - |
| 8 CI 验证 | ⬜ 未开始 | - | - |
| 9 部署验证 | ⬜ 未开始 | - | - |
| 10 用户确认 | ⬜ 未开始 | - | - |
| 11 自动复盘 | ⬜ 未开始 | - | - |

## 评审摘要
[待填充]

## 异常记录
[待填充]

## 阶段 3 - 编码实现 (Task 2+3)

- 状态：done
- 变更文件：
  - router/src/db/settings.ts — 新增 ClientSessionHeaderEntry 类型、getClientSessionHeaders/setClientSessionHeaders 函数
  - router/src/admin/settings.ts — 新增 GET/PUT /admin/api/settings/client-session-headers 端点
  - router/src/proxy/handler/proxy-handler-utils.ts — 移除 ClientAgentType/detectClientAgentType，新增 detectClient 配置驱动检测
  - router/src/proxy/hooks/builtin/client-detection.ts — 重构为从 DB 加载配置，兼容 user-agent fallback
  - router/src/proxy/handler/failover-loop.ts — sessionId/clientType 改为从 metadata 获取
  - router/src/proxy/handler/create-proxy-handler.ts — sessionId 改为从 metadata 获取
  - router/src/proxy/tool-error-logger.ts — ClientAgentType 改为 string
  - router/src/proxy/hooks/builtin/error-logging.ts — 移除 detectClientAgentType 引用，改用 metadata
  - router/src/proxy/hooks/builtin/request-logging.ts — 同上
  - router/src/proxy/hooks/builtin/enhancement-preprocess.ts — sessionId 改为从 metadata 获取
- 摘要：实现客户端 session header 配置化的 DB 层、Admin API、检测逻辑重构。14 个目标测试全部通过，1174 个全量测试通过，build + lint 无错误。
- 时间：2026-05-10T13:08:00+08:00
