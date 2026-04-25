import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getSetting, setSetting } from "../db/settings.js";
import { parseModels, COMPACT_THRESHOLD } from "../config/model-context.js";
import { getActiveProvidersWithModels } from "../db/index.js";

const UpdateProxyEnhancementSchema = Type.Object({
  claude_code_enabled: Type.Boolean(),
  context_compact_enabled: Type.Boolean(),
  compact_provider_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  compact_model: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  custom_prompt_enabled: Type.Boolean(),
  custom_prompt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const SessionParamsSchema = Type.Object({
  keyId: Type.String(),
  sessionId: Type.String(),
});
import {
  getSessionStates,
  getSessionHistory,
} from "../db/session-states.js";
import { modelState } from "../proxy/model-state.js";

interface ProxyEnhancementOptions {
  db: Database.Database;
}

interface ProxyEnhancementConfig {
  claude_code_enabled: boolean;
  context_compact_enabled: boolean;
  compact_provider_id: string | null;
  compact_model: string | null;
  custom_prompt_enabled: boolean;
  custom_prompt: string | null;
}

export const adminProxyEnhancementRoutes: FastifyPluginCallback<ProxyEnhancementOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/proxy-enhancement", async (_request, reply) => {
    const raw = getSetting(db, "proxy_enhancement");
    const parsed = raw ? JSON.parse(raw) : {};
    return reply.send({
      claude_code_enabled: parsed.claude_code_enabled ?? false,
      context_compact_enabled: parsed.context_compact_enabled ?? false,
      compact_provider_id: parsed.compact_provider_id ?? null,
      compact_model: parsed.compact_model ?? null,
      custom_prompt_enabled: parsed.custom_prompt_enabled ?? false,
      custom_prompt: parsed.custom_prompt ?? null,
    });
  });

  app.put("/admin/api/proxy-enhancement", { schema: { body: UpdateProxyEnhancementSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof UpdateProxyEnhancementSchema>;
    const config: ProxyEnhancementConfig = {
      claude_code_enabled: body.claude_code_enabled,
      context_compact_enabled: body.context_compact_enabled,
      compact_provider_id: body.compact_provider_id ?? null,
      compact_model: body.compact_model ?? null,
      custom_prompt_enabled: body.custom_prompt_enabled,
      custom_prompt: body.custom_prompt ?? null,
    };
    setSetting(db, "proxy_enhancement", JSON.stringify(config));
    return reply.send({ success: true });
  });

  app.get("/admin/api/proxy-enhancement/compact-models", async (_request, reply) => {
    const providers = getActiveProvidersWithModels(db);
    const result: Array<{ provider_id: string; provider_name: string; model: string; context_window: number }> = [];
    for (const p of providers) {
      const models = parseModels(p.models);
      for (const m of models) {
        if (m.context_window && m.context_window >= COMPACT_THRESHOLD) {
          result.push({ provider_id: p.id, provider_name: p.name, model: m.name, context_window: m.context_window });
        }
      }
    }
    return reply.send(result);
  });

  app.get("/admin/api/session-states", async (_req, reply) => {
    const states = getSessionStates(db);
    return reply.send(states);
  });

  app.get(
    "/admin/api/session-states/:keyId/:sessionId/history",
    { schema: { params: SessionParamsSchema } },
    async (req, reply) => {
      const { keyId, sessionId } = req.params as { keyId: string; sessionId: string };
      const history = getSessionHistory(db, keyId, sessionId);
      return reply.send(history);
    },
  );

  app.delete(
    "/admin/api/session-states/:keyId/:sessionId",
    { schema: { params: SessionParamsSchema } },
    async (req, reply) => {
      const { keyId, sessionId } = req.params as { keyId: string; sessionId: string };
      modelState.delete(keyId, sessionId);
      return reply.send({ success: true });
    },
  );

  done();
};
