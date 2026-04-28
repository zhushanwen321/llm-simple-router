import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../src/db/index.js";
import { upsertTransformRule } from "../../src/db/transform-rules.js";
import { PluginRegistry } from "../../src/proxy/transform/plugin-registry.js";
import type { RequestTransformContext, ResponseTransformContext, TransformPlugin } from "../../src/proxy/transform/plugin-types.js";

function makeCtx(overrides?: Partial<RequestTransformContext>): RequestTransformContext {
  return {
    body: {},
    sourceApiType: "openai",
    targetApiType: "anthropic",
    provider: { id: "p1", name: "test-provider", base_url: "", api_type: "anthropic" },
    ...overrides,
  };
}

function insertProvider(db: Database.Database, id: string, name: string, apiType: string): void {
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, apiType, "http://localhost:1234", "key", 1, new Date().toISOString(), new Date().toISOString());
}

describe("Plugin Integration: declarative rules + PluginRegistry", () => {
  let db: Database.Database;
  let reg: PluginRegistry;

  beforeEach(() => {
    db = initDatabase(":memory:");
    insertProvider(db, "p1", "test-provider", "anthropic");
    reg = new PluginRegistry();
  });

  describe("T26-1: request_defaults + drop_fields + field_overrides combo", () => {
    it("injects defaults for missing fields, drops specified fields, overrides values", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 4096, temperature: 0.5 },
        drop_fields: ["logprobs", "top_logprobs"],
        field_overrides: { stream: true },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({
        body: { messages: [{ role: "user", content: "hi" }], logprobs: true, top_logprobs: 5, temperature: 0.9 },
      });
      reg.applyAfterRequest(ctx);

      // request_defaults: temperature already present -> not overwritten; max_tokens missing -> injected
      expect(ctx.body.temperature).toBe(0.9);
      expect(ctx.body.max_tokens).toBe(4096);
      // drop_fields: both removed
      expect(ctx.body.logprobs).toBeUndefined();
      expect(ctx.body.top_logprobs).toBeUndefined();
      // field_overrides: stream forced to true
      expect(ctx.body.stream).toBe(true);
      // original content preserved
      expect((ctx.body.messages as unknown[]).length).toBe(1);
    });

    it("only applies rules matching the provider", () => {
      insertProvider(db, "p2", "other-provider", "openai");
      upsertTransformRule(db, "p1", { field_overrides: { model: "claude-3" }, is_active: 1 });
      upsertTransformRule(db, "p2", { field_overrides: { model: "gpt-4" }, is_active: 1 });
      reg.loadFromDB(db);

      const ctx = makeCtx();
      reg.applyAfterRequest(ctx);
      expect(ctx.body.model).toBe("claude-3");
    });

    it("skips inactive rules", () => {
      upsertTransformRule(db, "p1", { field_overrides: { model: "claude-3" }, is_active: 0 });
      reg.loadFromDB(db);

      const ctx = makeCtx();
      reg.applyAfterRequest(ctx);
      expect(ctx.body.model).toBeUndefined();
    });
  });

  describe("T26-2: reload picks up rule changes", () => {
    it("replaces old rules with updated ones after reload", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 2048 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx1 = makeCtx();
      reg.applyAfterRequest(ctx1);
      expect(ctx1.body.max_tokens).toBe(2048);

      // Update rule in DB
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 8192 },
        field_overrides: { temperature: 0.3 },
        is_active: 1,
      });
      reg.reload(db, "/tmp/nonexistent-plugins-dir");

      const ctx2 = makeCtx();
      reg.applyAfterRequest(ctx2);
      expect(ctx2.body.max_tokens).toBe(8192);
      expect(ctx2.body.temperature).toBe(0.3);
    });

    it("removes rules after DB deletion + reload", () => {
      upsertTransformRule(db, "p1", { drop_fields: ["stream"], is_active: 1 });
      reg.loadFromDB(db);

      db.prepare("DELETE FROM provider_transform_rules WHERE provider_id = ?").run("p1");
      reg.reload(db, "/tmp/nonexistent-plugins-dir");

      const ctx = makeCtx({ body: { stream: true } });
      reg.applyAfterRequest(ctx);
      // field should remain since rule was deleted
      expect(ctx.body.stream).toBe(true);
    });
  });

  describe("T26-3: code plugin + declarative rule execution order", () => {
    it("code plugin runs before declarative rule when registered first", () => {
      const codePlugin: TransformPlugin = {
        name: "code-plugin",
        match: { providerId: "p1" },
        afterRequestTransform(ctx) {
          // Set a field that the declarative rule will override
          ctx.body.temperature = 1.0;
          ctx.body.marker = "code-was-here";
        },
      };
      reg.registerPlugin(codePlugin);

      upsertTransformRule(db, "p1", {
        field_overrides: { temperature: 0.5 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx();
      reg.applyAfterRequest(ctx);

      // Code plugin ran first, set temperature=1.0 and marker
      // Declarative rule ran second, overrode temperature to 0.5
      // but marker from code plugin is preserved
      expect(ctx.body.marker).toBe("code-was-here");
      expect(ctx.body.temperature).toBe(0.5);
    });

    it("code plugin sees body before declarative defaults are injected", () => {
      const codePlugin: TransformPlugin = {
        name: "code-plugin",
        match: { providerId: "p1" },
        afterRequestTransform(ctx) {
          ctx.body.sawMaxTokens = ctx.body.max_tokens !== undefined;
        },
      };
      reg.registerPlugin(codePlugin);

      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 4096 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx();
      reg.applyAfterRequest(ctx);

      // Code plugin ran before declarative rule injected defaults
      expect(ctx.body.sawMaxTokens).toBe(false);
      // But defaults are present after all plugins finish
      expect(ctx.body.max_tokens).toBe(4096);
    });

    it("multiple code plugins + declarative rule all apply", () => {
      reg.registerPlugin({
        name: "step-1",
        match: { providerId: "p1" },
        afterRequestTransform(ctx) { ctx.body.steps = ["code-1"]; },
      });
      reg.registerPlugin({
        name: "step-2",
        match: { providerId: "p1" },
        afterRequestTransform(ctx) { (ctx.body.steps as string[]).push("code-2"); },
      });

      upsertTransformRule(db, "p1", {
        field_overrides: { finalized: true },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx();
      reg.applyAfterRequest(ctx);

      expect(ctx.body.steps).toEqual(["code-1", "code-2"]);
      expect(ctx.body.finalized).toBe(true);
    });
  });

  describe("T26-response: declarative rule on response", () => {
    it("applies field_overrides to response context", () => {
      upsertTransformRule(db, "p1", {
        field_overrides: { model: "claude-3-sonnet" },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const respCtx: ResponseTransformContext = {
        response: { id: "msg_123", model: "claude-3-haiku" },
        sourceApiType: "anthropic",
        targetApiType: "openai",
        provider: { id: "p1", name: "test-provider", base_url: "", api_type: "anthropic" },
      };
      reg.applyAfterResponse(respCtx);

      expect(respCtx.response.model).toBe("claude-3-sonnet");
      expect(respCtx.response.id).toBe("msg_123");
    });
  });
});
