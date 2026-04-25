import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { setSetting } from "../db/settings.js";
import { loadEnhancementConfig } from "../proxy/enhancement-config.js";
import { parseModels, lookupContextWindow, COMPACT_THRESHOLD } from "../config/model-context.js";
import { DEFAULT_COMPACT_PROMPT } from "../config/compact-prompt.js";
import { getActiveProvidersWithModels } from "../db/index.js";
import { getAllModelInfo } from "../db/model-info.js";

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
    const config = loadEnhancementConfig(db);
    return reply.send({
      claude_code_enabled: config.claude_code_enabled,
      context_compact_enabled: config.context_compact_enabled,
      compact_provider_id: config.compact_provider_id,
      compact_model: config.compact_model,
      custom_prompt_enabled: config.custom_prompt_enabled,
      custom_prompt: config.custom_prompt,
      default_compact_prompt: DEFAULT_COMPACT_PROMPT,
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
    const allOverrides = new Map(
      getAllModelInfo(db).map(m => [`${m.provider_id}:${m.model_name}`, m.context_window]),
    );
    const result: Array<{ provider_id: string; provider_name: string; model: string; context_window: number }> = [];
    for (const p of providers) {
      const modelNames = parseModels(p.models);
      for (const name of modelNames) {
        const ctx = allOverrides.get(`${p.id}:${name}`) ?? lookupContextWindow(name);
        if (ctx >= COMPACT_THRESHOLD) {
          result.push({ provider_id: p.id, provider_name: p.name, model: name, context_window: ctx });
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
