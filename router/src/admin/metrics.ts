import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getMetricsSummary, getMetricsTimeseries, getClientTypeBreakdown } from "../db/index.js";
import type { MetricsPeriod, MetricsMetric } from "../db/metrics.js";
import { resolveTimeRange } from "../utils/time-range.js";
import type { DashboardPeriod } from "../utils/time-range.js";

const LegacyPeriodEnum = Type.Union([
  Type.Literal("1h"), Type.Literal("5h"), Type.Literal("6h"), Type.Literal("24h"),
  Type.Literal("7d"), Type.Literal("30d"),
]);
const DashboardPeriodEnum = Type.Union([
  Type.Literal("window"), Type.Literal("weekly"), Type.Literal("monthly"),
]);
const PeriodEnum = Type.Union([LegacyPeriodEnum, DashboardPeriodEnum]);

const MetricEnum = Type.Union([
  Type.Literal("ttft"), Type.Literal("tps"), Type.Literal("text_tps"),
  Type.Literal("thinking_tps"), Type.Literal("tool_use_tps"), Type.Literal("total_tps"),
  Type.Literal("tokens"), Type.Literal("cache_rate"), Type.Literal("request_count"),
  Type.Literal("input_tokens"), Type.Literal("output_tokens"),
  Type.Literal("cache_hit_tokens"),
]);

const SummaryQuerySchema = Type.Object({
  period: Type.Optional(PeriodEnum),
  provider_id: Type.Optional(Type.String()),
  backend_model: Type.Optional(Type.String()),
  router_key_id: Type.Optional(Type.String()),
  client_type: Type.Optional(Type.String()),
  start_time: Type.Optional(Type.String()),
  end_time: Type.Optional(Type.String()),
});

const TimeseriesQuerySchema = Type.Object({
  period: Type.Optional(PeriodEnum),
  metric: MetricEnum,
  provider_id: Type.Optional(Type.String()),
  backend_model: Type.Optional(Type.String()),
  router_key_id: Type.Optional(Type.String()),
  start_time: Type.Optional(Type.String()),
  end_time: Type.Optional(Type.String()),
});

const DASHBOARD_PERIODS = new Set(["window", "weekly", "monthly"]);

interface MetricsRoutesOptions {
  db: Database.Database;
}

function resolveMetricsTime(
  query: { period?: string; start_time?: string; end_time?: string },
  db: Database.Database,
  routerKeyId?: string,
  providerId?: string,
): { startTime?: string; endTime?: string; legacyPeriod: string } {
  if (query.start_time && query.end_time) {
    return { startTime: query.start_time, endTime: query.end_time, legacyPeriod: "30d" };
  }
  const period = query.period ?? "weekly";
  if (DASHBOARD_PERIODS.has(period)) {
    const range = resolveTimeRange(period as DashboardPeriod, db, routerKeyId, providerId);
    return { startTime: range.startTime, endTime: range.endTime, legacyPeriod: "5h" };
  }
  return { legacyPeriod: period };
}

export const adminMetricsRoutes: FastifyPluginCallback<MetricsRoutesOptions> = (app, options, done) => {
  const { db } = options;

  app.get("/admin/api/metrics/summary", { schema: { querystring: SummaryQuerySchema } }, async (request, reply) => {
    const query = request.query as Static<typeof SummaryQuerySchema>;
    const { startTime, endTime, legacyPeriod } = resolveMetricsTime(query, db, query.router_key_id, query.provider_id);
    const summary = getMetricsSummary(db, legacyPeriod as MetricsPeriod, query.provider_id, query.backend_model, query.router_key_id, startTime, endTime, query.client_type);
    const breakdown = getClientTypeBreakdown(db, legacyPeriod as MetricsPeriod, query.provider_id, query.backend_model, query.router_key_id, startTime, endTime);
    return reply.send({ rows: summary, client_type_breakdown: breakdown });
  });

  app.get("/admin/api/metrics/timeseries", { schema: { querystring: TimeseriesQuerySchema } }, async (request, reply) => {
    const query = request.query as Static<typeof TimeseriesQuerySchema>;
    const metric = query.metric as MetricsMetric;
    const { startTime, endTime, legacyPeriod } = resolveMetricsTime(query, db, query.router_key_id, query.provider_id);
    const timeseries = getMetricsTimeseries(db, legacyPeriod as MetricsPeriod, metric, query.provider_id, query.backend_model, query.router_key_id, startTime, endTime);
    return reply.send(timeseries);
  });

  done();
};
