import { performance } from "node:perf_hooks";
import type { RuntimeMetrics } from "./types.js";

const MS_PER_SECOND = 1000;
const NS_PER_MS = 1e6;

export class RuntimeCollector {
  private histogram?: { enable(): void; disable(): void; mean: number };

  /** Start monitoring the event loop delay histogram */
  start(): void {
    if (this.histogram) return;
    if (typeof performance.monitorEventLoopDelay !== "function") return;
    this.histogram = performance.monitorEventLoopDelay({ resolution: 1 });
    this.histogram.enable();
  }

  /** Stop monitoring and disable the histogram */
  stop(): void {
    if (this.histogram) {
      this.histogram.disable();
      this.histogram = undefined;
    }
  }

  /** Collect a single runtime metrics snapshot */
  collect(): RuntimeMetrics {
    return {
      uptimeMs: process.uptime() * MS_PER_SECOND,
      memoryUsage: process.memoryUsage(),
      activeHandles: process._getActiveHandles().length,
      activeRequests: process._getActiveRequests().length,
      eventLoopDelayMs: this.getEventLoopDelayMs(),
    };
  }

  private getEventLoopDelayMs(): number {
    if (!this.histogram) {
      return 0;
    }
    // mean is in nanoseconds; convert to milliseconds
    return this.histogram.mean / NS_PER_MS;
  }
}
