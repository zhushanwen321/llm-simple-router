import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { Type, Static } from "@sinclair/typebox";
import { getMetricsSummary, getMetricsTimeseries } from "../db/index.js";
import type { MetricsPeriod, MetricsMetric } from "../db/metrics.js";

const PeriodEnum = Type.Union([
  Type.Literal("1h"), Type.Literal("6h"), Type.Literal("24h"),
  Type.Literal("7d"), Type.Literal("30d"),
]);

const MetricEnum = Type.Union([
  Type.Literal("ttft"), Type.Literal("tps"), Type.Literal("tokens"),
  Type.Literal("cache_rate"), Type.Literal("request_count"),
  Type.Literal("input_tokens"), Type.Literal("output_tokens"),
  Type.Literal("cache_hit_tokens"),
]);

const SummaryQuerySchema = Type.Object({
  period: Type.Optional(PeriodEnum),
  provider_id: Type.Optional(Type.String()),
  backend_model: Type.Optional(Type.String()),
  router_key_id: Type.Optional(Type.String()),
});

const TimeseriesQuerySchema = Type.Object({
  period: Type.Optional(PeriodEnum),
  metric: MetricEnum,
  provider_id: Type.Optional(Type.String()),
  backend_model: Type.Optional(Type.String()),
  router_key_id: Type.Optional(Type.String()),
});

interface MetricsRoutesOptions {
  db: Database.Database;
}

export const adminMetricsRoutes: FastifyPluginCallback<MetricsRoutesOptions> = (app, options, done) => {
  app.get("/admin/api/metrics/summary", { schema: { querystring: SummaryQuerySchema } }, async (request, reply) => {
    const query = request.query as Static<typeof SummaryQuerySchema>;
    const period = (query.period ?? "24h") as MetricsPeriod;
    const summary = getMetricsSummary(options.db, period, query.provider_id, query.backend_model, query.router_key_id);
    return reply.send(summary);
  });

  app.get("/admin/api/metrics/timeseries", { schema: { querystring: TimeseriesQuerySchema } }, async (request, reply) => {
    const query = request.query as Static<typeof TimeseriesQuerySchema>;
    const period = (query.period ?? "24h") as MetricsPeriod;
    const metric = query.metric as MetricsMetric;
    const timeseries = getMetricsTimeseries(options.db, period, metric, query.provider_id, query.backend_model, query.router_key_id);
    return reply.send(timeseries);
  });

  done();
};
