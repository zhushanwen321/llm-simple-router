# Format Transformer — Phase 2–4 实现计划

> **前置条件：** Phase 1 已完成，`src/proxy/transform/` 下存在以下模块：
> - `types.ts` — `ApiType`, `TransformContext`, `TransformCoordinator`
> - `request-transform.ts` — `requestTransform(ctx, body)`
> - `response-transform.ts` — `responseTransform(ctx, bodyStr)`
> - `stream-transform.ts` — `FormatStreamTransform` (Node.js Transform stream)
> - `message-mapper.ts`, `tool-mapper.ts`, `thinking-mapper.ts`, `usage-mapper.ts`
>
> `proxy-handler.ts` 已完成集成：删除 `provider.api_type !== apiType` 硬拒绝，并在关键位置插入 `TransformCoordinator` 调用。

**TDD 规则：** 每个 Task 内先写测试 → 验证失败 → 实现代码 → 验证通过 → `zcommit` 提交
**代码精简：** 每个 step 核心逻辑 ≤30 行，工具函数/重复代码提取到 helpers

---

## Phase 2: 集成测试

> 端到端测试：4 种场景 × 流式/非流式 × 正常/错误路径。
> 文件：`tests/transform/integration.test.ts`

### Task 14: OA→OA 直通集成测试

> **目标：** OpenAI 入口 → OpenAI Provider，验证不受格式转换影响，StreamProxy 管道正常。

**Step 1 — 创建测试文件骨架**

