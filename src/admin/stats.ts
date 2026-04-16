import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getStats } from "../db/index.js";

const StatsQuerySchema = Type.Object({
  period: Type.Optional(Type.String()),
  router_key_id: Type.Optional(Type.String()),
});

interface StatsRoutesOptions {
  db: Database.Database;
}

export const adminStatsRoutes: FastifyPluginCallback<StatsRoutesOptions> = (app, options, done) => {
  app.get("/admin/api/stats", { schema: { querystring: StatsQuerySchema } }, async (request, reply) => {
    const query = request.query as Static<typeof StatsQuerySchema>;
    const period = (query.period || "24h") as "1h" | "6h" | "24h" | "7d" | "30d";
    const stats = getStats(options.db, period, query.router_key_id);
    return reply.send(stats);
  });

  done();
};
