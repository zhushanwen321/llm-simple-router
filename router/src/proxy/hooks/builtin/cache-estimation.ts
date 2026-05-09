/**
 * post_response hook: 缓存命中估算。
 *
 * 在上游响应返回后执行（priority 200），先于 request-logging（priority 900）。
 *
 * 逻辑：
 * - 读取 settings token_estimation_enabled，关闭则跳过
 * - 检查 ctx.metadata 中的 session_id 和 client_type
 * - 如果 transport 已报告 cache_read_tokens（API 原生支持）：
 *   → 仅更新 CacheEstimator 历史记录，不估算
 * - 如果 transport 未报告 cache_read_tokens：
 *   → 调用 cacheEstimator.estimateHit() 做 token 级前缀匹配估算
 *   → 结果写入 ctx.metadata.cache_read_tokens_estimated
 *
 * collectTransportMetrics 在 request-logging hook 中读取此 metadata 写入 DB。
 *
 * 依赖：cacheEstimator（token 级前缀匹配）、getTokenEstimationEnabled（DB settings）
 */
import Database from "better-sqlite3";
import { cacheEstimator } from "../../../routing/cache-estimator.js";
import { getTokenEstimationEnabled } from "../../../db/settings.js";
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";

export const cacheEstimationHook: PipelineHook = {
  name: "builtin:cache-estimation",
  phase: "post_response",
  priority: 200,
  execute(ctx: PipelineContext): void {
    const db = ctx.metadata.get("db") as Database.Database;
    if (!db) return;

    // 开关控制
    if (!getTokenEstimationEnabled(db)) return;

    // 无 session_id 无意义（缓存命中以 session 为键）
    const sessionId = ctx.metadata.get("session_id") as string | undefined;
    if (!sessionId) return;

    // 检查 transport 是否已从上游 API 提取了 cache_read_tokens
    let cacheReadTokens = 0;
    const tr = ctx.transportResult;
    if (tr) {
      if (tr.kind === "stream_success" || tr.kind === "stream_abort") {
        cacheReadTokens = tr.metrics?.cache_read_tokens ?? 0;
      }
    }

    if (cacheReadTokens > 0) {
      // API 原生报告了缓存命中，只更新历史
      cacheEstimator.update(sessionId, ctx.clientModel, ctx.rawBody);
      ctx.metadata.set("cache_read_tokens_estimated", 0);
    } else {
      // API 未报告缓存，估算并写入 metadata
      const estimated = cacheEstimator.estimateHit(sessionId, ctx.clientModel, ctx.rawBody);
      ctx.metadata.set("cache_read_tokens_estimated", estimated ?? 0);
    }
  },
};
