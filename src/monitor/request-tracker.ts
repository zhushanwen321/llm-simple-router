import type { ServerResponse } from "node:http";
import { StatsAggregator } from "./stats-aggregator.js";
import { RuntimeCollector } from "./runtime-collector.js";
import type { ProviderSemaphoreManager } from "../proxy/semaphore.js";
import type {
  ActiveRequest,
  ContentBlock,
  ProviderConcurrencySnapshot,
  RuntimeMetrics,
  StatsSnapshot,
} from "./types.js";

// --- Stream content extraction ---

interface StreamExtraction {
  text: string
  block?: { index: number; type: ContentBlock['type']; content: string; name?: string } | null
}

function extractStreamText(line: string, apiType: "openai" | "anthropic"): StreamExtraction {
  const empty: StreamExtraction = { text: '', block: null }
  if (!line.startsWith(SSE_DATA_PREFIX)) return empty
  const jsonStr = line.slice(SSE_DATA_PREFIX.length)
  if (jsonStr === '[DONE]') return empty
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(jsonStr) as Record<string, unknown>
  } catch {
    return empty
  }

  if (apiType === 'openai') {
    const choices = obj.choices as Array<Record<string, unknown>> | undefined
    const delta = choices?.[0]?.delta as Record<string, unknown> | undefined
    const text = (delta?.content as string) ?? ''
    return { text, block: text ? { index: 0, type: 'text', content: text } : null }
  }

  // Anthropic
  const type = obj.type as string | undefined
  const index = obj.index as number | undefined
  const delta = obj.delta as Record<string, unknown> | undefined

  if (type === 'content_block_start') {
    const contentBlock = obj.content_block as Record<string, unknown> | undefined
    const blockType = contentBlock?.type as string | undefined
    const name = blockType === 'tool_use' ? (contentBlock?.name as string | undefined) : undefined
    if (blockType === 'thinking' || blockType === 'text' || blockType === 'tool_use') {
      return { text: '', block: { index: index ?? 0, type: blockType, content: '', name } }
    }
    return empty
  }

  if (type === 'content_block_delta' && delta) {
    const deltaType = delta.type as string | undefined
    if (deltaType === 'thinking_delta') {
      const thinking = (delta.thinking as string) ?? ''
      return { text: '', block: { index: index ?? 0, type: 'thinking', content: thinking } }
    }
    if (deltaType === 'text_delta') {
      const text = (delta.text as string) ?? ''
      return { text, block: { index: index ?? 0, type: 'text', content: text } }
    }
    if (deltaType === 'input_json_delta') {
      const partialJson = (delta.partial_json as string) ?? ''
      return { text: '', block: { index: index ?? 0, type: 'tool_use', content: partialJson } }
    }
  }

  return empty
}

const SSE_DATA_PREFIX = "data: ";
const RUNTIME_PUSH_TICK_INTERVAL = 2;
const RECENT_COMPLETED_MAX = 200;
const RECENT_TTL_MS = 5 * 60 * 1000; // eslint-disable-line no-magic-numbers
const ACTIVE_MAX_AGE_MS = 60 * 60 * 1000; // eslint-disable-line no-magic-numbers
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
    const prevQueued = req.queued;
    Object.assign(req, patch);
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

    if (!req.streamContent) {
      req.streamContent = { rawChunks: "", textContent: "", totalChars: 0, blocks: [] }
    }

    const sc = req.streamContent;
    sc.totalChars += rawLine.length;

    // 环形缓冲区：超过限制时截断保留尾部
    sc.rawChunks += rawLine + "\n";
    if (sc.rawChunks.length > maxRaw) {
      sc.rawChunks = sc.rawChunks.slice(-maxRaw);
    }

    // 初始化 blocks 数组
    if (!sc.blocks) {
      sc.blocks = []
    }

    const extracted = extractStreamText(rawLine, apiType)

    // 拼接纯文本（text 和 text_delta）
    if (extracted.text) {
      sc.textContent += extracted.text
      if (sc.textContent.length > maxText) {
        sc.textContent = sc.textContent.slice(-maxText)
      }
    }

    // 维护结构化内容块
    if (extracted.block) {
      const { index, type, content, name } = extracted.block
      while (sc.blocks.length <= index) {
        sc.blocks.push({ type: 'text', content: '' })
      }
      if (name) {
        sc.blocks[index].name = name
      }
      if (content === '' && type !== 'text') {
        sc.blocks[index].type = type
      } else if (content) {
        sc.blocks[index].content += content
        sc.blocks[index].type = type
      }
      const MAX_BLOCK_CONTENT = maxText
      for (const block of sc.blocks) {
        if (block.content.length > MAX_BLOCK_CONTENT) {
          block.content = block.content.slice(-MAX_BLOCK_CONTENT)
        }
      }
    }
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
