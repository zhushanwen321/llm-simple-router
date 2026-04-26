import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type } from "@sinclair/typebox";
import { getWindowsInRange, getWindowUsage } from "../db/usage-windows.js";
import { resolveTimeRange } from "../utils/time-range.js";

interface UsageRoutesOptions {
  db: Database.Database;
}

const UsageQuerySchema = Type.Object({
  router_key_id: Type.Optional(Type.String()),
  provider_id: Type.Optional(Type.String()),
});

interface DailyUsageRow {
  date: string;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

function getDailyUsage(
  db: Database.Database,
  startTime: string,
  endTime: string,
  routerKeyId?: string,
  providerId?: string,
): DailyUsageRow[] {
  const conditions = [
    "rm.is_complete = 1",
    "rm.created_at >= datetime(?)",
    "rm.created_at < datetime(?)",
  ];
  const params: unknown[] = [startTime, endTime];

  if (routerKeyId) {
    conditions.push("rm.router_key_id = ?");
    params.push(routerKeyId);
  }
  if (providerId) {
    conditions.push("rm.provider_id = ?");
    params.push(providerId);
  }

  return db.prepare(`
    SELECT
      date(rm.created_at) AS date,
      COUNT(*) AS request_count,
      COALESCE(SUM(rm.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(rm.output_tokens), 0) AS total_output_tokens
    FROM request_metrics rm
    WHERE ${conditions.join(" AND ")}
    GROUP BY date(rm.created_at)
    ORDER BY date ASC
  `).all(...params) as DailyUsageRow[];
}

export const adminUsageRoutes: FastifyPluginCallback<UsageRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/usage/windows", { schema: { querystring: UsageQuerySchema } }, async (request) => {
    const query = request.query as { router_key_id?: string; provider_id?: string };
    const range = resolveTimeRange("window", db, query.router_key_id);
    const windows = getWindowsInRange(db, range.startTime, range.endTime, query.router_key_id, query.provider_id);
    if (windows.length === 0) return [];
    return windows.map(w => ({
      window: w,
      usage: getWindowUsage(db, w.start_time, w.end_time, query.router_key_id, query.provider_id),
    }));
  });

  app.get("/admin/api/usage/weekly", { schema: { querystring: UsageQuerySchema } }, async (request) => {
    const query = request.query as { router_key_id?: string; provider_id?: string };
    const range = resolveTimeRange("weekly", db, query.router_key_id);
    return getDailyUsage(db, range.startTime, range.endTime, query.router_key_id, query.provider_id);
  });

  app.get("/admin/api/usage/monthly", { schema: { querystring: UsageQuerySchema } }, async (request) => {
    const query = request.query as { router_key_id?: string; provider_id?: string };
    const range = resolveTimeRange("monthly", db, query.router_key_id);
    return getDailyUsage(db, range.startTime, range.endTime, query.router_key_id, query.provider_id);
  });

  done();
};
