import type { ServerResponse } from "node:http";
import { StatsAggregator } from "./stats-aggregator.js";
import { RuntimeCollector } from "./runtime-collector.js";
import { StreamContentAccumulator } from "./stream-content-accumulator.js";
import type { AdaptiveConcurrencyController } from "../proxy/adaptive-controller.js";
import type {
  ActiveRequest,
  AttemptSnapshot,
  ISemaphoreStatus,
  ProviderConcurrencySnapshot,
  RuntimeMetrics,
  StatsSnapshot,
} from "./types.js";

const RUNTIME_PUSH_TICK_INTERVAL = 2;
const RECENT_COMPLETED_MAX = 200;
const RECENT_TTL_MS = 5 * 60 * 1000; // eslint-disable-line no-magic-numbers
const ACTIVE_MAX_AGE_MS = 60 * 60 * 1000; // eslint-disable-line no-magic-numbers
const PUSH_INTERVAL_MS = 5000;
const STREAM_CONTENT_PUSH_MS = 500;

export interface TrackerLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export class RequestTracker {
  private activeMap = new Map<string, ActiveRequest>();
  private recentCompleted: ActiveRequest[] = [];
  private clients = new Set<ServerResponse>();
  private logger?: TrackerLogger;
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
  private streamAccumulators = new Map<string, StreamContentAccumulator>();
  private streamContentPending = new Set<string>();
  private streamContentTimer: ReturnType<typeof setTimeout> | null = null;

  /** Visible for testing */
  readonly statsAggregator: StatsAggregator;
  readonly runtimeCollector: RuntimeCollector;
  private readonly semaphoreManager?: ISemaphoreStatus;
  private adaptiveController?: AdaptiveConcurrencyController;

  constructor(deps?: {
    semaphoreManager?: ISemaphoreStatus;
    runtimeCollector?: RuntimeCollector;
    logger?: TrackerLogger;
  }) {
    this.semaphoreManager = deps?.semaphoreManager;
    this.runtimeCollector = deps?.runtimeCollector ?? new RuntimeCollector();
    this.statsAggregator = new StatsAggregator();
    this.logger = deps?.logger;
  }

  setAdaptiveController(ctrl: AdaptiveConcurrencyController): void {
    this.adaptiveController = ctrl;
  }

  // --- Core methods ---

  start(req: ActiveRequest): void {
    this.activeMap.set(req.id, { ...req });
    this.logger?.debug({ reqId: req.id, model: req.model, providerId: req.providerId, activeCount: this.activeMap.size }, "Tracker: start");
    this.broadcast("request_start", req);
  }

  /** 轻量级节流推送：流式内容变更后 500ms 内批量广播 */
  private scheduleStreamContentPush(id: string): void {
    this.streamContentPending.add(id);
    if (!this.streamContentTimer) {
      this.streamContentTimer = setTimeout(() => this.flushStreamContentPush(), STREAM_CONTENT_PUSH_MS);
    }
  }

  private flushStreamContentPush(): void {
    this.streamContentTimer = null;
    if (this.streamContentPending.size === 0) return;

    const updates: Array<{ id: string; streamContent: unknown; streamMetrics: unknown }> = [];
    for (const id of this.streamContentPending) {
      const req = this.activeMap.get(id);
      if (req) {
        updates.push({ id, streamContent: req.streamContent ?? null, streamMetrics: req.streamMetrics ?? null });
      }
    }
    this.streamContentPending.clear();

    if (updates.length > 0) {
      this.broadcast("stream_content_update", updates);
    }
  }

  update(id: string, patch: Partial<ActiveRequest>): void {
    const req = this.activeMap.get(id);
    if (!req) {
      this.logger?.warn({ reqId: id, patchKeys: Object.keys(patch) }, "Tracker: update called but request not in activeMap");
      return;
    }
    const prevQueued = req.queued;
    Object.assign(req, patch);
    this.logger?.debug({ reqId: id, patchQueued: patch.queued, prevQueued, activeCount: this.activeMap.size }, "Tracker: update");
    // queued 状态变化时立即广播，让前端即时看到排队/取消排队
    if (patch.queued !== undefined && patch.queued !== prevQueued) {
      this.broadcast("request_update", this.getActive());
    }
  }

  appendStreamChunk(
    id: string,
    rawLine: string,
    apiType: "openai" | "anthropic",
    maxRaw: number,
    maxText: number,
  ): void {
    const req = this.activeMap.get(id);
    if (!req) return;

    let acc = this.streamAccumulators.get(id);
    if (!acc) {
      acc = new StreamContentAccumulator(maxRaw, maxText);
      this.streamAccumulators.set(id, acc);
    }
    acc.append(rawLine, apiType);
    req.streamContent = acc.getSnapshot();
    this.scheduleStreamContentPush(id);
  }

