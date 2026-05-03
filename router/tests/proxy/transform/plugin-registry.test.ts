import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../../src/db/index.js";
import { upsertTransformRule } from "../../../src/db/transform-rules.js";
import { PluginRegistry } from "../../../src/proxy/transform/plugin-registry.js";
import type { RequestTransformContext, ResponseTransformContext, TransformPlugin } from "../../../src/proxy/transform/plugin-types.js";

function makeCtx(overrides?: Partial<RequestTransformContext>): RequestTransformContext {
  return {
    body: {},
    sourceApiType: "openai",
    targetApiType: "anthropic",
    provider: { id: "p1", name: "test", base_url: "", api_type: "anthropic" },
    ...overrides,
  };
}

function makeResponseCtx(overrides?: Partial<ResponseTransformContext>): ResponseTransformContext {
  return {
    response: {},
    sourceApiType: "anthropic",
    targetApiType: "openai",
    provider: { id: "p1", name: "test", base_url: "", api_type: "anthropic" },
    ...overrides,
  };
}

describe("PluginRegistry", () => {
  let db: Database.Database;
  let reg: PluginRegistry;

  beforeEach(() => {
    db = initDatabase(":memory:");
    // Insert provider for FK
    db.prepare(
      `INSERT INTO providers (id, name, api_type, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("p1", "test", "anthropic", "http://localhost:1234", "key", 1, new Date().toISOString(), new Date().toISOString());
    reg = new PluginRegistry();
  });

  describe("plugin registration", () => {
    it("registers and applies matching plugin hooks", () => {
      const plugin: TransformPlugin = {
        name: "test",
        match: { providerId: "p1" },
        afterRequestTransform(ctx) { ctx.body.transformed = true; },
      };
      reg.registerPlugin(plugin);
      const ctx = makeCtx();
      reg.applyAfterRequest(ctx);
      expect(ctx.body.transformed).toBe(true);
    });

    it("does not apply non-matching plugin", () => {
      const plugin: TransformPlugin = {
        name: "test",
        match: { providerId: "p2" },
        afterRequestTransform(ctx) { ctx.body.transformed = true; },
      };
      reg.registerPlugin(plugin);
      const ctx = makeCtx();
      reg.applyAfterRequest(ctx);
      expect(ctx.body.transformed).toBeUndefined();
    });

    it("applies multiple plugins in order", () => {
      reg.registerPlugin({
        name: "first",
        match: {},
        afterRequestTransform(ctx) { ctx.body.step1 = true; },
      });
      reg.registerPlugin({
        name: "second",
        match: {},
        afterRequestTransform(ctx) { ctx.body.step2 = ctx.body.step1 === true; },
      });
      const ctx = makeCtx();
      reg.applyAfterRequest(ctx);
      expect(ctx.body.step1).toBe(true);
      expect(ctx.body.step2).toBe(true);
    });
  });

  describe("declarative rules from DB", () => {
    it("loadFromDB converts rules to plugins", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 4096 },
        drop_fields: ["logprobs"],
        is_active: 1,
      });
      reg.loadFromDB(db);
      const ctx = makeCtx({ body: { messages: [], logprobs: 5 } });
      reg.applyAfterRequest(ctx);
      expect(ctx.body.max_tokens).toBe(4096);
      expect(ctx.body.logprobs).toBeUndefined();
    });

    it("field_overrides applied after defaults", () => {
      upsertTransformRule(db, "p1", {
        request_defaults: { max_tokens: 4096 },
        field_overrides: { temperature: 0.7 },
        is_active: 1,
      });
      reg.loadFromDB(db);
      const ctx = makeCtx({ body: { messages: [] } });
      reg.applyAfterRequest(ctx);
      expect(ctx.body.max_tokens).toBe(4096);
      expect(ctx.body.temperature).toBe(0.7);
    });
  });

  describe("response transforms", () => {
    it("applies afterResponseTransform", () => {
      const plugin: TransformPlugin = {
        name: "test",
        match: {},
        afterResponseTransform(ctx) { ctx.response.extra = true; },
      };
      reg.registerPlugin(plugin);
      const ctx = makeResponseCtx();
      reg.applyAfterResponse(ctx);
      expect(ctx.response.extra).toBe(true);
    });
  });

  describe("reload", () => {
    it("reload refreshes rules from DB", () => {
      upsertTransformRule(db, "p1", { inject_headers: { "x-v": "1" }, is_active: 1 });
      reg.loadFromDB(db);
      // Update rule
      upsertTransformRule(db, "p1", { drop_fields: ["logprobs"], is_active: 1 });
      reg.loadFromDB(db);
      const ctx = makeCtx({ body: { logprobs: 5 } });
      reg.applyAfterRequest(ctx);
      expect(ctx.body.logprobs).toBeUndefined();
    });
  });
});
