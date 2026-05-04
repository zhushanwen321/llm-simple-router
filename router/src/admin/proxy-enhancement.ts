import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getSetting, setSetting } from "../db/settings.js";

const UpdateProxyEnhancementSchema = Type.Object({
  tool_call_loop_enabled: Type.Boolean(),
  stream_loop_enabled: Type.Boolean(),
  tool_round_limit_enabled: Type.Boolean(),
});


interface ProxyEnhancementOptions {
  db: Database.Database;
}

export const adminProxyEnhancementRoutes: FastifyPluginCallback<ProxyEnhancementOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/proxy-enhancement", async (_request, reply) => {
    const raw = getSetting(db, "proxy_enhancement");
    const defaults = { tool_call_loop_enabled: false, stream_loop_enabled: false, tool_round_limit_enabled: true };
    let config = defaults;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        config = {
          tool_call_loop_enabled: parsed.tool_call_loop_enabled ?? false,
          stream_loop_enabled: parsed.stream_loop_enabled ?? false,
          tool_round_limit_enabled: parsed.tool_round_limit_enabled ?? true,
        };
      } catch { /* eslint-disable-line taste/no-silent-catch -- invalid JSON, return defaults */ }
    }
    return reply.send(config);
  });

  app.put("/admin/api/proxy-enhancement", { schema: { body: UpdateProxyEnhancementSchema } }, async (request, reply) => {
    const body = request.body as Static<typeof UpdateProxyEnhancementSchema>;
    const config = {
      tool_call_loop_enabled: body.tool_call_loop_enabled,
      stream_loop_enabled: body.stream_loop_enabled,
      tool_round_limit_enabled: body.tool_round_limit_enabled,
    };
    setSetting(db, "proxy_enhancement", JSON.stringify(config));
    return reply.send({ success: true });
  });

  done();
};
