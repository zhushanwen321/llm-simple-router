import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { setSetting } from "../db/settings.js";
import type { StateRegistry } from "../core/registry.js";

const UpdateProxyEnhancementSchema = Type.Object({
  claude_code_enabled: Type.Boolean(),
  tool_call_loop_enabled: Type.Boolean(),
  stream_loop_enabled: Type.Boolean(),
  tool_round_limit_enabled: Type.Boolean(),
});

const SessionParamsSchema = Type.Object({
  keyId: Type.String(),
  sessionId: Type.String(),
});
import {
  getSessionStates,
  getSessionHistory,
} from "../db/session-states.js";

interface ProxyEnhancementOptions {
  db: Database.Database;
  stateRegistry?: StateRegistry;
}

export const adminProxyEnhancementRoutes: FastifyPluginCallback<ProxyEnhancementOptions> = (app, options, done) => {
  const { db, stateRegistry } = options;

  app.get("/admin/api/proxy-enhancement", async (_request, reply) => {
    const config = stateRegistry?.getEnhancementConfig() ?? { claude_code_enabled: false, tool_call_loop_enabled: false, stream_loop_enabled: false, tool_round_limit_enabled: true };
    return reply.send(config);
  });

  app.put("/admin/api/proxy-enhancement", { schema: { body: UpdateProxyEnhancementSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof UpdateProxyEnhancementSchema>;
    const config = {
      claude_code_enabled: body.claude_code_enabled,
      tool_call_loop_enabled: body.tool_call_loop_enabled,
      stream_loop_enabled: body.stream_loop_enabled,
      tool_round_limit_enabled: body.tool_round_limit_enabled,
    };
    setSetting(db, "proxy_enhancement", JSON.stringify(config));
    return reply.send({ success: true });
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
      stateRegistry?.deleteModelState(keyId, sessionId);
      return reply.send({ success: true });
    },
  );

  done();
};
