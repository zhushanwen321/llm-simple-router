---
verdict: pass
must_fix: 0
---

# Code Review v1 — 后端数据/UI 配置层（db + admin + config）

**审查范围**：
- `router/src/db/providers.ts`
- `router/src/admin/providers.ts`
- `router/src/admin/quick-setup.ts`
- `router/src/config/model-context.ts`
- `router/src/core/constants.ts`

**关联消费层（仅验证、不在本报告评分范围）**：
`proxy/handler/iteration-setup.ts`、`proxy/transport/transport-fn.ts`、`proxy/transport/http.ts`

**验证执行**：
- `npx tsc --noEmit` → 0 error
- `npx vitest run tests/config/model-timeouts.test.ts tests/stream-timeout.test.ts` → 17/17 passed
- `npx eslint <5 files>` → 0 error 0 warning
- grep `JSON.parse` / `stream_timeout_ms` / `non_stream_timeout_ms` / `getModelStreamTimeout` / `getModelTimeouts` 全量核对

---

## 1. 数据消费者完整性核对（CLAUDE.md 重点项）

新增字段 `non_stream_timeout_ms`，按下表逐点验证。**全部覆盖，无遗漏。**

| # | 消费点 | 文件:行 | 状态 |
|---|--------|---------|------|
| 1 | 类型声明 `ModelEntry` | `config/model-context.ts:18` | ✓ 新增 `non_stream_timeout_ms?: number` |
| 2 | 类型声明 `ModelInfo` | `config/model-context.ts:10` | ✓ 新增 `non_stream_timeout_ms?: number` |
| 3 | DB 读入 `parseModels()` | `config/model-context.ts:269,281` | ✓ obj cast 含字段 + `if (!=null) entry.xxx =` |
| 4 | DB 读出 `buildModelInfoList()` | `config/model-context.ts:304` | ✓ `if (!=null) info.xxx =` |
| 5 | Admin 写入 `extractModelOverrides` | `admin/providers.ts:83,105` | ✓ ModelInput 类型 + 赋值对称 |
| 6 | Admin Schema (Create) | `admin/providers.ts:174,175` | ✓ 两个 Union 分支均含字段 |
| 7 | Admin Schema (Update) | `admin/providers.ts:197,198` | ✓ 两个 Union 分支均含字段 |
| 8 | QuickSetup Schema | `admin/quick-setup.ts:67` | ✓ |
| 9 | QuickSetup `createAll` 映射 | `admin/quick-setup.ts:153` | ✓ `...(m.xxx != null ? {xxx} : {})` |
| 10 | 运行时读取 `getModelTimeouts` | `db/providers.ts:57` | ✓ `resolveTimeout(entry.non_stream_timeout_ms, DEFAULT_NON_STREAM_TIMEOUT_MS)` |
| 11 | 薄包装 `getModelStreamTimeout` | `db/providers.ts:62-66` | ✓ 仍可工作（委托 stream） |
| 12 | 下游 transport 消费 | `iteration-setup.ts:165` → `transport-fn.ts:141` → `http.ts callNonStream` | ✓ `nonStreamTimeoutMs` 贯通到 `req.setTimeout` |

**结论**：CLAUDE.md 「新字段数据消费者检查」清单 12 项全部命中。无 MUST FIX。

---

## 2. 类型安全

- 禁止 `any`：5 个文件 diff 中无 `any`。`parseModels` 内 `item as {...} | null` 是窄化断言（CLAUDE.md 转换层规则 1/2 允许的入口断言模式），字段名受 TS 校验。
- `ModelEntry` / `ModelInfo` 字段类型均为 `number`（可选），与 `stream_timeout_ms` 完全对称。
- `getModelTimeouts` 返回 `{ stream: number; nonStream: number }` 具体类型，非 `any`/`Record`。
- `resolveTimeout(value: number | undefined, fallback: number): number` 签名清晰。

**结论**：无类型问题。

---

## 3. 向后兼容

### 3.1 `getModelStreamTimeout` 薄包装 ✓
保留为 `@deprecated`，委托 `getModelTimeouts(...).stream`。语义与改造前完全一致：
- `0` → `Infinity`
- `undefined/null/未设置` → `DEFAULT_STREAM_TIMEOUT_MS`
- 显式值 → 原值

`stream-timeout.test.ts:82` 新增等价性测试，验证薄包装与 `getModelTimeouts().stream` 一致。

### 3.2 `DEFAULT_STREAM_TIMEOUT_MS` 600000 → 300000 ⚠️ 行为变更（可接受）
默认流式空闲超时从 10 分钟收紧到 5 分钟。这是本分支「transport-timeout-resource-cleanup」的核心修复目的（减少悬挂连接的资源占用），**非回归**。

- `stream-timeout.test.ts:181` 已同步更新断言 `600_000 → 300_000`。
- 影响面：仅影响**未显式配置 `stream_timeout_ms`** 的存量 provider。显式配置的 provider 不受影响。
- 部署提示：若有 provider 依赖旧的 10min 默认（如长思考模型），需在 provider 配置中显式设 `stream_timeout_ms`。建议在 PR description / changelog 中注明。**Info 级，非 bug。**

### 3.3 `non_stream_timeout_ms` 未配置时默认值 ✓
- `undefined` → `resolveTimeout(undefined, 600_000)` → `600_000`（10 分钟）
- `0` → `Infinity`（禁用超时）
- 与 `stream_timeout_ms` 语义对称，符合既有「0=禁用，undefined=默认」约定。

