---
verdict: pass
---

# Non-Functional Design — Pipeline Architecture Refactor

## 1. 稳定性

**影响：** 纯重构，不改变外部行为。风险来自函数提取时的导入路径变更和模块边界错误。通过"先写测试再提取"的 TDD 流程缓解——每个提取的模块都有独立测试，提取前先确保测试通过，提取后只改 import 路径。

## 2. 数据一致性

**不适用。** 本次重构不涉及数据库 schema 变更或数据迁移。所有 DB 操作调用保持不变，仅改变代码组织结构。

## 3. 性能

**不适用。** 纯代码重组，不引入新的运行时开销。hook-registry 合并消除了双注册的启动开销（从 O(2n) 降为 O(n)），但注册只在启动时执行一次，无运行时性能影响。

## 4. 业务安全

**不适用。** 本次重构不改变认证、授权、密钥管理等安全相关逻辑。emit 异常降级新增了 catch 分支，但仅用于 non-core hook 的 warning 级别日志，不影响安全决策路径。

## 5. 数据安全

**不适用。** 不涉及敏感信息处理变更。rejectAndReply 提取后仍然执行 headers 脱敏（sanitizeHeadersForLog），行为不变。
