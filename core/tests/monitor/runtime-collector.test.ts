import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RuntimeCollector } from "../../src/monitor/runtime-collector.js";
import type { RuntimeMetrics } from "../../src/monitor/types.js";

describe("RuntimeCollector", () => {
  let collector: RuntimeCollector;

  beforeEach(() => {
    collector = new RuntimeCollector();
  });

  afterEach(() => {
    collector.stop();
  });

  describe("collect", () => {
    it("returns RuntimeMetrics with correct structure", () => {
      const metrics: RuntimeMetrics = collector.collect();

      expect(metrics).toHaveProperty("uptimeMs");
      expect(metrics).toHaveProperty("memoryUsage");
      expect(metrics).toHaveProperty("activeHandles");
      expect(metrics).toHaveProperty("activeRequests");
      expect(metrics).toHaveProperty("eventLoopDelayMs");
    });

    it("uptimeMs > 0", () => {
      const metrics = collector.collect();
      expect(metrics.uptimeMs).toBeGreaterThan(0);
    });

    it("memoryUsage.rss > 0", () => {
      const metrics = collector.collect();
      expect(metrics.memoryUsage.rss).toBeGreaterThan(0);
    });

    it("activeHandles >= 0", () => {
      const metrics = collector.collect();
      expect(metrics.activeHandles).toBeGreaterThanOrEqual(0);
    });

    it("activeRequests >= 0", () => {
      const metrics = collector.collect();
      expect(metrics.activeRequests).toBeGreaterThanOrEqual(0);
    });

    it("eventLoopDelayMs is a number (0 if monitor not available)", () => {
      const metrics = collector.collect();
      expect(typeof metrics.eventLoopDelayMs).toBe("number");
      expect(metrics.eventLoopDelayMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("start / stop", () => {
    it("start() does not throw", () => {
      expect(() => collector.start()).not.toThrow();
    });

    it("stop() does not throw when not started", () => {
      expect(() => collector.stop()).not.toThrow();
    });

    it("start + stop round-trip does not throw", () => {
      collector.start();
      collector.stop();
      expect(() => collector.stop()).not.toThrow();
    });
  });
});
