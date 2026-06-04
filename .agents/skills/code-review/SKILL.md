---
name: code-review
description: >-
  审查代码变更。触发词："review"、"审查代码"、"code review"、
  "帮我看看代码"。仅用于 llm-simple-router 项目。
---

# Code Review（llm-simple-router）

审查当前 worktree 的代码变更，聚焦 LLM 代理路由器的架构约束和代码质量。

## 适用范围

- 项目：`llm-simple-router`（Node.js monorepo，Fastify + Vue 3）
- 触发词：「review」「审查代码」「code review」「帮我看看代码」
- 不适用：单文件小改动（主 agent 直接看即可）

## Review 维度

按以下维度审查变更，每个维度独立评估。

### 1. 类型安全

```bash
npx tsc --noEmit
```

- 禁止 `any`，用 `unknown` 或具体类型
- `(entry as any).customType` 改为类型守卫函数
- 回调参数必须有类型注解（TS7006）
- 所有 workspace 子包（router、frontend、pi-extension）必须 0 error

### 2. 架构分层（四层代理架构）

llm-simple-router 的代理层严格遵循四层架构，禁止跨层调用：

```
Handler → Orchestration → Routing → Transport
```

| 层 | 目录 | 职责 | 禁止 |
|----|------|------|------|
| Handler | `proxy/handler/` | Fastify 路由回调、映射解析、header 构建 | 直接调用 Transport |
| Orchestration | `proxy/orchestration/` | 信号量、tracker、resilience 协调 | 直接读 DB、直接构建 HTTP 请求 |
| Routing | `proxy/routing/` | 模型映射解析、用量追踪 | 直接调用 Transport |
| Transport | `proxy/transport/` | 底层 HTTP/SSE 调用 | 依赖上层业务逻辑 |

**审查要点**：
- Transport 层不应 import 任何上层模块（handler/orchestration/routing）
- Handler 层不应直接创建 HTTP 请求（必须通过 Orchestrator → Transport）
- Routing 层不应访问 transport 函数
- 同层内模块间可以互相调用，但应保持单向依赖

### 3. 路由映射正确性

审查 model mapping、retry strategy、provider switch 的正确性：

- `routing/mapping-resolver.ts` — client_model → { backend_model, provider_id } 解析
- `routing/model-state.ts` — 内存+SQLite 双层缓存一致性
- `orchestration/resilience.ts` — 重试决策（fixed/exponential）
- `orchestration/retry-rules.ts` — retry rule 匹配（status_code + body_pattern 正则）
- 路由策略：`scheduled`（定时）、`round-robin`（轮询）、`random`（随机）、`failover`（故障转移）

**审查要点**：
- 新增 provider 是否正确配置并发控制（max_concurrency、queue_timeout_ms、max_queue_size）
- 重试规则的 status_code 匹配是否有边界情况
- failover 切换后是否正确释放旧 provider 信号量
- 模型映射变更后内存缓存是否同步刷新

### 4. Monorepo 子包依赖

workspace 结构：`router`、`frontend`、`pi-extension`

```bash
cat package.json | grep -A 20 '"workspaces"'
```

- `workspace:*` 引用是否正确
- router 是核心包，frontend 和 pi-extension 可能依赖它
- 新增依赖必须在正确的子包中声明
- 不能在 router 中引入 frontend 的依赖（反向依赖）

### 5. 测试覆盖

```bash
npm test
```

- 新增功能必须有对应测试
- 测试框架：vitest，禁止 `node:test`
- 运行命令：`npx vitest run` 或 `npm test`
- 涉及 timer 的测试必须用 `vi.useFakeTimers()` + `vi.advanceTimersByTime()`

### 6. 代码质量（Linter）

```bash
npm run lint
```

- ESLint 零警告（`--max-warnings 0`）
- 项目有 `taste-lint` 规则，包含：禁止 any、禁止无界 while(true)、max-lines 1000、max-lines-per-function 300

### 7. 代码质量扫描（fallow）

在人工审查前，运行 fallow 静态分析获取基线数据：

```bash
npm list -g @sourcemeta/fallow 2>/dev/null || npm install -g @sourcemeta/fallow
fallow scan $(git diff main...HEAD --name-only)
```

关注以下指标：
- **复杂度热点**：新增函数是否超过 80 行 / 15 圈复杂度
- **重复代码**：是否与现有代码有重复
- **未使用导出**：新增的类型/函数是否被使用
- **循环依赖**：是否引入新的循环引用

### 8. 向后兼容性

- API 接口变化（`/v1/chat/completions`、`/v1/messages`、`/admin/api/*`）
- 数据库迁移（`src/db/migrations/`）是否有向前兼容逻辑
- 配置格式变化（Provider、Mapping、RetryRule 的 JSON 结构）
- 认证方式变化（Bearer token、JWT）

**审查要点**：
- 新增 DB migration 必须有 `docs/migration-compat.md` 记录
- API 响应格式变化必须保持旧客户端兼容
- 删除或重命名字段需要 deprecation period

## 操作步骤

### 1. 收集变更上下文

```bash
cd /Users/zhushanwen/Code/llm-simple-router-workspace/main
git diff --stat main...HEAD
git diff main...HEAD --name-only
```

### 2. 按维度审查

逐一检查上述 7 个维度，记录发现的问题。

### 3. 输出审查报告

按维度组织，每个问题包含：
- **文件**: 路径和行号
- **维度**: 对应的 review 维度
- **严重程度**: error（必须修复）/ warning（建议修复）/ info（可选优化）
- **描述**: 问题说明和修复建议

### 4. 验证修复

修复后重新运行对应检查：

```bash
npx tsc --noEmit    # 类型安全
npm run lint        # 代码质量
npm test            # 测试覆盖
npm run build       # 构建验证
```

---

## 标记说明

| 标记 | 含义 | 修改约束 |
|------|------|----------|
| `[HISTORICAL]` | 历史经验总结的规则 | 不允许删除或削弱 |
| `[MANDATORY]` | 流程强制要求 | 必须严格遵守 |
| `[OPTIONAL]` | 可选步骤 | 可根据项目需求调整 |
