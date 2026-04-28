/**
 * T26: PluginRegistry + DB declarative rules 集成测试
 *
 * 验证声明式规则写入 DB 后，通过 PluginRegistry 加载并应用到 transform context，
 * 以及 reload 后规则更新生效、代码插件与声明式规则混合执行。
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../src/db/index.js";
import { upsertTransformRule } from "../../src/db/transform-rules.js";
import { PluginRegistry } from "../../src/proxy/transform/plugin-registry.js";
import type { RequestTransformContext, TransformPlugin } from "../../src/proxy/transform/plugin-types.js";

function makeCtx(overrides?: Partial<RequestTransformContext>): RequestTransformContext {
  return {
    body: {},
    sourceApiType: "openai",
    targetApiType: "anthropic",
    provider: { id: "p1", name: "test-provider", base_url: "http://localhost:1234", api_type: "anthropic" },
    ...overrides,
  };
}

function insertProvider(db: Database.Database, id: string, name: string, apiType: string) {
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, apiType, "http://localhost:1234", "key", 1, new Date().toISOString(), new Date().toISOString());
}

describe("Plugin Integration (T26)", () => {
  let db: Database.Database;
  let reg: PluginRegistry;

  beforeEach(() => {
    db = initDatabase(":memory:");
    insertProvider(db, "p1", "test-provider", "anthropic");
    reg = new PluginRegistry();
  });

  describe("declarative rules from DB applied to context", () => {
    it("injects request_defaults for missing fields", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 4096, temperature: 0.5 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx);

      expect(ctx.body.max_tokens).toBe(4096);
      expect(ctx.body.temperature).toBe(0.5);
    });

    it("does not overwrite existing fields with request_defaults", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 4096 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({ body: { messages: [], max_tokens: 1024 } });
      reg.applyAfterRequest(ctx);

      expect(ctx.body.max_tokens).toBe(1024);
    });

    it("drops specified fields", () => {
      upsertTransformRule(db, "p1", {
        drop_fields: ["logprobs", "top_logprobs"],
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({ body: { messages: [], logprobs: true, top_logprobs: 5, model: "gpt-4" } });
      reg.applyAfterRequest(ctx);

      expect(ctx.body.logprobs).toBeUndefined();
      expect(ctx.body.top_logprobs).toBeUndefined();
      expect(ctx.body.model).toBe("gpt-4");
    });

    it("applies field_overrides unconditionally", () => {
      upsertTransformRule(db, "p1", {
        field_overrides: { temperature: 0.7, top_p: 0.9 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({ body: { messages: [], temperature: 1.0 } });
      reg.applyAfterRequest(ctx);

      expect(ctx.body.temperature).toBe(0.7);
      expect(ctx.body.top_p).toBe(0.9);
    });

    it("applies all three rule types in order: defaults -> drop -> overrides", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 4096, stream: true },
        drop_fields: ["logprobs", "user"],
        field_overrides: { temperature: 0.3 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({
        body: { messages: [], logprobs: 5, user: "alice", temperature: 1.0 },
      });
      reg.applyAfterRequest(ctx);

      // defaults: max_tokens and stream injected
      expect(ctx.body.max_tokens).toBe(4096);
      expect(ctx.body.stream).toBe(true);
      // drop: logprobs and user removed
      expect(ctx.body.logprobs).toBeUndefined();
      expect(ctx.body.user).toBeUndefined();
      // overrides: temperature forced
      expect(ctx.body.temperature).toBe(0.3);
    });

    it("skips inactive rules", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 4096 },
        is_active: 0,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx);

      expect(ctx.body.max_tokens).toBeUndefined();
    });

    it("only matches the correct provider", () => {
      insertProvider(db, "p2", "other-provider", "openai");
      upsertTransformRule(db, "p1", {
        field_overrides: { temperature: 0.1 },
        is_active: 1,
      });
      upsertTransformRule(db, "p2", {
        field_overrides: { temperature: 0.9 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      // ctx for p1 should get p1's rule
      const ctx1 = makeCtx({ provider: { id: "p1", name: "test-provider", base_url: "", api_type: "anthropic" } });
      reg.applyAfterRequest(ctx1);
      expect(ctx1.body.temperature).toBe(0.1);

      // ctx for p2 should get p2's rule
      const ctx2 = makeCtx({ provider: { id: "p2", name: "other-provider", base_url: "", api_type: "openai" } });
      reg.applyAfterRequest(ctx2);
      expect(ctx2.body.temperature).toBe(0.9);
    });
  });

  describe("reload updates rules", () => {
    it("replaces old rules after DB update", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 2048 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx1 = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx1);
      expect(ctx1.body.max_tokens).toBe(2048);

      // Update rule in DB
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 8192 },
        is_active: 1,
      });

      // reload with empty plugins dir
      const { rulesCount } = reg.reload(db, "/tmp/nonexistent-plugins-dir-t26");
      expect(rulesCount).toBe(1);

      const ctx2 = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx2);
      expect(ctx2.body.max_tokens).toBe(8192);
    });

    it("picks up newly inserted rule after reload", () => {
      reg.loadFromDB(db);

      const ctx1 = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx1);
      expect(ctx1.body.temperature).toBeUndefined();

      // Insert a new rule
      upsertTransformRule(db, "p1", {
        field_overrides: { temperature: 0.42 },
        is_active: 1,
      });
      reg.reload(db, "/tmp/nonexistent-plugins-dir-t26");

      const ctx2 = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx2);
      expect(ctx2.body.temperature).toBe(0.42);
    });

    it("removes effect of deactivated rule after reload", () => {
      upsertTransformRule(db, "p1", {
        field_overrides: { temperature: 0.5 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      // Deactivate the rule
      upsertTransformRule(db, "p1", { is_active: 0 });
      reg.reload(db, "/tmp/nonexistent-plugins-dir-t26");

      const ctx = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx);
      expect(ctx.body.temperature).toBeUndefined();
    });
  });

  describe("mixed code plugins and declarative rules", () => {
    it("executes code plugin before declarative rule", () => {
      // Register a code plugin first
      const codePlugin: TransformPlugin = {
        name: "code-plugin",
        match: { providerId: "p1" },
        afterRequestTransform(ctx) {
          ctx.body.code_executed = true;
          // Code plugin sets a field that the rule will override
          ctx.body.temperature = 1.0;
        },
      };
      reg.registerPlugin(codePlugin);

      // Then load declarative rule from DB
      upsertTransformRule(db, "p1", {
        field_overrides: { temperature: 0.2 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx);

      // Code plugin ran
      expect(ctx.body.code_executed).toBe(true);
      // Declarative rule overwrote temperature (registered after code plugin)
      expect(ctx.body.temperature).toBe(0.2);
    });

    it("code plugin and rule can cooperate on different fields", () => {
      const codePlugin: TransformPlugin = {
        name: "enrich-plugin",
        match: { providerId: "p1" },
        afterRequestTransform(ctx) {
          ctx.body.enriched = true;
          ctx.body.max_tokens = 9999;
        },
      };
      reg.registerPlugin(codePlugin);

      upsertTransformRule(db, "p1", {
        request_defaults: { stream: true },
        drop_fields: ["logprobs"],
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({ body: { messages: [], logprobs: 3 } });
      reg.applyAfterRequest(ctx);

      expect(ctx.body.enriched).toBe(true);
      expect(ctx.body.max_tokens).toBe(9999);
      expect(ctx.body.stream).toBe(true);
      expect(ctx.body.logprobs).toBeUndefined();
    });
  });
});
