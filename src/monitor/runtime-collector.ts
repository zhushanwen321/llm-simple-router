import { performance } from "node:perf_hooks";
import { MS_PER_SECOND } from "../core/constants.js";
import type { RuntimeMetrics } from "./types.js";
const NS_PER_MS = 1e6;

// Node.js 内部 API，无正式类型声明
type EventLoopHistogram = { enable(): void; disable(): void; mean: number };
const perf = performance as unknown as Performance & {
  monitorEventLoopDelay?(opts?: { resolution?: number }): EventLoopHistogram;
};
const proc = process as NodeJS.Process & {
  _getActiveHandles(): object[];
  _getActiveRequests(): object[];
};

export class RuntimeCollector {
  private histogram?: { enable(): void; disable(): void; mean: number };

  /** Start monitoring the event loop delay histogram */
  start(): void {
    if (this.histogram) return;
    if (typeof perf.monitorEventLoopDelay !== "function") return;
    this.histogram = perf.monitorEventLoopDelay({ resolution: 1 });
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
      activeHandles: proc._getActiveHandles().length,
      activeRequests: proc._getActiveRequests().length,
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