  complete(
    id: string,
    result: { status: "completed" | "failed"; statusCode?: number; attempts?: AttemptSnapshot[] },
  ): void {
    const req = this.activeMap.get(id);
    if (!req) {
      this.logger?.warn({ reqId: id, result }, "Tracker: complete called but request not in activeMap");
      return;
    }

    const now = Date.now();
    const latency = now - req.startTime;
    const statusCode = result.statusCode ?? 0;

    this.statsAggregator.recordLatency(latency);
    this.statsAggregator.recordRequest(
      req.providerId,
      req.providerName,
      statusCode,
      req.retryCount > 0,
      false,
    );
    this.statsAggregator.recordProviderLatency(req.providerId, latency);

    const completed: ActiveRequest = {
      ...req,
      status: result.status,
      completedAt: now,
      attempts: result.attempts ?? req.attempts,
    };

    this.streamContentPending.delete(id);
    this.activeMap.delete(id);
    this.streamAccumulators.delete(id);
    this.recentCompleted.unshift(completed);
    if (this.recentCompleted.length > RECENT_COMPLETED_MAX) {
      this.recentCompleted.length = RECENT_COMPLETED_MAX;
    }

    this.logger?.debug({ reqId: id, status: result.status, statusCode, latency, activeCount: this.activeMap.size }, "Tracker: complete");
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

  /** Public alias for API endpoint use — returns full request data including clientRequest */
  getRequestById(id: string): ActiveRequest | undefined {
    return this.get(id);
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
      const adaptiveState = this.adaptiveController?.getStatus(providerId);
      result.push({
        providerId,
        providerName: config.name,
        maxConcurrency: config.maxConcurrency,
        active: status.active,
        queued: status.queued,
        queueTimeoutMs: config.queueTimeoutMs,
        maxQueueSize: config.maxQueueSize,
        adaptiveEnabled: adaptiveState !== undefined,
        adaptiveLimit: adaptiveState?.currentLimit,
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
    // 连接时立即推送当前活跃请求，让新客户端看到页面加载前已存在的请求
    this.sendInitialSnapshot(res);
    res.on("close", () => {
      this.clients.delete(res);
    });
  }

  /** 向单个客户端发送当前活跃请求快照（保留 clientRequest 以便前端即时展示） */
  private sendInitialSnapshot(res: ServerResponse): void {
    const active = this.getActive();
    const msg = `event: request_update\ndata: ${JSON.stringify(active)}\n\n`;
    try {
      if (!res.writableEnded) res.write(msg);
    } catch {
      this.clients.delete(res);
    }
  }

  removeClient(res: ServerResponse): void {
    this.clients.delete(res);
  }

  /** 主动关闭所有 SSE 客户端连接，确保 app.close() 不会因长连接阻塞 */
  closeAllClients(): void {
    const clients = [...this.clients];
    this.clients.clear();
    for (const client of clients) {
      try {
        if (!client.writableEnded) client.end();
      } catch {
        // 忽略已关闭的连接
      }
    }
  }

  // --- Push interval ---

  startPushInterval(): void {
    if (this.pushTimer) return;
    this.tickCount = 0;
    this.runtimeCollector.start();

    this.pushTimer = setInterval(() => {
      this.tickCount++;
      this.cleanupRecent();
      this.cleanupStaleActive();

      this.broadcast("request_update", this.getActive());
      this.broadcast("concurrency_update", this.getConcurrency());
      this.broadcast("stats_update", this.getStats());

      // Every 10s (every 2nd tick)
      if (this.tickCount % RUNTIME_PUSH_TICK_INTERVAL === 0) {
        this.broadcast("runtime_update", this.getRuntime());
      }
    }, PUSH_INTERVAL_MS);
  }

  stopPushInterval(): void {
    if (this.pushTimer) {
      clearInterval(this.pushTimer);
      this.pushTimer = null;
    }
    if (this.streamContentTimer) {
      clearTimeout(this.streamContentTimer);
      this.streamContentTimer = null;
    }
    this.streamContentPending.clear();
    this.runtimeCollector.stop();
  }

  broadcast(event: string, data: unknown): void {
    // request_update: 保留 clientRequest，前端 pending 请求需要即时展示内容
    // request_start: 无需处理，已是原始数据
    // request_complete: strip clientRequest（完成后从 DB 加载详情）
    let payload = data;
    if (event === "request_update" && Array.isArray(data)) {
      payload = data.map((req: ActiveRequest) => {
        const copy = { ...req };
        delete copy.clientRequest;
        return copy;
      });
    } else if ((event === "request_complete" || event === "request_start") && data && typeof data === "object") {
      const copy = { ...(data as ActiveRequest) };
      delete copy.clientRequest;
      payload = copy;
    }
    const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    const clientCount = this.clients.size;
    let sentCount = 0;
    for (const client of this.clients) {
      try {
        if (!client.writableEnded) {
          client.write(msg);
          sentCount++;
        }
      } catch {
        this.clients.delete(client);
      }
    }
    const summary = event === "request_update" ? `active=${(data as ActiveRequest[])?.length}`
      : event === "concurrency_update" ? (data as ProviderConcurrencySnapshot[])?.map(p => `${p.providerName}=${p.active}/${p.maxConcurrency}q${p.queued}`).join(",")
        : event === "request_start" ? `model=${(data as ActiveRequest)?.model}`
          : event === "request_complete" ? `model=${(data as ActiveRequest)?.model} status=${(data as ActiveRequest)?.status}`
            : "";
    this.logger?.debug({ event, clientCount, sentCount, summary }, "Tracker: SSE broadcast");
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

  /** 最终一致性兜底：清理异常残留的 active 条目 */
  private cleanupStaleActive(): void {
    const cutoff = Date.now() - ACTIVE_MAX_AGE_MS;
    for (const [id, req] of this.activeMap) {
      if (req.startTime < cutoff) {
        this.activeMap.delete(id);
      }
    }
  }
}
