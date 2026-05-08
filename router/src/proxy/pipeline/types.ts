// router/src/proxy/pipeline/types.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PipelineSnapshot } from "../pipeline-snapshot.js";
import type { Target } from "../../core/types.js";

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
  adaptive_enabled: boolean;
  created_at: string;
}

/** 贯穿管道的上下文 */
export interface PipelineContext {
  // 不可变
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly rawBody: Record<string, unknown>;
  readonly clientModel: string;
  readonly apiType: string;
  readonly sessionId: string | undefined;

  // 可变
  body: Record<string, unknown>;
  isStream: boolean;
  resolved: Target | null;
  provider: ProviderInfo | null;
  effectiveUpstreamPath: string;
  effectiveApiType: string;
  injectedHeaders: Record<string, string>;
  metadata: Map<string, unknown>;
  logId: string;
  rootLogId: string | null;
  clientRequest: string;
  upstreamRequest: string;
  snapshot: PipelineSnapshot;
}
