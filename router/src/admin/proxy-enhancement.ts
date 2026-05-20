import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getSetting, setSetting } from "../db/settings.js";
import { clearEnhancementConfigCache } from "../proxy/routing/enhancement-config.js";
import { API_CODE } from "./api-response.js";

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
}

export const adminProxyEnhancementRoutes: FastifyPluginCallback<ProxyEnhancementOptions> = (app, options, done) => {
  const { db } = options;

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
    // Include code to bypass onSend wrapping; flat structure matches test expectations
    return reply.send({ code: API_CODE.SUCCESS, message: 'ok', ...config, ai_retry_config: aiRetryConfig });
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
    clearEnhancementConfigCache();
    // ai_retry_config is stored in a separate settings key
    if (ai_retry_config !== undefined) {
      setSetting(db, "ai_retry_config", ai_retry_config ? JSON.stringify(ai_retry_config) : "");
    }
    return reply.send({ success: true });
  });

  done();
};
