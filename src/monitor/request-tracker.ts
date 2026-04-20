import type { ServerResponse } from "node:http";
import { StatsAggregator } from "./stats-aggregator.js";
import { RuntimeCollector } from "./runtime-collector.js";
import type { ProviderSemaphoreManager } from "../proxy/semaphore.js";
import type {
  ActiveRequest,
  ProviderConcurrencySnapshot,
  RuntimeMetrics,
  StatsSnapshot,
} from "./types.js";

const RECENT_COMPLETED_MAX = 200;
const RECENT_TTL_MS = 5 * 60 * 1000;
const PUSH_INTERVAL_MS = 5000;

export class RequestTracker {
  private activeMap = new Map<string, ActiveRequest>();
  private recentCompleted: ActiveRequest[] = [];
  private clients = new Set<ServerResponse>();
  private providerConfigCache = new Map<
    string,
    {
      name: string;
      maxConcurrency: number;
      queueTimeoutMs: number;
      maxQueueSize: number;
    }
  >();
  private pushTimer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;

  /** Visible for testing */
  readonly statsAggregator: StatsAggregator;
  readonly runtimeCollector: RuntimeCollector;
  private readonly semaphoreManager?: ProviderSemaphoreManager;

  constructor(deps?: {
    semaphoreManager?: ProviderSemaphoreManager;
    runtimeCollector?: RuntimeCollector;
  }) {
    this.semaphoreManager = deps?.semaphoreManager;
    this.runtimeCollector = deps?.runtimeCollector ?? new RuntimeCollector();
    this.statsAggregator = new StatsAggregator();
  }

  // --- Core methods ---

  start(req: ActiveRequest): void {
    this.activeMap.set(req.id, { ...req });
    this.broadcast("request_start", req);
  }

  update(id: string, patch: Partial<ActiveRequest>): void {
    const req = this.activeMap.get(id);
    if (!req) return;
    Object.assign(req, patch);
  }

  complete(
    id: string,
    result: { status: "completed" | "failed"; statusCode?: number },
  ): void {
    const req = this.activeMap.get(id);
    if (!req) return;

    const now = Date.now();
    const latency = now - req.startTime;
    const statusCode = result.statusCode ?? 0;

    this.statsAggregator.recordLatency(latency);
    this.statsAggregator.recordRequest(
      req.providerId,
      statusCode,
      req.retryCount > 0,
      false,
    );
    this.statsAggregator.recordProviderLatency(req.providerId, latency);

    const completed: ActiveRequest = {
      ...req,
      status: result.status,
      completedAt: now,
    };

    this.activeMap.delete(id);
    this.recentCompleted.unshift(completed);
    if (this.recentCompleted.length > RECENT_COMPLETED_MAX) {
      this.recentCompleted.length = RECENT_COMPLETED_MAX;
    }

    this.broadcast("request_complete", completed);
  }

  // --- Query methods ---

  getActive(): ActiveRequest[] {
    const result: ActiveRequest[] = [];
    for (const req of this.activeMap.values()) {
      if (req.status === "pending") result.push(req);
    }
    return result;
  }

  getRecent(limit?: number): ActiveRequest[] {
    const list = limit != null ? this.recentCompleted.slice(0, limit) : this.recentCompleted;
    return list;
  }

  get(id: string): ActiveRequest | undefined {
    return this.activeMap.get(id) ?? this.recentCompleted.find((r) => r.id === id);
  }

  // --- Stats / monitoring ---

  getStats(): StatsSnapshot {
    return this.statsAggregator.getStats();
  }

  getConcurrency(): ProviderConcurrencySnapshot[] {
    if (!this.semaphoreManager) return [];

    const result: ProviderConcurrencySnapshot[] = [];
    for (const [providerId, config] of this.providerConfigCache) {
      const status = this.semaphoreManager.getStatus(providerId);
      result.push({
        providerId,
        providerName: config.name,
        maxConcurrency: config.maxConcurrency,
        active: status.active,
        queued: status.queued,
        queueTimeoutMs: config.queueTimeoutMs,
        maxQueueSize: config.maxQueueSize,
      });
    }
    return result;
  }

  getRuntime(): RuntimeMetrics {
    return this.runtimeCollector.collect();
  }

  // --- SSE client management ---

  addClient(res: ServerResponse): void {
    this.clients.add(res);
    res.on("close", () => {
      this.clients.delete(res);
    });
  }

  removeClient(res: ServerResponse): void {
    this.clients.delete(res);
  }

  // --- Push interval ---

  startPushInterval(): void {
    if (this.pushTimer) return;
    this.tickCount = 0;

    this.pushTimer = setInterval(() => {
      this.tickCount++;
      this.cleanupRecent();

      this.broadcast("request_update", this.getActive());
      this.broadcast("concurrency_update", this.getConcurrency());
      this.broadcast("stats_update", this.getStats());

      // Every 10s (every 2nd tick)
      if (this.tickCount % 2 === 0) {
        this.broadcast("runtime_update", this.getRuntime());
      }
    }, PUSH_INTERVAL_MS);
  }

  stopPushInterval(): void {
    if (this.pushTimer) {
      clearInterval(this.pushTimer);
      this.pushTimer = null;
    }
  }

  broadcast(event: string, data: unknown): void {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        if (!client.writableEnded) client.write(msg);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  // --- Provider config cache ---

  updateProviderConfig(
    providerId: string,
    config: {
      name: string;
      maxConcurrency: number;
      queueTimeoutMs: number;
      maxQueueSize: number;
    },
  ): void {
    this.providerConfigCache.set(providerId, config);
  }

  removeProviderConfig(providerId: string): void {
    this.providerConfigCache.delete(providerId);
  }

  // --- Internal ---

  private cleanupRecent(): void {
    const cutoff = Date.now() - RECENT_TTL_MS;
    // recentCompleted is sorted desc by completedAt, so we find the cutoff index
    let i = 0;
    for (; i < this.recentCompleted.length; i++) {
      if (
        this.recentCompleted[i].completedAt != null &&
        this.recentCompleted[i].completedAt! < cutoff
      ) {
        break;
      }
    }
    this.recentCompleted = this.recentCompleted.slice(
      0,
      Math.min(i, RECENT_COMPLETED_MAX),
    );
  }
}
