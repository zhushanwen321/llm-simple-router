import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type } from "@sinclair/typebox";
import { getWindowsInRange, getWindowUsage } from "../db/usage-windows.js";
import { toSqliteDatetime } from "../utils/datetime.js";

interface UsageRoutesOptions {
  db: Database.Database;
}

const UsageQuerySchema = Type.Object({
  router_key_id: Type.Optional(Type.String()),
});

interface DailyUsageRow {
  date: string;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // 周日 getDay()=0，需要回退到上周一；其余日期减到周一
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // eslint-disable-line no-magic-numbers
  d.setDate(diff);
  return d;
}

function getDailyUsage(
  db: Database.Database,
  start: Date,
  end: Date,
  routerKeyId?: string,
): DailyUsageRow[] {
  const routerKeyFilter = routerKeyId
    ? " AND rl.router_key_id = ?"
    : "";
  const params = routerKeyId
    ? [toSqliteDatetime(start), toSqliteDatetime(end), routerKeyId]
    : [toSqliteDatetime(start), toSqliteDatetime(end)];

  return db.prepare(`
    SELECT
      date(rm.created_at) AS date,
      COUNT(*) AS request_count,
      COALESCE(SUM(rm.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(rm.output_tokens), 0) AS total_output_tokens
    FROM request_metrics rm
    JOIN request_logs rl ON rl.id = rm.request_log_id
    WHERE rm.is_complete = 1
      AND rm.created_at >= datetime(?)
      AND rm.created_at < datetime(?)
      ${routerKeyFilter}
    GROUP BY date(rm.created_at)
    ORDER BY date ASC
  `).all(...params) as DailyUsageRow[];
}

export const adminUsageRoutes: FastifyPluginCallback<UsageRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/usage/windows", { schema: { querystring: UsageQuerySchema } }, async (request) => {
    const query = request.query as { router_key_id?: string };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const windows = getWindowsInRange(db, toSqliteDatetime(today), toSqliteDatetime(tomorrow), query.router_key_id);

    return windows.map(w => ({
      window: w,
      usage: getWindowUsage(db, w.start_time, w.end_time, query.router_key_id),
    }));
  });

  app.get("/admin/api/usage/weekly", { schema: { querystring: UsageQuerySchema } }, async (request) => {
    const query = request.query as { router_key_id?: string };
    const now = new Date();
    const monday = getMonday(now);
    monday.setHours(0, 0, 0, 0);
    return getDailyUsage(db, monday, now, query.router_key_id);
  });

  app.get("/admin/api/usage/monthly", { schema: { querystring: UsageQuerySchema } }, async (request) => {
    const query = request.query as { router_key_id?: string };
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return getDailyUsage(db, firstOfMonth, now, query.router_key_id);
  });

  done();
};
