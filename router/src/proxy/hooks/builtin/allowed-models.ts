/**
 * post_route hook: 检查客户端密钥的 allowed_models 白名单。
 *
 * 路由解析完成后，检查 routerKey.allowed_models 是否包含 resolved.backend_model。
 * 不在白名单中时抛出 PipelineAbort (403)。
 *
 * 仅在首次迭代（非 failover）时执行检查。
 *
 * 依赖：ctx.metadata 中需设置 "errors" (ProxyErrorFormatter)
 */
import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";
import { PipelineAbort } from "../../pipeline/types.js";
import { HTTP_FORBIDDEN } from "../../../core/constants.js";

export const allowedModelsHook: PipelineHook = {
  name: "builtin:allowed-models",
  phase: "post_route",
  priority: 50,
  execute(ctx: PipelineContext): void {
    const { request, resolved } = ctx;
    if (!resolved) return;

    // 仅首次迭代检查
    const isFailoverIteration = ctx.rootLogId !== null && ctx.rootLogId !== ctx.logId;
    if (isFailoverIteration) return;

    // allowed_models 已由 auth 中间件预解析为 string[] | null
    const allowedModels = request.routerKey?.allowed_models;
    if (!allowedModels || allowedModels.length === 0) return;

    if (!allowedModels.includes(resolved.backend_model)) {
      const errors = ctx.metadata.get("errors") as {
        modelNotAllowed: (model: string) => { statusCode: number; body: unknown };
      };
      const err = errors?.modelNotAllowed(resolved.backend_model);
      throw new PipelineAbort(err?.statusCode ?? HTTP_FORBIDDEN, err?.body ?? {
        error: { type: "model_not_allowed", message: `Model '${resolved.backend_model}' not allowed` },
      });
    }
  },
};
