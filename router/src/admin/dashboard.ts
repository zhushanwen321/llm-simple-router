import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getStats, getMetricsSummary, getMetricsTimeseries, getClientTypeBreakdown } from "../db/index.js";
import type { MetricsPeriod, MetricsMetric } from "../db/metrics.js";

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
const PROVIDER_TOKEN_LOOKBACK_DAYS = 30;

interface DashboardRoutesOptions {
  db: Database.Database;
}

export const adminDashboardRoutes: FastifyPluginCallback<DashboardRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/dashboard/overview", { schema: { querystring: OverviewQuerySchema } }, async (request, reply) => {
    const query = request.query as Static<typeof OverviewQuerySchema>;
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

    // 5. Provider token summary (for provider sorting/labels in frontend)
    const providerTokenSummary = getProviderTokenSummary(db);

    return reply.send({
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
    });
  });

  done();
};

/** Get per-provider total input tokens for last 30 days (for sorting/labels) */
function getProviderTokenSummary(db: Database.Database): Record<string, number> {
  const rows = db.prepare(
    `SELECT provider_id, COALESCE(SUM(sum_input_tokens), 0) AS total_input_tokens
     FROM metrics_10min
     WHERE bucket_time >= datetime('now', '-' || ? || ' days')
     GROUP BY provider_id`,
  ).all(PROVIDER_TOKEN_LOOKBACK_DAYS) as { provider_id: string; total_input_tokens: number }[];

  const result: Record<string, number> = {};
  for (const r of rows) {
    result[r.provider_id] = r.total_input_tokens;
  }
  return result;
}
