// router/src/proxy/pipeline/types.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import type { PipelineSnapshot } from "../pipeline-snapshot.js";
import type { Target, TransportResult, MappingReason, ResolveResult, ConcurrencyOverride } from "../../core/types.js";
import type { RawHeaders } from "../../core/types.js";
import type { ResilienceResult } from "../orchestration/resilience.js";
import type { ServiceContainer } from "../../core/container.js";
import type { FormatAdapter } from "../format/types.js";
import type { ProxyOrchestrator } from "../orchestration/orchestrator.js";
import type { RetryRuleMatcher } from "../orchestration/retry-rules.js";
import type { RequestTracker } from "../../core/monitor/index.js";
import type { LogFileWriter } from "../../storage/log-file-writer.js";
import type { ProxyErrorFormatter } from "../proxy-core.js";
import type { UsageWindowTracker } from "../routing/usage-window-tracker.js";
import type { ProxyAgentFactory } from "../transport/proxy-agent.js";

/** Hook 挂载阶段 */
export type HookPhase =
  | "pre_route"
  | "post_route"
  | "pre_transport"
  | "post_response"
  | "on_error"
  | "on_stream_event";

/** Pipeline 钩子 — 内置 hook 和外部插件共用此接口 */
export interface PipelineHook {
  /** 全局唯一名称 */
  name: string;
  /** 挂载阶段 */
  phase: HookPhase;
  /** 优先级（0-99 基础设施, 100-199 内置功能, 200-299 外部插件, 900-999 观察者） */
  priority: number;
  /** 核心骨架 hook 标记。true = 异常不可降级，直接传播 */
  core?: boolean;
  /** 钩子逻辑 */
  execute(ctx: PipelineContext): void | Promise<void>;
}

/** 管道中止信号 */
export class PipelineAbort extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: unknown,
  ) {
    super("Pipeline aborted");
  }
}

/** Provider 信息（简化，避免直接耦合 DB 行类型） */
export interface ProviderInfo {
  id: string;
  name: string;
  base_url: string;
  api_type: string;
  is_active: number;
  api_key: string;
  models: string;
  upstream_path: string | null;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
  adaptive_enabled: number;
  created_at: string;
}

/**
 * PipelineDeps — 固定依赖集合（L1→L2 通道注入）。
 * 所有字段可选，允许逐步填充（先创建空对象，再由 failover-loop 设置）。
 */
export interface PipelineDeps {
  db?: Database.Database;
  container?: ServiceContainer;
  cachedTargets?: Target[];
  overflowIndices?: Set<number>;
  resolveResult?: ResolveResult;
  precomputeSnapshot?: PipelineSnapshot;
  decryptedApiKeys?: Map<string, string>;
  enhancementConfig?: {
    tool_call_loop_enabled: boolean;
    stream_loop_enabled: boolean;
    tool_round_limit_enabled: boolean;
    tool_error_logging_enabled: boolean;
  };
  adapter?: FormatAdapter;
  orchestrator?: ProxyOrchestrator;
  matcher?: RetryRuleMatcher;
  tracker?: RequestTracker;
  defaultUpstreamPath?: string;
  clientHeaders?: RawHeaders;
  precomputedClientReq?: string;
  retryBaseDelayMs?: number;
  concurrencyOverride?: ConcurrencyOverride | null;
  logFileWriter?: LogFileWriter | null;
  errors?: ProxyErrorFormatter;
  usageWindowTracker?: UsageWindowTracker;
  proxyAgentFactory?: ProxyAgentFactory;
}

/**
 * PipelineMetaMap — 非固定依赖的元数据键值映射（保持 Map<string, unknown> 兼容）。
 *
 * 常见键名（非固定，由 hook 动态设置）：
 * - "session_id" — 当前请求的会话 ID
 * - "client_type" — 客户端类型标识
 * - "errorInfo" — 错误信息（{ statusCode: number; errorMessage: string; providerId?: string }）
 * - "pendingToolErrors" — 待处理的工具执行错误
 */
export type PipelineMetaMap = Map<string, unknown>;

/** 贯穿管道的上下文 */
export interface PipelineContext {
  // 不可变
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly rawBody: Record<string, unknown>;
  readonly clientModel: string;
  readonly apiType: string;

  // 可变
  body: Record<string, unknown>;
  isStream: boolean;
  resolved: Target | null;
  provider: ProviderInfo | null;
  effectiveUpstreamPath: string;
  effectiveApiType: string;
  injectedHeaders: Record<string, string>;
  metadata: PipelineMetaMap;
  logId: string;
  rootLogId: string | null;
  transportResult: TransportResult | null;
  resilienceResult: ResilienceResult | null;
  clientRequest: string;
  upstreamRequest: string;
  snapshot: PipelineSnapshot;

  // L1→L2 通道（固定依赖，由 PipelineDeps 定义）
  deps?: PipelineDeps;

  // 迭代级字段（每次 failover 迭代重置）
  excludeTargets?: Target[];
  mappingReason?: MappingReason;
  isFailoverIteration?: boolean;
  iterationStartTime?: number;
  lastFailoverTrigger?: string | null;
}
