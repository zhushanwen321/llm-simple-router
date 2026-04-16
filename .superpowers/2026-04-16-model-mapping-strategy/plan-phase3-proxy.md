# Task 3: 映射解析器 + 代理集成

> 依赖：Task 1（DB 迁移 + getMappingGroup）、Task 2（策略接口 + scheduledStrategy）

## 概述

创建 `resolveMapping` 统一入口，将 client_model 通过 group → strategy → target 链路解析为具体后端目标，然后替换 openai.ts / anthropic.ts 中对 `getModelMapping` 的直接调用。

---

## 步骤

### Step 1: 创建 mapping-resolver.ts

文件 `src/proxy/mapping-resolver.ts`：

- 调用 `getMappingGroup(db, clientModel)` 获取 group
- JSON.parse(group.rule) 得到原始规则
- 按 group.strategy 查找已注册策略（目前只有 scheduled）
- 调用 strategy.select(rule, context) 得到 Target
- 任何环节失败返回 null

策略注册表用 `Record<string, MappingStrategy>`，新增策略只需加一行。

### Step 2: 写 resolver 测试

文件 `tests/mapping-resolver.test.ts`，使用内存数据库：

| # | 场景 | 预期 |
|---|------|------|
| 1 | client_model 无对应 group | null |
| 2 | scheduled group，当前时间无窗口匹配 | default target |
| 3 | scheduled group，当前时间命中窗口 | 窗口 target |
| 4 | rule JSON 格式错误 | null |
| 5 | strategy 字段指向不存在的策略 | null |

通过 `createMappingGroup` 直接向 mapping_groups 表插入测试数据。测试中控制 `context.now` 避免时间依赖。

### Step 3: 修改 openai.ts

在 openaiProxyRaw（第 53 行）：

- `getModelMapping(db, clientModel)` → `resolveMapping(db, clientModel, { now: new Date() })`
- 后续 `mapping.backend_model` / `mapping.provider_id` → `resolved.backend_model` / `resolved.provider_id`
- null 检查和错误处理逻辑不变
- 保留 getModelMapping import（标记 @deprecated，旧 API 兼容层仍使用）

### Step 4: 修改 anthropic.ts

同 Step 3 相同改动。anthropic.ts 第 51 行同样的替换模式。

### Step 5: 运行全部测试

```bash
npm test
```

### Step 6: 提交

```bash
git add src/proxy/mapping-resolver.ts src/proxy/openai.ts src/proxy/anthropic.ts tests/mapping-resolver.test.ts
git commit -m "feat: integrate resolveMapping into proxy layer"
```

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `src/proxy/mapping-resolver.ts` |
| 新建 | `tests/mapping-resolver.test.ts` |
| 修改 | `src/proxy/openai.ts` |
| 修改 | `src/proxy/anthropic.ts` |

## 风险点

- openai.ts / anthropic.ts 中 `mapping` 变量后续还有多处引用（白名单校验、请求日志等），需全局替换，不能遗漏
- `resolveMapping` 返回的 `Target` 只有 `backend_model` + `provider_id`，而旧 `getModelMapping` 返回的字段可能更多——需确认下游是否依赖其他字段
