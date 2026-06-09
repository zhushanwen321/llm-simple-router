import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getStats, getMetricsSummary, getMetricsTimeseries, getClientTypeBreakdown, getAllProviders, getAllRouterKeys, computeBucketBoundary } from "../db/index.js";
import type { MetricsPeriod, MetricsMetric } from "../db/metrics.js";
import { getSetting } from "../db/settings.js";
import { serializeProviders } from "./providers.js";
import type { StateRegistry } from "../core/registry.js";

const OverviewQuerySchema = Type.Object({
  provider_id: Type.Optional(Type.String()),
  backend_model: Type.Optional(Type.String()),
  router_key_id: Type.Optional(Type.String()),
  client_type: Type.Optional(Type.String()),
  start_time: Type.String(),
  end_time: Type.String(),
});

const PERCENT_MULTIPLIER = 100;
const PCT_ROUND_DIGITS = 10;

interface DashboardRoutesOptions {
  db: Database.Database;
  stateRegistry?: StateRegistry;
}

/** Compute overview stats (reused by both /overview and /init) */
async function computeOverview(db: Database.Database, query: Static<typeof OverviewQuerySchema>) {
  const startTime = query.start_time;
  const endTime = query.end_time;
  const providerId = query.provider_id || undefined;
  const backendModel = query.backend_model || undefined;
  const routerKeyId = query.router_key_id || undefined;
  const clientType = query.client_type || undefined;

  // 1. Current period stats
  const stats = getStats(db, startTime, endTime, routerKeyId, providerId, backendModel, clientType);

  // 2. Previous period stats (same duration, immediately before current window)
  const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  const prevEnd = startTime;
  const prevStart = new Date(new Date(startTime).getTime() - durationMs).toISOString();
  const prevStats = durationMs > 0
    ? getStats(db, prevStart, prevEnd, routerKeyId, providerId, backendModel, clientType)
    : null;

  // 3. Timeseries (tps, input_tokens, output_tokens)
  const legacyPeriod: MetricsPeriod = "30d";

  const [tpsRes, inputRes, outputRes] = await Promise.allSettled([
    getMetricsTimeseries(db, legacyPeriod, "total_tps" as MetricsMetric, providerId, backendModel, routerKeyId, startTime, endTime, clientType),
    getMetricsTimeseries(db, legacyPeriod, "input_tokens" as MetricsMetric, providerId, backendModel, routerKeyId, startTime, endTime, clientType),
    getMetricsTimeseries(db, legacyPeriod, "output_tokens" as MetricsMetric, providerId, backendModel, routerKeyId, startTime, endTime, clientType),
  ]);

  const tpsRes_ = tpsRes.status === "fulfilled" ? tpsRes.value : [];
  const inputRes_ = inputRes.status === "fulfilled" ? inputRes.value : [];
  const outputRes_ = outputRes.status === "fulfilled" ? outputRes.value : [];

  // 4. Cache hit rate + client type breakdown
  const summary = getMetricsSummary(db, legacyPeriod, providerId, backendModel, routerKeyId, startTime, endTime, clientType);
  const totalInputTokens = summary.reduce((sum, r) => sum + r.total_input_tokens, 0);
  const totalCacheHitTokens = summary.reduce((sum, r) => sum + r.total_cache_hit_tokens, 0);
  const cacheHitRate = totalInputTokens > 0
    ? Math.round(totalCacheHitTokens * PERCENT_MULTIPLIER / totalInputTokens * PCT_ROUND_DIGITS) / PCT_ROUND_DIGITS
    : 0;
  const breakdown = getClientTypeBreakdown(db, legacyPeriod, providerId, backendModel, routerKeyId, startTime, endTime);

  // 5. Provider token summary (same time range as overview)
  const providerTokenSummary = getProviderTokenSummary(db, startTime, endTime);

  return {
    stats: {
      totalRequests: stats.totalRequests,
      successRate: stats.successRate,
      avgTps: stats.avgTps,
      totalInputTokens: stats.totalInputTokens,
      totalOutputTokens: stats.totalOutputTokens,
      startTime,
      endTime,
    },
    prev_stats: prevStats ? {
      totalRequests: prevStats.totalRequests,
      successRate: prevStats.successRate,
      avgTps: prevStats.avgTps,
      totalInputTokens: prevStats.totalInputTokens,
      totalOutputTokens: prevStats.totalOutputTokens,
    } : null,
    cache_hit_rate: cacheHitRate,
    client_type_breakdown: breakdown,
    timeseries: {
      tps: tpsRes_,
      input_tokens: inputRes_,
      output_tokens: outputRes_,
    },
    provider_token_summary: providerTokenSummary,
  };
}

