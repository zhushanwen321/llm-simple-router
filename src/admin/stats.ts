import { FastifyPluginCallback } from "fastify";
import { getStats } from "../db/index.js";

interface StatsRoutesOptions {
  db: any;
}

export const adminStatsRoutes: FastifyPluginCallback<StatsRoutesOptions> = (app, options, done) => {
  app.get("/admin/api/stats", async (_request, reply) => {
    const stats = getStats(options.db);
    return reply.send(stats);
  });

  done();
};
