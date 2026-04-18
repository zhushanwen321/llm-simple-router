import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { getSetting, setSetting } from "../db/settings.js";

interface ProxyEnhancementOptions {
  db: Database.Database;
}

interface ProxyEnhancementConfig {
  claude_code_enabled: boolean;
}

export const adminProxyEnhancementRoutes: FastifyPluginCallback<ProxyEnhancementOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/proxy-enhancement", async (_req, reply) => {
    const raw = getSetting(db, "proxy_enhancement");
    const config: ProxyEnhancementConfig = raw
      ? JSON.parse(raw)
      : { claude_code_enabled: false };
    return reply.send(config);
  });

  app.put("/admin/api/proxy-enhancement", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    if (typeof body.claude_code_enabled !== "boolean") {
      return reply.status(400).send({ error: "claude_code_enabled must be a boolean" }); // eslint-disable-line no-magic-numbers
    }
    const config: ProxyEnhancementConfig = {
      claude_code_enabled: body.claude_code_enabled,
    };
    setSetting(db, "proxy_enhancement", JSON.stringify(config));
    return reply.send({ success: true });
  });

  done();
};
