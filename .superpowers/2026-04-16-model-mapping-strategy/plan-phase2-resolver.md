# Task 2: 策略接口 + scheduled 实现

> 依赖：Task 1（DB 迁移，本 Task 仅依赖其中的 MappingGroup 类型定义）

## 概述

定义 `MappingStrategy` 策略接口，实现 `scheduled`（定时切换）策略，并为 round-robin / random / failover 创建占位骨架。采用 TDD 流程：先写测试，再写实现。

---

## 步骤

### Step 1: 创建策略类型 — `src/proxy/strategy/types.ts`

```typescript
export interface Target {
  backend_model: string;
  provider_id: string;
}

export interface ResolveContext {
  now: Date;
}

export interface MappingStrategy {
  select(rule: unknown, context: ResolveContext): Target | undefined;
}
```

- `Target` 描述一个后端目标（模型 + 服务商）
- `ResolveContext` 注入当前时间，方便测试控制
- `select` 接收原始 rule（JSON 反序列化后的任意结构）和上下文，返回匹配的 Target 或 undefined
- `rule` 用 `unknown` 而非具体类型，因为每种策略的 rule 结构不同

### Step 2: 写 scheduled 策略测试 — `tests/scheduled-strategy.test.ts`

8 个测试用例，覆盖：

| # | 场景 | 输入 | 预期 |
|---|------|------|------|
| 1 | 无窗口 | `default + windows=[]` | default |
| 2 | 匹配窗口 | now 在 start-end 内 | 窗口 target |
| 3 | 不匹配 | now 在所有窗口外 | default |
| 4 | 跨午夜 | start > end，now 在范围内 | 窗口 target |
| 5 | 多窗口匹配 | 两个窗口重叠 | 第一个匹配的 |
| 6 | 无 default 也无匹配 | 无 default 字段 | undefined |
| 7 | windows 为空数组 | `windows: []` | default |
| 8 | rule 非法 | `null / undefined / 非对象` | undefined |

scheduled rule 结构：
```typescript
{ default?: Target, windows?: Array<{ start: "HH:MM", end: "HH:MM", target: Target }> }
```

时间比较规则：
- 正常窗口（start <= end）：`now >= start && now <= end`
- 跨午夜（start > end）：`now >= start || now <= end`

### Step 3: 实现 scheduled 策略 — `src/proxy/strategy/scheduled.ts`

```typescript
import type { MappingStrategy, Target, ResolveContext } from "./types.js";

interface ScheduledRule {
  default?: Target;
  windows?: Array<{ start: string; end: string; target: Target }>;
}

function toHHMM(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false
  });
}

export const scheduledStrategy: MappingStrategy = {
  select(rule: unknown, ctx: ResolveContext): Target | undefined {
    if (!rule || typeof rule !== "object") return undefined;
    const r = rule as ScheduledRule;
    const now = toHHMM(ctx.now);

    for (const w of r.windows ?? []) {
      const match = w.start <= w.end
        ? now >= w.start && now <= w.end
        : now >= w.start || now <= w.end;
      if (match) return w.target;
    }
    return r.default;
  },
};
```

`toLocaleTimeString("en-GB")` 返回 `"HH:MM:SS"` 格式，可直接用字符串前 5 位做比较。跨午夜判断中 start > end 时用 OR 逻辑。

### Step 4: 创建骨架文件

三个文件结构相同，仅导出名和方法名不同：

- `src/proxy/strategy/round-robin.ts` → `roundRobinStrategy`
- `src/proxy/strategy/random.ts` → `randomStrategy`
- `src/proxy/strategy/failover.ts` → `failoverStrategy`

每个骨架 `select()` 内 `throw new Error("Not implemented")`。

### Step 5: 运行测试

```bash
npx vitest run tests/scheduled-strategy.test.ts
```

全部通过后进入 Step 6。

### Step 6: 提交

```bash
git add src/proxy/strategy/ tests/scheduled-strategy.test.ts
git commit -m "feat: add strategy interface and scheduled strategy with tests"
```

---

## 文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `src/proxy/strategy/types.ts` |
| 新建 | `src/proxy/strategy/scheduled.ts` |
| 新建 | `src/proxy/strategy/round-robin.ts` |
| 新建 | `src/proxy/strategy/random.ts` |
| 新建 | `src/proxy/strategy/failover.ts` |
| 新建 | `tests/scheduled-strategy.test.ts` |
