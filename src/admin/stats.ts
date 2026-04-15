import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { getStats } from "../db/index.js";

interface StatsRoutesOptions {
  db: Database.Database;
}

export const adminStatsRoutes: FastifyPluginCallback<StatsRoutesOptions> = (app, options, done) => {
  app.get("/admin/api/stats", async (_request, reply) => {
    const stats = getStats(options.db);
    return reply.send(stats);
  });

  done();
};
