# 映射解析层（Mapping Resolver）

## 统一入口

`resolveMapping(db, clientModel, context) → { backend_model, provider_id } | null`

- `context`: `{ now: Date }`（scheduled 策略需要当前时间）
- 内部流程：查 `mapping_groups` → 解析 `rule` JSON → 按 `strategy` 字段分发到对应策略 → 返回选中的 target

## 策略接口

定义于 `src/proxy/strategy/types.ts`：

```typescript
interface MappingStrategy {
  select(rule: unknown, context: ResolveContext): Target | undefined;
}
interface Target { backend_model: string; provider_id: string; }
interface ResolveContext { now: Date; }
```

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/proxy/mapping-resolver.ts` | 统一入口，策略注册与分发 |
| `src/proxy/strategy/types.ts` | 策略接口定义 |
| `src/proxy/strategy/scheduled.ts` | 定时切换（完整实现） |
| `src/proxy/strategy/round-robin.ts` | 骨架，抛 not_implemented |
| `src/proxy/strategy/random.ts` | 骨架 |
| `src/proxy/strategy/failover.ts` | 骨架 |

## scheduled 策略 select 逻辑

1. 将 `windows` 按 `start` 排序
2. 取当前时间 `HH:MM`（使用 `Intl.DateTimeFormat` + `timeZone: 'local'`，即 Node.js 进程的时区）
3. 遍历找 `time_start <= now <= time_end` 的匹配
   - 跨午夜：`start > end` 表示跨 0 点，匹配条件为 `now >= start || now <= end`
4. 无匹配返回 `rule.default`
5. `default` 也不存在返回 `undefined`

**时区说明**：使用服务器本地时间。Docker 部署时需通过 `TZ` 环境变量设置时区（如 `TZ=Asia/Shanghai`），否则默认 UTC。配置的时间窗口应与服务器时区一致。

## 代理层调用

`openaiProxyRaw` 和 `anthropicProxyRaw` 统一改为：

```typescript
resolveMapping(db, clientModel, { now: new Date() })
```

替换原来的 `getModelMapping(db, clientModel)`。

## DB 函数变更

- 新增 `getMappingGroup(db, clientModel)` — 查 `mapping_groups` 表
- `getModelMapping` 保留但标记 `@deprecated`，迁移期兼容