### 3.4 `DEFAULT_GET_TIMEOUT_MS = 30_000`（新增常量）✓
仅用于 `callGet`（admin 探测 `/v1/models`）。注释明确「仅响应头前超时，与流式 idleTimer 无关」。此前 `callGet` 无超时（可永久挂起），现在 30s 兜底，是纯增强。不影响现有 provider 配置。

**结论**：兼容性处理得当，唯一行为变更是有意为之的默认值收紧。

---

## 4. 禁止裸 `JSON.parse(provider.models)` ✓

grep 确认 5 个文件中的 `JSON.parse` 调用均**不涉及 `provider.models`**：

| 位置 | 解析对象 | 合规 |
|------|---------|------|
| `db/providers.ts:84` | `endpointsJson`（endpoints 字段） | ✓ |
| `admin/providers.ts:38,544,574` | `g.rule`（mapping group rule） | ✓ |
| `admin/providers.ts:623` | 上游响应 body | ✓ |
| `admin/quick-setup.ts:194,452` | rule / body | ✓ |
| `config/model-context.ts:198` | model-directory.json（外部文件） | ✓ |
| `config/model-context.ts:261` | **在 `parseModels()` 内部**（ sanctioned 位置） | ✓ |

`provider.models` 的解析统一通过 `parseModels()`，符合 ESLint `taste/no-raw-json-parse-models` 规则。

---

## 5. TypeBox Schema 对称性 ✓

### `admin/providers.ts`（Create + Update）
两个 schema 的 `stream_timeout_ms` 与 `non_stream_timeout_ms` **完全对称**：
```ts
stream_timeout_ms:    Type.Optional(Type.Number({ minimum: 0, maximum: 86_400_000 }))
non_stream_timeout_ms: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400_000 }))
```
两个 Union 分支（`{name,...}` 和 `{id,...}`）均同时包含两字段。Create 与 Update schema 之间也对称。

### `admin/quick-setup.ts`
```ts
stream_timeout_ms:    Type.Optional(Type.Number())
non_stream_timeout_ms: Type.Optional(Type.Number())
```
**内部对称**（两字段均无 min/max 约束）。与 `admin/providers.ts` 的约束强度不一致是**既有模式**（quick-setup 历来不加 min/max），本次新增字段遵循了 quick-setup 的既有约定，非回归。

**结论**：schema 对称性合格。

---

## 6. 镜像点完整性 ✓

`stream_timeout_ms` 出现处与 `non_stream_timeout_ms` 对称情况：

| 镜像点 | stream | non_stream |
|--------|--------|------------|
| `extractModelOverrides` 赋值 | `admin/providers.ts:104` | `admin/providers.ts:105` ✓ |
| `parseModels` obj cast | `model-context.ts:269` | `model-context.ts:269` ✓ |
| `parseModels` entry 赋值 | `model-context.ts:280` | `model-context.ts:281` ✓ |
| `buildModelInfoList` | `model-context.ts:303` | `model-context.ts:304` ✓ |
| Create schema (2 分支) | `:174,175` | `:174,175` ✓ |
| Update schema (2 分支) | `:197,198` | `:197,198` ✓ |
| QuickSetup schema | `:66` | `:67` ✓ |
| QuickSetup createAll | `:152` | `:153` ✓ |
| `getModelTimeouts` | `:56` | `:57` ✓ |

**无遗漏镜像点。**

---

## Warnings（建议改进，非阻塞）

### W1. `iteration-setup.ts:165-166` 重复调用 `getModelTimeouts`
```ts
nonStreamTimeoutMs: getModelTimeouts(provider, resolved.backend_model).nonStream,
streamTimeoutMs: getModelTimeouts(provider, resolved.backend_model).stream,
```
同一 `(provider, backend_model)` 调用两次。`parseModels` 有缓存（O(1)），但 `entries.find()` 仍执行两遍 O(n)。建议解构一次：
```ts
const { stream: streamTimeoutMs, nonStream: nonStreamTimeoutMs } = getModelTimeouts(provider, resolved.backend_model);
```
影响极小，纯代码品味。

### W2. `getModelStreamTimeout` 已无生产调用方
grep 显示除测试外，唯一生产调用方 `iteration-setup.ts` 已迁移到 `getModelTimeouts`。`@deprecated` 薄包装目前仅被 `stream-timeout.test.ts` 用于等价性验证。可考虑后续清理（删除 wrapper + 测试），但保留无害。**Info 级。**

---

## 结论

| 维度 | 结果 |
|------|------|
| 类型安全 | ✓ 通过 |
| 数据消费者完整性（12 点） | ✓ 全覆盖 |
| 向后兼容 | ✓ 有意收紧默认值，测试已同步 |
| 禁止裸 JSON.parse | ✓ 无违规 |
| TypeBox schema 对称性 | ✓ 合格 |
| 镜像点完整性 | ✓ 无遗漏 |
| tsc / eslint / 相关测试 | ✓ 全绿 |

**Verdict: PASS / must_fix: 0**

改动质量高：字段从类型声明 → DB 解析 → Admin 写入 → Schema 校验 → 运行时读取 → Transport 消费的完整链路一次性贯通，对称性严格，注释清晰（`resolveTimeout` 的 `0→Infinity` 语义、`@deprecated` 标注、`DEFAULT_GET_TIMEOUT_MS` 适用范围说明）。