export const adminDashboardRoutes: FastifyPluginCallback<DashboardRoutesOptions> = (app, options, done) => {
  const { db, stateRegistry } = options;

  app.get("/admin/api/dashboard/init", { schema: { querystring: OverviewQuerySchema } }, async (request, reply) => {
    const query = request.query as Static<typeof OverviewQuerySchema>;

    const [providersResult, routerKeysResult, overviewResult] = await Promise.allSettled([
      (async () => {
        const encryptionKey = getSetting(db, "encryption_key")!;
        const providers = getAllProviders(db);
        return serializeProviders(db, providers, encryptionKey, (id) =>
          stateRegistry?.getProviderStatus(id) ?? { active: 0, queued: 0 },
        );
      })(),
      Promise.resolve(getAllRouterKeys(db).map(rk => ({ id: rk.id, name: rk.name }))),
      (async () => computeOverview(db, query))(),
    ]);

    return reply.send({
      providers: providersResult.status === "fulfilled" ? providersResult.value : null,
      router_keys: routerKeysResult.status === "fulfilled" ? routerKeysResult.value : null,
      ...(overviewResult.status === "fulfilled" ? overviewResult.value : {
        stats: null, prev_stats: null, cache_hit_rate: null,
        client_type_breakdown: null, timeseries: null, provider_token_summary: null,
      }),
    });
  });

  app.get("/admin/api/dashboard/overview", { schema: { querystring: OverviewQuerySchema } }, async (request, reply) => {
    const query = request.query as Static<typeof OverviewQuerySchema>;
    return reply.send(await computeOverview(db, query));
  });

  done();
};

/** Get per-provider total input tokens for the given time range (for sorting/labels).
 *  Uses the same cross-boundary merge as getStats(): metrics_10min (settled) + request_metrics (current bucket).
 */
function getProviderTokenSummary(db: Database.Database, startTime: string, endTime: string): Record<string, number> {
  const result: Record<string, number> = {};
  const boundary = computeBucketBoundary();

  // 1. Aggregated data from metrics_10min (everything before the current bucket)
  const aggEnd = endTime <= boundary ? endTime : boundary;
  if (startTime < aggEnd) {
    const rows = db.prepare(
      `SELECT provider_id, COALESCE(SUM(sum_input_tokens), 0) AS total_input_tokens
       FROM metrics_10min
       WHERE bucket_time >= datetime(?) AND bucket_time < datetime(?)
       GROUP BY provider_id`,
    ).all(startTime, aggEnd) as { provider_id: string; total_input_tokens: number }[];
    for (const r of rows) {
      result[r.provider_id] = (result[r.provider_id] ?? 0) + r.total_input_tokens;
    }
  }

  // 2. Real-time data from request_metrics (current bucket to now)
  if (endTime > boundary && boundary > startTime) {
    const detailRows = db.prepare(
      `SELECT provider_id, COALESCE(SUM(input_tokens), 0) AS total_input_tokens
       FROM request_metrics
       WHERE created_at >= datetime(?) AND created_at < datetime(?)
       GROUP BY provider_id`,
    ).all(boundary, endTime) as { provider_id: string; total_input_tokens: number }[];
    for (const r of detailRows) {
      result[r.provider_id] = (result[r.provider_id] ?? 0) + r.total_input_tokens;
    }
  }

  return result;
}