```typescript
// tests/transform/integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { buildApp } from "../../src/index.js";
import { initDatabase } from "../../src/db/index.js";
import { setSetting } from "../../src/db/settings.js";
import { encrypt } from "../../src/utils/crypto.js";
import { hashPassword } from "../../src/utils/password.js";
import { createMockBackend } from "../helpers/mock-backend.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeConfig() {
  return { PORT: 9981, DB_PATH: ":memory:", LOG_LEVEL: "silent" as const, TZ: "Asia/Shanghai", STREAM_TIMEOUT_MS: 5000, RETRY_BASE_DELAY_MS: 0 };
}

async function seedData(db: Database.Database, mockPort: number) {
  const encrypted = encrypt("sk-mock-key", TEST_KEY);
  db.prepare(`INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    "provider-openai", "Mock OpenAI", "openai", `http://localhost:${mockPort}`,
    encrypted, JSON.stringify([{ name: "gpt-4", context_window: 128000 }]), 1
  );
  db.prepare(`INSERT INTO mapping_groups (id, name, strategy, rule)
    VALUES (?, ?, ?, ?)`).run(
    "group-oa", "OA Direct", "round_robin",
    JSON.stringify({ targets: [{ provider_id: "provider-openai", backend_model: "gpt-4", weight: 1 }] })
  );
}
```

- [ ] Step 1: 创建 `tests/transform/` 目录 + `integration.test.ts` 骨架
- [ ] Step 2: 实现 `seedData()` 和 `closeServer()` 工具函数（≤30行）
- [ ] Step 3: 写 OA→OA 非流式直通测试：mock backend 返回 `{choices:[{message:{content:"Hello"}}], usage:...}`
  ```typescript
  it("OA→OA non-stream passthrough", async () => {
    const backend = await createMockBackend((req, res) => {
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id:"cmpl-1", object:"chat.completion", choices:[{index:0,message:{role:"assistant",content:"Hello!"},finish_reason:"stop"}], usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12} }));
      }
    });
    const db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_KEY);
    setSetting(db, "jwt_secret", "test-jwt"); setSetting(db, "admin_password_hash", hashPassword("admin")); setSetting(db, "initialized", "true");
    await seedData(db, backend.port);
    const { app, close } = await buildApp({ config: makeConfig() as any, db });
    const res = await app.inject({ method:"POST", url:"/v1/chat/completions", headers:{"content-type":"application/json",authorization:"Bearer sk-test"},
      payload: { model:"gpt-4", messages:[{role:"user",content:"hi"}], max_tokens:100 } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.choices[0].message.content).toBe("Hello!");
    await close(); await backend.close();
  });
  ```
- [ ] Step 4: 写 OA→OA 流式直通测试：mock backend 返回 SSE chunks，验证客户端收到同样 chunks
  ```typescript
  it("OA→OA streaming passthrough", async () => {
    const chunks = [`data: ${JSON.stringify({id:"cmpl-1",object:"chat.completion.chunk",choices:[{delta:{content:"Hi"}}]})}\n\n`, "data: [DONE]\n\n"];
    const backend = await createMockBackend((req, res) => {
      res.writeHead(200, {"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive"});
      for (const c of chunks) res.write(c);
      res.end();
    });
    const db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_KEY);
    setSetting(db, "jwt_secret", "test-jwt"); setSetting(db, "admin_password_hash", hashPassword("admin")); setSetting(db, "initialized", "true");
    await seedData(db, backend.port);
    const { app, close } = await buildApp({ config: makeConfig() as any, db });
    const res = await app.inject({ method:"POST", url:"/v1/chat/completions", headers:{"content-type":"application/json",authorization:"Bearer sk-test"},
      payload: { model:"gpt-4", messages:[{role:"user",content:"hi"}], stream:true, max_tokens:100 } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"content":"Hi"');  // 验证转换后的内容
    await close(); await backend.close();
  });
  ```
- [ ] Step 5: 运行 `npx vitest run tests/transform/integration.test.ts` — 验证测试通过
- [ ] Step 6: `zcommit` — `feat: add OA→OA passthrough integration tests`

### Task 15: Ant→Ant 直通集成测试

> **目标：** Anthropic 入口 → Anthropic Provider 直通不受影响。

- [ ] Step 1: 添加 `seedDataAnthropic()` 插入 anthropic provider + mapping group
  ```typescript
  async function seedDataAnthropic(db: Database.Database, mockPort: number) {
    const encrypted = encrypt("sk-anthropic-key", TEST_KEY);
    db.prepare(`INSERT INTO providers (id, name, api_type, base_url, api_key, models, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      "provider-ant", "Mock Anthropic", "anthropic", `http://localhost:${mockPort}`,
      encrypted, JSON.stringify([{ name: "claude-3-opus", context_window: 200000 }]), 1
    );
    db.prepare(`INSERT INTO mapping_groups (id, name, strategy, rule)
      VALUES (?, ?, ?, ?)`).run(
      "group-ant", "Ant Direct", "round_robin",
      JSON.stringify({ targets: [{ provider_id: "provider-ant", backend_model: "claude-3-opus", weight: 1 }] })
    );
  }
  ```
- [ ] Step 2: 写 Ant→Ant 非流式测试：mock backend 返回 Anthropic 格式 `{content:[{type:"text",text:"Hello"}], usage:{input_tokens:10,output_tokens:2}}`
- [ ] Step 3: 写 Ant→Ant 流式测试：mock backend 返回 Anthropic SSE（`message_start`, `content_block_delta/text`, `message_delta`, `message_stop`）
  ```typescript
  const antStream = [
    `data: ${JSON.stringify({type:"message_start",message:{id:"msg-1",model:"claude-3-opus",content:[],usage:{input_tokens:5,output_tokens:0}}})}\n\n`,
    `data: ${JSON.stringify({type:"content_block_start",index:0,content_block:{type:"text",text:""}})}\n\n`,
    `data: ${JSON.stringify({type:"content_block_delta",index:0,delta:{type:"text_delta",text:"Hello"}})}\n\n`,
    `data: ${JSON.stringify({type:"content_block_stop",index:0})}\n\n`,
    `data: ${JSON.stringify({type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:2}})}\n\n`,
    `data: ${JSON.stringify({type:"message_stop"})}\n\n`,
  ];
  // 验证：直接 Anthropic SSE 通过，不丢失事件
  ```
- [ ] Step 4: 运行测试通过 + `zcommit`

### Task 16: OA→Ant 非流式集成测试

> **目标：** OpenAI 入口 → Anthropic Provider，验证请求转换 + 响应转换正确。

- [ ] Step 1: 在 `describe("OA→Ant")` 中写第一个测试
  ```typescript
  describe("OA→Ant", () => {
    it("non-stream transforms request and response", async () => {
      const backend = await createMockBackend((req, res) => {
        // 验证接收到的请求体是 Anthropic 格式
        let body = "";
        req.on("data", (c) => body += c);
        req.on("end", () => {
          const parsed = JSON.parse(body);
          expect(parsed.messages[0].content).toEqual([{type:"text",text:"hi"}]); // Ant content array
          expect(parsed.system).toBeDefined(); // 如有 system, 验证提取到顶层
          expect(parsed.stop_sequences).toBeUndefined(); // 字段别名验证
          // 返回 Anthropic 格式响应
          res.writeHead(200, {"Content-Type":"application/json"});
          res.end(JSON.stringify({
            id:"msg-1", type:"message", role:"assistant",
            content:[{type:"text",text:"Hello from Claude!"}],
            stop_reason:"end_turn", stop_sequence:null,
            usage:{input_tokens:10,output_tokens:3}
          }));
        });
      });
      const db = initDatabase(":memory:");
      setSetting(db, "encryption_key", TEST_KEY);
      setSetting(db, "jwt_secret", "test-jwt"); setSetting(db, "admin_password_hash", hashPassword("admin")); setSetting(db, "initialized", "true");
      // 使用 Anthropic provider
      await seedDataAnthropic(db, backend.port);
      const { app, close } = await buildApp({ config: makeConfig() as any, db });
      const res = await app.inject({ method:"POST", url:"/v1/chat/completions",
        headers:{"content-type":"application/json",authorization:"Bearer sk-test"},
        payload: { model:"claude-3-opus", messages:[{role:"user",content:"hi"}], max_tokens:100 }
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      // 验证客户端收到 OpenAI 格式
      expect(body.choices[0].message.content).toBe("Hello from Claude!");
      expect(body.choices[0].finish_reason).toBe("stop"); // end_turn → stop
      expect(body.usage.prompt_tokens).toBe(10); // input_tokens → prompt_tokens
      await close(); await backend.close();
    });
  });
  ```
- [ ] Step 2: 运行测试——预期失败（Phase 1 未实现或未集成）→ 验证失败信息正确
- [ ] Step 3: 确认 Phase 1 的 `TransformCoordinator.request` 和 `responseTransform` 在 Handler 层被正确调用
- [ ] Step 4: 测试通过后 `zcommit`

### Task 17: OA→Ant 流式集成测试

> **目标：** OpenAI 入口，Anthropic Provider 流式，验证 Anthropic SSE 被转换为 OpenAI SSE chunks。

- [ ] Step 1: 写流式测试（最关键的转换路径）
  ```typescript
  it("stream transforms Anthropic SSE to OpenAI SSE chunks", async () => {
    const backend = await createMockBackend((req, res) => {
      // 验证接收到的请求体含 stream:true
      let body = "";
      req.on("data", (c) => body += c);
      req.on("end", () => {
        const parsed = JSON.parse(body);
        expect(parsed.stream).toBe(true);
        res.writeHead(200, {"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive"});
        // Anthropic 流式响应
        const events = [
          {type:"message_start",message:{id:"msg-1",model:"claude-3-opus",role:"assistant",content:[],usage:{input_tokens:5,output_tokens:0}}},
          {type:"content_block_start",index:0,content_block:{type:"text",text:""}},
          {type:"content_block_delta",index:0,delta:{type:"text_delta",text:"Hello"}},
          {type:"content_block_stop",index:0},
          {type:"message_delta",delta:{stop_reason:"end_turn",stop_sequence:null},usage:{output_tokens:3}},
          {type:"message_stop"},
        ];
        for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
        res.end();
      });
    });
    const db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_KEY);
    setSetting(db, "jwt_secret", "test-jwt"); setSetting(db, "admin_password_hash", hashPassword("admin")); setSetting(db, "initialized", "true");
    await seedDataAnthropic(db, backend.port);
    const { app, close } = await buildApp({ config: makeConfig() as any, db });
    const res = await app.inject({ method:"POST", url:"/v1/chat/completions",
      headers:{"content-type":"application/json",authorization:"Bearer sk-test"},
      payload: { model:"claude-3-opus", messages:[{role:"user",content:"hi"}], stream:true, max_tokens:100 }
    });
    expect(res.statusCode).toBe(200);
    // 验证收到 OpenAI SSE chunks（包含 choices[0].delta.content）
    expect(res.body).toContain('"content":"Hello"');
    expect(res.body).toContain("[DONE]");
    // 验证不包含 Anthropic 原生事件名
    expect(res.body).not.toContain("content_block_delta");
    expect(res.body).not.toContain("message_delta");
    await close(); await backend.close();
  });
  ```
- [ ] Step 2: 运行测试 → 确认失败
- [ ] Step 3: 确保 `FormatStreamTransform` 正确注入到 StreamProxy 管道
- [ ] Step 4: 测试通过 + `zcommit`

### Task 18: Ant→OA 非流式集成测试

> **目标：** Anthropic 入口 → OpenAI Provider，验证请求/响应双向转换正确。

- [ ] Step 1: 同文件添加 `describe("Ant→OA")` 块
- [ ] Step 2: 非流式测试：POST `/v1/messages` → mock OpenAI backend
  ```typescript
  it("non-stream Ant→OA", async () => {
    const backend = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (c) => body += c);
      req.on("end", () => {
        const parsed = JSON.parse(body);
        expect(parsed.messages[0].role).toBe("user");
        expect(typeof parsed.messages[0].content).toBe("string"); // OpenAI 格式
        res.writeHead(200, {"Content-Type":"application/json"});
        res.end(JSON.stringify({
          id:"cmpl-1", object:"chat.completion",
          choices:[{index:0,message:{role:"assistant",content:"Hi there!"},finish_reason:"stop"}],
          usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}
        }));
      });
    });
    const db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_KEY);
    setSetting(db, "jwt_secret", "test-jwt"); setSetting(db, "admin_password_hash", hashPassword("admin")); setSetting(db, "initialized", "true");
    // OpenAI provider + Anthropic 入口对应 mapping
    await seedData(db, backend.port);
    const { app, close } = await buildApp({ config: makeConfig() as any, db });
    const res = await app.inject({ method:"POST", url:"/v1/messages",
      headers:{"content-type":"application/json","x-api-key":"sk-test"},
      payload: { model:"gpt-4", messages:[{role:"user",content:[{type:"text",text:"hi"}]}], max_tokens:100 }
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // 客户端收到 Anthropic 格式
    expect(body.content[0].type).toBe("text");
    expect(body.content[0].text).toBe("Hi there!");
    await close(); await backend.close();
  });
  ```
- [ ] Step 3: 流式测试：POST `/v1/messages` with `stream:true`
  ```typescript
  it("stream Ant→OA", async () => {
    const backend = await createMockBackend((req, res) => {
      res.writeHead(200, {"Content-Type":"text/event-stream"});
      const chunks = [
        `data: ${JSON.stringify({id:"cmpl-1",object:"chat.completion.chunk",choices:[{index:0,delta:{role:"assistant",content:""}}]})}\n\n`,
        `data: ${JSON.stringify({id:"cmpl-1",object:"chat.completion.chunk",choices:[{index:0,delta:{content:"Hello"}}]})}\n\n`,
        `data: ${JSON.stringify({id:"cmpl-1",object:"chat.completion.chunk",choices:[{index:0,delta:{}},finish_reason:"stop",usage:{prompt_tokens:10,completion_tokens:2}}])}\n\n`,
        "data: [DONE]\n\n",
      ];
      for (const c of chunks) res.write(c);
      res.end();
    });
    // ... setup + inject
    const res = await app.inject({ method:"POST", url:"/v1/messages", ... });
    expect(res.body).toContain("content_block_delta");
    expect(res.body).toContain('"text":"Hello"');
    expect(res.body).toContain("message_stop");
  });
  ```
- [ ] Step 4: 运行测试通过 + `zcommit`

### Task 19: Ant→OA 流式集成测试

- [ ] Step 1: 补充流式测试（已有 Step 3 中的 Ant→OA stream 测试），重点验证：
  - `choices[0].delta.reasoning_content` → Anthropic `content_block_start/thinking`
  - `choices[0].delta.tool_calls` → Anthropic `content_block_delta/input_json_delta`
- [ ] Step 2: 运行通过 + `zcommit`

### Task 20: 错误场景集成测试

> **目标：** 跨格式时的错误响应转换验证。

- [ ] Step 1: OA→Ant 上游 400 错误转换
  ```typescript
  it("OA→Ant upstream 400 error is converted to OpenAI format", async () => {
    const backend = await createMockBackend((req, res) => {
      res.writeHead(400, {"Content-Type":"application/json"});
      res.end(JSON.stringify({type:"error",error:{type:"invalid_request_error",message:"Bad request"}}));
    });
    // ... setup
    const res = await app.inject({ method:"POST", url:"/v1/chat/completions", payload: { model:"claude-3-opus", ... } });
    expect(res.statusCode).toBe(502); // 或 400（取决于 proxy-handler 的决策）
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("Bad request");
  });
  ```
- [ ] Step 2: OA→Ant 流中途错误（SSE error event）
  ```typescript
  it("OA→Ant stream mid-error", async () => {
    const backend = await createMockBackend((req, res) => {
      res.writeHead(200, {"Content-Type":"text/event-stream"});
      res.write(`data: ${JSON.stringify({type:"message_start",...})}\n\n`);
      res.write(`data: ${JSON.stringify({type:"content_block_start",...})}\n\n`);
      res.write(`data: ${JSON.stringify({type:"error",error:{type:"overloaded_error",message:"Server overloaded"}})}\n\n`);
      res.end();
    });
    const res = await app.inject({ ... });
    // 验证收到包含 error 的 OpenAI chunk + [DONE]
    expect(res.body).toContain("error");
    expect(res.body).toContain("[DONE]");
  });
  ```
- [ ] Step 3: 上游连接失败（server 不启动）
  ```typescript
  it("OA→Ant upstream connection failure", async () => {
    const db = initDatabase(":memory:");
    setSetting(db, "encryption_key", TEST_KEY);
    setSetting(db, "jwt_secret", "test-jwt"); setSetting(db, "admin_password_hash", hashPassword("admin")); setSetting(db, "initialized", "true");
    // 注入指向无法连接的端口
    const encrypted = encrypt("sk-key", TEST_KEY);
    db.prepare(`INSERT INTO providers ...`).run("provider-down","Down","anthropic","http://localhost:1",encrypted,...);
    const { app, close } = await buildApp({ config: makeConfig() as any, db });
    const res = await app.inject({ method:"POST", url:"/v1/chat/completions", payload: { model:"down-model", messages:[{role:"user",content:"hi"}], max_tokens:100 } });
    expect(res.statusCode).toBe(502);
    await close();
  });
  ```
- [ ] Step 4: Ant→OA 错误转换同理
- [ ] Step 5: 全部测试通过 + `zcommit` — `feat: add error scenario integration tests for cross-format proxy`

---

## Phase 3: 插件系统

> 声明式规则（DB）+ 代码插件（文件系统）+ 热重载

### Task 21: DB migration + transform-rules CRUD

> **文件：** `src/db/migrations/033_create_provider_transform_rules.sql`, `src/db/transform-rules.ts`

**Step 1 — 创建 migration**

```sql
-- src/db/migrations/033_create_provider_transform_rules.sql
CREATE TABLE IF NOT EXISTS provider_transform_rules (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  inject_headers TEXT,          -- JSON string of Record<string, string>
  request_defaults TEXT,        -- JSON string of Record<string, unknown>
  drop_fields TEXT,             -- JSON string array of field names
  field_overrides TEXT,         -- JSON string of Record<string, unknown>
  plugin_name TEXT,             -- file plugin name, nullable
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

**Step 2 — 创建 `src/db/transform-rules.ts`**

```typescript
// src/db/transform-rules.ts
import Database from "better-sqlite3";

export interface TransformRules {
  provider_id: string;
  inject_headers: Record<string, string> | null;
  request_defaults: Record<string, unknown> | null;
  drop_fields: string[] | null;
  field_overrides: Record<string, unknown> | null;
  plugin_name: string | null;
  is_active: number;
  created_at?: string;
  updated_at?: string;
}

export function getTransformRule(db: Database, providerId: string): TransformRules | null {
  const row = db.prepare("SELECT * FROM provider_transform_rules WHERE provider_id = ?").get(providerId) as any;
  if (!row) return null;
  return {
    ...row,
    inject_headers: row.inject_headers ? JSON.parse(row.inject_headers) : null,
    request_defaults: row.request_defaults ? JSON.parse(row.request_defaults) : null,
    drop_fields: row.drop_fields ? JSON.parse(row.drop_fields) : null,
    field_overrides: row.field_overrides ? JSON.parse(row.field_overrides) : null,
  };
}

export function upsertTransformRule(db: Database, providerId: string, rules: Partial<TransformRules>): void {
  const existing = db.prepare("SELECT provider_id FROM provider_transform_rules WHERE provider_id = ?").get(providerId);
  if (existing) {
    const fields: string[] = []; const values: unknown[] = [];
    for (const [key, val] of Object.entries(rules)) {
      if (key === "provider_id") continue;
      if (key === "inject_headers" || key === "request_defaults" || key === "field_overrides") {
        fields.push(`${key} = ?`); values.push(val ? JSON.stringify(val) : null);
      } else if (key === "drop_fields") {
        fields.push(`${key} = ?`); values.push(val ? JSON.stringify(val) : null);
      } else {
        fields.push(`${key} = ?`); values.push(val);
      }
    }
    fields.push("updated_at = datetime('now')");
    values.push(providerId);
    db.prepare(`UPDATE provider_transform_rules SET ${fields.join(", ")} WHERE provider_id = ?`).run(...values);
  } else {
    db.prepare(`INSERT INTO provider_transform_rules (provider_id, inject_headers, request_defaults, drop_fields, field_overrides, plugin_name, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      providerId,
      rules.inject_headers ? JSON.stringify(rules.inject_headers) : null,
      rules.request_defaults ? JSON.stringify(rules.request_defaults) : null,
      rules.drop_fields ? JSON.stringify(rules.drop_fields) : null,
      rules.field_overrides ? JSON.stringify(rules.field_overrides) : null,
      rules.plugin_name ?? null,
      rules.is_active ?? 1,
    );
  }
}

