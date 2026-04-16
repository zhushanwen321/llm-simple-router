import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { getStats } from "../db/index.js";

interface StatsRoutesOptions {
  db: Database.Database;
}

export const adminStatsRoutes: FastifyPluginCallback<StatsRoutesOptions> = (app, options, done) => {
  app.get("/admin/api/stats", async (request, reply) => {
    const query = request.query as { router_key_id?: string };
    const stats = getStats(options.db, query.router_key_id);
    return reply.send(stats);
  });

  done();
};
