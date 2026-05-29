/**
 * post_route hook: 从候选 target 列表中选取第一个非 excluded 的 target，
 * 查询 provider，校验 is_active。
 */
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import { PipelineAbort } from "../../pipeline/types.js";
import { getProviderById } from "../../../db/index.js";
import { HTTP_SERVICE_UNAVAILABLE } from "../../../core/constants.js";
import type { Target } from "../../../core/types.js";
import type Database from "better-sqlite3";

export const routeResolveHook: PipelineHook = {
  name: "builtin:route-resolve",
  phase: "post_route",
  priority: 0,
  core: true,
  execute(ctx: PipelineContext): void {
    // db: 优先从 setup deps，fallback 到 metadata（兼容测试）
    const db = ctx.deps?.setup?.db ?? ctx.metadata.get("db") as Database.Database | undefined;
    if (!db) return;
    // cachedTargets: 优先从 request deps，fallback 到 metadata
    const cachedTargets = ctx.deps?.request?.cachedTargets ?? ctx.metadata.get("cachedTargets") as Target[] ?? [];
    const excludeTargets = ctx.excludeTargets ?? ctx.metadata.get("excludeTargets") as Target[] ?? [];

    const available = cachedTargets.filter(
      (t) =>
        !excludeTargets.some(
          (e) =>
            e.provider_id === t.provider_id &&
            e.backend_model === t.backend_model,
        ),
    );

    if (available.length === 0) {
      const isAnthropic = ctx.apiType === "anthropic";
      const errorBody = isAnthropic
        ? {
          type: "error",
          error: {
            type: "api_error",
            message: `All failover targets exhausted (${excludeTargets.length} attempted)`,
          },
        }
        : {
          error: {
            message: `All failover targets exhausted (${excludeTargets.length} attempted)`,
            type: "server_error",
            code: "failover_limit_exceeded",
          },
        };
      throw new PipelineAbort(HTTP_SERVICE_UNAVAILABLE, errorBody);
    }

    const resolved = available[0];
    const provider = getProviderById(db, resolved.provider_id);
    if (!provider || !provider.is_active) {
      const errorBody =
        ctx.apiType === "anthropic"
          ? {
            type: "error",
            error: {
              type: "api_error",
              message: `Provider '${resolved.provider_id}' unavailable`,
            },
          }
          : {
            error: {
              message: `Provider '${resolved.provider_id}' unavailable`,
              type: "server_error",
              code: "provider_unavailable",
            },
          };
      throw new PipelineAbort(HTTP_SERVICE_UNAVAILABLE, errorBody);
    }

    ctx.resolved = resolved;
    ctx.provider = provider;
    ctx.body = { ...ctx.body, model: resolved.backend_model };
  },
};
