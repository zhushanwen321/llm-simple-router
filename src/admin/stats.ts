import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getStats } from "../db/index.js";
import { resolveTimeRange } from "../utils/time-range.js";
import type { DashboardPeriod } from "../utils/time-range.js";

const StatsQuerySchema = Type.Object({
  period: Type.Optional(Type.Union([
    Type.Literal("window"),
    Type.Literal("weekly"),
    Type.Literal("monthly"),
  ])),
  start_time: Type.Optional(Type.String()),
  end_time: Type.Optional(Type.String()),
  router_key_id: Type.Optional(Type.String()),
  provider_id: Type.Optional(Type.String()),
  backend_model: Type.Optional(Type.String()),
});

interface StatsRoutesOptions {
  db: Database.Database;
}

export const adminStatsRoutes: FastifyPluginCallback<StatsRoutesOptions> = (app, options, done) => {
  app.get("/admin/api/stats", { schema: { querystring: StatsQuerySchema } }, async (request, reply) => {
    const query = request.query as Static<typeof StatsQuerySchema>;
    let startTime: string;
    let endTime: string;

    if (query.start_time && query.end_time) {
      startTime = query.start_time;
      endTime = query.end_time;
    } else {
      const range = resolveTimeRange(
        (query.period ?? "weekly") as DashboardPeriod,
        options.db,
        query.router_key_id,
        query.provider_id,
      );
      startTime = range.startTime;
      endTime = range.endTime;
    }

    const stats = getStats(options.db, startTime, endTime, query.router_key_id, query.provider_id, query.backend_model);
    return reply.send({ ...stats, startTime, endTime });
  });

  done();
};
