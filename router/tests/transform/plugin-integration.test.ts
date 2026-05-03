import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../src/db/index.js";
import { upsertTransformRule } from "../../src/db/transform-rules.js";
import { PluginRegistry } from "../../src/proxy/transform/plugin-registry.js";
import type { RequestTransformContext, ResponseTransformContext } from "../../src/proxy/transform/plugin-types.js";

function makeCtx(overrides?: Partial<RequestTransformContext>): RequestTransformContext {
  return {
    body: {},
    sourceApiType: "openai",
    targetApiType: "anthropic",
    provider: { id: "p1", name: "test-provider", base_url: "http://localhost:1234", api_type: "anthropic" },
    ...overrides,
  };
}

function makeResponseCtx(overrides?: Partial<ResponseTransformContext>): ResponseTransformContext {
  return {
    response: {},
    sourceApiType: "anthropic",
    targetApiType: "openai",
    provider: { id: "p1", name: "test-provider", base_url: "http://localhost:1234", api_type: "anthropic" },
    ...overrides,
  };
}

function insertProvider(db: Database.Database, id: string, name: string, apiType: string): void {
  db.prepare(
    `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, apiType, "http://localhost:1234", "key", 1, new Date().toISOString(), new Date().toISOString());
}

describe("Plugin Integration (T26)", () => {
  let db: Database.Database;
  let reg: PluginRegistry;

  beforeEach(() => {
    db = initDatabase(":memory:");
    insertProvider(db, "p1", "test-provider", "anthropic");
    insertProvider(db, "p2", "other-provider", "openai");
    reg = new PluginRegistry();
  });

  describe("declarative rules via DB + PluginRegistry", () => {
    it("request_defaults injects missing fields", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 4096, temperature: 0.5 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({ body: { messages: [], max_tokens: 1024 } });
      reg.applyAfterRequest(ctx);

      // existing field preserved, missing field injected
      expect(ctx.body.max_tokens).toBe(1024);
      expect(ctx.body.temperature).toBe(0.5);
    });

    it("drop_fields removes specified fields", () => {
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

    it("field_overrides overwrites existing values", () => {
      upsertTransformRule(db, "p1", {
        field_overrides: { temperature: 0.7, max_tokens: 8192 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({ body: { messages: [], temperature: 1.0, max_tokens: 100 } });
      reg.applyAfterRequest(ctx);

      expect(ctx.body.temperature).toBe(0.7);
      expect(ctx.body.max_tokens).toBe(8192);
    });

    it("applies request_defaults, drop_fields, and field_overrides together", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { stream: true, temperature: 0.3 },
        drop_fields: ["user", "logprobs"],
        field_overrides: { max_tokens: 2048 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({
        body: { messages: [], user: "test-user", logprobs: 3, max_tokens: 500 },
      });
      reg.applyAfterRequest(ctx);

      // defaults: stream injected (was missing), temperature not injected (would conflict with flow, but defaults only set if undefined)
      expect(ctx.body.stream).toBe(true);
      // drop: user and logprobs removed
      expect(ctx.body.user).toBeUndefined();
      expect(ctx.body.logprobs).toBeUndefined();
      // override: max_tokens forced to 2048
      expect(ctx.body.max_tokens).toBe(2048);
      // defaults: temperature NOT injected because request_defaults only sets if undefined
      // but field_overrides does NOT have temperature, so it stays as-is from request_defaults
      expect(ctx.body.temperature).toBe(0.3);
    });

    it("inactive rules are not loaded", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 9999 },
        is_active: 0,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx);

      expect(ctx.body.max_tokens).toBeUndefined();
    });

    it("rules only match their provider", () => {
      upsertTransformRule(db, "p1", {
        field_overrides: { temperature: 0.1 },
        is_active: 1,
      });
      upsertTransformRule(db, "p2", {
        field_overrides: { temperature: 0.9 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctxP1 = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctxP1);
      expect(ctxP1.body.temperature).toBe(0.1);

      const ctxP2 = makeCtx({
        body: { messages: [] },
        provider: { id: "p2", name: "other-provider", base_url: "", api_type: "openai" },
      });
      reg.applyAfterRequest(ctxP2);
      expect(ctxP2.body.temperature).toBe(0.9);
    });

    it("field_overrides NOT applied to response (request-only)", () => {
      upsertTransformRule(db, "p1", {
        field_overrides: { model: "overridden-model" },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeResponseCtx({ response: { model: "original", content: "hello" } });
      reg.applyAfterResponse(ctx);

      // field_overrides should NOT override response — response reflects actual upstream data
      expect(ctx.response.model).toBe("original");
      expect(ctx.response.content).toBe("hello");
    });
  });

  describe("reload refreshes rules", () => {
    it("updated rule takes effect after reload", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 1024 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx1 = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx1);
      expect(ctx1.body.max_tokens).toBe(1024);

      // Update the rule
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 8192 },
        is_active: 1,
      });

      // Before reload, old rule still applies
      const ctx1b = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx1b);
      expect(ctx1b.body.max_tokens).toBe(1024);

      // Reload and verify new rule
      const result = reg.reload(db, "/nonexistent/plugins");
      expect(result.rulesCount).toBe(1);

      const ctx2 = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx2);
      expect(ctx2.body.max_tokens).toBe(8192);
    });

    it("deleted rule no longer applies after reload", () => {
      upsertTransformRule(db, "p1", {
        field_overrides: { temperature: 0.5 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      // Deactivate the rule
      upsertTransformRule(db, "p1", { is_active: 0 });
      reg.reload(db, "/nonexistent/plugins");

      const ctx = makeCtx({ body: { messages: [], temperature: 1.0 } });
      reg.applyAfterRequest(ctx);
      expect(ctx.body.temperature).toBe(1.0);
    });
  });

  describe("mixed code plugins and declarative rules", () => {
    it("code plugins registered before loadFromDB execute before declarative rules", () => {
      // Register a code plugin that sets a marker
      reg.registerPlugin({
        name: "code-plugin",
        match: { providerId: "p1" },
        afterRequestTransform(ctx) {
          ctx.body._codePluginRan = true;
          // Set temperature so we can verify declarative rule overrides it
          ctx.body.temperature = 0.1;
        },
      });

      // Declarative rule that overrides temperature
      upsertTransformRule(db, "p1", {
        field_overrides: { temperature: 0.99 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      const ctx = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx);

      // Code plugin ran
      expect(ctx.body._codePluginRan).toBe(true);
      // Declarative rule overwrote the temperature set by code plugin
      expect(ctx.body.temperature).toBe(0.99);
    });

    it("code plugin can observe body already modified by earlier declarative rule", () => {
      // Declarative rule sets max_tokens
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 4096 },
        is_active: 1,
      });
      reg.loadFromDB(db);

      // Code plugin registered AFTER loadFromDB, so it runs after declarative rule
      reg.registerPlugin({
        name: "late-code-plugin",
        match: { providerId: "p1" },
        afterRequestTransform(ctx) {
          ctx.body._observedMaxTokens = ctx.body.max_tokens;
        },
      });

      const ctx = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx);

      expect(ctx.body._observedMaxTokens).toBe(4096);
    });

    it("multiple providers each get their own code + declarative pipeline", () => {
      // Code plugin for p1
      reg.registerPlugin({
        name: "p1-code",
        match: { providerId: "p1" },
        afterRequestTransform(ctx) {
          ctx.body.p1Code = true;
        },
      });

      // Code plugin for p2
      reg.registerPlugin({
        name: "p2-code",
        match: { providerId: "p2" },
        afterRequestTransform(ctx) {
          ctx.body.p2Code = true;
        },
      });

      upsertTransformRule(db, "p1", { field_overrides: { stream: false }, is_active: 1 });
      upsertTransformRule(db, "p2", { field_overrides: { stream: true }, is_active: 1 });
      reg.loadFromDB(db);

      const ctxP1 = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctxP1);
      expect(ctxP1.body.p1Code).toBe(true);
      expect(ctxP1.body.p2Code).toBeUndefined();
      expect(ctxP1.body.stream).toBe(false);

      const ctxP2 = makeCtx({
        body: { messages: [] },
        provider: { id: "p2", name: "other-provider", base_url: "", api_type: "openai" },
      });
      reg.applyAfterRequest(ctxP2);
      expect(ctxP2.body.p2Code).toBe(true);
      expect(ctxP2.body.p1Code).toBeUndefined();
      expect(ctxP2.body.stream).toBe(true);
    });
  });
});
