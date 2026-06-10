import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getSetting, setSetting } from "../db/settings.js";
import { getAllProviders } from "../db/index.js";
import { serializeProviders } from "./providers.js";
import type { StateRegistry } from "../core/registry.js";

const UpdateProxyEnhancementSchema = Type.Object({
  tool_call_loop_enabled: Type.Boolean(),
  stream_loop_enabled: Type.Boolean(),
  tool_round_limit_enabled: Type.Boolean(),
  tool_error_logging_enabled: Type.Boolean(),
  ai_retry_config: Type.Optional(Type.Union([
    Type.Null(),
    Type.Object({ provider_id: Type.String({ minLength: 1 }), model: Type.String({ minLength: 1 }) }),
  ])),
});


interface ProxyEnhancementOptions {
  db: Database.Database;
  stateRegistry?: StateRegistry;
}

export const adminProxyEnhancementRoutes: FastifyPluginCallback<ProxyEnhancementOptions> = (app, options, done) => {
  const { db, stateRegistry } = options;

  app.get("/admin/api/proxy-enhancement", async (_request, reply) => {
    const raw = getSetting(db, "proxy_enhancement");
    const defaults = { tool_call_loop_enabled: false, stream_loop_enabled: false, tool_round_limit_enabled: true, tool_error_logging_enabled: false };
    let config = defaults;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        config = {
          tool_call_loop_enabled: parsed.tool_call_loop_enabled ?? false,
          stream_loop_enabled: parsed.stream_loop_enabled ?? false,
          tool_round_limit_enabled: parsed.tool_round_limit_enabled ?? true,
          tool_error_logging_enabled: parsed.tool_error_logging_enabled ?? false,
        };
      } catch { /* eslint-disable-line taste/no-silent-catch -- invalid JSON, return defaults */ }
    }
    const aiConfigRaw = getSetting(db, "ai_retry_config");
    let aiRetryConfig: { provider_id: string; model: string } | null = null;
    if (aiConfigRaw) {
      try {
        aiRetryConfig = JSON.parse(aiConfigRaw) as { provider_id: string; model: string };
      } catch (e: unknown) {
        console.error('proxyEnhancement.parseAiConfig:', e);
        aiRetryConfig = null; // 损坏的 JSON 回退为 null
      }
    }
    return reply.send({ ...config, ai_retry_config: aiRetryConfig });
  });

  app.put("/admin/api/proxy-enhancement", { schema: { body: UpdateProxyEnhancementSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof UpdateProxyEnhancementSchema>;
    const { ai_retry_config, ...enhancementFields } = body;
    const config = {
      tool_call_loop_enabled: enhancementFields.tool_call_loop_enabled,
      stream_loop_enabled: enhancementFields.stream_loop_enabled,
      tool_round_limit_enabled: enhancementFields.tool_round_limit_enabled,
      tool_error_logging_enabled: enhancementFields.tool_error_logging_enabled,
    };
    setSetting(db, "proxy_enhancement", JSON.stringify(config));
    stateRegistry?.clearEnhancementCache();
    // ai_retry_config is stored in a separate settings key
    if (ai_retry_config !== undefined) {
      setSetting(db, "ai_retry_config", ai_retry_config ? JSON.stringify(ai_retry_config) : "");
    }
    return reply.send({ success: true });
  });

  app.get("/admin/api/proxy-enhancement/init", async (_request, reply) => {
    // config
    const raw = getSetting(db, "proxy_enhancement");
    const defaults = { tool_call_loop_enabled: false, stream_loop_enabled: false, tool_round_limit_enabled: true, tool_error_logging_enabled: false };
    let config = defaults;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        config = {
          tool_call_loop_enabled: parsed.tool_call_loop_enabled ?? false,
          stream_loop_enabled: parsed.stream_loop_enabled ?? false,
          tool_round_limit_enabled: parsed.tool_round_limit_enabled ?? true,
          tool_error_logging_enabled: parsed.tool_error_logging_enabled ?? false,
        };
      } catch { /* eslint-disable-line taste/no-silent-catch -- 损坏的 JSON，回退默认 */ }
    }
    const aiConfigRaw = getSetting(db, "ai_retry_config");
    let aiRetryConfig: { provider_id: string; model: string } | null = null;
    if (aiConfigRaw) {
      try {
        aiRetryConfig = JSON.parse(aiConfigRaw) as { provider_id: string; model: string };
      } catch (e: unknown) {
        console.error('proxyEnhancementInit.parseAiConfig:', e);
        aiRetryConfig = null;
      }
    }
    const fullConfig = { ...config, ai_retry_config: aiRetryConfig };

    // providers — simplified list with id, name, models for AI Retry selection
    const encryptionKey = getSetting(db, "encryption_key")!;
    const providers = getAllProviders(db);
    const serializedProviders = serializeProviders(db, providers, encryptionKey);

    return reply.send({ config: fullConfig, providers: serializedProviders });
  });

  done();
};
