import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type } from "@sinclair/typebox";
import { getWindowsInRange, getWindowUsage } from "../db/usage-windows.js";
import { getProviderById } from "../db/index.js";
import { MS_PER_SECOND } from "../core/constants.js";
import { BUCKET_SECONDS } from "../db/metrics-10min.js";
import { resolveTimeRange } from "../utils/time-range.js";
import { toSqliteDatetime } from "../utils/datetime.js";

interface UsageRoutesOptions {
  db: Database.Database;
}

const UsageQuerySchema = Type.Object({
  router_key_id: Type.Optional(Type.String()),
  provider_id: Type.Optional(Type.String()),
  start_time: Type.Optional(Type.String()),
  end_time: Type.Optional(Type.String()),
});

interface DailyUsageRow {
  date: string;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

// Use shared bucket boundary from metrics-10min
// BUCKET_SECONDS imported from metrics-10min

function computeBucketBoundary(): string {
  const bucketStartSec = Math.floor(Date.now() / MS_PER_SECOND / BUCKET_SECONDS) * BUCKET_SECONDS;
  return toSqliteDatetime(new Date(bucketStartSec * MS_PER_SECOND));
}

function queryAggDailyUsage(
  db: Database.Database,
  startTime: string,
  endTime: string,
  routerKeyId?: string,
  providerId?: string,
): DailyUsageRow[] {
  const conditions = [
    "m.bucket_time >= datetime(?)",
    "m.bucket_time < datetime(?)",
  ];
  const params: unknown[] = [startTime, endTime];

  if (routerKeyId) {
    conditions.push("m.router_key_id = ?");
    params.push(routerKeyId);
  }
  if (providerId) {
    conditions.push("m.provider_id = ?");
    params.push(providerId);
  }

  return db.prepare(`
    SELECT
      date(m.bucket_time) AS date,
      SUM(m.request_count) AS request_count,
      SUM(m.sum_input_tokens) AS total_input_tokens,
      SUM(m.sum_output_tokens) AS total_output_tokens
    FROM metrics_10min m
    WHERE ${conditions.join(" AND ")}
    GROUP BY date(m.bucket_time)
    ORDER BY date ASC
  `).all(...params) as DailyUsageRow[];
}

function queryDetailDailyUsage(
  db: Database.Database,
  startTime: string,
  endTime: string,
  routerKeyId?: string,
  providerId?: string,
): DailyUsageRow[] {
  const conditions = [
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

function mergeDailyUsageResults(
  a: DailyUsageRow[],
  b: DailyUsageRow[],
): DailyUsageRow[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;

  const dateMap = new Map<string, DailyUsageRow>();
  for (const row of [...a, ...b]) {
    const existing = dateMap.get(row.date);
    if (existing) {
      existing.request_count += row.request_count;
      existing.total_input_tokens += row.total_input_tokens;
      existing.total_output_tokens += row.total_output_tokens;
    } else {
      dateMap.set(row.date, { ...row });
    }
  }

  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function getDailyUsage(
  db: Database.Database,
  startTime: string,
  endTime: string,
  routerKeyId?: string,
  providerId?: string,
): DailyUsageRow[] {
  const boundary = computeBucketBoundary();

  // Pure agg: entire range is before the current bucket
  if (endTime <= boundary) {
    return queryAggDailyUsage(db, startTime, endTime, routerKeyId, providerId);
  }

  // Pure detail: entire range is within the current bucket
  if (startTime >= boundary) {
    return queryDetailDailyUsage(db, startTime, endTime, routerKeyId, providerId);
  }

  // Cross-boundary: agg segment [start, boundary) + detail segment [boundary, end)
  const aggResult = queryAggDailyUsage(db, startTime, boundary, routerKeyId, providerId);
  const detailResult = queryDetailDailyUsage(db, boundary, endTime, routerKeyId, providerId);
  return mergeDailyUsageResults(detailResult, aggResult);
}

function resolveProviderName(db: Database.Database, providerId: string | null): string | null {
  if (!providerId) return null;
  return getProviderById(db, providerId)?.name ?? null;
}

export const adminUsageRoutes: FastifyPluginCallback<UsageRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/usage/windows", { schema: { querystring: UsageQuerySchema } }, async (request) => {
    const query = request.query as {
      router_key_id?: string;
      provider_id?: string;
      start_time?: string;
      end_time?: string;
    };

    let startTime: string;
    let endTime: string;

    if (query.start_time && query.end_time) {
      startTime = query.start_time;
      endTime = query.end_time;
    } else if (query.provider_id) {
      const range = resolveTimeRange("window", db, query.router_key_id, query.provider_id);
      startTime = range.startTime;
      endTime = range.endTime;
    } else {
      startTime = "1970-01-01";
      endTime = "2099-12-31";
    }

    const windows = getWindowsInRange(db, startTime, endTime, query.router_key_id, query.provider_id)
      .filter((w) => w.provider_id !== null);
    if (windows.length === 0) return [];

    return windows.map(w => ({
      window: { ...w, provider_name: resolveProviderName(db, w.provider_id) },
      usage: getWindowUsage(db, w.start_time, w.end_time, query.router_key_id, w.provider_id!),
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
