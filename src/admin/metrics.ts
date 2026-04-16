import { FastifyPluginCallback } from "fastify";
import Database from "better-sqlite3";
import { getMetricsSummary, getMetricsTimeseries } from "../db/index.js";
import { HTTP_BAD_REQUEST } from "./constants.js";

type MetricsPeriod = "1h" | "6h" | "24h" | "7d" | "30d";
type MetricsMetric = "ttft" | "tps" | "tokens" | "cache_rate" | "request_count" | "input_tokens" | "output_tokens" | "cache_hit_tokens";

const VALID_PERIODS: Set<string> = new Set(["1h", "6h", "24h", "7d", "30d"]);
const VALID_METRICS: Set<string> = new Set(["ttft", "tps", "tokens", "cache_rate", "request_count", "input_tokens", "output_tokens", "cache_hit_tokens"]);

interface MetricsRoutesOptions {
  db: Database.Database;
}

export const adminMetricsRoutes: FastifyPluginCallback<MetricsRoutesOptions> = (app, options, done) => {
  app.get("/admin/api/metrics/summary", async (request, reply) => {
    const query = request.query as {
      period?: string;
      provider_id?: string;
      backend_model?: string;
      router_key_id?: string;
    };

    const period = (query.period ?? "24h") as MetricsPeriod;
    if (!VALID_PERIODS.has(period)) {
      return reply.status(HTTP_BAD_REQUEST).send({ error: { message: `Invalid period: ${period}. Must be one of: 1h, 6h, 24h, 7d, 30d` } });
    }

    const summary = getMetricsSummary(options.db, period, query.provider_id, query.backend_model, query.router_key_id);
    return reply.send(summary);
  });

  app.get("/admin/api/metrics/timeseries", async (request, reply) => {
    const query = request.query as {
      period?: string;
      metric?: string;
      provider_id?: string;
      backend_model?: string;
      router_key_id?: string;
    };

    const period = (query.period ?? "24h") as MetricsPeriod;
    if (!VALID_PERIODS.has(period)) {
      return reply.status(HTTP_BAD_REQUEST).send({ error: { message: `Invalid period: ${period}. Must be one of: 1h, 6h, 24h, 7d, 30d` } });
    }

    const metric = query.metric as MetricsMetric;
    if (!metric || !VALID_METRICS.has(metric)) {
      return reply.status(HTTP_BAD_REQUEST).send({ error: { message: `Invalid or missing metric. Must be one of: ttft, tps, tokens, cache_rate, request_count` } });
    }

    const timeseries = getMetricsTimeseries(options.db, period, metric, query.provider_id, query.backend_model, query.router_key_id);
    return reply.send(timeseries);
  });

  done();
};
