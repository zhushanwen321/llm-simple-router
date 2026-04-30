import type { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { resolve } from "path";
import { getTransformRule, upsertTransformRule, deleteTransformRule, getAllActiveRules } from "../db/transform-rules.js";

interface TransformRuleOptions {
  db: Database.Database;
  pluginRegistry?: import("../proxy/transform/plugin-registry.js").PluginRegistry;
}

const ALLOWED_FIELDS = new Set([
  "inject_headers", "request_defaults", "drop_fields", "field_overrides", "plugin_name", "is_active",
]);

export const adminTransformRuleRoutes: FastifyPluginCallback<TransformRuleOptions> = (app, options, done) => {
  const { db } = options;

  app.get<{ Params: { providerId: string } }>("/admin/api/transform-rules/:providerId", async (req) => {
    const { providerId } = req.params;
    const rule = getTransformRule(db, providerId);
    return { code: 0, message: "ok", data: rule };
  });

  app.put<{ Params: { providerId: string }; Body: Record<string, unknown> }>(
    "/admin/api/transform-rules/:providerId",
    async (req) => {
      const { providerId } = req.params;
      const updates: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(req.body)) {
        if (ALLOWED_FIELDS.has(key)) updates[key] = val;
      }
      upsertTransformRule(db, providerId, updates);
      return { code: 0, message: "ok", data: { success: true } };
    },
  );

  app.delete<{ Params: { providerId: string } }>("/admin/api/transform-rules/:providerId", async (req) => {
    const { providerId } = req.params;
    deleteTransformRule(db, providerId);
    return { code: 0, message: "ok", data: { success: true } };
  });

  app.post("/admin/api/transform-rules/reload", async () => {
    if (options.pluginRegistry) {
      const pluginsDir = resolve(process.cwd(), "plugins/transform");
      const result = options.pluginRegistry.reload(options.db, pluginsDir);
      return { code: 0, message: "ok", data: result };
    }
    const rules = getAllActiveRules(db);
    return { code: 0, message: "ok", data: { loadedPlugins: [] as string[], rulesCount: rules.length } };
  });

  done();
};
