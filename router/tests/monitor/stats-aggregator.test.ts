import { describe, it, expect, beforeEach } from "vitest";
import { StatsAggregator } from "../../src/monitor/stats-aggregator.js";
import type { StatsSnapshot } from "../../src/monitor/types.js";

describe("StatsAggregator", () => {
  let agg: StatsAggregator;

  beforeEach(() => {
    agg = new StatsAggregator();
  });

  describe("recordLatency", () => {
    it("records latency values to ring buffer", () => {
      agg.recordLatency(100);
      agg.recordLatency(200);
      agg.recordLatency(300);

      const stats = agg.getStats();
      expect(stats.avgLatencyMs).toBeCloseTo(200, 1);
      expect(stats.p50LatencyMs).toBe(200);
    });

    it("ring buffer wraps around when full", () => {
      const smallAgg = new StatsAggregator(5);
      // Fill with 100s
      for (let i = 0; i < 5; i++) smallAgg.recordLatency(100);
      // Overwrite with 200s
      for (let i = 0; i < 5; i++) smallAgg.recordLatency(200);

      const stats = smallAgg.getStats();
      // Only the last 5 values (200s) should remain
      expect(stats.avgLatencyMs).toBeCloseTo(200, 1);
      expect(stats.p50LatencyMs).toBe(200);
    });
  });

  describe("getStats", () => {
    it("returns empty StatsSnapshot when no data", () => {
      const stats = agg.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.avgLatencyMs).toBe(0);
      expect(stats.p50LatencyMs).toBe(0);
      expect(stats.p99LatencyMs).toBe(0);
      expect(stats.retryCount).toBe(0);
      expect(stats.failoverCount).toBe(0);
      expect(Object.keys(stats.byProvider)).toHaveLength(0);
      expect(Object.keys(stats.byStatusCode)).toHaveLength(0);
    });

    it("computes p50 and p99 from ring buffer", () => {
      // Insert 100 values: 1..100
      for (let i = 1; i <= 100; i++) agg.recordLatency(i);

      const stats = agg.getStats();
      // p50 of 1..100 = 50, p99 of 1..100 = 99
      expect(stats.p50LatencyMs).toBe(50);
      expect(stats.p99LatencyMs).toBe(99);
    });

    it("computes avgLatencyMs from ring buffer", () => {
      agg.recordLatency(100);
      agg.recordLatency(200);
      agg.recordLatency(300);

      const stats = agg.getStats();
      expect(stats.avgLatencyMs).toBeCloseTo(200, 1);
    });
  });

  describe("recordRequest", () => {
    it("counts totalRequests, success and error by statusCode", () => {
      agg.recordRequest("p1", "Provider1", 200, false, false);
      agg.recordRequest("p1", "Provider1", 200, false, false);
      agg.recordRequest("p1", "Provider1", 500, false, false);
      agg.recordRequest("p2", "Provider2", 200, false, false);

      const stats = agg.getStats();
      expect(stats.totalRequests).toBe(4);
      expect(stats.successCount).toBe(3);
      expect(stats.errorCount).toBe(1);
      expect(stats.byStatusCode[200]).toBe(3);
      expect(stats.byStatusCode[500]).toBe(1);
    });

    it("counts retries and failovers", () => {
      agg.recordRequest("p1", "Provider1", 200, true, false);
      agg.recordRequest("p1", "Provider1", 200, false, true);
      agg.recordRequest("p1", "Provider1", 200, true, true);

      const stats = agg.getStats();
      expect(stats.retryCount).toBe(2);
      expect(stats.failoverCount).toBe(2);
    });

    it("builds byProvider with per-provider stats", () => {
      agg.recordLatency(100);
      agg.recordLatency(200);
      agg.recordRequest("p1", "Provider1", 200, false, false);
      agg.recordRequest("p1", "Provider1", 500, false, false);
      agg.recordRequest("p2", "Provider2", 200, false, false);

      const stats = agg.getStats();
      expect(stats.byProvider["p1"].totalRequests).toBe(2);
      expect(stats.byProvider["p1"].providerName).toBe("Provider1");
      expect(stats.byProvider["p1"].successCount).toBe(1);
      expect(stats.byProvider["p1"].errorCount).toBe(1);
      expect(stats.byProvider["p2"].totalRequests).toBe(1);
      expect(stats.byProvider["p2"].providerName).toBe("Provider2");
      expect(stats.byProvider["p2"].successCount).toBe(1);
    });

    it("computes per-provider avgLatencyMs", () => {
      agg.recordRequest("p1", "Provider1", 200, false, false);
      agg.recordProviderLatency("p1", 100);
      agg.recordRequest("p1", "Provider1", 200, false, false);
      agg.recordProviderLatency("p1", 300);

      const stats = agg.getStats();
      expect(stats.byProvider["p1"].avgLatencyMs).toBeCloseTo(200, 1);
    });

    it("tracks topErrors per provider", () => {
      for (let i = 0; i < 5; i++) agg.recordRequest("p1", "Provider1", 500, false, false);
      for (let i = 0; i < 3; i++) agg.recordRequest("p1", "Provider1", 429, false, false);
      agg.recordRequest("p1", "Provider1", 503, false, false);

      const stats = agg.getStats();
      const errors = stats.byProvider["p1"].topErrors;
      expect(errors[0]).toEqual({ code: 500, count: 5 });
      expect(errors[1]).toEqual({ code: 429, count: 3 });
      expect(errors[2]).toEqual({ code: 503, count: 1 });
    });

    it("limits topErrors to top 5", () => {
      // 6 different error codes
      for (let code = 400; code < 406; code++) {
        // Higher codes get more occurrences
        agg.recordRequest("p1", "Provider1", code, false, false);
      }
      agg.recordRequest("p1", "Provider1", 405, false, false);

      const stats = agg.getStats();
      expect(stats.byProvider["p1"].topErrors.length).toBeLessThanOrEqual(5);
    });

    it("counts per-provider retryCount", () => {
      agg.recordRequest("p1", "Provider1", 200, true, false);
      agg.recordRequest("p1", "Provider1", 200, true, false);
      agg.recordRequest("p1", "Provider1", 200, false, false);

      const stats = agg.getStats();
      expect(stats.byProvider["p1"].retryCount).toBe(2);
    });
  });

  describe("reset", () => {
    it("clears all data", () => {
      agg.recordLatency(100);
      agg.recordRequest("p1", "Provider1", 200, false, false);
      agg.recordRequest("p1", "Provider1", 500, true, false);

      agg.reset();

      const stats = agg.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.avgLatencyMs).toBe(0);
      expect(stats.p50LatencyMs).toBe(0);
      expect(Object.keys(stats.byProvider)).toHaveLength(0);
      expect(Object.keys(stats.byStatusCode)).toHaveLength(0);
    });
  });
});