export function deleteTransformRule(db: Database, providerId: string): void {
  db.prepare("DELETE FROM provider_transform_rules WHERE provider_id = ?").run(providerId);
}

export function getAllActiveRules(db: Database): TransformRules[] {
  const rows = db.prepare("SELECT * FROM provider_transform_rules WHERE is_active = 1").all() as any[];
  return rows.map(r => ({
    ...r,
    inject_headers: r.inject_headers ? JSON.parse(r.inject_headers) : null,
    request_defaults: r.request_defaults ? JSON.parse(r.request_defaults) : null,
    drop_fields: r.drop_fields ? JSON.parse(r.drop_fields) : null,
    field_overrides: r.field_overrides ? JSON.parse(r.field_overrides) : null,
  }));
}
```

- [ ] Step 1: 创建 migration SQL 文件
- [ ] Step 2: 写 `src/db/transform-rules.ts` CRUD 函数（≤80行）
- [ ] Step 3: 写 CRUD 测试 `tests/db/transform-rules.test.ts`
  ```typescript
  import { describe, it, expect } from "vitest";
  import Database from "better-sqlite3";
  import { initDatabase } from "../../src/db/index.js";
  import { getTransformRule, upsertTransformRule, deleteTransformRule, getAllActiveRules } from "../../src/db/transform-rules.js";

  describe("transform rules CRUD", () => {
    let db: Database.Database;
    beforeEach(() => { db = initDatabase(":memory:"); });
    it("upsert and get", () => {
      upsertTransformRule(db, "p1", { inject_headers: { "x-custom": "v1" }, is_active: 1 });
      const rule = getTransformRule(db, "p1");
      expect(rule).not.toBeNull();
      expect(rule!.inject_headers).toEqual({ "x-custom": "v1" });
    });
    it("update existing rule", () => { /* ... */ });
    it("delete rule", () => { /* ... */ });
    it("getAllActiveRules returns only active", () => { /* ... */ });
  });
  ```
- [ ] Step 4: 测试通过 + `zcommit`

### Task 22: Plugin 接口 + 注册表

> **文件：** `src/proxy/transform/plugin-types.ts`, `src/proxy/transform/plugin-registry.ts`

- [ ] Step 1: 定义 `plugin-types.ts`
  ```typescript
  // src/proxy/transform/plugin-types.ts
  export interface PluginMatch {
    providerId?: string;
    providerName?: string;
    providerNamePattern?: string; // 正则字符串
    apiType?: "openai" | "anthropic";
  }

  export interface RequestTransformContext {
    body: Record<string, unknown>;
    sourceApiType: "openai" | "anthropic";
    targetApiType: "openai" | "anthropic";
    provider: { id: string; name: string; base_url: string; api_type: string };
  }

  export interface ResponseTransformContext {
    response: Record<string, unknown>;
    sourceApiType: "openai" | "anthropic";
    targetApiType: "openai" | "anthropic";
    provider: { id: string; name: string; base_url: string; api_type: string };
  }

  export interface TransformPlugin {
    name: string;
    version?: string;
    match: PluginMatch;
    beforeRequestTransform?(ctx: RequestTransformContext): void;
    afterRequestTransform?(ctx: RequestTransformContext): void;
    beforeResponseTransform?(ctx: ResponseTransformContext): void;
    afterResponseTransform?(ctx: ResponseTransformContext): void;
  }

  export function pluginMatches(plugin: TransformPlugin, provider: { id: string; name: string; api_type: string }): boolean {
    if (plugin.match.providerId && plugin.match.providerId !== provider.id) return false;
    if (plugin.match.providerName && plugin.match.providerName !== provider.name) return false;
    if (plugin.match.providerNamePattern && !new RegExp(plugin.match.providerNamePattern).test(provider.name)) return false;
    if (plugin.match.apiType && plugin.match.apiType !== provider.api_type) return false;
    return true;
  }
  ```
- [ ] Step 2: 定义 `plugin-registry.ts`
  ```typescript
  // src/proxy/transform/plugin-registry.ts
  import Database from "better-sqlite3";
  import { readdirSync } from "fs";
  import { join, extname } from "path";
  import type { TransformPlugin, RequestTransformContext, ResponseTransformContext } from "./plugin-types.js";
  import { getAllActiveRules, type TransformRules } from "../../db/transform-rules.js";

  export class PluginRegistry {
    private plugins: TransformPlugin[] = [];
    private rulesCache: Map<string, TransformRules> = new Map();

    loadFromDB(db: Database): void {
      const rules = getAllActiveRules(db);
      this.rulesCache.clear();
      for (const rule of rules) {
        this.rulesCache.set(rule.provider_id, rule);
      }
      // 将声明式规则转换为内置插件（见 Task 23 的 ruleToPlugin 集成后合并调用）
    }

    scanPluginsDir(dir: string): string[] {
      const loaded: string[] = [];
      if (!existsSync(dir)) return loaded;
      const files = readdirSync(dir).filter(f => extname(f) === ".js" || extname(f) === ".mjs");
      for (const file of files) {
        try {
          const mod = require(join(dir, file));  // 热重载需要先清除缓存
          if (mod.default && typeof mod.default.name === "string") {
            this.plugins.push(mod.default);
            loaded.push(mod.default.name);
          }
        } catch (err) {
          console.warn(`[PluginRegistry] Failed to load ${file}:`, err);
        }
      }
      return loaded;
    }

    getMatchingPlugins(provider: { id: string; name: string; api_type: string }): TransformPlugin[] {
      return this.plugins.filter(p => pluginMatches(p, provider));
    }

    applyBeforeRequest(ctx: RequestTransformContext): void {
      const plugins = this.getMatchingPlugins(ctx.provider);
      for (const p of plugins) p.beforeRequestTransform?.(ctx);
    }
    applyAfterRequest(ctx: RequestTransformContext): void {
      const plugins = this.getMatchingPlugins(ctx.provider);
      for (const p of plugins) p.afterRequestTransform?.(ctx);
    }
    applyBeforeResponse(ctx: ResponseTransformContext): void {
      const plugins = this.getMatchingPlugins(ctx.provider);
      for (const p of plugins) p.beforeResponseTransform?.(ctx);
    }
    applyAfterResponse(ctx: ResponseTransformContext): void {
      const plugins = this.getMatchingPlugins(ctx.provider);
      for (const p of plugins) p.afterResponseTransform?.(ctx);
    }

    applyDeclarativeRules(ctx: RequestTransformContext | ResponseTransformContext): void {
      const rule = this.rulesCache.get(ctx.provider.id);
      if (!rule) return;
      // 声明式规则只在 afterRequestTransform / afterResponseTransform 阶段执行
    }

    reload(db: Database, pluginsDir: string): string[] {
      this.plugins = []; // 清除现有插件
      this.loadFromDB(db);
      return this.scanPluginsDir(pluginsDir);
    }
  }
  ```
- [ ] Step 3: 写 `tests/transform/plugin-types.test.ts` — 测试 `pluginMatches()` 纯函数（无数据库依赖）
  ```typescript
  it("matches by providerId", () => {
    const plugin: TransformPlugin = { name:"test", match:{providerId:"p1"}, afterRequestTransform(ctx) { ctx.body.test = true; } };
    expect(pluginMatches(plugin, {id:"p1",name:"x",api_type:"openai"})).toBe(true);
    expect(pluginMatches(plugin, {id:"p2",name:"x",api_type:"openai"})).toBe(false);
  });
  it("matches by name pattern", () => {
    const plugin: TransformPlugin = { name:"bedrock", match:{providerNamePattern:"^bedrock"}, afterRequestTransform(ctx) { ctx.body.extra = "value"; } };
    expect(pluginMatches(plugin, {id:"b1",name:"bedrock-claude",api_type:"anthropic"})).toBe(true);
  });
  ```
- [ ] Step 4: 写 `tests/transform/plugin-registry.test.ts` — 测试 `PluginRegistry`
  ```typescript
  it("applies matching plugin hooks", () => {
    const reg = new PluginRegistry();
    reg.registerPlugin({
      name:"test", match:{providerId:"p1"},
      afterRequestTransform(ctx) { ctx.body.transformed = true; }
    });
    const ctx: RequestTransformContext = { body:{}, sourceApiType:"openai", targetApiType:"anthropic", provider:{id:"p1",name:"x",base_url:"",api_type:"anthropic"} };
    reg.applyAfterRequest(ctx);
    expect(ctx.body.transformed).toBe(true);
  });
  ```
- [ ] Step 5: 测试通过 + `zcommit`

### Task 23: 声明式规则 → Plugin 转换

> 将 DB 中的 `provider_transform_rules` 行自动转换为 `TransformPlugin` 实例。

- [ ] Step 1: 在 `plugin-registry.ts` 中添加 `ruleToPlugin()` 方法
  ```typescript
  private ruleToPlugin(rule: TransformRules): TransformPlugin {
    return {
      name: `declarative:${rule.provider_id}`,
      match: { providerId: rule.provider_id },
      afterRequestTransform(ctx: RequestTransformContext): void {
        // request_defaults: 注入缺失字段
        if (rule.request_defaults) {
          for (const [key, val] of Object.entries(rule.request_defaults)) {
            if (ctx.body[key] === undefined) ctx.body[key] = val;
          }
        }
        // drop_fields: 删除字段
        if (rule.drop_fields) {
          for (const field of rule.drop_fields) {
            delete ctx.body[field];
          }
        }
        // field_overrides: 覆盖特定映射
        if (rule.field_overrides) {
          for (const [key, val] of Object.entries(rule.field_overrides)) {
            ctx.body[key] = val;
          }
        }
      },
      afterResponseTransform(ctx: ResponseTransformContext): void {
        // inject_headers 只用在请求阶段，不在 response 中处理
        // field_overrides 也应用于 response
        if (rule.field_overrides) {
          for (const [key, val] of Object.entries(rule.field_overrides)) {
            ctx.response[key] = val;
          }
        }
      },
    };
  }
  ```
- [ ] Step 2: 在 `loadFromDB()` 中调用 `ruleToPlugin()` 将规则注册为插件
- [ ] Step 3: 测试
  ```typescript
  it("declarative rule injects request_defaults", () => {
    const reg = new PluginRegistry();
    // 模拟 DB 规则（绕过 loadFromDB，直接测试 ruleToPlugin）
    const rule: TransformRules = { provider_id:"p1", inject_headers:null, request_defaults:{max_tokens:4096}, drop_fields:["logprobs"], field_overrides:null, plugin_name:null, is_active:1 };
    const plugin = reg["ruleToPlugin"](rule);
    const ctx: RequestTransformContext = { body:{messages:[{role:"user",content:"hi"}]}, sourceApiType:"openai", targetApiType:"anthropic", provider:{id:"p1",name:"x",base_url:"",api_type:"anthropic"} };
    plugin.afterRequestTransform!(ctx);
    expect(ctx.body.max_tokens).toBe(4096);
    expect(ctx.body.logprobs).toBeUndefined();
  });
  ```
- [ ] Step 4: 测试通过 + `zcommit`

### Task 24: 文件插件扫描

> 扫描 `plugins/transform/` 目录，动态 import JS 文件。

- [ ] Step 1: 完善 `PluginRegistry.scanPluginsDir()` — 支持热重载（清除 require.cache）
  ```typescript
  scanPluginsDir(dir: string): string[] {
    const resolvedDir = resolve(dir);
    const loaded: string[] = [];
    if (!existsSync(resolvedDir)) { mkdirSync(resolvedDir, { recursive: true }); return loaded; }
    const files = readdirSync(resolvedDir).filter(f => f.endsWith(".js") || f.endsWith(".mjs"));
    for (const file of files) {
      const filePath = join(resolvedDir, file);
      // 热重载：清除缓存
      delete require.cache[require.resolve(filePath)];
      try {
        const mod = require(filePath);
        const plugin: TransformPlugin = mod.default || mod;
        if (!plugin.name) { console.warn(`[PluginRegistry] ${file} missing name`); continue; }
        this.plugins.push(plugin);
        loaded.push(`${plugin.name} (${file})`);
      } catch (err) {
        console.warn(`[PluginRegistry] Failed to load ${file}:`, (err as Error).message);
      }
    }
    return loaded;
  }
  ```
- [ ] Step 2: 创建示例插件 `plugins/transform/example-plugin.js`（仅用于测试）
  ```javascript
  // plugins/transform/example-plugin.js
  module.exports = {
    name: "example",
    match: { providerNamePattern: ".*" },
    afterRequestTransform(ctx) {
      ctx.body.x_custom_header = "plugin-injected";
    },
  };
  ```
- [ ] Step 3: 测试文件插件加载
  ```typescript
  it("loads file plugin from directory", () => {
    const reg = new PluginRegistry();
    const dir = join(__dirname, "../../plugins/transform");
    const loaded = reg.scanPluginsDir(dir);
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.some(n => n.includes("example"))).toBe(true);
    const ctx: RequestTransformContext = { body:{}, sourceApiType:"openai", targetApiType:"anthropic", provider:{id:"p1",name:"test",base_url:"",api_type:"openai"} };
    reg.applyAfterRequest(ctx);
    expect(ctx.body.x_custom_header).toBe("plugin-injected");
  });
  ```
- [ ] Step 4: 测试通过 + `zcommit`

### Task 25: 热重载 + 缓存刷新

> `POST /admin/api/transform-rules/reload` 端点逻辑 + 测试

- [ ] Step 1: 在 `PluginRegistry` 中实现完整的 `reload()` 方法
  ```typescript
  reload(db: Database, pluginsDir: string): { loadedPlugins: string[]; rulesCount: number } {
    this.plugins = [];
    this.rulesCache.clear();
    this.loadFromDB(db);
    const loadedPlugins = this.scanPluginsDir(pluginsDir);
    // 将声明式规则再注册为插件
    for (const [providerId, rule] of this.rulesCache) {
      if (rule.is_active) {
        this.plugins.push(this.ruleToPlugin(rule));
      }
    }
    return { loadedPlugins, rulesCount: this.rulesCache.size };
  }
  ```
- [ ] Step 2: 编写热重载测试
  ```typescript
  it("reload refreshes rules", () => {
    const db = initDatabase(":memory:");
    upsertTransformRule(db, "p1", { inject_headers: { "x-version": "1" }, is_active: 1 });
    const reg = new PluginRegistry();
    const result1 = reg.reload(db, "/tmp/no-plugins");
    expect(result1.rulesCount).toBe(1);
    // 更新规则
    upsertTransformRule(db, "p1", { drop_fields: ["logprobs"], is_active: 1 });
    const result2 = reg.reload(db, "/tmp/no-plugins");
    expect(result2.rulesCount).toBe(1);
    // 验证旧规则被替换
    const ctx: RequestTransformContext = { body:{logprobs:5}, sourceApiType:"openai", targetApiType:"anthropic", provider:{id:"p1",name:"x",base_url:"",api_type:"anthropic"} };
    reg.applyAfterRequest(ctx);
    expect(ctx.body.x_version).toBeUndefined(); // 旧的 inject_headers 不应存在
    expect(ctx.body.logprobs).toBeUndefined(); // 新 drop_fields 生效
  });
  ```
- [ ] Step 3: 测试通过 + `zcommit`

### Task 26: 插件系统集成测试

> 完整链路：声明式规则生效 + 文件插件加载 + 热重载验证

- [ ] Step 1: 创建 `tests/transform/plugin-integration.test.ts`，测试声明式规则对代理请求的影响
  ```typescript
  describe("Plugin Integration", () => {
    it("declarative rule injects header on proxy request", async () => {
      const backend = await createMockBackend((req, res) => {
        let body = "";
        req.on("data", (c) => body += c);
        req.on("end", () => {
          const parsed = JSON.parse(body);
          expect(parsed.max_tokens).toBe(2048); // request_defaults 注入
          expect(parsed.logprobs).toBeUndefined(); // drop_fields 移除
          res.writeHead(200, {"Content-Type":"application/json"});
          res.end(JSON.stringify({...}));
        });
      });
      const db = initDatabase(":memory:");
      setSetting(db, "encryption_key", TEST_KEY);
      setSetting(db, "jwt_secret", "test-jwt"); setSetting(db, "admin_password_hash", hashPassword("admin")); setSetting(db, "initialized", "true");
      await seedDataAnthropic(db, backend.port);
      // 添加转换规则
      upsertTransformRule(db, "provider-ant", { request_defaults: { max_tokens: 2048 }, drop_fields: ["logprobs"], is_active: 1 });
      const { app, close } = await buildApp({ config: makeConfig() as any, db });
      const res = await app.inject({ method:"POST", url:"/v1/chat/completions", headers:{"content-type":"application/json",authorization:"Bearer sk-test"},
        payload: { model:"claude-3-opus", messages:[{role:"user",content:"hi"}], logprobs:5, max_tokens:100 }
      });
      expect(res.statusCode).toBe(200);
      await close(); await backend.close();
    });
  });
  ```
- [ ] Step 2: 测试文件插件加载 + 热重载后代理路径生效
- [ ] Step 3: 全部测试通过 + `zcommit`

---

## Phase 4: Admin API + UI

> CRUD 端点 → Provider 编辑页折叠面板 → 重载按钮

### Task 27: Admin API 端点

> **文件：** `src/admin/transform-rules.ts`

- [ ] Step 1: 创建 `src/admin/transform-rules.ts`
  ```typescript
  import { FastifyPluginCallback } from "fastify";
  import Database from "better-sqlite3";
  import { getTransformRule, upsertTransformRule, deleteTransformRule } from "../db/transform-rules.js";
  import { PluginRegistry } from "../proxy/transform/plugin-registry.js";

  interface TransformRuleOptions {
    db: Database.Database;
    pluginRegistry?: PluginRegistry;
    pluginsDir?: string;
  }

  export const adminTransformRuleRoutes: FastifyPluginCallback<TransformRuleOptions> = (app, options, done) => {
    const { db, pluginRegistry, pluginsDir } = options;

    app.get("/transform-rules/:providerId", async (req, reply) => {
      const { providerId } = req.params as { providerId: string };
      const rule = getTransformRule(db, providerId);
      return { code: 0, data: rule };
    });

    app.put<{ Params: { providerId: string }; Body: any }>("/transform-rules/:providerId", async (req, reply) => {
      const { providerId } = req.params;
      const upsertTransformRule(db, providerId, req.body);
      return { code: 0, data: { success: true } };
    });

    app.delete("/transform-rules/:providerId", async (req, reply) => {
      const { providerId } = req.params as { providerId: string };
      deleteTransformRule(db, providerId);
      return { code: 0, data: { success: true } };
    });

    app.post("/transform-rules/reload", async (req, reply) => {
      if (!pluginRegistry) return reply.status(500).send({ code: 50001, message: "PluginRegistry not available" });
      const result = pluginRegistry.reload(db, pluginsDir || join(process.cwd(), "plugins/transform"));
      return { code: 0, data: result };
    });

    done();
  };
  ```
- [ ] Step 2: 在 `src/admin/routes.ts` 中注册新路由
  ```typescript
  import { adminTransformRuleRoutes } from "./transform-rules.js";
  import { PluginRegistry } from "../proxy/transform/plugin-registry.js";

  // 在 adminRoutes 函数参数中增加 pluginRegistry?, pluginsDir?
  export const adminRoutes: FastifyPluginCallback<AdminRoutesOptions> = (app, options, done) => {
    // ... 现有路由 ...
    app.register(adminTransformRuleRoutes, {
      db: options.db,
      pluginRegistry: options.pluginRegistry,
      pluginsDir: options.pluginsDir
    });
    done();
  };
  ```
- [ ] Step 3: 实现测试（Task 28 前完成路由注册）

### Task 28: Admin API 测试

> **文件：** `tests/admin/transform-rules.test.ts`

- [ ] Step 1: 写 CRUD 测试
  ```typescript
  describe("Transform Rules Admin API", () => {
    let app: FastifyInstance;
    let db: ReturnType<typeof initDatabase>;
    let close: () => Promise<void>;
    let cookie: string;

    beforeEach(async () => {
      db = initDatabase(":memory:");
      seedSettings(db);
      const result = await buildApp({ config: makeConfig() as any, db });
      app = result.app; close = result.close;
      cookie = await login(app);
    });
    afterEach(async () => { await close(); });

    it("GET returns null for non-existent rule", async () => {
      const res = await app.inject({ method:"GET", url:"/admin/api/transform-rules/nonexistent", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeNull();
    });

    it("PUT creates new rule", async () => {
      const res = await app.inject({ method:"PUT", url:"/admin/api/transform-rules/p1", headers:{cookie},
        payload: { inject_headers: { "x-custom":"v1" }, drop_fields: ["logprobs"], is_active: 1 }
      });
      expect(res.statusCode).toBe(200);
      // GET 验证
      const getRes = await app.inject({ method:"GET", url:"/admin/api/transform-rules/p1", headers:{cookie} });
      expect(getRes.json().data.inject_headers).toEqual({ "x-custom":"v1" });
    });

    it("DELETE removes rule", async () => {
      await app.inject({ method:"PUT", url:"/admin/api/transform-rules/p1", headers:{cookie}, payload: { inject_headers: { "x":"v" }, is_active:1 } });
      await app.inject({ method:"DELETE", url:"/admin/api/transform-rules/p1", headers:{cookie} });
      const getRes = await app.inject({ method:"GET", url:"/admin/api/transform-rules/p1", headers:{cookie} });
      expect(getRes.json().data).toBeNull();
    });

    it("reload returns plugin info", async () => {
      const res = await app.inject({ method:"POST", url:"/admin/api/transform-rules/reload", headers:{cookie} });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data).toHaveProperty("loadedPlugins");
      expect(data).toHaveProperty("rulesCount");
    });

    it("unauthenticated request returns 401", async () => {
      const res = await app.inject({ method:"GET", url:"/admin/api/transform-rules/p1" });
      expect(res.statusCode).toBe(401);
    });
  });
  ```
- [ ] Step 2: 运行测试通过 + `zcommit`

### Task 29: 前端 API client 方法

> **文件：** `frontend/src/api/client.ts` 追加

- [ ] Step 1: 添加类型和方法
  ```typescript
  // 类型定义
  export interface TransformRules {
    provider_id: string;
    inject_headers: Record<string, string> | null;
    request_defaults: Record<string, unknown> | null;
    drop_fields: string[] | null;
    field_overrides: Record<string, unknown> | null;
    plugin_name: string | null;
    is_active: number;
  }

  export interface ReloadResult {
    loadedPlugins: string[];
    rulesCount: number;
  }

  // API 方法——悬挂在 api 对象上
  export const getTransformRules = (providerId: string): Promise<TransformRules> =>
    request(client.get(`/transform-rules/${providerId}`));

  export const upsertTransformRules = (providerId: string, rules: Partial<TransformRules>): Promise<void> =>
    request(client.put(`/transform-rules/${providerId}`, rules));

  export const deleteTransformRules = (providerId: string): Promise<void> =>
    request(client.delete(`/transform-rules/${providerId}`));

  export const reloadTransformRules = (): Promise<ReloadResult> =>
    request(client.post("/transform-rules/reload"));
  ```
- [ ] Step 2: 确保 `api` 对象暴露这些方法（挂到 export 列表）

### Task 30: Provider 页面转换规则面板

> **文件：** `frontend/src/views/Providers.vue`

- [ ] Step 1: 在编辑弹窗 `DialogContent` 内、`DialogFooter` 前插入折叠面板
  ```vue
  <!-- 转换规则面板（仅在编辑现有 Provider 时显示） -->
  <Collapsible v-if="editingId" v-model:open="transformOpen" class="border rounded-md p-3">
    <CollapsibleTrigger class="flex items-center justify-between w-full text-sm font-medium">
      转换规则
      <ChevronDown class="w-4 h-4 transition-transform" :class="transformOpen ? 'rotate-180' : ''" />
    </CollapsibleTrigger>
    <CollapsibleContent class="mt-3 space-y-3">
      <!-- 注入 Headers -->
      <div>
        <Label class="text-xs text-muted-foreground">注入 Headers</Label>
        <div v-for="(val, key, i) in transformForm.inject_headers" :key="i" class="flex gap-1 mt-1">
          <Input v-model="transformForm.inject_headers[key]" placeholder="value" class="flex-1" />
          <Button type="button" variant="ghost" size="sm" @click="delete transformForm.inject_headers[key]">✕</Button>
        </div>
        <Button type="button" variant="outline" size="sm" class="mt-1" @click="addHeader">+ 添加 Header</Button>
      </div>
      <!-- 丢弃字段 -->
      <div>
        <Label class="text-xs text-muted-foreground">丢弃字段（逗号分隔）</Label>
        <Input v-model="transformForm.dropFieldsInput" placeholder="logprobs, frequency_penalty" />
      </div>
      <!-- 关联插件 -->
      <div>
        <Label class="text-xs text-muted-foreground">关联插件</Label>
        <Select v-model="transformForm.plugin_name">
          <SelectTrigger><SelectValue placeholder="无" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">无</SelectItem>
            <SelectItem v-for="pn in availablePlugins" :key="pn" :value="pn">{{ pn }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <!-- 操作按钮 -->
      <div class="flex gap-2">
        <Button type="button" variant="outline" size="sm" @click="saveTransformRules">保存规则</Button>
        <Button type="button" variant="ghost" size="sm" @click="deleteTransformRules(editingId); transformForm.reset(); toast.success('规则已删除')">删除规则</Button>
      </div>
    </CollapsibleContent>
  </Collapsible>
  ```
- [ ] Step 2: 在 `<script setup>` 中添加响应式数据和逻辑
  ```typescript
  import { ref, watch } from 'vue'
  import { ChevronDown } from 'lucide-vue-next'
  import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'

  const transformOpen = ref(false)
  const transformForm = ref({
    inject_headers: {} as Record<string, string>,
    dropFieldsInput: '',
    plugin_name: '',
  })
  const availablePlugins = ref<string[]>([])

  // 打开编辑时加载规则
  watch(editingId, async (id) => {
    if (!id) { transformForm.resetDefault(); return }
    try {
      const rules = await getTransformRules(id)
      if (rules) {
        transformForm.value.inject_headers = rules.inject_headers || {}
        transformForm.value.dropFieldsInput = (rules.drop_fields || []).join(', ')
        transformForm.value.plugin_name = rules.plugin_name || ''
      }
    } catch {}
  })

  async function saveTransformRules() {
    try {
      await upsertTransformRules(editingId.value!, {
        inject_headers: Object.keys(transformForm.value.inject_headers).length > 0 ? transformForm.value.inject_headers : null,
        drop_fields: transformForm.value.dropFieldsInput ? transformForm.value.dropFieldsInput.split(',').map(s => s.trim()) : null,
        plugin_name: transformForm.value.plugin_name || null,
      })
      toast.success('转换规则已保存')
    } catch (e) {
      toast.error(getApiMessage(e, '保存失败'))
    }
  }

  function addHeader() {
    const key = prompt('Header 名称:')
    if (key) transformForm.value.inject_headers[key] = ''
  }
  ```
- [ ] Step 3: 添加缺少的 shadcn-vue 组件引用
  ```typescript
  import { ChevronDown } from 'lucide-vue-next'
  import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
  ```
- [ ] Step 4: 如果需要安装 Collapsible 组件：
  ```bash
  cd frontend && npx shadcn-vue@latest add collapsible
  ```

### Task 31: 重载按钮

> 在 Provider 页或 Monitor 页添加「重载全部插件」按钮

- [ ] Step 1: 在 Provider 页面标题栏（Button 旁）添加重载按钮
  ```vue
  <template>
    <div class="p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-foreground">供应商</h2>
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" @click="handleReload" :disabled="reloading" class="flex items-center gap-1">
            <RotateCw class="w-4 h-4" :class="{ 'animate-spin': reloading }" />
            重载插件
          </Button>
          <Button @click="openCreate" class="flex items-center gap-1">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            添加供应商
          </Button>
        </div>
      </div>
      <!-- ... 表格 ... -->
    </div>
  </template>

  <script setup lang="ts">
  import { RotateCw } from 'lucide-vue-next'
  const reloading = ref(false)

  async function handleReload() {
    reloading.value = true
    try {
      const result = await reloadTransformRules()
      toast.success(`插件重载完成：${result.loadedPlugins.length} 个插件，${result.rulesCount} 条规则`)
    } catch (e) {
      toast.error(getApiMessage(e, '重载失败'))
    } finally {
      reloading.value = false
    }
  }
  </script>
  ```
- [ ] Step 2: 手动视觉验证——确认旋转动画、toast 消息正常
- [ ] Step 3: `zcommit`

---

## 验证清单

### Phase 2 完成验证
- [ ] `npx vitest run tests/transform/integration.test.ts` — 全部集成测试通过
- [ ] OA→OA 直通（非流式 + 流式）→ 响应不变
- [ ] Ant→Ant 直通（非流式 + 流式）→ 响应不变
- [ ] OA→Ant 转换（非流式 + 流式）→ 客户端收到 OpenAI 格式
- [ ] Ant→OA 转换（非流式 + 流式）→ 客户端收到 Anthropic 格式
- [ ] 错误场景：400/500 错误、流中途错误、连接失败 → 格式正确转换

### Phase 3 完成验证
- [ ] `npx vitest run tests/db/transform-rules.test.ts` — CRUD 测试通过
- [ ] `npx vitest run tests/transform/plugin-types.test.ts` — pluginMatches 测试通过
- [ ] `npx vitest run tests/transform/plugin-registry.test.ts` — 插件注册表测试通过
- [ ] `npx vitest run tests/transform/plugin-integration.test.ts` — 声明式规则 + 文件插件集成测试通过

### Phase 4 完成验证
- [ ] `npx vitest run tests/admin/transform-rules.test.ts` — Admin API 测试通过
- [ ] Provider 编辑弹窗显示「转换规则」折叠面板 ✓
- [ ] 保存/删除规则正确调用 API ✓
- [ ] 重载按钮正确调用 API 并显示 toast ✓
- [ ] `npm run lint` 零警告
- [ ] 全部测试通过 `npx vitest run`
